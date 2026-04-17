/**
 * providers/base.js — Base AI Provider class
 * All providers (Gemini, Groq, LLM7, Nvidia, Mistral) extend this.
 */

export class BaseProvider {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this._modelsCache = null;
    this._modelsCacheTime = 0;
  }

  /** Return provider display name */
  getDisplayName() {
    return this.name;
  }

  /** Check if this provider is configured (has API key etc.) */
  isConfigured() {
    return false;
  }

  /**
   * Fetch available models from the API.
   * @returns {Promise<Array<{id: string, name: string, context: string, notes: string}>>}
   */
  async fetchModels() {
    throw new Error(`${this.name}: fetchModels() not implemented`);
  }

  /**
   * Get cached models (refreshes every 5 minutes).
   */
  async getModels() {
    const now = Date.now();
    if (this._modelsCache && (now - this._modelsCacheTime) < 300_000) {
      return this._modelsCache;
    }
    try {
      this._modelsCache = await this.fetchModels();
      this._modelsCacheTime = now;
    } catch (err) {
      if (this._modelsCache) return this._modelsCache;
      throw err;
    }
    return this._modelsCache;
  }

  /**
   * Stream a chat completion.
   * @param {object} params
   * @param {Array} params.messages - [{role, content, tool_calls?, name?, tool_call_id?}]
   * @param {Array} params.tools - Tool schemas
   * @param {string} params.systemPrompt
   * @param {string} params.model
   * @yields {{type: 'text'|'tool_calls'|'done'|'error', ...}}
   */
  async *streamChat({ messages, tools, systemPrompt, model }) {
    throw new Error(`${this.name}: streamChat() not implemented`);
  }
}
