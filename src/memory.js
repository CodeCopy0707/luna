/**
 * memory.js — Persistent memory system
 * Stores memories as JSON files in ~/.gemma-agent/memory/
 */

import fs from 'fs';
import path from 'path';
import { CONFIG_DIR_PATH } from './config.js';
import { registerTool } from './tools.js';

const MEMORY_DIR = path.join(CONFIG_DIR_PATH, 'memory');
const MEMORY_INDEX = path.join(MEMORY_DIR, 'MEMORY.md');

export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function memoryFilePath(name, scope = 'user') {
  const dir = scope === 'project'
    ? path.join(process.cwd(), '.gemma-agent', 'memory')
    : MEMORY_DIR;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.json`);
}

function rebuildIndex() {
  ensureMemoryDir();
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json'));
  const lines = ['# Memory Index\n'];
  for (const file of files) {
    try {
      const mem = JSON.parse(fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8'));
      lines.push(`## ${mem.name} [${mem.type}/${mem.scope}] conf:${Math.round((mem.confidence || 1) * 100)}%`);
      lines.push(`${mem.description}`);
      lines.push('');
    } catch {}
  }
  fs.writeFileSync(MEMORY_INDEX, lines.join('\n'), 'utf8');
}

export function saveMemory({ name, type = 'user', description, content, scope = 'user', confidence = 1.0, source = 'user' }) {
  ensureMemoryDir();
  const filePath = memoryFilePath(name, scope);
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
  
  const mem = {
    name,
    type,
    description,
    content,
    scope,
    confidence,
    source,
    created: existing?.created || new Date().toISOString(),
    updated: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
  };
  
  fs.writeFileSync(filePath, JSON.stringify(mem, null, 2), 'utf8');
  rebuildIndex();
  
  const conflict = existing && existing.content !== content;
  return { saved: true, name, conflict, old_content: conflict ? existing.content : undefined };
}

export function deleteMemory(name, scope = 'user') {
  const filePath = memoryFilePath(name, scope);
  if (!fs.existsSync(filePath)) return { error: `Memory '${name}' not found` };
  fs.unlinkSync(filePath);
  rebuildIndex();
  return { deleted: true, name };
}

export function searchMemory(query, scope = 'all', maxResults = 10) {
  ensureMemoryDir();
  const dirs = scope === 'all'
    ? [MEMORY_DIR, path.join(process.cwd(), '.gemma-agent', 'memory')]
    : scope === 'project'
      ? [path.join(process.cwd(), '.gemma-agent', 'memory')]
      : [MEMORY_DIR];
  
  const memories = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const mem = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        memories.push(mem);
      } catch {}
    }
  }
  
  if (!query) return memories.slice(0, maxResults);
  
  const q = query.toLowerCase();
  const scored = memories.map(m => {
    let score = 0;
    if (m.name?.toLowerCase().includes(q)) score += 3;
    if (m.description?.toLowerCase().includes(q)) score += 2;
    if (m.content?.toLowerCase().includes(q)) score += 1;
    
    // Recency decay (30-day)
    const daysSince = (Date.now() - new Date(m.last_used_at || m.updated || m.created).getTime()) / (1000 * 60 * 60 * 24);
    const recency = Math.exp(-daysSince / 30);
    const finalScore = score * (m.confidence || 1) * recency;
    return { ...m, _score: finalScore };
  });
  
  return scored
    .filter(m => m._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, maxResults);
}

export function listMemories(scope = 'all') {
  return searchMemory('', scope, 100);
}

export function getMemoryContext() {
  if (!fs.existsSync(MEMORY_INDEX)) return '';
  const content = fs.readFileSync(MEMORY_INDEX, 'utf8');
  if (content.length > 5000) return content.slice(0, 5000) + '\n...(truncated)';
  return content;
}

// ─── Register Memory Tools ────────────────────────────────────────────────────

registerTool({
  name: 'memory_save',
  description: 'Save a persistent memory for future sessions. Use for user preferences, project decisions, feedback corrections.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Unique name/key for this memory' },
      type: { type: 'string', enum: MEMORY_TYPES, description: 'Memory type: user, feedback, project, reference' },
      description: { type: 'string', description: 'Short description of what this memory is about' },
      content: { type: 'string', description: 'The actual memory content to store' },
      scope: { type: 'string', enum: ['user', 'project'], description: 'user = global, project = this project only' },
    },
    required: ['name', 'description', 'content'],
  },
  readOnly: false,
  async execute(args) {
    return saveMemory(args);
  },
});

registerTool({
  name: 'memory_delete',
  description: 'Delete a persistent memory by name.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the memory to delete' },
      scope: { type: 'string', enum: ['user', 'project'], description: 'Scope of the memory' },
    },
    required: ['name'],
  },
  readOnly: false,
  async execute({ name, scope }) {
    return deleteMemory(name, scope);
  },
});

registerTool({
  name: 'memory_search',
  description: 'Search persistent memories by keyword. Returns ranked results.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      scope: { type: 'string', enum: ['user', 'project', 'all'], description: 'Scope to search' },
      max_results: { type: 'number', description: 'Maximum results (default: 10)' },
    },
    required: ['query'],
  },
  readOnly: true,
  async execute({ query, scope = 'all', max_results = 10 }) {
    return { memories: searchMemory(query, scope, max_results) };
  },
});

registerTool({
  name: 'memory_list',
  description: 'List all persistent memories.',
  parameters: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['user', 'project', 'all'], description: 'Scope to list' },
    },
    required: [],
  },
  readOnly: true,
  async execute({ scope = 'all' }) {
    return { memories: listMemories(scope) };
  },
});
