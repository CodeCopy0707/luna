/**
 * providers/mistral.js — Mistral AI Provider
 * Uses the native @mistralai/mistralai SDK for direct Mistral API access.
 */

import { Mistral } from '@mistralai/mistralai';
import { BaseProvider } from './base.js';
import { getConfig } from '../config.js';

const DEFAULT_MODELS = [
  { id: 'mistral-large-latest',      name: 'Mistral Large',      context: '128K', notes: 'Most capable' },
  { id: 'mistral-large-2411',        name: 'Mistral Large 2411', context: '128K', notes: 'Latest stable' },
  { id: 'mistral-medium-latest',     name: 'Mistral Medium',     context: '32K',  notes: 'Balanced' },
  { id: 'mistral-small-latest',      name: 'Mistral Small',      context: '32K',  notes: 'Fast, cheapest' },
  { id: 'codestral-latest',          name: 'Codestral',          context: '32K',  notes: 'Code-optimized' },
  { id: 'ministral-3-8b-latest',     name: 'Ministral 8B',       context: '32K',  notes: 'Small & fast' },
  { id: 'pixtral-12b-2409',          name: 'Pixtral 12B',        context: '128K', notes: 'Vision-capable' },
];

export class MistralProvider extends BaseProvider {
  constructor() {
    super('Mistral');
    this._client = null;
  }

  /** Get or create the native Mistral client */
  _getClient() {
    if (this._client) return this._client;
    const apiKey = this._getApiKey();
    if (!apiKey) {
      throw new Error(
        'MISTRAL_API_KEY not set. Run: /config mistral_api_key=YOUR_KEY  or  export MISTRAL_API_KEY=...'
      );
    }
    this._client = new Mistral({ apiKey });
    return this._client;
  }

  /** Resolve API key from config or environment */
  _getApiKey() {
    const cfg = getConfig();
    return cfg.mistral_api_key || process.env.MISTRAL_API_KEY || '';
  }

  /** @override */
  isConfigured() {
    return !!this._getApiKey();
  }

  /** @override */
  getDisplayName() {
    return 'Mistral AI';
  }

  /**
   * Fetch available models from the Mistral API.
   * Falls back to the hardcoded default list on failure.
   * @override
   */
  async fetchModels() {
    try {
      const client = this._getClient();
      const response = await client.models.list();

      const models = [];
      const data = response.data || response;
      for (const m of data) {
        models.push({
          id: m.id,
          name: m.id,
          context: m.maxContextLength ? `${Math.round(m.maxContextLength / 1024)}K` : 'unknown',
          notes: m.ownedBy || '',
        });
      }

      return models.length > 0 ? models : DEFAULT_MODELS;
    } catch {
      return DEFAULT_MODELS;
    }
  }

  /**
   * Stream a chat completion via the native Mistral SDK.
   * @override
   * @param {object} params
   * @param {Array} params.messages
   * @param {Array} params.tools - Tool schemas
   * @param {string} params.systemPrompt
   * @param {string} params.model
   * @yields {{type: 'text'|'tool_calls'|'done'|'error', ...}}
   */
  async *streamChat({ messages, tools = [], systemPrompt = '', model }) {
    const cfg = getConfig();
    const modelName = model || 'mistral-large-latest';

    let client;
    try {
      client = this._getClient();
    } catch (err) {
      yield { type: 'error', error: err.message };
      return;
    }

    // Build the messages array for the API
    const apiMessages = [];

    // System prompt
    if (systemPrompt) {
      apiMessages.push({ role: 'system', content: systemPrompt });
    }

    // Convert internal message format
    for (const msg of messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'user') {
        apiMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const entry = { role: 'assistant' };
        
        // Only include content if it's actually present
        if (msg.content) {
          entry.content = msg.content;
        }
        
        // Add tool_calls if present
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          entry.toolCalls = msg.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }));
        }
        
        // Ensure message has either content or tool_calls
        if (!entry.content && !entry.toolCalls) {
          entry.content = '';
        }
        
        apiMessages.push(entry);
      } else if (msg.role === 'tool') {
        apiMessages.push({
          role: 'tool',
          toolCallId: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      }
    }

    // Build tool definitions for Mistral format (with safeguard against double-wrapping)
    const toolDefs = tools.length > 0
      ? tools.map(t => {
          if (t.type === 'function' && t.function) return t;
          return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } };
        })
      : undefined;

    try {
      // Use native Mistral SDK streaming via client.chat.stream()
      const stream = await client.chat.stream({
        model: modelName,
        messages: apiMessages,
        tools: toolDefs,
        maxTokens: cfg.max_tokens || 8192,
        temperature: 0.7,
      });

      let textBuffer = '';
      const toolCallsMap = new Map();

      for await (const event of stream) {
        const chunk = event.data ?? event;
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        const finishReason = choice.finishReason;

        // Accumulate text content
        if (delta?.content) {
          textBuffer += delta.content;
          yield { type: 'text', text: delta.content };
        }

        // Accumulate tool calls
        if (delta?.toolCalls) {
          for (const tc of delta.toolCalls) {
            const idx = tc.index ?? 0;
            if (!toolCallsMap.has(idx)) {
              toolCallsMap.set(idx, {
                id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                type: 'function',
                function: { name: '', arguments: '' },
              });
            }
            const existing = toolCallsMap.get(idx);
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.function.name += tc.function.name;
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
          }
        }

        // Handle finish
        if (finishReason === 'tool_calls' || finishReason === 'stop') {
          const toolCalls = Array.from(toolCallsMap.values());
          if (toolCalls.length > 0) {
            yield { type: 'tool_calls', tool_calls: toolCalls };
          }
          // Get usage from the final chunk
          const usage = chunk.usage ? {
            input_tokens: chunk.usage.promptTokens || 0,
            output_tokens: chunk.usage.completionTokens || 0,
            total_tokens: chunk.usage.totalTokens || 0,
          } : null;
          yield { type: 'done', text: textBuffer, tool_calls: toolCalls, usage };
          return;
        }
      }

      // If we exit the loop without a finish reason
      const toolCalls = Array.from(toolCallsMap.values());
      if (toolCalls.length > 0) {
        yield { type: 'tool_calls', tool_calls: toolCalls };
      }
      yield { type: 'done', text: textBuffer, tool_calls: toolCalls, usage: null };
    } catch (err) {
      yield { type: 'error', error: err.message };
    }
  }
}
