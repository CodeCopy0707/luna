/**
 * agent.js — Core Agent + Multi-Agent Orchestration
 *
 * Supports Plan/Act modes:
 *   PLAN — research, analysis, planning only (no file writes/edits/bash)
 *   ACT  — full access, implements the plan
 *
 * Auto-spawns subagents when the task complexity warrants it.
 */

import { AgentManager, initGlobalManager } from './agents/manager.js';
import { getAgentDef, loadCustomAgents }   from './agents/registry.js';
import { getConfig }         from './config.js';
import { getMemoryContext }  from './memory.js';
import { streamChat }        from './providers/index.js';
import { getTool, getToolSchemas } from './tools.js';
import { MODES }             from './tui/mode_tab.js';
import fs   from 'fs';
import path from 'path';
import os   from 'os';

// ─── Tool sets per mode ───────────────────────────────────────────────────────

const PLAN_MODE_TOOLS = new Set([
  'read_file', 'read_files', 'list_dir', 'glob', 'grep',
  'web_search', 'web_search_deep', 'web_fetch',
  'task_create', 'task_update', 'task_list', 'task_get',
  'memory_save', 'memory_search', 'memory_list', 'memory_delete',
  'bucket_create', 'bucket_list', 'bucket_get', 'bucket_next',
  'shared_memory_read', 'shared_memory_list', 'shared_memory_get_stuck',
  'shared_memory_write', 'shared_memory_signal_stuck',
  'checkpoint_list',
  'cron_list',
  'ask_user',
  'spawn_agent', 'spawn_agents_parallel',
]);

// GENERAL mode — balanced access, no auto-spawn
const GENERAL_MODE_TOOLS = new Set([
  'read_file', 'read_files', 'write_file', 'edit_file',
  'list_dir', 'glob', 'grep', 'bash',
  'regex_replace',
  'web_search', 'web_fetch',
  'task_create', 'task_update', 'task_list', 'task_get',
  'memory_save', 'memory_search', 'memory_list', 'memory_delete',
  'bucket_list', 'bucket_get',
  'checkpoint_create', 'checkpoint_list', 'checkpoint_rollback',
  'ask_user',
  'spawn_agent', 'spawn_agents_parallel',
]);

// GOD mode — everything, fully autonomous
// ACT mode — everything

// ─── Main Agent ───────────────────────────────────────────────────────────────

export class Agent {
  constructor({
    model,
    onText,
    onToolStart,
    onToolEnd,
    onError,
    onLog,
    onModeChange,
    permissionCallback,
    askUserCallback,
  } = {}) {
    this.model = model;
    this.onText      = onText      || (() => {});
    this.onToolStart = onToolStart || (() => {});
    this.onToolEnd   = onToolEnd   || (() => {});
    this.onError     = onError     || console.error;
    this.onLog       = onLog       || (() => {});
    this.onModeChange = onModeChange || (() => {});
    this.permissionCallback = permissionCallback;
    this.askUserCallback    = askUserCallback;

    this.messages = [];
    this.totalInputTokens  = 0;
    this.totalOutputTokens = 0;

    // Mode: plan | act | general | god
    this.mode = MODES.PLAN;

    // Pending plan — set after PLAN mode completes, executed in ACT mode
    this._pendingPlan = null;

    this._manager = initGlobalManager({
      model: this.model,
      onText:      this.onText,
      onToolStart: this.onToolStart,
      onToolEnd:   this.onToolEnd,
      onLog:       this.onLog,
      permissionCallback: this.permissionCallback,
      askUserCallback:    this.askUserCallback,
    });

    this.systemPrompt = '';
    this._refreshSystemPrompt();

    loadCustomAgents().catch(() => {});
  }

  setMode(mode) {
    this.mode = mode;
    this._refreshSystemPrompt();
    this.onModeChange(mode);
  }

  _getModeInstructions() {
    const isPlan = this.mode === MODES.PLAN;
    const isAct = this.mode === MODES.ACT;
    const isGeneral = this.mode === MODES.GENERAL;
    const isGod = this.mode === MODES.GOD;

    if (isPlan) {
      return `## PLAN MODE
You are in research and planning mode. Your job is to:
1. Understand the task thoroughly
2. Search the web for relevant documentation, best practices, and examples
3. Read and analyze the codebase
4. Create a detailed, step-by-step implementation plan
5. Identify risks, dependencies, and edge cases
6. DO NOT make any code changes, file writes, or run commands that modify state
7. End your response with a clear "## Implementation Plan" section

When done planning, tell the user: "Plan complete. Switch to ACT mode (press Tab) and say 'implement' to execute."
IMPORTANT: When user switches to ACT mode, do NOT auto-execute. Wait for user to explicitly say "implement", "execute", "do it", or similar.
`;
    }

    if (isAct) {
      return `## ACT MODE
You are in execution mode. You have full tool access.
${this._pendingPlan ? `\n## Captured Plan\n${this._pendingPlan}\n\nWait for user to say "implement" or similar before executing this plan.\n` : ''}
When instructed to implement:
1. Use checkpoint_create before risky changes
2. Use bucket_create to decompose large tasks into subtasks
3. Implement changes file by file, use bucket_complete_task as you finish each
4. Run run_tests after each significant change
5. Verify nothing is broken — use lint_fix if needed
6. Spawn specialist subagents for complex subtasks
7. Report progress as you go
`;
    }

    if (isGeneral) {
      return `## GENERAL MODE
You are in balanced general-purpose mode for everyday tasks.
- Handle simple queries, code edits, file operations
- You have read/write access and can spawn specialist subagents
- Only spawn subagents for specific complex sub-tasks — keep the main workflow simple
- Ask the user if the task seems complex enough to warrant switching to PLAN or ACT mode
`;
    }

    if (isGod) {
      return `## GOD MODE — FULLY AUTONOMOUS
You are in fully autonomous mode. Complete the user's request WITHOUT asking for clarification or permission.
- Make ALL decisions autonomously — do not ask the user questions
- Spawn agents and subagents freely as needed
- Use bucket_create to decompose complex work into subtasks, then bucket_complete_task as you finish each
- Use shared_memory_write to share results between agents, shared_memory_signal_stuck if stuck
- Use checkpoint_create before risky changes so you can checkpoint_rollback if needed
- Use cron_schedule if the task involves recurring automation
- Execute everything end-to-end: plan → implement → test → review
- Only stop when the task is fully complete or you hit an unrecoverable error
- Auto-approve all permissions (skip permission prompts)
- If stuck, spawn helper agents or try alternative approaches
- Run run_tests and lint_fix after code changes
`;
    }

    return '';
  }

  _refreshSystemPrompt() {
    const cfg = getConfig();
    const cwd = process.cwd();
    const isPlan = this.mode === MODES.PLAN;
    const isGeneral = this.mode === MODES.GENERAL;
    const isGod = this.mode === MODES.GOD;
    const modeLabel = isPlan ? '📋 PLAN' : isGod ? '🚀 GOD' : isGeneral ? '🔧 GENERAL' : '⚡ ACT';

    let prompt = `You are Gemma, a powerful AI coding assistant.
Current mode: ${modeLabel}

${this._getModeInstructions()}

## Environment
- Working directory: ${cwd}
- Platform: ${os.platform()} ${os.release()}
- Date: ${new Date().toLocaleDateString()}
- Model: ${this.model || cfg.model}

## Auto-Spawn Policy
Automatically spawn subagents when:
- Task requires searching multiple files → spawn file-picker
- Task needs web research → spawn researcher  
- Making complex code changes → spawn editor + reviewer in parallel
- Need to write tests → spawn tester
- Debugging a complex issue → spawn debugger
You do NOT need user permission to spawn agents — do it autonomously.

## Spawnable Agents
- file-picker, planner, editor, reviewer, researcher, tester, git-committer, debugger
- optimizer, architect, doc-writer, refactorer, security-auditor

## Advanced Tools
- Task Buckets: bucket_create, bucket_list, bucket_get, bucket_complete_task, bucket_next
- Shared Memory: shared_memory_write, shared_memory_read, shared_memory_list, shared_memory_signal_stuck, shared_memory_get_stuck
- Checkpoints: checkpoint_create, checkpoint_list, checkpoint_rollback
- Cron Jobs: cron_schedule, cron_list, cron_run, cron_enable, cron_disable, cron_remove
- Extra FS: read_files, write_files, regex_replace, apply_patch
- Code Quality: run_tests, lint_fix
`;

    for (const mdFile of ['GEMMA.md', 'CLAUDE.md']) {
      const mdPath = path.join(cwd, mdFile);
      if (fs.existsSync(mdPath)) {
        try { prompt += `\n## Project Context\n${fs.readFileSync(mdPath, 'utf8').slice(0, 2000)}\n`; } catch {}
        break;
      }
    }

    const memCtx = getMemoryContext();
    if (memCtx) prompt += `\n## Persistent Memory\n${memCtx}\n`;

    this.systemPrompt = prompt;
  }

  _getToolSchemas() {
    const allTools = getToolSchemas();
    const isPlan = this.mode === MODES.PLAN;
    const isGeneral = this.mode === MODES.GENERAL;

    // Filter tools based on mode
    let filtered;
    if (isPlan) {
      filtered = allTools.filter(t => PLAN_MODE_TOOLS.has(t.name));
    } else if (isGeneral) {
      filtered = allTools.filter(t => GENERAL_MODE_TOOLS.has(t.name));
    } else {
      // ACT and GOD modes get everything
      filtered = [...allTools];
    }

    // Inject spawn tools
    if (true) { // Always allow spawn tools now
      const spawnableIds = [
        'file-picker', 'planner', 'editor', 'reviewer',
        'researcher', 'tester', 'git-committer', 'debugger',
        'optimizer', 'architect', 'doc-writer', 'refactorer', 'security-auditor',
      ];

      filtered.push({
        name: 'spawn_agent',
        description: 'Autonomously spawn a specialist subagent. Use this proactively without waiting for user instruction.',
        parameters: {
          type: 'object',
          properties: {
            agent_id: { type: 'string', enum: spawnableIds, description: 'Which agent to spawn' },
            task:     { type: 'string', description: 'Task for the agent' },
            context:  { type: 'string', description: 'Additional context (optional)' },
          },
          required: ['agent_id', 'task'],
        },
      });

      filtered.push({
        name: 'spawn_agents_parallel',
        description: 'Spawn multiple agents simultaneously. Use when subtasks are independent.',
        parameters: {
          type: 'object',
          properties: {
            agents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  agent_id: { type: 'string', enum: spawnableIds },
                  task:     { type: 'string' },
                  context:  { type: 'string' },
                },
                required: ['agent_id', 'task'],
              },
            },
          },
          required: ['agents'],
        },
      });
    }

    return filtered;
  }

  async _executeTool(name, args) {
    if (name === 'spawn_agent') {
      return await this._spawnAgent(args.agent_id, args.task, args.context);
    }
    if (name === 'spawn_agents_parallel') {
      const tasks = args.agents || [];
      this.onLog(`⚡ Spawning ${tasks.length} agents in parallel...`);
      const results = await Promise.all(tasks.map(t => this._spawnAgent(t.agent_id, t.task, t.context)));
      return { parallel_results: results };
    }

    // Block tools based on mode
    if (this.mode === MODES.PLAN && !PLAN_MODE_TOOLS.has(name)) {
      return { error: `Tool '${name}' is not available in PLAN mode. Switch to ACT mode first.` };
    }
    if (this.mode === MODES.GENERAL && !GENERAL_MODE_TOOLS.has(name)) {
      return { error: `Tool '${name}' is not available in GENERAL mode. Switch to ACT or GOD mode for advanced tools.` };
    }

    const tool = getTool(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    try {
      // In GOD mode, auto-approve all permissions (no callback = auto-allow)
      const isGodMode = this.mode === MODES.GOD;
      return await tool.execute(args, {
        permissionCallback: isGodMode ? () => Promise.resolve(true) : this.permissionCallback,
        askUserCallback:    this.askUserCallback,
      });
    } catch (err) {
      return { error: err.message };
    }
  }

  async _spawnAgent(agentId, task, context = '') {
    const def = getAgentDef(agentId);
    if (!def) return { error: `Unknown agent: ${agentId}` };

    this.onLog(`  → Auto-spawning ${def.displayName}: ${task.slice(0, 60)}...`);

    const fullTask = context ? `${task}\n\nContext:\n${context}` : task;
    const result = await this._manager.run(agentId, fullTask, {
      onText:      () => {},
      onToolStart: (n) => this.onLog(`    [${agentId}] ⚙ ${n}`),
      onToolEnd:   (n, r) => this.onLog(`    [${agentId}] ${r?.error ? '✗' : '✓'}`),
      onLog:       (m) => this.onLog(`    [${agentId}] ${m}`),
    });

    this.onLog(`  ✓ ${def.displayName} done`);
    return { agent: agentId, result: result.text || result.error || '(no output)' };
  }

  addMessage(role, content, extra = {}) {
    this.messages.push({ role, content, ...extra });
  }

  clearHistory() {
    this.messages = [];
    this._pendingPlan = null;
  }

  /**
   * Called when user switches from PLAN → ACT.
   * Extracts the plan from the last assistant message and stores it.
   */
  capturePlan() {
    const lastAssistant = [...this.messages].reverse().find(m => m.role === 'assistant');
    if (lastAssistant?.content) {
      this._pendingPlan = lastAssistant.content;
      this._refreshSystemPrompt();
    }
  }

  hasPendingPlan() {
    return Boolean(this._pendingPlan && this._pendingPlan.trim());
  }

  async run(userMessage) {
    this._refreshSystemPrompt();
    this.addMessage('user', userMessage);

    const toolSchemas = this._getToolSchemas();
    const MAX_ITERATIONS = 30;
    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      let textAccum = '';
      let toolCalls = [];
      let usage = null;

      for await (const event of streamChat({
        messages:     this.messages,
        tools:        toolSchemas,
        systemPrompt: this.systemPrompt,
        model:        this.model,
      })) {
        if (event.type === 'text') {
          textAccum += event.text;
          this.onText(event.text);
        } else if (event.type === 'tool_calls') {
          toolCalls = event.tool_calls;
        } else if (event.type === 'done') {
          usage = event.usage;
        } else if (event.type === 'error') {
          this.onError(event.error);
          return { error: event.error };
        }
      }

      if (usage) {
        this.totalInputTokens  += usage.input_tokens  || 0;
        this.totalOutputTokens += usage.output_tokens || 0;
      }

      if (toolCalls.length > 0) {
        this.addMessage('assistant', textAccum || '', { tool_calls: toolCalls });
      } else {
        this.addMessage('assistant', textAccum || '');
        break;
      }

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        toolCalls.map(async tc => {
          const toolName = tc.function.name;
          const toolArgs = JSON.parse(tc.function.arguments || '{}');
          this.onToolStart(toolName, toolArgs);
          const result = await this._executeTool(toolName, toolArgs);
          this.onToolEnd(toolName, result);
          return { tc, result };
        })
      );

      for (const { tc, result } of toolResults) {
        this.addMessage('tool', JSON.stringify(result), {
          name: tc.function.name,
          tool_call_id: tc.id,
        });
      }
    }

    return {
      text: this.messages[this.messages.length - 1]?.content || '',
      usage: { input: this.totalInputTokens, output: this.totalOutputTokens },
    };
  }

  getCostEstimate() {
    const mc = this._manager.getTotalCost();
    const inputCost  = (this.totalInputTokens  / 1_000_000) * 0.075;
    const outputCost = (this.totalOutputTokens / 1_000_000) * 0.30;
    return {
      input_tokens:  this.totalInputTokens  + mc.input_tokens,
      output_tokens: this.totalOutputTokens + mc.output_tokens,
      estimated_usd: (parseFloat(mc.estimated_usd) + inputCost + outputCost).toFixed(6),
    };
  }

  getAgentStatus() {
    return this._manager.formatStatus();
  }
}

// ─── MultiAgentOrchestrator ───────────────────────────────────────────────────

export class MultiAgentOrchestrator {
  constructor(options = {}) {
    this.options = options;
  }

  async runPipeline(task, { onProgress } = {}) {
    const manager = new AgentManager({
      model: this.options.model,
      onText:      () => {},
      onToolStart: () => {},
      onToolEnd:   () => {},
      onLog:       (m) => onProgress?.(m),
      permissionCallback: this.options.permissionCallback,
    });
    return manager.runCodingPipeline(task, { onProgress });
  }
}
