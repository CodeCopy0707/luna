/**
 * agents/manager.js — Agent Manager
 *
 * Tracks all running and completed agents.
 * Provides the /agents command view and subagent lifecycle management.
 * Supports parallel execution via Promise.all.
 */

import { AgentRunner } from './runner.js';
import { getAgentDef, listAgentDefs } from './registry.js';
import { getConfig } from '../config.js';
import { WorkerPool } from '../workers/pool.js';

let _taskIdCounter = 1;

export class AgentManager {
  constructor(options = {}) {
    this.options = options; // shared callbacks: onText, onToolStart, onToolEnd, onLog
    this._tasks = new Map(); // taskId → { id, agentId, task, runner, status, startedAt, finishedAt, result }
  }

  // ─── Task Lifecycle ──────────────────────────────────────────────────────────

  registerSubagent(agentId, task, runner) {
    const id = String(_taskIdCounter++);
    this._tasks.set(id, {
      id,
      agentId,
      task: task.slice(0, 80),
      runner,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      result: null,
    });
    return id;
  }

  completeSubagent(taskId, result) {
    const t = this._tasks.get(taskId);
    if (!t) return;
    t.status = result?.error ? 'error' : 'done';
    t.finishedAt = Date.now();
    t.result = result;
  }

  // ─── Run a named agent ───────────────────────────────────────────────────────

  async run(agentId, task, extraOptions = {}) {
    const def = getAgentDef(agentId);
    if (!def) throw new Error(`Unknown agent: ${agentId}`);

    const cfg = getConfig();
    const runner = new AgentRunner(def, {
      model: cfg.model,
      manager: this,
      ...this.options,
      ...extraOptions,
    });

    const id = String(_taskIdCounter++);
    this._tasks.set(id, {
      id,
      agentId,
      task: task.slice(0, 80),
      runner,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      result: null,
    });

    const result = await runner.run(task);

    const t = this._tasks.get(id);
    t.status = result?.error ? 'error' : 'done';
    t.finishedAt = Date.now();
    t.result = result;

    return result;
  }

  // ─── Run multiple agents in parallel (via WorkerPool) ────────────────────────

  async runParallel(tasks) {
    // tasks = [{ agentId, task, options? }, ...]
    if (tasks.length <= 1) {
      return Promise.all(tasks.map(t => this.run(t.agentId, t.task, t.options || {})));
    }

    const cfg = getConfig();
    const pool = new WorkerPool({ maxConcurrent: cfg.max_parallel_workers ?? 4 });

    const results = new Array(tasks.length);

    tasks.forEach((t, idx) => {
      pool.addTask(async ({ taskId, sharedResults }) => {
        const result = await this.run(t.agentId, t.task, t.options || {});
        // Share result so other workers can access it
        sharedResults.set(t.agentId, result);
        results[idx] = result;
        return result;
      }, t.priority || 0);
    });

    await pool.run();
    return results;
  }

  // ─── Codebuff-style pipeline ─────────────────────────────────────────────────
  // File Picker → Planner → (Editor + Researcher in parallel) → Reviewer → Tester

  async runCodingPipeline(userTask, { onProgress } = {}) {
    onProgress?.('🔍 File Picker scanning codebase...');
    const pickerResult = await this.run('file-picker', userTask);

    onProgress?.('📋 Planner creating implementation plan...');
    const plannerResult = await this.run('planner',
      `Task: ${userTask}\n\nRelevant files:\n${pickerResult.text}`
    );

    onProgress?.('✏️  Editor + 🌐 Researcher running in parallel...');
    const [editorResult, researchResult] = await this.runParallel([
      {
        agentId: 'editor',
        task: `Task: ${userTask}\n\nPlan:\n${plannerResult.text}`,
      },
      {
        agentId: 'researcher',
        task: `Research best practices and documentation for: ${userTask}`,
      },
    ]);

    onProgress?.('🔎 Reviewer validating changes...');
    const reviewResult = await this.run('reviewer',
      `Review the implementation for: ${userTask}\n\nChanges made:\n${editorResult.text}\n\nResearch notes:\n${researchResult.text}`
    );

    onProgress?.('🧪 Tester writing and running tests...');
    const testResult = await this.run('tester',
      `Write and run tests for: ${userTask}\n\nImplementation:\n${editorResult.text}`
    );

    return {
      files:       pickerResult.text,
      plan:        plannerResult.text,
      implementation: editorResult.text,
      research:    researchResult.text,
      review:      reviewResult.text,
      tests:       testResult.text,
    };
  }

  // ─── Status / Listing ────────────────────────────────────────────────────────

  listTasks() {
    return Array.from(this._tasks.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  getTask(id) {
    return this._tasks.get(id) || null;
  }

  clearCompleted() {
    for (const [id, t] of this._tasks) {
      if (t.status === 'done' || t.status === 'error') this._tasks.delete(id);
    }
  }

  formatStatus() {
    const tasks = this.listTasks();
    if (tasks.length === 0) return 'No agent tasks.';

    const STATUS_ICON = { running: '⚙', done: '✓', error: '✗', idle: '○' };
    return tasks.map(t => {
      const icon = STATUS_ICON[t.status] || '?';
      const elapsed = t.finishedAt
        ? `${((t.finishedAt - t.startedAt) / 1000).toFixed(1)}s`
        : `${((Date.now() - t.startedAt) / 1000).toFixed(1)}s…`;
      return `  #${t.id} ${icon} [${t.agentId}] ${t.task} (${elapsed})`;
    }).join('\n');
  }

  getTotalCost() {
    let input = 0, output = 0;
    for (const t of this._tasks.values()) {
      if (t.runner) {
        const c = t.runner.getCostEstimate();
        input  += c.input_tokens;
        output += c.output_tokens;
      }
    }
    const usd = ((input / 1_000_000) * 0.075 + (output / 1_000_000) * 0.30).toFixed(6);
    return { input_tokens: input, output_tokens: output, estimated_usd: usd };
  }
}

// ─── Global singleton manager ─────────────────────────────────────────────────
// Shared across the whole process so /agents command can see all tasks

let _globalManager = null;

export function getGlobalManager() {
  return _globalManager;
}

export function initGlobalManager(options) {
  _globalManager = new AgentManager(options);
  return _globalManager;
}
