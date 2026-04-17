/**
 * cron.js — Cron Job Scheduler for Gemma Agent v2
 * Uses node-cron for scheduling recurring tasks with persistence.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import cron from 'node-cron';
import { getConfig } from '../config.js';
import { registerTool } from '../tools.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const CRON_DIR  = path.join(os.homedir(), '.gemma-agent', 'cron');
const JOBS_FILE = path.join(CRON_DIR, 'jobs.json');

function ensureCronDir() {
  if (!fs.existsSync(CRON_DIR)) {
    fs.mkdirSync(CRON_DIR, { recursive: true });
  }
}

// ─── In-Memory State ──────────────────────────────────────────────────────────

/** @type {Map<string, { name, schedule, enabled, createdAt, lastRun, lastError, runCount, taskFn, cronTask }>} */
const _jobs = new Map();

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadJobs() {
  ensureCronDir();
  if (!fs.existsSync(JOBS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveJobs() {
  ensureCronDir();
  const serializable = [];
  for (const job of _jobs.values()) {
    serializable.push({
      name:      job.name,
      schedule:  job.schedule,
      enabled:   job.enabled,
      createdAt: job.createdAt,
      lastRun:   job.lastRun,
      lastError: job.lastError,
      runCount:  job.runCount,
    });
  }
  fs.writeFileSync(JOBS_FILE, JSON.stringify(serializable, null, 2), 'utf8');
}

// ─── Core API ─────────────────────────────────────────────────────────────────

/**
 * Register a new cron job.
 *
 * @param {string}   name     - Unique job name
 * @param {string}   schedule - Cron expression (e.g. '0 * * * *' = every hour)
 * @param {Function} taskFn   - Async function to execute on each tick
 * @returns {object} The registered job descriptor
 */
export function registerJob(name, schedule, taskFn) {
  if (_jobs.has(name)) {
    return { error: `Job "${name}" already exists. Remove it first or use a different name.` };
  }

  if (!cron.validate(schedule)) {
    return { error: `Invalid cron schedule: "${schedule}"` };
  }

  if (typeof taskFn !== 'function') {
    return { error: 'taskFn must be a function' };
  }

  const cfg = getConfig();
  const enabled = cfg.cron_enabled !== false;

  const job = {
    name,
    schedule,
    enabled,
    createdAt: new Date().toISOString(),
    lastRun:   null,
    lastError: null,
    runCount:  0,
    taskFn,
    cronTask:  null,
  };

  // Create the cron task (starts paused if not enabled)
  job.cronTask = cron.schedule(schedule, async () => {
    await _executeJob(job);
  }, {
    scheduled: enabled,
  });

  _jobs.set(name, job);
  saveJobs();

  return {
    name:      job.name,
    schedule:  job.schedule,
    enabled:   job.enabled,
    createdAt: job.createdAt,
  };
}

/**
 * List all registered jobs with their current status.
 * @returns {object[]}
 */
export function listJobs() {
  const list = [];
  for (const job of _jobs.values()) {
    list.push({
      name:      job.name,
      schedule:  job.schedule,
      enabled:   job.enabled,
      createdAt: job.createdAt,
      lastRun:   job.lastRun,
      lastError: job.lastError,
      runCount:  job.runCount,
    });
  }
  return list;
}

/**
 * Enable a previously disabled job.
 * @param {string} name
 * @returns {object}
 */
export function enableJob(name) {
  const job = _jobs.get(name);
  if (!job) return { error: `Job "${name}" not found` };

  job.enabled = true;
  if (job.cronTask) {
    job.cronTask.start();
  }
  saveJobs();

  return { name, enabled: true };
}

/**
 * Disable a job (stop scheduling but keep registration).
 * @param {string} name
 * @returns {object}
 */
export function disableJob(name) {
  const job = _jobs.get(name);
  if (!job) return { error: `Job "${name}" not found` };

  job.enabled = false;
  if (job.cronTask) {
    job.cronTask.stop();
  }
  saveJobs();

  return { name, enabled: false };
}

/**
 * Remove a job entirely (stop + unregister).
 * @param {string} name
 * @returns {object}
 */
export function removeJob(name) {
  const job = _jobs.get(name);
  if (!job) return { error: `Job "${name}" not found` };

  if (job.cronTask) {
    job.cronTask.stop();
  }
  _jobs.delete(name);
  saveJobs();

  return { name, removed: true };
}

/**
 * Manually trigger a registered job immediately (regardless of schedule / enabled state).
 * @param {string} name
 * @returns {Promise<object>}
 */
export async function runJob(name) {
  const job = _jobs.get(name);
  if (!job) return { error: `Job "${name}" not found` };

  return await _executeJob(job);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

/**
 * Execute a job's task function and update its metadata.
 * @param {object} job
 * @returns {Promise<object>}
 */
async function _executeJob(job) {
  const startedAt = new Date().toISOString();
  try {
    const result = await job.taskFn({ jobName: job.name, schedule: job.schedule });
    job.lastRun   = startedAt;
    job.lastError = null;
    job.runCount += 1;
    saveJobs();
    return { name: job.name, startedAt, result, success: true };
  } catch (err) {
    job.lastRun   = startedAt;
    job.lastError = err.message || String(err);
    job.runCount += 1;
    saveJobs();
    return { name: job.name, startedAt, error: job.lastError, success: false };
  }
}

/**
 * Restore persisted jobs on startup (without taskFn — they become "stale" descriptors).
 * Call registerJob() again to re-attach actual functions.
 */
export function restorePersistedJobs() {
  const saved = loadJobs();
  // We only restore metadata; callers must re-register taskFn via registerJob().
  // This is useful for showing what jobs were configured previously.
  return saved;
}

// ─── Register Cron Tools ──────────────────────────────────────────────────────

registerTool({
  name: 'cron_schedule',
  description: 'Schedule a recurring cron job. The job will run a shell command on the given cron schedule. Use standard cron syntax (e.g. "*/5 * * * *" for every 5 minutes).',
  parameters: {
    type: 'object',
    properties: {
      name:     { type: 'string', description: 'Unique name for this cron job' },
      schedule: { type: 'string', description: 'Cron expression (e.g. "0 * * * *" = every hour, "*/5 * * * *" = every 5 min)' },
      command:  { type: 'string', description: 'Shell command to execute on each tick' },
    },
    required: ['name', 'schedule', 'command'],
  },
  readOnly: false,
  async execute({ name, schedule, command }) {
    const { execSync } = await import('child_process');

    // Create a task function that runs the shell command
    const taskFn = async () => {
      try {
        const output = execSync(command, {
          timeout: 60000,
          maxBuffer: 1024 * 1024 * 5,
          encoding: 'utf8',
        });
        return { stdout: output.trim(), exit_code: 0 };
      } catch (err) {
        return {
          stdout: err.stdout?.trim() || '',
          stderr: err.stderr?.trim() || err.message,
          exit_code: err.status || 1,
        };
      }
    };

    const result = registerJob(name, schedule, taskFn);
    if (result.error) return result;

    return {
      success: true,
      job: result,
      message: `Cron job "${name}" scheduled with expression "${schedule}" → runs: ${command}`,
    };
  },
});

registerTool({
  name: 'cron_list',
  description: 'List all registered cron jobs with their status, last run time, and run counts.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  readOnly: true,
  async execute() {
    const jobs = listJobs();
    if (jobs.length === 0) {
      return { jobs: [], message: 'No cron jobs registered.' };
    }

    const formatted = jobs.map(j => {
      const status = j.enabled ? '✓ enabled' : '✗ disabled';
      const last = j.lastRun ? `last: ${j.lastRun}` : 'never run';
      const err = j.lastError ? ` [error: ${j.lastError}]` : '';
      return `  ${j.name} (${j.schedule}) — ${status} — ${last} — runs: ${j.runCount}${err}`;
    }).join('\n');

    return { jobs, formatted };
  },
});

registerTool({
  name: 'cron_run',
  description: 'Manually trigger a registered cron job by name, regardless of its schedule.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the cron job to trigger' },
    },
    required: ['name'],
  },
  readOnly: false,
  async execute({ name }) {
    return await runJob(name);
  },
});

registerTool({
  name: 'cron_enable',
  description: 'Enable a disabled cron job so it resumes running on schedule.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the cron job to enable' },
    },
    required: ['name'],
  },
  readOnly: false,
  async execute({ name }) {
    return enableJob(name);
  },
});

registerTool({
  name: 'cron_disable',
  description: 'Disable a cron job so it stops running on schedule (but stays registered).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the cron job to disable' },
    },
    required: ['name'],
  },
  readOnly: false,
  async execute({ name }) {
    return disableJob(name);
  },
});

registerTool({
  name: 'cron_remove',
  description: 'Remove a cron job entirely (stops and unregisters it).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the cron job to remove' },
    },
    required: ['name'],
  },
  readOnly: false,
  async execute({ name }) {
    return removeJob(name);
  },
});

export default {
  registerJob,
  listJobs,
  enableJob,
  disableJob,
  removeJob,
  runJob,
  restorePersistedJobs,
};
