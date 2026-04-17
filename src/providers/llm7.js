/**
 * providers/llm7.js — LLM7 Provider (OpenAI-compatible)
 * Uses OpenAI SDK pointed at https://api.llm7.io/v1 for LLM7 inference.
 * No API key required — uses 'unused' as a placeholder.
 */

import OpenAI from 'openai';
import { BaseProvider } from './base.js';
import { getConfig } from '../config.js';

const BASE_URL = 'https://api.llm7.io/v1';

const DEFAULT_MODELS = [
  { id: 'codestral-latest',    name: 'Codestral',          context: '32K',     notes: 'Free, code-optimized' },
  { id: 'GLM-4.6V-Flash',     name: 'GLM 4.6V Flash',     context: 'unknown', notes: 'Free, multimodal' },
  { id: 'gpt-oss-20b',        name: 'GPT-OSS 20B',       context: 'unknown', notes: 'Free' },
  { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo', context: '131K', notes: 'Pro tier' },
  { id: 'ministral-8b-2512',  name: 'Ministral 8B',       context: '32K',     notes: 'Pro tier, multimodal' },
];

export class LLM7Provider extends BaseProvider {
  constructor() {
    super('LLM7');
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      const cfg = getConfig();
      const apiKey = cfg.llm7_api_key || process.env.LLM7_API_KEY || 'unused';
      this._client = new OpenAI({
        baseURL: BASE_URL,
        apiKey,
      });
    }
    return this._client;
  }

  isConfigured() {
    // LLM7 works without an API key (uses 'unused'), but also supports custom keys
    return true;
  }

  async fetchModels() {
    // Hardcoded — no API call needed
    return DEFAULT_MODELS;
  }

  async *streamChat({ messages, tools, systemPrompt, model }) {
    try {
      const client = this._getClient();
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

      const stream = await client.chat.completions.create(params);

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

export default LLM7Provider;
