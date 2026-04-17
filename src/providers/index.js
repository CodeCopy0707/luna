/**
 * providers/index.js — Provider Registry
 * Central hub for all AI providers. Handles initialization, routing,
 * model aggregation, and provider switching.
 */

import { GeminiProvider } from './gemini.js';
import { GroqProvider } from './groq.js';
import { LLM7Provider } from './llm7.js';
import { NvidiaProvider } from './nvidia.js';
import { MistralProvider } from './mistral.js';
import { OpenRouterProvider } from './openrouter.js';
import { getConfig, setConfig } from '../config.js';
import { getToolSchemas } from '../tools.js';

// ─── Provider Registry ────────────────────────────────────────────────────────

/** @type {Map<string, import('./base.js').BaseProvider>} */
const _providers = new Map();

/** @type {string} */
let _activeProviderName = '';

// Provider name → class mapping
const PROVIDER_CLASSES = {
  gemini:     GeminiProvider,
  groq:       GroqProvider,
  llm7:       LLM7Provider,
  nvidia:     NvidiaProvider,
  mistral:    MistralProvider,
  openrouter: OpenRouterProvider,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize all provider instances.
 * Should be called once at startup.
 * @returns {Map<string, import('./base.js').BaseProvider>}
 */
export function initProviders() {
  const cfg = getConfig();

  for (const [name, ProviderClass] of Object.entries(PROVIDER_CLASSES)) {
    if (!_providers.has(name)) {
      _providers.set(name, new ProviderClass());
    }
  }

  // Set the active provider from config, or default to 'gemini'
  _activeProviderName = cfg.active_provider || 'gemini';
  if (!_providers.has(_activeProviderName)) {
    _activeProviderName = 'gemini';
  }

  return _providers;
}

/**
 * Get a provider instance by name.
 * @param {string} name - Provider name ('gemini', 'groq', 'llm7', 'nvidia', 'mistral')
 * @returns {import('./base.js').BaseProvider|undefined}
 */
export function getProvider(name) {
  return _providers.get(name);
}

/**
 * Get the currently active provider.
 * @returns {import('./base.js').BaseProvider}
 */
export function getActiveProvider() {
  const provider = _providers.get(_activeProviderName);
  if (!provider) {
    // Fallback: try to init if not done yet
    if (_providers.size === 0) initProviders();
    return _providers.get(_activeProviderName) || _providers.get('gemini');
  }
  return provider;
}

/**
 * Switch the active provider.
 * @param {string} name - Provider name to switch to
 * @returns {import('./base.js').BaseProvider}
 * @throws {Error} if provider name is unknown
 */
export function setActiveProvider(name) {
  if (!_providers.has(name)) {
    const validNames = Array.from(_providers.keys()).join(', ');
    throw new Error(`Unknown provider: "${name}". Valid providers: ${validNames}`);
  }
  _activeProviderName = name;
  // Persist to config
  setConfig('active_provider', name);
  return _providers.get(name);
}

/**
 * Get all registered provider instances.
 * @returns {Map<string, import('./base.js').BaseProvider>}
 */
export function getAllProviders() {
  if (_providers.size === 0) initProviders();
  return _providers;
}

/**
 * Aggregate models from all configured (has API key) providers.
 * Each model is prefixed with its provider name for unambiguous selection.
 * @returns {Promise<Array<{id: string, name: string, context: string, notes: string, provider: string}>>}
 */
export async function getAllModels() {
  if (_providers.size === 0) initProviders();

  const allModels = [];

  for (const [name, provider] of _providers) {
    if (!provider.isConfigured()) continue;

    try {
      const models = await provider.getModels();
      for (const m of models) {
        allModels.push({
          ...m,
          provider: name,
          // Prefixed id for unambiguous routing: 'groq/llama-3.3-70b'
          prefixedId: `${name}/${m.id}`,
        });
      }
    } catch {
      // Skip providers that fail to fetch models
    }
  }

  return allModels;
}

/**
 * Route a streamChat call to the correct provider.
 *
 * Model routing logic:
 *   - If `model` contains '/' (e.g. 'groq/llama-3.3-70b'), split on the
 *     first '/' to determine provider name and model id.
 *   - Otherwise, use the currently active provider.
 *
 * @param {object} params
 * @param {Array}  params.messages
 * @param {Array}  [params.tools]
 * @param {string} [params.systemPrompt]
 * @param {string} [params.model]
 * @yields {{type: 'text'|'tool_calls'|'done'|'error', ...}}
 */
export async function* streamChat({ messages, tools, systemPrompt, model }) {
  if (_providers.size === 0) initProviders();

  let provider;
  let resolvedModel = model;

  if (model && model.includes('/')) {
    // Route by model prefix: 'groq/llama-3.3-70b' → provider='groq', model='llama-3.3-70b'
    const slashIdx = model.indexOf('/');
    const providerName = model.slice(0, slashIdx);
    const modelId = model.slice(slashIdx + 1);

    provider = _providers.get(providerName);
    if (!provider) {
      yield { type: 'error', error: `Unknown provider in model string: "${providerName}". Valid: ${Array.from(_providers.keys()).join(', ')}` };
      return;
    }
    resolvedModel = modelId;
  } else {
    // Use active provider
    provider = getActiveProvider();
  }

  if (!provider) {
    yield { type: 'error', error: 'No active provider configured. Run initProviders() first.' };
    return;
  }

  if (!provider.isConfigured()) {
    yield { type: 'error', error: `Provider "${provider.name}" is not configured (missing API key).` };
    return;
  }

  // Delegate to the provider's streamChat
  yield* provider.streamChat({
    messages,
    tools: tools || getToolSchemas(),
    systemPrompt: systemPrompt || '',
    model: resolvedModel,
  });
}

// ─── Re-exports for convenience ───────────────────────────────────────────────

export { getToolSchemas };
