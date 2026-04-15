/**
 * agents/runner.js — Agent Runner
 *
 * Runs a single agent definition against a task.
 * Supports spawning subagents (parallel or sequential).
 * Tracks all running agents in the AgentManager.
 */

import { Agent } from '../agent.js';
import { getAgentDef } from './registry.js';
import { getToolSchemas, getTool } from '../tools.js';
import { streamChat } from '../gemini.js';
import { getConfig } from '../config.js';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { getMemoryContext } from '../memory.js';

// ─── AgentRunner ──────────────────────────────────────────────────────────────

export class AgentRunner {
  /**
   * @param {object} def        - Agent definition from registry
   * @param {object} options
   * @param {string} options.model
   * @param {function} options.onText
   * @param {function} options.onToolStart
   * @param {function} options.onToolEnd
   * @param {function} options.onSpawn      - called when spawning a subagent
   * @param {function} options.onLog        - general log messages
   * @param {function} options.permissionCallback
   * @param {AgentManager} options.manager  - parent manager for subagent spawning
   */
  constructor(def, options = {}) {
    this.def = def;
    this.options = options;
    this.messages = [];
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.status = 'idle'; // idle | running | done | error
    this.result = null;
    this.error = null;
    this.startedAt = null;
    this.finishedAt = null;
  }

  _buildSystemPrompt() {
    const cfg = getConfig();
    const cwd = process.cwd();
    const platform = `${os.platform()} ${os.release()}`;

    let prompt = `${this.def.instructionsPrompt}\n\n`;
    prompt += `## Environment\n`;
    prompt += `- Working directory: ${cwd}\n`;
    prompt += `- Platform: ${platform}\n`;
    prompt += `- Date: ${new Date().toLocaleDateString()}\n`;
    prompt += `- Model: ${this.options.model || cfg.model}\n\n`;

    // Inject GEMMA.md / CLAUDE.md
    for (const mdFile of ['GEMMA.md', 'CLAUDE.md']) {
      const mdPath = path.join(cwd, mdFile);
      if (fs.existsSync(mdPath)) {
        try {
          prompt += `## Project Context\n${fs.readFileSync(mdPath, 'utf8').slice(0, 2000)}\n\n`;
        } catch {}
        break;
      }
    }

    // Memory
    const memCtx = getMemoryContext();
    if (memCtx) prompt += `## Persistent Memory\n${memCtx}\n\n`;

    // Available tools
    const toolNames = this.def.toolNames || [];
    if (toolNames.length > 0) {
      prompt += `## Available Tools\n${toolNames.join(', ')}\n\n`;
    }

    // Spawnable subagents
    if (this.def.spawnableAgents?.length > 0) {
      prompt += `## Spawnable Subagents\n`;
      prompt += `You can spawn these specialist agents using the spawn_agent tool:\n`;
      for (const agentId of this.def.spawnableAgents) {
        const subDef = getAgentDef(agentId);
        if (subDef) {
          prompt += `- **${agentId}**: ${subDef.description}\n`;
        }
      }
      prompt += `\nUse spawn_agent to delegate subtasks. Use spawn_agents_parallel to run multiple agents simultaneously.\n\n`;
    }

    return prompt;
  }

  _getToolSchemas() {
    const allowed = new Set(this.def.toolNames || []);
    const base = getToolSchemas().filter(t => allowed.size === 0 || allowed.has(t.name));

    // Add spawn_agent tool if this agent can spawn subagents
    if (this.def.spawnableAgents?.length > 0) {
      base.push({
        name: 'spawn_agent',
        description: 'Spawn a specialist subagent to handle a specific subtask. Returns the agent\'s result.',
        parameters: {
          type: 'object',
          properties: {
            agent_id: {
              type: 'string',
              enum: this.def.spawnableAgents,
              description: 'Which specialist agent to spawn',
            },
            task: {
              type: 'string',
              description: 'The specific task for this agent to complete',
            },
            context: {
              type: 'string',
              description: 'Additional context to pass to the agent (optional)',
            },
          },
          required: ['agent_id', 'task'],
        },
      });

      base.push({
        name: 'spawn_agents_parallel',
        description: 'Spawn multiple specialist agents in parallel. All run simultaneously. Returns all results.',
        parameters: {
          type: 'object',
          properties: {
            agents: {
              type: 'array',
              description: 'List of agents to spawn in parallel',
              items: {
                type: 'object',
                properties: {
                  agent_id: { type: 'string', enum: this.def.spawnableAgents },
                  task: { type: 'string' },
                  context: { type: 'string' },
                },
                required: ['agent_id', 'task'],
              },
            },
          },
          required: ['agents'],
        },
      });
    }

    return base;
  }

  async _executeTool(name, args) {
    // Handle spawn_agent
    if (name === 'spawn_agent') {
      return await this._spawnSubagent(args.agent_id, args.task, args.context);
    }

    // Handle spawn_agents_parallel
    if (name === 'spawn_agents_parallel') {
      const tasks = args.agents || [];
      this.options.onLog?.(`⚡ Spawning ${tasks.length} agents in parallel...`);
      const results = await Promise.all(
        tasks.map(t => this._spawnSubagent(t.agent_id, t.task, t.context))
      );
      return { parallel_results: results };
    }

    // Regular tool
    const tool = getTool(name);
    if (!tool) return { error: `Unknown tool: ${name}` };

    try {
      return await tool.execute(args, {
        permissionCallback: this.options.permissionCallback,
        askUserCallback: this.options.askUserCallback,
      });
    } catch (err) {
      return { error: err.message };
    }
  }

  async _spawnSubagent(agentId, task, context = '') {
    const def = getAgentDef(agentId);
    if (!def) return { error: `Unknown agent: ${agentId}` };

    this.options.onSpawn?.(agentId, task);
    this.options.onLog?.(`  → Spawning ${def.displayName}: ${task.slice(0, 60)}...`);

    const subRunner = new AgentRunner(def, {
      ...this.options,
      onText: () => {}, // suppress subagent text streaming
      onLog: (msg) => this.options.onLog?.(`    [${agentId}] ${msg}`),
    });

    // Register in manager if available
    const taskId = this.options.manager?.registerSubagent(agentId, task, subRunner);

    const fullTask = context ? `${task}\n\nContext:\n${context}` : task;
    const result = await subRunner.run(fullTask);

    this.options.manager?.completeSubagent(taskId, result);
    this.options.onLog?.(`  ✓ ${def.displayName} completed`);

    return { agent: agentId, result: result.text || result.error || '(no output)' };
  }

  async run(userMessage) {
    this.status = 'running';
    this.startedAt = Date.now();
    const systemPrompt = this._buildSystemPrompt();
    const toolSchemas = this._getToolSchemas();
    const cfg = getConfig();
    const modelName = this.options.model || cfg.model;
    const maxIter = this.def.maxIterations || 20;

    this.messages.push({ role: 'user', content: userMessage });

    let iterations = 0;

    try {
      while (iterations < maxIter) {
        iterations++;

        let textAccum = '';
        let toolCalls = [];
        let usage = null;

        for await (const event of streamChat({
          messages: this.messages,
          tools: toolSchemas,
          systemPrompt,
          model: modelName,
        })) {
          if (event.type === 'text') {
            textAccum += event.text;
            this.options.onText?.(event.text);
          } else if (event.type === 'tool_calls') {
            toolCalls = event.tool_calls;
          } else if (event.type === 'done') {
            usage = event.usage;
          } else if (event.type === 'error') {
            throw new Error(event.error);
          }
        }

        if (usage) {
          this.totalInputTokens  += usage.input_tokens  || 0;
          this.totalOutputTokens += usage.output_tokens || 0;
        }

        if (toolCalls.length > 0) {
          this.messages.push({ role: 'assistant', content: textAccum || '', tool_calls: toolCalls });
        } else {
          this.messages.push({ role: 'assistant', content: textAccum || '' });
          break;
        }

        // Execute tools (possibly in parallel if they're independent)
        const toolResults = await Promise.all(
          toolCalls.map(async tc => {
            const toolName = tc.function.name;
            const toolArgs = JSON.parse(tc.function.arguments || '{}');
            this.options.onToolStart?.(toolName, toolArgs);
            const result = await this._executeTool(toolName, toolArgs);
            this.options.onToolEnd?.(toolName, result);
            return { tc, result };
          })
        );

        for (const { tc, result } of toolResults) {
          this.messages.push({
            role: 'tool',
            content: JSON.stringify(result),
            name: tc.function.name,
            tool_call_id: tc.id,
          });
        }
      }

      const lastMsg = this.messages[this.messages.length - 1];
      this.result = { text: lastMsg?.content || '', messages: this.messages };
      this.status = 'done';
      this.finishedAt = Date.now();
      return this.result;

    } catch (err) {
      this.error = err.message;
      this.status = 'error';
      this.finishedAt = Date.now();
      return { error: err.message, text: '' };
    }
  }

  getCostEstimate() {
    const inputCost  = (this.totalInputTokens  / 1_000_000) * 0.075;
    const outputCost = (this.totalOutputTokens / 1_000_000) * 0.30;
    return {
      input_tokens:  this.totalInputTokens,
      output_tokens: this.totalOutputTokens,
      estimated_usd: (inputCost + outputCost).toFixed(6),
    };
  }
}
