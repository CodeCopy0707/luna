/**
 * tasks.js — Task management system
 * Tracks multi-step work with dependency edges
 */

import fs from 'fs';
import path from 'path';
import { registerTool } from './tools.js';

const TASKS_FILE = path.join(process.cwd(), '.gemma-agent', 'tasks.json');

let _tasks = null;
let _nextId = 1;

function ensureTasksDir() {
  const dir = path.dirname(TASKS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadTasks() {
  if (_tasks) return _tasks;
  ensureTasksDir();
  if (fs.existsSync(TASKS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
      _tasks = data.tasks || [];
      _nextId = data.next_id || (_tasks.length + 1);
    } catch {
      _tasks = [];
    }
  } else {
    _tasks = [];
  }
  return _tasks;
}

function saveTasks() {
  ensureTasksDir();
  fs.writeFileSync(TASKS_FILE, JSON.stringify({ tasks: _tasks, next_id: _nextId }, null, 2), 'utf8');
}

export const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled', 'deleted'];

export function createTask({ subject, description = '', metadata = {} }) {
  loadTasks();
  const task = {
    id: String(_nextId++),
    subject,
    description,
    status: 'pending',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    blocks: [],
    blocked_by: [],
    metadata,
  };
  _tasks.push(task);
  saveTasks();
  return task;
}

export function updateTask({ task_id, subject, description, status, add_blocks = [], add_blocked_by = [], metadata }) {
  loadTasks();
  const task = _tasks.find(t => t.id === String(task_id));
  if (!task) return { error: `Task #${task_id} not found` };
  
  if (subject !== undefined) task.subject = subject;
  if (description !== undefined) task.description = description;
  if (status !== undefined) task.status = status;
  if (metadata !== undefined) task.metadata = { ...task.metadata, ...metadata };
  task.updated = new Date().toISOString();
  
  // Add dependency edges
  for (const blockId of add_blocks) {
    const sid = String(blockId);
    if (!task.blocks.includes(sid)) task.blocks.push(sid);
    const other = _tasks.find(t => t.id === sid);
    if (other && !other.blocked_by.includes(task.id)) other.blocked_by.push(task.id);
  }
  for (const blockId of add_blocked_by) {
    const sid = String(blockId);
    if (!task.blocked_by.includes(sid)) task.blocked_by.push(sid);
    const other = _tasks.find(t => t.id === sid);
    if (other && !other.blocks.includes(task.id)) other.blocks.push(task.id);
  }
  
  if (status === 'deleted') {
    _tasks = _tasks.filter(t => t.id !== task.id);
  }
  
  saveTasks();
  return task;
}

export function getTask(task_id) {
  loadTasks();
  return _tasks.find(t => t.id === String(task_id)) || { error: `Task #${task_id} not found` };
}

export function listTasks() {
  loadTasks();
  return _tasks.filter(t => t.status !== 'deleted');
}

export function clearTasks() {
  _tasks = [];
  _nextId = 1;
  saveTasks();
}

const STATUS_ICONS = {
  pending: '○',
  in_progress: '⚙',
  completed: '✓',
  cancelled: '✗',
};

export function formatTaskList(tasks) {
  if (!tasks.length) return 'No tasks.';
  return tasks.map(t => {
    const icon = STATUS_ICONS[t.status] || '?';
    const blockedNote = t.blocked_by.length ? ` [blocked by: ${t.blocked_by.join(', ')}]` : '';
    return `  #${t.id} ${icon} ${t.subject}${blockedNote}`;
  }).join('\n');
}

// ─── Register Task Tools ──────────────────────────────────────────────────────

registerTool({
  name: 'task_create',
  description: 'Create a new task for tracking multi-step work.',
  parameters: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Short task title' },
      description: { type: 'string', description: 'Detailed description of the task' },
    },
    required: ['subject'],
  },
  readOnly: false,
  async execute(args) {
    return createTask(args);
  },
});

registerTool({
  name: 'task_update',
  description: 'Update a task status, description, or add dependency edges.',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Task ID to update' },
      subject: { type: 'string', description: 'New subject (optional)' },
      description: { type: 'string', description: 'New description (optional)' },
      status: { type: 'string', enum: TASK_STATUSES, description: 'New status' },
      add_blocks: { type: 'array', items: { type: 'string' }, description: 'Task IDs this task blocks' },
      add_blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task IDs that block this task' },
    },
    required: ['task_id'],
  },
  readOnly: false,
  async execute(args) {
    return updateTask(args);
  },
});

registerTool({
  name: 'task_list',
  description: 'List all active tasks with their status and dependencies.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  readOnly: true,
  async execute() {
    const tasks = listTasks();
    return { tasks, formatted: formatTaskList(tasks) };
  },
});

registerTool({
  name: 'task_get',
  description: 'Get full details of a specific task.',
  parameters: {
    type: 'object',
    properties: {
      task_id: { type: 'string', description: 'Task ID to retrieve' },
    },
    required: ['task_id'],
  },
  readOnly: true,
  async execute({ task_id }) {
    return getTask(task_id);
  },
});
