/**
 * agent.js — Core agent loop
 * Handles streaming, tool dispatch, multi-turn conversations
 * Inspired by ClawSpring's agent.py and Codebuff's multi-agent architecture
 */

import { streamChat } from './gemini.js';
import { getTool, getAllTools } from './tools.js';
import { getConfig } from './config.js';
import { getMemoryContext } from './memory.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt() {
  const cfg = getConfig();
  const cwd = process.cwd();
  const platform = `${os.platform()} ${os.release()}`;
  
  let prompt = `You are Gemma, a powerful AI coding assistant running in the terminal.
You help developers write, edit, debug, and understand code.

## Environment
- Working directory: ${cwd}
- Platform: ${platform}
- Date: ${new Date().toLocaleDateString()}
- Model: ${cfg.model}

## Capabilities
You have access to tools for reading/writing files, running shell commands, searching code, fetching web content, managing tasks, and storing memories.

## Guidelines
- Always read relevant files before making changes
- Show diffs when editing files
- Ask for clarification when the task is ambiguous (use ask_user tool)
- Break complex tasks into steps using task_create/task_update
- Save important decisions to memory using memory_save
- Be concise but thorough
- Prefer editing existing code over rewriting from scratch
- Run tests after making changes when a test suite exists

## Tool Usage
- Use read_file to understand existing code before editing
- Use bash for running commands, tests, git operations
- Use glob/grep to find relevant files
- Use write_file for new files, edit_file for modifications
- Use web_search/web_fetch for documentation lookups
`;

  // Inject CLAUDE.md / GEMMA.md if present
  for (const mdFile of ['GEMMA.md', 'CLAUDE.md', '.gemma.md']) {
    const mdPath = path.join(cwd, mdFile);
    if (fs.existsSync(mdPath)) {
      const content = fs.readFileSync(mdPath, 'utf8').slice(0, 3000);
      prompt += `\n## Project Context (${mdFile})\n${content}\n`;
      break;
    }
  }
  
  // Inject memory context
  const memCtx = getMemoryContext();
  if (memCtx) {
    prompt += `\n## Persistent Memory\n${memCtx}\n`;
  }
  
  // Git context can be added here if needed
  
  return prompt;
}

// ─── Agent Class ──────────────────────────────────────────────────────────────

export class Agent {
  constructor({ model, onText, onToolStart, onToolEnd, onError, permissionCallback, askUserCallback } = {}) {
    this.model = model;
    this.messages = [];
    this.onText = onText || (() => {});
    this.onToolStart = onToolStart || (() => {});
    this.onToolEnd = onToolEnd || (() => {});
    this.onError = onError || console.error;
    this.permissionCallback = permissionCallback;
    this.askUserCallback = askUserCallback;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
    this.systemPrompt = '';
    this._refreshSystemPrompt();
  }
  
  _refreshSystemPrompt() {
    const cfg = getConfig();
    const cwd = process.cwd();
    const platform = `${os.platform()} ${os.release()}`;
    
    let prompt = `You are Gemma, a powerful AI coding assistant running in the terminal.
You help developers write, edit, debug, and understand code.

## Environment
- Working directory: ${cwd}
- Platform: ${platform}
- Date: ${new Date().toLocaleDateString()}
- Model: ${this.model || cfg.model}

## Capabilities
You have access to tools for reading/writing files, running shell commands, searching code, fetching web content, managing tasks, and storing memories.

## Guidelines
- Always read relevant files before making changes
- Show diffs when editing files
- Ask for clarification when the task is ambiguous (use ask_user tool)
- Break complex tasks into steps using task_create/task_update
- Save important decisions to memory using memory_save
- Be concise but thorough
- Prefer editing existing code over rewriting from scratch
- Run tests after making changes when a test suite exists

## Tool Usage
- Use read_file to understand existing code before editing
- Use bash for running commands, tests, git operations
- Use glob/grep to find relevant files
- Use write_file for new files, edit_file for modifications
- Use web_search/web_fetch for documentation lookups
`;

    // Inject GEMMA.md / CLAUDE.md
    for (const mdFile of ['GEMMA.md', 'CLAUDE.md', '.gemma.md']) {
      const mdPath = path.join(cwd, mdFile);
      if (fs.existsSync(mdPath)) {
        try {
          const content = fs.readFileSync(mdPath, 'utf8').slice(0, 3000);
          prompt += `\n## Project Context (${mdFile})\n${content}\n`;
        } catch {}
        break;
      }
    }
    
    // Inject memory
    const memCtx = getMemoryContext();
    if (memCtx) {
      prompt += `\n## Persistent Memory\n${memCtx}\n`;
    }
    
    this.systemPrompt = prompt;
  }
  
  addMessage(role, content, extra = {}) {
    this.messages.push({ role, content, ...extra });
  }
  
  clearHistory() {
    this.messages = [];
  }
  
  async run(userMessage) {
    this._refreshSystemPrompt();
    this.addMessage('user', userMessage);
    
    let iterations = 0;
    const MAX_ITERATIONS = 20;
    
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      
      let textAccum = '';
      let toolCalls = [];
      let usage = null;
      
      // Stream from Gemini
      for await (const event of streamChat({
        messages: this.messages,
        systemPrompt: this.systemPrompt,
        model: this.model,
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
      
      // Track token usage
      if (usage) {
        this.totalInputTokens += usage.input_tokens || 0;
        this.totalOutputTokens += usage.output_tokens || 0;
      }
      
      // Add assistant message to history
      if (toolCalls.length > 0) {
        this.addMessage('assistant', textAccum || '', { tool_calls: toolCalls });
      } else {
        this.addMessage('assistant', textAccum || '');
        break; // No tool calls = done
      }
      
      // Execute tool calls
      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        const toolArgs = JSON.parse(tc.function.arguments || '{}');
        
        this.onToolStart(toolName, toolArgs);
        
        let result;
        const tool = getTool(toolName);
        if (!tool) {
          result = { error: `Unknown tool: ${toolName}` };
        } else {
          try {
            result = await tool.execute(toolArgs, {
              permissionCallback: this.permissionCallback,
              askUserCallback: this.askUserCallback,
            });
          } catch (err) {
            result = { error: err.message };
          }
        }
        
        this.onToolEnd(toolName, result);
        
        // Add tool result to messages
        this.addMessage('tool', JSON.stringify(result), { name: toolName, tool_call_id: tc.id });
      }
    }
    
    return {
      text: this.messages[this.messages.length - 1]?.content || '',
      usage: { input: this.totalInputTokens, output: this.totalOutputTokens },
    };
  }
  
  getCostEstimate() {
    // Gemini 2.0 Flash pricing (approximate)
    const inputCost = (this.totalInputTokens / 1_000_000) * 0.075;
    const outputCost = (this.totalOutputTokens / 1_000_000) * 0.30;
    return {
      input_tokens: this.totalInputTokens,
      output_tokens: this.totalOutputTokens,
      estimated_usd: (inputCost + outputCost).toFixed(6),
    };
  }
}

// ─── Multi-Agent: Specialized Agents ─────────────────────────────────────────

export class MultiAgentOrchestrator {
  constructor(options = {}) {
    this.options = options;
    this.agents = new Map();
  }
  
  createAgent(type, overrides = {}) {
    const AGENT_PROMPTS = {
      'file-picker': 'You are a File Picker Agent. Your job is to analyze the codebase structure and identify which files are relevant to the given task. Return a JSON list of file paths.',
      'planner': 'You are a Planner Agent. Your job is to create a detailed step-by-step plan for implementing the requested changes. Be specific about which files to modify and what changes to make.',
      'editor': 'You are an Editor Agent. Your job is to implement code changes precisely and correctly. Always read files before editing them.',
      'reviewer': 'You are a Reviewer Agent. Your job is to review code changes for correctness, security issues, and best practices. Be thorough and specific.',
      'researcher': 'You are a Researcher Agent. Your job is to search for documentation, examples, and solutions. Use web_search and web_fetch tools.',
      'tester': 'You are a Tester Agent. Your job is to write and run tests to verify that code changes work correctly.',
    };
    
    const agent = new Agent({
      ...this.options,
      ...overrides,
    });
    
    if (AGENT_PROMPTS[type]) {
      agent.systemPrompt = AGENT_PROMPTS[type] + '\n\n' + agent.systemPrompt;
    }
    
    this.agents.set(type, agent);
    return agent;
  }
  
  async runPipeline(task, { onProgress } = {}) {
    const results = {};
    
    // Step 1: File Picker
    onProgress?.('🔍 File Picker Agent scanning codebase...');
    const picker = this.createAgent('file-picker');
    const pickerResult = await picker.run(
      `Task: ${task}\n\nScan the codebase and identify which files are relevant. Use glob and grep tools. Return a JSON array of file paths.`
    );
    results.files = pickerResult.text;
    
    // Step 2: Planner
    onProgress?.('📋 Planner Agent creating implementation plan...');
    const planner = this.createAgent('planner');
    const plannerResult = await planner.run(
      `Task: ${task}\n\nRelevant files identified: ${results.files}\n\nCreate a detailed implementation plan.`
    );
    results.plan = plannerResult.text;
    
    // Step 3: Editor
    onProgress?.('✏️  Editor Agent implementing changes...');
    const editor = this.createAgent('editor');
    const editorResult = await editor.run(
      `Task: ${task}\n\nPlan: ${results.plan}\n\nImplement the changes now.`
    );
    results.implementation = editorResult.text;
    
    // Step 4: Reviewer
    onProgress?.('🔎 Reviewer Agent validating changes...');
    const reviewer = this.createAgent('reviewer');
    const reviewerResult = await reviewer.run(
      `Review the following implementation for the task: ${task}\n\nImplementation: ${results.implementation}\n\nCheck for bugs, security issues, and best practices.`
    );
    results.review = reviewerResult.text;
    
    return results;
  }
}
