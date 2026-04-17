/**
 * config.js — Configuration management for Gemma Agent v2
 * Multi-provider support: Gemini, Groq, LLM7, Nvidia, Mistral
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Load .env from cwd ───────────────────────────────────────────────────────
function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
}
loadDotEnv();

const CONFIG_DIR = path.join(os.homedir(), '.gemma-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  // Active provider and model
  active_provider: 'gemini',
  model: 'gemini-2.0-flash',

  // Provider API keys
  gemini_api_key: '',
  groq_api_key: '',
  nvidia_api_key: '',
  mistral_api_key: '',
  llm7_api_key: '',
  openrouter_api_key: '',

  // General settings
  permission_mode: 'accept-all',
  verbose: false,
  max_tokens: 8192,
  rich_live: true,

  // Telegram
  telegram_token: '',
  telegram_chat_id: '',
  telegram_auto_start: false,

  // Session
  session_daily_limit: 5,
  session_history_limit: 100,

  // Worker pool
  max_parallel_workers: 4,

  // Cron
  cron_enabled: false,

  // Checkpoint
  checkpoint_enabled: true,
  max_checkpoints: 20,

  // Proactive
  proactive_interval: 0,
};

let _config = null;

export function ensureConfigDir() {
  for (const dir of [
    CONFIG_DIR,
    path.join(CONFIG_DIR, 'sessions', 'daily'),
    path.join(CONFIG_DIR, 'memory'),
    path.join(CONFIG_DIR, 'tasks'),
    path.join(CONFIG_DIR, 'checkpoints'),
    path.join(CONFIG_DIR, 'cron'),
  ]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadConfig() {
  ensureConfigDir();
  if (_config) return _config;

  let saved = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try { saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { saved = {}; }
  }

  _config = { ...DEFAULTS, ...saved };

  // Override with environment variables (highest priority)
  if (process.env.GEMINI_API_KEY)      _config.gemini_api_key   = process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY)      _config.gemini_api_key   = process.env.GOOGLE_API_KEY;
  if (process.env.GROQ_API_KEY)        _config.groq_api_key     = process.env.GROQ_API_KEY;
  if (process.env.NVIDIA_API_KEY)      _config.nvidia_api_key   = process.env.NVIDIA_API_KEY;
  if (process.env.MISTRAL_API_KEY)     _config.mistral_api_key  = process.env.MISTRAL_API_KEY;
  if (process.env.LLM7_API_KEY)        _config.llm7_api_key     = process.env.LLM7_API_KEY;
  if (process.env.OPENROUTER_API_KEY)   _config.openrouter_api_key = process.env.OPENROUTER_API_KEY;
  if (process.env.TELEGRAM_BOT_TOKEN)  _config.telegram_token   = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.TELEGRAM_CHAT_ID)    _config.telegram_chat_id = process.env.TELEGRAM_CHAT_ID;

  if (_config.telegram_token && _config.telegram_chat_id) {
    _config.telegram_auto_start = true;
  }

  return _config;
}

export function saveConfig(updates = {}) {
  ensureConfigDir();
  _config = { ...(loadConfig()), ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2), 'utf8');
  return _config;
}

export function getConfig() {
  return loadConfig();
}

export function setConfig(key, value) {
  const cfg = loadConfig();
  cfg[key] = value;
  saveConfig(cfg);
  return cfg;
}

export const CONFIG_DIR_PATH = CONFIG_DIR;
