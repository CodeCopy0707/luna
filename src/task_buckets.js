/**
 * task_buckets.js — Task bucket system
 * Decomposes complex work into manageable subtasks that can be
 * tracked and completed one by one.
 * Buckets are stored as JSON in .gemma-agent/buckets/
 */

import fs from 'fs';
import path from 'path';
import { registerTool } from './tools.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const BUCKETS_DIR = path.join(process.cwd(), '.gemma-agent', 'buckets');

function ensureBucketsDir() {
  if (!fs.existsSync(BUCKETS_DIR)) {
    fs.mkdirSync(BUCKETS_DIR, { recursive: true });
  }
}

function bucketFilePath(name) {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  return path.join(BUCKETS_DIR, `${safeName}.json`);
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Create a new task bucket with subtasks.
 * @param {string} name - Unique bucket name
 * @param {string} description - What this bucket is for
 * @param {string[]} tasks - Array of task descriptions
 * @returns {{ name: string, description: string, taskCount: number, createdAt: string }}
 */
export function createBucket(name, description, tasks = []) {
  ensureBucketsDir();

  const filePath = bucketFilePath(name);
  if (fs.existsSync(filePath)) {
    return { error: `Bucket '${name}' already exists` };
  }

  const now = new Date().toISOString();

  const bucket = {
    name,
    description,
    createdAt: now,
    updatedAt: now,
    tasks: tasks.map((text, index) => ({
      index,
      text,
      status: 'pending',
      completedAt: null,
      notes: '',
    })),
  };

  fs.writeFileSync(filePath, JSON.stringify(bucket, null, 2), 'utf8');

  return {
    name: bucket.name,
    description: bucket.description,
    taskCount: bucket.tasks.length,
    createdAt: bucket.createdAt,
  };
}

/**
 * Get a bucket with all its tasks and status.
 * @param {string} name - Bucket name
 * @returns {object} Full bucket data with progress stats
 */
export function getBucket(name) {
  ensureBucketsDir();

  const filePath = bucketFilePath(name);
  if (!fs.existsSync(filePath)) {
    return { error: `Bucket '${name}' not found` };
  }

  try {
    const bucket = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const progress = computeProgress(bucket);
    return { ...bucket, progress };
  } catch (err) {
    return { error: `Failed to read bucket '${name}': ${err.message}` };
  }
}

/**
 * List all buckets with summary info.
 * @returns {Array<{ name: string, description: string, taskCount: number, progress: object, createdAt: string, updatedAt: string }>}
 */
export function listBuckets() {
  ensureBucketsDir();

  const files = fs.readdirSync(BUCKETS_DIR).filter(f => f.endsWith('.json'));
  const buckets = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(BUCKETS_DIR, file), 'utf8'));
      const progress = computeProgress(data);
      buckets.push({
        name: data.name,
        description: data.description,
        taskCount: data.tasks?.length || 0,
        progress,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    } catch { /* skip corrupt files */ }
  }

  // Sort newest first
  buckets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return buckets;
}

/**
 * Mark a task as done within a bucket.
 * @param {string} bucketName - Bucket name
 * @param {number} taskIndex - Index of the task to complete
 * @param {string} [notes] - Optional notes about completion
 * @returns {{ updated: boolean, task: object, progress: object }}
 */
export function completeTask(bucketName, taskIndex, notes = '') {
  ensureBucketsDir();

  const filePath = bucketFilePath(bucketName);
  if (!fs.existsSync(filePath)) {
    return { error: `Bucket '${bucketName}' not found` };
  }

  let bucket;
  try {
    bucket = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { error: `Failed to read bucket: ${err.message}` };
  }

  const idx = Number(taskIndex);
  if (idx < 0 || idx >= bucket.tasks.length) {
    return { error: `Task index ${taskIndex} out of range (0-${bucket.tasks.length - 1})` };
  }

  const task = bucket.tasks[idx];
  task.status = 'done';
  task.completedAt = new Date().toISOString();
  if (notes) task.notes = notes;

  bucket.updatedAt = new Date().toISOString();

  fs.writeFileSync(filePath, JSON.stringify(bucket, null, 2), 'utf8');

  const progress = computeProgress(bucket);
  return { updated: true, task, progress };
}

/**
 * Get the next pending task from a bucket.
 * @param {string} bucketName - Bucket name
 * @returns {{ task: object | null, remaining: number, progress: object }}
 */
export function getNextTask(bucketName) {
  ensureBucketsDir();

  const filePath = bucketFilePath(bucketName);
  if (!fs.existsSync(filePath)) {
    return { error: `Bucket '${bucketName}' not found` };
  }

  let bucket;
  try {
    bucket = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { error: `Failed to read bucket: ${err.message}` };
  }

  const pending = bucket.tasks.filter(t => t.status === 'pending');
  const next = pending.length > 0 ? pending[0] : null;
  const progress = computeProgress(bucket);

  return {
    task: next,
    remaining: pending.length,
    progress,
  };
}

/**
 * Get completion stats for a bucket.
 * @param {string} bucketName - Bucket name
 * @returns {{ total: number, done: number, pending: number, skipped: number, percentComplete: number }}
 */
export function getBucketProgress(bucketName) {
  ensureBucketsDir();

  const filePath = bucketFilePath(bucketName);
  if (!fs.existsSync(filePath)) {
    return { error: `Bucket '${bucketName}' not found` };
  }

  let bucket;
  try {
    bucket = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { error: `Failed to read bucket: ${err.message}` };
  }

  return computeProgress(bucket);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeProgress(bucket) {
  const tasks = bucket.tasks || [];
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const pending = tasks.filter(t => t.status === 'pending').length;
  const skipped = tasks.filter(t => t.status === 'skipped').length;
  const percentComplete = total > 0 ? Math.round((done / total) * 100) : 0;

  return { total, done, pending, skipped, percentComplete };
}

const STATUS_ICONS = {
  pending: '○',
  done: '✓',
  skipped: '⊘',
};

export function formatBucketList(buckets) {
  if (!buckets.length) return 'No buckets.';
  return buckets.map(b => {
    const pct = b.progress?.percentComplete ?? 0;
    return `  📦 ${b.name} — ${b.description} [${pct}% complete, ${b.taskCount} tasks]`;
  }).join('\n');
}

export function formatBucketTasks(bucket) {
  if (!bucket.tasks || !bucket.tasks.length) return 'No tasks in bucket.';
  return bucket.tasks.map(t => {
    const icon = STATUS_ICONS[t.status] || '?';
    const note = t.notes ? ` (${t.notes})` : '';
    return `  #${t.index} ${icon} ${t.text}${note}`;
  }).join('\n');
}

// ─── Register Bucket Tools ───────────────────────────────────────────────────

registerTool({
  name: 'bucket_create',
  description: 'Create a task bucket with subtasks. Decomposes complex work into manageable steps.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Unique bucket name (e.g. "refactor-auth")' },
      description: { type: 'string', description: 'What this bucket of work is about' },
      tasks: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of subtask descriptions, in order',
      },
    },
    required: ['name', 'description', 'tasks'],
  },
  readOnly: false,
  async execute({ name, description, tasks }) {
    return createBucket(name, description, tasks);
  },
});

registerTool({
  name: 'bucket_list',
  description: 'List all task buckets with their progress summaries.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  readOnly: true,
  async execute() {
    const buckets = listBuckets();
    return { buckets, formatted: formatBucketList(buckets) };
  },
});

registerTool({
  name: 'bucket_get',
  description: 'Get full details of a task bucket including all subtasks and their statuses.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Bucket name to retrieve' },
    },
    required: ['name'],
  },
  readOnly: true,
  async execute({ name }) {
    const bucket = getBucket(name);
    if (bucket.error) return bucket;
    return { ...bucket, formatted: formatBucketTasks(bucket) };
  },
});

registerTool({
  name: 'bucket_complete_task',
  description: 'Mark a subtask as done within a bucket.',
  parameters: {
    type: 'object',
    properties: {
      bucket_name: { type: 'string', description: 'Bucket name' },
      task_index: { type: 'number', description: 'Index of the subtask to mark as done' },
      notes: { type: 'string', description: 'Optional notes about the completion' },
    },
    required: ['bucket_name', 'task_index'],
  },
  readOnly: false,
  async execute({ bucket_name, task_index, notes }) {
    return completeTask(bucket_name, task_index, notes);
  },
});

registerTool({
  name: 'bucket_next',
  description: 'Get the next pending subtask from a bucket. Returns null task if all are done.',
  parameters: {
    type: 'object',
    properties: {
      bucket_name: { type: 'string', description: 'Bucket name' },
    },
    required: ['bucket_name'],
  },
  readOnly: true,
  async execute({ bucket_name }) {
    return getNextTask(bucket_name);
  },
});
