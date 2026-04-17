/**
 * providers/groq.js — Groq Provider (OpenAI-compatible)
 * Uses groq-sdk for fast inference on open-source models.
 */

import { Groq } from 'groq-sdk';
import { BaseProvider } from './base.js';
import { getConfig } from '../config.js';

const DEFAULT_MODELS = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B',    context: '128K', notes: 'Most capable' },
  { id: 'llama-3.1-8b-instant',    name: 'Llama 3.1 8B',     context: '128K', notes: 'Fast' },
  { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B',    context: '128K', notes: 'Versatile' },
  { id: 'gemma2-9b-it',            name: 'Gemma 2 9B',       context: '8K',   notes: 'Google' },
  { id: 'mixtral-8x7b-32768',      name: 'Mixtral 8x7B',     context: '32K',  notes: 'Mistral MoE' },
];

export class GroqProvider extends BaseProvider {
  constructor() {
    super('Groq');
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      const config = getConfig();
      const apiKey = config.groq_api_key || process.env.GROQ_API_KEY;
      if (!apiKey) throw new Error('Groq API key not configured. Set groq_api_key in config or GROQ_API_KEY env var.');
      this._client = new Groq({ apiKey });
    }
    return this._client;
  }

  isConfigured() {
    const config = getConfig();
    return !!(config.groq_api_key || process.env.GROQ_API_KEY);
  }

  async fetchModels() {
    // Hardcoded — no API call needed
    return DEFAULT_MODELS;
  }

  async *streamChat({ messages, tools, systemPrompt, model }) {
    try {
      const groq = this._getClient();
      const resolvedModel = model || DEFAULT_MODELS[0].id;

      // Build messages array with system prompt
      const apiMessages = [];
      if (systemPrompt) {
        apiMessages.push({ role: 'system', content: systemPrompt });
      }
      for (const msg of messages) {
        if (msg.role === 'system') continue;
        
        const m = { role: msg.role };
        
        // Only include content if actual content exists
        if (msg.content) {
          m.content = msg.content;
        }
        
        // Add tool_calls if present
        if (msg.tool_calls) {
          m.tool_calls = msg.tool_calls;
        }
        
        // Add tool_call_id and name for tool messages
        if (msg.tool_call_id) {
          m.tool_call_id = msg.tool_call_id;
          if (msg.name) m.name = msg.name;
        }
        
        // Ensure message has content (for messages without tool_calls)
        if (!m.content && msg.role !== 'tool') {
          m.content = '';
        }
        
        apiMessages.push(m);
      }

      // Build request params
      const params = {
        model: resolvedModel,
        messages: apiMessages,
        stream: true,
      };

      if (tools && tools.length > 0) {
        // Wrap tools in OpenAI-compatible format (with safeguard against double-wrapping)
        params.tools = tools.map(t => {
          if (t.type === 'function' && t.function) return t;
          return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } };
        });
        params.tool_choice = 'auto';
      }

      const stream = await groq.chat.completions.create(params);

      let textBuffer = '';
      const toolCalls = {};

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        const finishReason = chunk.choices?.[0]?.finish_reason;

        if (!delta && !finishReason) continue;

        // Handle text content
        if (delta?.content) {
          textBuffer += delta.content;
          yield { type: 'text', text: delta.content };
        }

        // Handle tool calls (streaming accumulation)
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCalls[idx]) {
              toolCalls[idx] = {
                id: tc.id || '',
                type: 'function',
                function: {
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || '',
                },
              };
            } else {
              if (tc.id) toolCalls[idx].id = tc.id;
              if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
            }
          }
        }

        // Handle finish
        if (finishReason === 'tool_calls' || finishReason === 'stop') {
          const toolCallsArray = Object.values(toolCalls);
          if (toolCallsArray.length > 0) {
            yield {
              type: 'tool_calls',
              tool_calls: toolCallsArray.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                },
              })),
            };
          }
          yield { type: 'done', finishReason };
          return;
        }
      }

      // If we exit the loop without a finish_reason
      const toolCallsArray = Object.values(toolCalls);
      if (toolCallsArray.length > 0) {
        yield {
          type: 'tool_calls',
          tool_calls: toolCallsArray.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        };
      }
      yield { type: 'done', finishReason: 'stop' };
    } catch (err) {
      yield { type: 'error', error: err.message || String(err) };
    }
  }
}

export default GroqProvider;
