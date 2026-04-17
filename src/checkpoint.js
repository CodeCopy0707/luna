/**
 * checkpoint.js — Checkpoint / rollback system for Gemma Agent
 * Snapshots specified files so destructive operations can be undone.
 * Checkpoints are stored as JSON in ~/.gemma-agent/checkpoints/
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { CONFIG_DIR_PATH, getConfig } from './config.js';
import { createDiff } from './diff.js';
import { registerTool } from './tools.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHECKPOINTS_DIR = path.join(CONFIG_DIR_PATH, 'checkpoints');

function ensureCheckpointsDir() {
  if (!fs.existsSync(CHECKPOINTS_DIR)) {
    fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
  }
}

function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `cp_${ts}_${rand}`;
}

function checkpointFilePath(id) {
  return path.join(CHECKPOINTS_DIR, `${id}.json`);
}

// ─── Auto-Prune ───────────────────────────────────────────────────────────────

function autoPrune() {
  const cfg = getConfig();
  const maxCheckpoints = cfg.max_checkpoints || 20;
  const all = listCheckpoints();

  if (all.length <= maxCheckpoints) return;

  // Sort oldest first
  const sorted = [...all].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const toRemove = sorted.slice(0, sorted.length - maxCheckpoints);

  for (const cp of toRemove) {
    const filePath = checkpointFilePath(cp.id);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Create a checkpoint — snapshot the content of specified files.
 * @param {string} label - Human-readable label for the checkpoint
 * @param {string[]} files - Array of file paths (relative or absolute) to snapshot
 * @returns {{ id: string, label: string, timestamp: string, fileCount: number }}
 */
export function createCheckpoint(label, files) {
  ensureCheckpointsDir();

  const id = generateId();
  const timestamp = new Date().toISOString();

  const snapshots = [];
  for (const filePath of files) {
    const resolved = path.resolve(process.cwd(), filePath);
    let content = null;
    let exists = false;

    if (fs.existsSync(resolved)) {
      try {
        content = fs.readFileSync(resolved, 'utf8');
        exists = true;
      } catch {
        content = null;
        exists = false;
      }
    }

    snapshots.push({
      path: filePath,
      resolvedPath: resolved,
      content,
      exists,
    });
  }

  const checkpoint = {
    id,
    label,
    timestamp,
    cwd: process.cwd(),
    files: snapshots,
  };

  fs.writeFileSync(checkpointFilePath(id), JSON.stringify(checkpoint, null, 2), 'utf8');

  // Auto-prune if over limit
  autoPrune();

  return { id, label, timestamp, fileCount: snapshots.length };
}

/**
 * List all checkpoints with timestamps and labels.
 * @returns {Array<{ id: string, label: string, timestamp: string, fileCount: number }>}
 */
export function listCheckpoints() {
  ensureCheckpointsDir();

  const files = fs.readdirSync(CHECKPOINTS_DIR).filter(f => f.endsWith('.json'));
  const checkpoints = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(CHECKPOINTS_DIR, file), 'utf8'));
      checkpoints.push({
        id: data.id,
        label: data.label,
        timestamp: data.timestamp,
        fileCount: data.files?.length || 0,
        cwd: data.cwd,
      });
    } catch { /* skip corrupt files */ }
  }

  // Sort newest first
  checkpoints.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return checkpoints;
}

/**
 * Rollback files to a checkpoint state.
 * @param {string} checkpointId - The checkpoint ID to restore
 * @returns {{ restored: boolean, files: string[], diffs: string[] }}
 */
export function rollbackToCheckpoint(checkpointId) {
  ensureCheckpointsDir();

  const filePath = checkpointFilePath(checkpointId);
  if (!fs.existsSync(filePath)) {
    return { error: `Checkpoint '${checkpointId}' not found` };
  }

  let checkpoint;
  try {
    checkpoint = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { error: `Failed to parse checkpoint: ${err.message}` };
  }

  const restoredFiles = [];
  const diffs = [];

  for (const snap of checkpoint.files) {
    const resolved = path.resolve(process.cwd(), snap.path);

    // Read current content for diff
    let currentContent = '';
    const currentExists = fs.existsSync(resolved);
    if (currentExists) {
      try {
        currentContent = fs.readFileSync(resolved, 'utf8');
      } catch {
        currentContent = '';
      }
    }

    if (snap.exists && snap.content !== null) {
      // Restore file content
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, snap.content, 'utf8');
      restoredFiles.push(snap.path);

      // Generate diff
      if (currentContent !== snap.content) {
        const diff = createDiff(currentContent, snap.content, snap.path);
        if (diff) diffs.push(diff);
      }
    } else if (!snap.exists && currentExists) {
      // File didn't exist at checkpoint time — delete it
      try {
        fs.unlinkSync(resolved);
        restoredFiles.push(`${snap.path} (deleted)`);
        const diff = createDiff(currentContent, '', snap.path);
        if (diff) diffs.push(diff);
      } catch { /* ignore */ }
    }
  }

  return {
    restored: true,
    checkpointId,
    label: checkpoint.label,
    timestamp: checkpoint.timestamp,
    files: restoredFiles,
    diffs,
  };
}

/**
 * Delete a checkpoint by ID.
 * @param {string} checkpointId
 * @returns {{ deleted: boolean, id: string }}
 */
export function deleteCheckpoint(checkpointId) {
  ensureCheckpointsDir();

  const filePath = checkpointFilePath(checkpointId);
  if (!fs.existsSync(filePath)) {
    return { error: `Checkpoint '${checkpointId}' not found` };
  }

  try {
    fs.unlinkSync(filePath);
    return { deleted: true, id: checkpointId };
  } catch (err) {
    return { error: `Failed to delete checkpoint: ${err.message}` };
  }
}

/**
 * Automatically create a checkpoint before a destructive operation.
 * Uses a standard label format: "auto: <timestamp>"
 * @param {string[]} files - File paths to snapshot
 * @returns {{ id: string, label: string, timestamp: string, fileCount: number }}
 */
export function autoCheckpoint(files) {
  const cfg = getConfig();
  if (cfg.checkpoint_enabled === false) {
    return { skipped: true, reason: 'Checkpoints disabled in config' };
  }

  const label = `auto: before destructive op @ ${new Date().toLocaleString()}`;
  return createCheckpoint(label, files);
}

/**
 * Show diff between current file state and a checkpoint's snapshot.
 * @param {string} checkpointId
 * @returns {{ diffs: Array<{ path: string, diff: string, status: string }> }}
 */
export function getCheckpointDiff(checkpointId) {
  ensureCheckpointsDir();

  const filePath = checkpointFilePath(checkpointId);
  if (!fs.existsSync(filePath)) {
    return { error: `Checkpoint '${checkpointId}' not found` };
  }

  let checkpoint;
  try {
    checkpoint = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { error: `Failed to parse checkpoint: ${err.message}` };
  }

  const diffs = [];

  for (const snap of checkpoint.files) {
    const resolved = path.resolve(process.cwd(), snap.path);
    let currentContent = '';
    let currentExists = false;

    if (fs.existsSync(resolved)) {
      try {
        currentContent = fs.readFileSync(resolved, 'utf8');
        currentExists = true;
      } catch {
        currentContent = '';
      }
    }

    const checkpointContent = snap.content || '';

    if (currentContent === checkpointContent && currentExists === snap.exists) {
      diffs.push({
        path: snap.path,
        diff: '',
        status: 'unchanged',
      });
    } else if (!snap.exists && currentExists) {
      // File was created after checkpoint
      diffs.push({
        path: snap.path,
        diff: createDiff('', currentContent, snap.path),
        status: 'added',
      });
    } else if (snap.exists && !currentExists) {
      // File was deleted after checkpoint
      diffs.push({
        path: snap.path,
        diff: createDiff(checkpointContent, '', snap.path),
        status: 'deleted',
      });
    } else {
      // File was modified
      diffs.push({
        path: snap.path,
        diff: createDiff(checkpointContent, currentContent, snap.path),
        status: 'modified',
      });
    }
  }

  return {
    checkpointId,
    label: checkpoint.label,
    timestamp: checkpoint.timestamp,
    diffs,
    summary: {
      unchanged: diffs.filter(d => d.status === 'unchanged').length,
      modified:  diffs.filter(d => d.status === 'modified').length,
      added:     diffs.filter(d => d.status === 'added').length,
      deleted:   diffs.filter(d => d.status === 'deleted').length,
    },
  };
}

// ─── Register Checkpoint Tools ────────────────────────────────────────────────

registerTool({
  name: 'checkpoint_create',
  description: 'Create a checkpoint/snapshot of specified files. Use before making large or risky changes so you can rollback.',
  parameters: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'A descriptive label for this checkpoint (e.g. "before refactor")' },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of file paths to snapshot',
      },
    },
    required: ['label', 'files'],
  },
  readOnly: false,
  async execute({ label, files }) {
    return createCheckpoint(label, files);
  },
});

registerTool({
  name: 'checkpoint_list',
  description: 'List all saved checkpoints with their IDs, labels, timestamps, and file counts.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  readOnly: true,
  async execute() {
    return { checkpoints: listCheckpoints() };
  },
});

registerTool({
  name: 'checkpoint_rollback',
  description: 'Rollback/restore files to a previous checkpoint state. Reverts all files in the checkpoint to their saved content.',
  parameters: {
    type: 'object',
    properties: {
      checkpoint_id: { type: 'string', description: 'The checkpoint ID to rollback to (from checkpoint_list)' },
    },
    required: ['checkpoint_id'],
  },
  readOnly: false,
  async execute({ checkpoint_id }) {
    return rollbackToCheckpoint(checkpoint_id);
  },
});
