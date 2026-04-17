/**
 * providers/openrouter.js — OpenRouter Provider (OpenAI-compatible)
 * Uses OpenAI SDK pointed at https://openrouter.ai/api/v1 for multi-model routing.
 * Supports hundreds of models from OpenAI, Anthropic, Google, Meta, Mistral, etc.
 */

import OpenAI from 'openai';
import { BaseProvider } from './base.js';
import { getConfig } from '../config.js';

const BASE_URL = 'https://openrouter.ai/api/v1';

const DEFAULT_MODELS = [
  // Free models (no cost per token, :free suffix)
  { id: 'google/gemini-2.0-flash-exp:free',          name: 'Gemini 2.0 Flash',         context: '256K', notes: 'Free, Google, fast' },
  { id: 'qwen/qwen3-235b-a22b:free',                 name: 'Qwen 3 235B MoE',         context: '200K', notes: 'Free, tool calling' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free',    name: 'Llama 3.3 70B',           context: '131K', notes: 'Free, strong reasoning' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free',       name: 'Nemotron 3 Nano 30B',     context: '262K', notes: 'Free, hybrid arch' },
  { id: 'openai/gpt-oss-20b:free',                   name: 'GPT-OSS 20B',             context: '128K', notes: 'Free, open-weight' },
  { id: 'deepseek/deepseek-r1:free',                 name: 'DeepSeek R1',             context: '128K', notes: 'Free, reasoning' },
  // Paid models (for users with credits)
  { id: 'anthropic/claude-sonnet-4',                  name: 'Claude Sonnet 4',         context: '200K', notes: 'Paid, Anthropic' },
  { id: 'openai/gpt-4.1-mini',                       name: 'GPT-4.1 Mini',            context: '1M',   notes: 'Paid, OpenAI' },
  { id: 'google/gemini-2.5-flash-preview',            name: 'Gemini 2.5 Flash',        context: '1M',   notes: 'Paid, Google' },
];

export class OpenRouterProvider extends BaseProvider {
  constructor() {
    super('OpenRouter');
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      const config = getConfig();
      const apiKey = config.openrouter_api_key || process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OpenRouter API key not configured. Set openrouter_api_key in config or OPENROUTER_API_KEY env var.');
      this._client = new OpenAI({
        baseURL: BASE_URL,
        apiKey,
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/gemma-agent',
          'X-Title': 'Gemma Agent',
        },
      });
    }
    return this._client;
  }

  isConfigured() {
    const config = getConfig();
    return !!(config.openrouter_api_key || process.env.OPENROUTER_API_KEY);
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

export default OpenRouterProvider;
