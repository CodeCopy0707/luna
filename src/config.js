/**
 * config.js — Configuration management for Gemma Agent
 * Loads/saves config from ~/.gemma-agent/config.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.gemma-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  model: 'gemini-2.0-flash',
  gemini_api_key: '',
  permission_mode: 'auto',   // auto | accept-all | manual
  verbose: false,
  max_tokens: 8192,
  telegram_token: '',
  telegram_chat_id: '',
  telegram_auto_start: false,
  session_daily_limit: 5,
  session_history_limit: 100,
  rich_live: true,
  proactive_interval: 0,
};

let _config = null;

export function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const sessionsDir = path.join(CONFIG_DIR, 'sessions', 'daily');
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
  const memoryDir = path.join(CONFIG_DIR, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  const tasksDir = path.join(CONFIG_DIR, 'tasks');
  if (!fs.existsSync(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
  }
}

export function loadConfig() {
  ensureConfigDir();
  if (_config) return _config;
  
  let saved = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      saved = {};
    }
  }
  
  _config = { ...DEFAULTS, ...saved };
  
  // Override with environment variables
  if (process.env.GEMINI_API_KEY) _config.gemini_api_key = process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) _config.gemini_api_key = process.env.GOOGLE_API_KEY;
  
  return _config;
}

export function saveConfig(updates = {}) {
  ensureConfigDir();
  _config = { ...(loadConfig()), ...updates };
  
  // Don't save env-var keys to disk if they came from env
  const toSave = { ..._config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), 'utf8');
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
