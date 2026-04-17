/**
 * providers/nvidia.js — Nvidia Provider (OpenAI-compatible)
 * Uses OpenAI SDK pointed at https://integrate.api.nvidia.com/v1 for Nvidia NIM inference.
 */

import OpenAI from 'openai';
import { BaseProvider } from './base.js';
import { getConfig } from '../config.js';

const BASE_URL = 'https://integrate.api.nvidia.com/v1';

const DEFAULT_MODELS = [
  { id: 'mistralai/mistral-small-4-119b-2603', name: 'Mistral Small 4 119B', context: '32K', notes: 'Code-optimized' },
  { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', context: '128K', notes: 'Code-optimized' },
  { id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super 120B', context: '32K', notes: 'nvidia' },
  { id: 'qwen/qwen3.5-122b-a10b', name: 'Qwen 3.5 122B MoE', context: '32K', notes: 'Thinking model' },
  { id: 'google/gemma-3n-e2b-it', name: 'Gemma 3n E2B', context: '8K', notes: 'Code-optimized' },
  // { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 Instruct', context: '128K', notes: 'MoE' },
];

export class NvidiaProvider extends BaseProvider {
  constructor() {
    super('Nvidia');
    this._client = null;
  }

  _getClient() {
    if (!this._client) {
      const config = getConfig();
      const apiKey = config.nvidia_api_key || process.env.NVIDIA_API_KEY;
      if (!apiKey) throw new Error('Nvidia API key not configured. Set nvidia_api_key in config or NVIDIA_API_KEY env var.');
      this._client = new OpenAI({
        baseURL: BASE_URL,
        apiKey,
      });
    }
    return this._client;
  }

  isConfigured() {
    const config = getConfig();
    return !!(config.nvidia_api_key || process.env.NVIDIA_API_KEY);
  }

  async fetchModels() {
    // Hardcoded — no API call needed
    return DEFAULT_MODELS;
  }

  /**
   * Check if the model is a thinking/reasoning model that supports enable_thinking.
   * Currently matches models containing 'qwen3' (case-insensitive).
   */
  _isThinkingModel(modelName) {
    return /qwen3/i.test(modelName);
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

      // Enable thinking/reasoning for supported models (e.g. qwen3.5-*)
      if (this._isThinkingModel(resolvedModel)) {
        params.chat_template_kwargs = { enable_thinking: true };
        params.max_tokens = 16384;
      }

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

export default NvidiaProvider;
