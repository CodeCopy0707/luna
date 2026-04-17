/**
 * pool.js — Parallel Worker Pool for Gemma Agent v2
 * Executes multiple agent tasks simultaneously with priority scheduling.
 */

import { getConfig } from '../config.js';

// ─── Task Status Constants ────────────────────────────────────────────────────

export const TASK_STATUS = {
  PENDING:  'pending',
  RUNNING:  'running',
  DONE:     'done',
  ERROR:    'error',
  CANCELLED: 'cancelled',
};

// ─── WorkerPool Class ─────────────────────────────────────────────────────────

export class WorkerPool {
  /**
   * @param {object} [options]
   * @param {number} [options.maxConcurrent] - Max parallel workers (default from config)
   */
  constructor(options = {}) {
    const cfg = getConfig();
    this.maxConcurrent = options.maxConcurrent ?? cfg.max_parallel_workers ?? 4;

    /** @type {Map<string, object>} taskId → task object */
    this._tasks = new Map();

    /** @type {string[]} ordered queue of task IDs waiting to run */
    this._queue = [];

    /** @type {Set<string>} task IDs currently running */
    this._running = new Set();

    /** Shared results map — accessible to all workers */
    this.sharedResults = new Map();

    this._nextId = 1;
    this._drainResolvers = [];

    // ── Event callbacks ───────────────────────────────────────────────────
    this.onTaskStart    = null; // (task) => void
    this.onTaskComplete = null; // (task) => void
    this.onTaskError    = null; // (task) => void
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Queue a task function with optional priority.
   * Higher priority numbers run first.
   *
   * @param {Function} taskFn  - Async function to execute. Receives { taskId, sharedResults }.
   * @param {number}   [priority=0] - Higher priority = runs sooner.
   * @returns {string} taskId
   */
  addTask(taskFn, priority = 0) {
    if (typeof taskFn !== 'function') {
      throw new TypeError('taskFn must be a function');
    }

    const id = String(this._nextId++);

    const task = {
      id,
      fn: taskFn,
      priority,
      status: TASK_STATUS.PENDING,
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    };

    this._tasks.set(id, task);
    this._queue.push(id);

    // Re-sort queue so highest priority is at front
    this._sortQueue();

    return id;
  }

  /**
   * Execute all queued tasks, respecting the concurrency limit.
   * Returns a promise that resolves when every task has completed (or errored/cancelled).
   *
   * @returns {Promise<Map<string, object>>} Map of taskId → task objects
   */
  async run() {
    // Kick off initial batch
    this._scheduleNext();

    // Wait until everything is finished
    await this.drain();

    return this._tasks;
  }

  /**
   * Return the status of all tasks.
   * @returns {object[]} Array of { id, status, priority, startedAt, finishedAt, result, error }
   */
  getStatus() {
    const statuses = [];
    for (const task of this._tasks.values()) {
      statuses.push({
        id:         task.id,
        status:     task.status,
        priority:   task.priority,
        startedAt:  task.startedAt,
        finishedAt: task.finishedAt,
        result:     task.result,
        error:      task.error,
      });
    }
    return statuses;
  }

  /**
   * Cancel a pending task. Running tasks cannot be cancelled.
   * @param {string} taskId
   * @returns {boolean} true if successfully cancelled
   */
  cancel(taskId) {
    const task = this._tasks.get(taskId);
    if (!task) return false;

    if (task.status !== TASK_STATUS.PENDING) {
      return false; // only pending tasks can be cancelled
    }

    task.status = TASK_STATUS.CANCELLED;
    task.finishedAt = new Date().toISOString();

    // Remove from queue
    this._queue = this._queue.filter(id => id !== taskId);

    // Check if everything is now done
    this._checkDrain();

    return true;
  }

  /**
   * Wait for all tasks to complete (including currently running ones).
   * Resolves immediately if nothing is pending or running.
   * @returns {Promise<void>}
   */
  drain() {
    if (this._isAllDone()) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      this._drainResolvers.push(resolve);
    });
  }

  /**
   * Get a specific task by ID.
   * @param {string} taskId
   * @returns {object|null}
   */
  getTask(taskId) {
    return this._tasks.get(taskId) || null;
  }

  /**
   * Total number of tasks.
   */
  get size() {
    return this._tasks.size;
  }

  /**
   * Number of currently running tasks.
   */
  get activeCount() {
    return this._running.size;
  }

  /**
   * Number of pending tasks in the queue.
   */
  get pendingCount() {
    return this._queue.length;
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────────

  /** Sort queue so highest-priority tasks come first */
  _sortQueue() {
    this._queue.sort((a, b) => {
      const taskA = this._tasks.get(a);
      const taskB = this._tasks.get(b);
      return (taskB?.priority ?? 0) - (taskA?.priority ?? 0);
    });
  }

  /** Try to pull tasks from the queue and start them up to the concurrency limit */
  _scheduleNext() {
    while (this._running.size < this.maxConcurrent && this._queue.length > 0) {
      const taskId = this._queue.shift();
      const task = this._tasks.get(taskId);

      // Skip cancelled tasks that are still in queue
      if (!task || task.status === TASK_STATUS.CANCELLED) continue;

      this._runTask(task);
    }
  }

  /** Execute a single task */
  async _runTask(task) {
    task.status = TASK_STATUS.RUNNING;
    task.startedAt = new Date().toISOString();
    this._running.add(task.id);

    // Fire onTaskStart
    if (typeof this.onTaskStart === 'function') {
      try { this.onTaskStart(task); } catch {}
    }

    try {
      const result = await task.fn({
        taskId: task.id,
        sharedResults: this.sharedResults,
      });

      task.status = TASK_STATUS.DONE;
      task.result = result;
      task.finishedAt = new Date().toISOString();

      // Store in shared results
      this.sharedResults.set(task.id, result);

      // Fire onTaskComplete
      if (typeof this.onTaskComplete === 'function') {
        try { this.onTaskComplete(task); } catch {}
      }
    } catch (err) {
      task.status = TASK_STATUS.ERROR;
      task.error = err.message || String(err);
      task.finishedAt = new Date().toISOString();

      // Fire onTaskError
      if (typeof this.onTaskError === 'function') {
        try { this.onTaskError(task); } catch {}
      }
    } finally {
      this._running.delete(task.id);

      // Schedule more work
      this._scheduleNext();

      // Check if we can resolve drain waiters
      this._checkDrain();
    }
  }

  /** Check if everything is done and resolve drain promises */
  _checkDrain() {
    if (this._isAllDone()) {
      for (const resolve of this._drainResolvers) {
        resolve();
      }
      this._drainResolvers = [];
    }
  }

  /** Returns true if no tasks are pending or running */
  _isAllDone() {
    return this._queue.length === 0 && this._running.size === 0;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a new WorkerPool with optional overrides.
 * @param {object} [options]
 * @returns {WorkerPool}
 */
export function createWorkerPool(options) {
  return new WorkerPool(options);
}

export default WorkerPool;
