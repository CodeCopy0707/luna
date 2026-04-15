/**
 * gemini.js — Google Gemini AI provider
 * Uses generateContentStream directly (not startChat) for full control
 * over the conversation history format.
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { getConfig } from './config.js';
import { getToolSchemas } from './tools.js';

let _client = null;

function getClient() {
  if (_client) return _client;
  const cfg = getConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY not set. Run: /config gemini_api_key=YOUR_KEY  or  export GEMINI_API_KEY=...'
    );
  }
  _client = new GoogleGenerativeAI(apiKey);
  return _client;
}

function toGeminiFunctionDeclarations(toolSchemas) {
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
 *   'tool'      → result of one tool call (name + content)
 *
 * Gemini `contents` rules:
 *   - roles alternate: 'user' / 'model'
 *   - a 'model' turn with functionCall parts must be immediately followed
 *     by a 'user' turn whose parts are ALL functionResponse objects
 *     (one per called function, grouped in a single turn)
 *   - a plain 'user' text turn must NOT contain functionResponse parts
 *
 * We walk the list sequentially and collapse consecutive 'tool' messages
 * that follow an 'assistant+tool_calls' turn into one 'user' turn.
 */
function buildContents(messages) {
  const contents = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    // ── system messages are handled via systemInstruction, skip here ──
    if (msg.role === 'system') { i++; continue; }

    // ── plain user text ───────────────────────────────────────────────
    if (msg.role === 'user') {
      const text = msg.content || '';
      if (text) {
        contents.push({ role: 'user', parts: [{ text }] });
      }
      i++;
      continue;
    }

    // ── assistant turn ────────────────────────────────────────────────
    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Model called one or more tools
        const parts = [];
        if (msg.content) parts.push({ text: msg.content });
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}'),
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
          try { parsed = JSON.parse(t.content); } catch { parsed = { result: t.content }; }
          responseParts.push({
            functionResponse: {
              name: t.name,
              response: parsed,   // must be a plain object
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

    // ── orphaned tool message (shouldn't happen) ──────────────────────
    i++;
  }

  return contents;
}

export async function* streamChat({ messages, tools = [], systemPrompt = '', model: modelOverride }) {
  const cfg = getConfig();
  const modelName = modelOverride || cfg.model || 'gemini-2.0-flash';
  const client = getClient();

  const toolSchemas = tools.length > 0 ? tools : getToolSchemas();
  const functionDeclarations = toGeminiFunctionDeclarations(toolSchemas);

  const genModel = client.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt || undefined,
    tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : [],
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
    generationConfig: {
      maxOutputTokens: cfg.max_tokens || 8192,
      temperature: 0.7,
    },
  });

  // Build the full contents array from the entire message history.
  // We do NOT use startChat/sendMessage — we call generateContentStream
  // directly with the complete contents so we own the format entirely.
  const nonSystem = messages.filter(m => m.role !== 'system');
  const contents = buildContents(nonSystem);

  if (contents.length === 0) {
    yield { type: 'error', error: 'No messages to send' };
    return;
  }

  try {
    const result = await genModel.generateContentStream({ contents });

    let textBuffer = '';
    let functionCalls = [];
    let usageMetadata = null;

    for await (const chunk of result.stream) {
      usageMetadata = chunk.usageMetadata;
      for (const candidate of chunk.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          if (part.text) {
            textBuffer += part.text;
            yield { type: 'text', text: part.text };
          }
          if (part.functionCall) {
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

    if (functionCalls.length > 0) {
      yield { type: 'tool_calls', tool_calls: functionCalls };
    }

    yield {
      type: 'done',
      text: textBuffer,
      tool_calls: functionCalls,
      usage: usageMetadata
        ? {
            input_tokens:  usageMetadata.promptTokenCount     || 0,
            output_tokens: usageMetadata.candidatesTokenCount || 0,
            total_tokens:  usageMetadata.totalTokenCount      || 0,
          }
        : null,
    };
  } catch (err) {
    yield { type: 'error', error: err.message };
  }
}

export async function countTokens(text, model) {
  const cfg = getConfig();
  const modelName = model || cfg.model || 'gemini-2.0-flash';
  try {
    const genModel = getClient().getGenerativeModel({ model: modelName });
    const result = await genModel.countTokens(text);
    return result.totalTokens;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro',       context: '1M', notes: 'Most capable' },
  { id: 'gemini-2.0-flash',             name: 'Gemini 2.0 Flash',      context: '1M', notes: 'Fast, recommended ✓' },
  { id: 'gemini-2.0-flash-lite',        name: 'Gemini 2.0 Flash Lite', context: '1M', notes: 'Fastest, cheapest' },
  { id: 'gemini-1.5-pro',               name: 'Gemini 1.5 Pro',        context: '2M', notes: 'Largest context' },
  { id: 'gemini-1.5-flash',             name: 'Gemini 1.5 Flash',      context: '1M', notes: 'Balanced' },
];
