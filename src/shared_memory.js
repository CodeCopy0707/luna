/**
 * shared_memory.js — Shared memory system for agent collaboration
 * Allows agents and subagents to communicate, share results, and help each other.
 * Persists to .gemma-agent/shared_memory.json
 */

import fs from 'fs';
import path from 'path';
import { registerTool } from './tools.js';

const SHARED_MEMORY_DIR = path.join(process.cwd(), '.gemma-agent');
const SHARED_MEMORY_FILE = path.join(SHARED_MEMORY_DIR, 'shared_memory.json');

// ─── In-Memory Store ──────────────────────────────────────────────────────────

const _store = new Map();
const _stuckAgents = new Map();

// ─── Persistence Helpers ──────────────────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(SHARED_MEMORY_DIR)) fs.mkdirSync(SHARED_MEMORY_DIR, { recursive: true });
}

function loadFromDisk() {
  ensureDir();
  if (!fs.existsSync(SHARED_MEMORY_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(SHARED_MEMORY_FILE, 'utf8'));
    if (data.store) {
      for (const [key, value] of Object.entries(data.store)) {
        _store.set(key, value);
      }
    }
    if (data.stuckAgents) {
      for (const [key, value] of Object.entries(data.stuckAgents)) {
        _stuckAgents.set(key, value);
      }
    }
  } catch {}
}

function persistToDisk() {
  ensureDir();
  const data = {
    store: Object.fromEntries(_store),
    stuckAgents: Object.fromEntries(_stuckAgents),
    updated: new Date().toISOString(),
  };
  fs.writeFileSync(SHARED_MEMORY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Load existing data on module init
loadFromDisk();

// ─── Shared Memory API ───────────────────────────────────────────────────────

/**
 * Write a value to shared memory with a key.
 * @param {string} key - Unique key for the entry
 * @param {*} value - The value to store
 * @param {string} agentId - ID of the writing agent
 */
export function sharedWrite(key, value, agentId) {
  const entry = {
    key,
    value,
    agentId: agentId || 'unknown',
    created: _store.has(key) ? _store.get(key).created : new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  _store.set(key, entry);
  persistToDisk();
  return { success: true, key, agentId: entry.agentId };
}

/**
 * Read a value from shared memory by key.
 * @param {string} key - Key to look up
 */
export function sharedRead(key) {
  if (!_store.has(key)) {
    return { error: `Key '${key}' not found in shared memory` };
  }
  const entry = _store.get(key);
  entry.last_read_at = new Date().toISOString();
  _store.set(key, entry);
  persistToDisk();
  return { ...entry };
}

/**
 * List all shared memory entries.
 */
export function sharedList() {
  const entries = [];
  for (const [key, entry] of _store) {
    entries.push({
      key,
      agentId: entry.agentId,
      created: entry.created,
      updated: entry.updated,
      preview: typeof entry.value === 'string'
        ? entry.value.slice(0, 120)
        : JSON.stringify(entry.value).slice(0, 120),
    });
  }
  return { entries, count: entries.length };
}

/**
 * Signal that an agent is stuck and needs help.
 * @param {string} agentId - ID of the stuck agent
 * @param {string} taskDescription - Description of the task the agent is stuck on
 * @param {string} context - Additional context about the problem
 */
export function signalStuck(agentId, taskDescription, context) {
  const stuckEntry = {
    agentId,
    taskDescription,
    context: context || '',
    signaled_at: new Date().toISOString(),
    status: 'stuck',
    helpers: [],
  };
  _stuckAgents.set(agentId, stuckEntry);
  persistToDisk();
  return { success: true, agentId, status: 'stuck' };
}

/**
 * Get list of agents that are stuck and need help.
 */
export function getStuckAgents() {
  const stuck = [];
  for (const [agentId, entry] of _stuckAgents) {
    if (entry.status === 'stuck') {
      stuck.push({ ...entry });
    }
  }
  return { stuckAgents: stuck, count: stuck.length };
}

/**
 * Offer help to a stuck agent.
 * @param {string} helperId - ID of the agent offering help
 * @param {string} stuckAgentId - ID of the stuck agent to help
 * @param {string} suggestion - Suggestion or solution from the helper
 */
export function offerHelp(helperId, stuckAgentId, suggestion) {
  if (!_stuckAgents.has(stuckAgentId)) {
    return { error: `Agent '${stuckAgentId}' is not in the stuck list` };
  }
  const entry = _stuckAgents.get(stuckAgentId);
  entry.helpers.push({
    helperId,
    suggestion,
    offered_at: new Date().toISOString(),
  });
  entry.status = 'helped';
  _stuckAgents.set(stuckAgentId, entry);
  persistToDisk();
  return { success: true, helperId, stuckAgentId, status: 'helped' };
}

/**
 * Clear all shared memory entries and stuck signals.
 */
export function clearShared() {
  _store.clear();
  _stuckAgents.clear();
  persistToDisk();
  return { success: true, cleared: true };
}

// ─── Register Shared Memory Tools ─────────────────────────────────────────────

registerTool({
  name: 'shared_memory_write',
  description: 'Write data to shared memory for other agents to read. Use to share results, intermediate data, or signals between agents.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Unique key for this shared memory entry' },
      value: { type: 'string', description: 'The value/data to store (string or JSON-encoded)' },
      agent_id: { type: 'string', description: 'ID of the agent writing the data' },
    },
    required: ['key', 'value'],
  },
  readOnly: false,
  async execute({ key, value, agent_id }) {
    return sharedWrite(key, value, agent_id);
  },
});

registerTool({
  name: 'shared_memory_read',
  description: 'Read data from shared memory written by another agent.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Key of the shared memory entry to read' },
    },
    required: ['key'],
  },
  readOnly: true,
  async execute({ key }) {
    return sharedRead(key);
  },
});

registerTool({
  name: 'shared_memory_list',
  description: 'List all shared memory entries with previews. Use to discover what data other agents have shared.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  readOnly: true,
  async execute() {
    return sharedList();
  },
});

registerTool({
  name: 'shared_memory_signal_stuck',
  description: 'Signal that the current agent is stuck on a task and needs help from another agent.',
  parameters: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', description: 'ID of the agent that is stuck' },
      task_description: { type: 'string', description: 'Description of the task the agent is stuck on' },
      context: { type: 'string', description: 'Additional context about why the agent is stuck' },
    },
    required: ['agent_id', 'task_description'],
  },
  readOnly: false,
  async execute({ agent_id, task_description, context }) {
    return signalStuck(agent_id, task_description, context);
  },
});

registerTool({
  name: 'shared_memory_get_stuck',
  description: 'Check if any agents need help. Returns a list of stuck agents with their task descriptions.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  readOnly: true,
  async execute() {
    return getStuckAgents();
  },
});
