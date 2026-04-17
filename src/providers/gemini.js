/**
 * providers/gemini.js — Google Gemini AI provider (NEW @google/genai SDK)
 *
 * Uses the @google/genai package (GoogleGenAI class) — NOT the older
 * @google/generative-ai package.  Streams via ai.models.generateContentStream()
 * and lists models via ai.models.list().
 */

import { GoogleGenAI } from '@google/genai';
import { BaseProvider } from './base.js';
import { getConfig } from '../config.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert tool schemas (OpenAI-style) to Gemini functionDeclarations.
 */
function toFunctionDeclarations(toolSchemas) {
  return toolSchemas.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Convert our internal message list into a Gemini `contents` array.
 *
 * Internal roles:
 *   'user'      → plain text from the human
 *   'assistant' → model reply, may carry tool_calls[]
 *   'tool'      → result of one tool call (name, tool_call_id, content)
 *   'system'    → handled via systemInstruction, skipped here
 *
 * Gemini `contents` rules:
 *   - roles are 'user' or 'model'
 *   - a 'model' turn with functionCall parts must be immediately followed
 *     by a 'user' turn whose parts are ALL functionResponse objects
 *     (one per called function, grouped in a single turn)
 *   - a plain 'user' text turn must NOT contain functionResponse parts
 */
function buildContents(messages) {
  const contents = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // ── system messages handled via systemInstruction, skip ──
    if (msg.role === 'system') {
      i++;
      continue;
    }

    // ── plain user text ─────────────────────────────────────
    if (msg.role === 'user') {
      const text = msg.content || '';
      if (text) {
        contents.push({ role: 'user', parts: [{ text }] });
      }
      i++;
      continue;
    }

    // ── assistant turn ──────────────────────────────────────
    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Model called one or more tools
        const parts = [];
        if (msg.content) parts.push({ text: msg.content });

        for (const tc of msg.tool_calls) {
          let args;
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            args = {};
          }
          parts.push({
            functionCall: {
              name: tc.function.name,
              args,
            },
          });
        }
        contents.push({ role: 'model', parts });
        i++;

        // Consume ALL immediately following 'tool' messages into ONE user turn
        const responseParts = [];
        while (i < messages.length && messages[i].role === 'tool') {
          const t = messages[i];
          let parsed;
          try {
            parsed = JSON.parse(t.content);
          } catch {
            parsed = { result: t.content };
          }
          responseParts.push({
            functionResponse: {
              name: t.name,
              response: parsed, // must be a plain object
            },
          });
          i++;
        }
        if (responseParts.length > 0) {
          contents.push({ role: 'user', parts: responseParts });
        }
      } else {
        // Plain model text
        contents.push({ role: 'model', parts: [{ text: msg.content || '' }] });
        i++;
      }
      continue;
    }

    // ── orphaned tool message (shouldn't normally happen) ───
    if (msg.role === 'tool') {
      // Try to wrap it as a user functionResponse anyway
      let parsed;
      try {
        parsed = JSON.parse(msg.content);
      } catch {
        parsed = { result: msg.content };
      }
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: msg.name || 'unknown',
            response: parsed,
          },
        }],
      });
      i++;
      continue;
    }

    // ── anything else, skip ─────────────────────────────────
    i++;
  }

  return contents;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class GeminiProvider extends BaseProvider {
  constructor() {
    super('Gemini');
    this._client = null;
  }

  /** Lazily create (or return cached) GoogleGenAI client */
  _getClient() {
    if (this._client) return this._client;
    const cfg = getConfig();
    const apiKey = cfg.gemini_api_key;
    if (!apiKey) {
      throw new Error(
        'GEMINI_API_KEY not set. Run: /config gemini_api_key=YOUR_KEY  or  export GEMINI_API_KEY=...'
      );
    }
    this._client = new GoogleGenAI({ apiKey });
    return this._client;
  }

  /** Check whether the provider has a usable API key */
  isConfigured() {
    const cfg = getConfig();
    return !!(cfg.gemini_api_key);
  }

  /**
   * Fetch available models from the Gemini API.
   * @returns {Promise<Array<{id: string, name: string, context: string, notes: string}>>}
   */
  async fetchModels() {
    const ai = this._getClient();

    try {
      const models = [];
      const pager = await ai.models.list();

      // The SDK returns an async iterable (or a page object with .models)
      if (pager && Symbol.asyncIterator in Object(pager)) {
        for await (const model of pager) {
          if (!model.name) continue;
          // model.name is like "models/gemini-2.0-flash" — strip prefix
          const id = model.name.replace(/^models\//, '');
          // Only include generative models (skip embedding etc.)
          if (!id.startsWith('gemini')) continue;
          models.push({
            id,
            name: model.displayName || id,
            context: model.inputTokenLimit
              ? `${Math.round(model.inputTokenLimit / 1000)}K`
              : 'unknown',
            notes: model.description
              ? model.description.slice(0, 80)
              : '',
          });
        }
      } else if (pager && Array.isArray(pager.models)) {
        for (const model of pager.models) {
          if (!model.name) continue;
          const id = model.name.replace(/^models\//, '');
          if (!id.startsWith('gemini')) continue;
          models.push({
            id,
            name: model.displayName || id,
            context: model.inputTokenLimit
              ? `${Math.round(model.inputTokenLimit / 1000)}K`
              : 'unknown',
            notes: model.description
              ? model.description.slice(0, 80)
              : '',
          });
        }
      }

      // If API returned nothing useful, fall back to known list
      if (models.length === 0) {
        return FALLBACK_MODELS;
      }

      return models;
    } catch (err) {
      // On failure fall back to a curated list
      return FALLBACK_MODELS;
    }
  }

  /**
   * Stream a chat completion via Gemini.
   *
   * @param {object} params
   * @param {Array}  params.messages     - Internal format messages
   * @param {Array}  params.tools        - Tool schemas (OpenAI-style)
   * @param {string} params.systemPrompt - System instruction text
   * @param {string} params.model        - Model id override
   * @yields {{type: 'text'|'tool_calls'|'done'|'error', ...}}
   */
  async *streamChat({ messages, tools = [], systemPrompt = '', model: modelOverride }) {
    const cfg = getConfig();
    const modelName = modelOverride || cfg.model || 'gemini-2.0-flash';

    let ai;
    try {
      ai = this._getClient();
    } catch (err) {
      yield { type: 'error', error: err.message };
      return;
    }

    // Build tools config
    const functionDeclarations = tools.length > 0
      ? toFunctionDeclarations(tools)
      : [];

    // Build contents from message history (skip system — passed separately)
    const contents = buildContents(messages);

    if (contents.length === 0) {
      yield { type: 'error', error: 'No messages to send' };
      return;
    }

    // Assemble the config object for the new SDK
    const requestConfig = {
      maxOutputTokens: cfg.max_tokens || 8192,
      temperature: 0.7,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',         threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',  threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT',  threshold: 'BLOCK_NONE' },
      ],
    };

    if (systemPrompt) {
      requestConfig.systemInstruction = systemPrompt;
    }

    if (functionDeclarations.length > 0) {
      requestConfig.tools = [{ functionDeclarations }];
    }

    try {
      // Use the new SDK streaming method: ai.models.generateContentStream()
      const responseStream = await ai.models.generateContentStream({
        model: modelName,
        contents,
        config: requestConfig,
      });

      let textBuffer = '';
      let functionCalls = [];
      let usageMetadata = null;

      for await (const chunk of responseStream) {
        // Track usage metadata if present
        if (chunk.usageMetadata) {
          usageMetadata = chunk.usageMetadata;
        }

        // Handle text content
        if (chunk.text) {
          textBuffer += chunk.text;
          yield { type: 'text', text: chunk.text };
        }

        // Handle function calls
        if (chunk.functionCalls && chunk.functionCalls.length > 0) {
          for (const fc of chunk.functionCalls) {
            functionCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'function',
              function: {
                name: fc.name,
                arguments: JSON.stringify(fc.args || {}),
              },
            });
          }
        }

        // Also check candidates for parts (fallback path)
        if (chunk.candidates) {
          for (const candidate of chunk.candidates) {
            const parts = candidate.content?.parts || [];
            for (const part of parts) {
              if (part.text && !chunk.text) {
                // Only if we didn't already get text from chunk.text
                textBuffer += part.text;
                yield { type: 'text', text: part.text };
              }
              if (part.functionCall && (!chunk.functionCalls || chunk.functionCalls.length === 0)) {
                // Only if we didn't already get functionCalls from chunk.functionCalls
                functionCalls.push({
                  id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                  type: 'function',
                  function: {
                    name: part.functionCall.name,
                    arguments: JSON.stringify(part.functionCall.args || {}),
                  },
                });
              }
            }
          }
        }
      }

      // Emit tool_calls event if any were collected
      if (functionCalls.length > 0) {
        yield { type: 'tool_calls', tool_calls: functionCalls };
      }

      // Build usage info
      const usage = usageMetadata
        ? {
            input_tokens:  usageMetadata.promptTokenCount     || 0,
            output_tokens: usageMetadata.candidatesTokenCount || 0,
            total_tokens:  usageMetadata.totalTokenCount      || 0,
          }
        : null;

      // Emit done
      yield {
        type: 'done',
        text: textBuffer,
        tool_calls: functionCalls,
        usage,
      };
    } catch (err) {
      yield { type: 'error', error: err.message };
    }
  }
}

// ─── Fallback model list (used when API listing fails) ────────────────────────

const FALLBACK_MODELS = [
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro',        context: '1M',  notes: 'Most capable' },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash',   context: '1M',  notes: 'Fast + thinking' },
  { id: 'gemini-2.0-flash',              name: 'Gemini 2.0 Flash',     context: '1M',  notes: 'Fast, recommended ✓' },
  { id: 'gemini-2.0-flash-lite',         name: 'Gemini 2.0 Flash Lite', context: '1M', notes: 'Fastest, cheapest' },
  { id: 'gemini-1.5-pro',                name: 'Gemini 1.5 Pro',       context: '2M',  notes: 'Largest context' },
  { id: 'gemini-1.5-flash',              name: 'Gemini 1.5 Flash',     context: '1M',  notes: 'Balanced' },
];
