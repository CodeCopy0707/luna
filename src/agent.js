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
import { streamChat }        from './gemini.js';
import { getTool, getToolSchemas } from './tools.js';
import { MODES }             from './tui/mode_tab.js';
import fs   from 'fs';
import path from 'path';
import os   from 'os';

// ─── Tool sets per mode ───────────────────────────────────────────────────────

const PLAN_MODE_TOOLS = new Set([
  'read_file', 'list_dir', 'glob', 'grep',
  'web_search', 'web_search_deep', 'web_fetch',
  'task_create', 'task_update', 'task_list', 'task_get',
  'memory_save', 'memory_search', 'memory_list', 'memory_delete',
  'ask_user',
  'spawn_agent', 'spawn_agents_parallel',
]);

// ACT mode gets everything

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

    // Plan/Act mode
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

  _refreshSystemPrompt() {
    const cfg = getConfig();
    const cwd = process.cwd();
    const isPlan = this.mode === MODES.PLAN;

    let prompt = `You are Gemma, a powerful AI coding assistant.
Current mode: ${isPlan ? '📋 PLAN' : '⚡ ACT'}

${isPlan ? `## PLAN MODE
You are in research and planning mode. Your job is to:
1. Understand the task thoroughly
2. Search the web for relevant documentation, best practices, and examples
3. Read and analyze the codebase
4. Create a detailed, step-by-step implementation plan
5. Identify risks, dependencies, and edge cases
6. DO NOT make any code changes, file writes, or run commands that modify state
7. End your response with a clear "## Implementation Plan" section

When done planning, tell the user: "Plan complete. Switch to ACT mode (press Tab) to implement."
` : `## ACT MODE
You are in execution mode. You have a plan to implement.
${this._pendingPlan ? `\n## Plan to Execute\n${this._pendingPlan}\n` : ''}
Execute the plan precisely:
1. Implement changes file by file
2. Run tests after each significant change
3. Verify nothing is broken
4. Spawn specialist subagents for complex subtasks
5. Report progress as you go
`}

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

    // In PLAN mode, filter to read-only + planning tools
    const filtered = isPlan
      ? allTools.filter(t => PLAN_MODE_TOOLS.has(t.name))
      : allTools;

    const spawnableIds = [
      'file-picker', 'planner', 'editor', 'reviewer',
      'researcher', 'tester', 'git-committer', 'debugger',
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

    // Block write tools in PLAN mode
    if (this.mode === MODES.PLAN && !PLAN_MODE_TOOLS.has(name)) {
      return { error: `Tool '${name}' is not available in PLAN mode. Switch to ACT mode first.` };
    }

    const tool = getTool(name);
    if (!tool) return { error: `Unknown tool: ${name}` };
    try {
      return await tool.execute(args, {
        permissionCallback: this.permissionCallback,
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
