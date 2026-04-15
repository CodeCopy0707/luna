/**
 * tools.js — All built-in tools for Gemma Agent
 * Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, ListDir
 */

import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import { createDiff } from './diff.js';
import { getConfig } from './config.js';

const execAsync = promisify(exec);

// ─── Tool Registry ────────────────────────────────────────────────────────────

const _tools = new Map();

export function registerTool(def) {
  _tools.set(def.name, def);
}

export function getTool(name) {
  return _tools.get(name);
}

export function getAllTools() {
  return Array.from(_tools.values());
}

export function getToolSchemas() {
  return getAllTools().map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

// ─── Permission Check ─────────────────────────────────────────────────────────

let _permissionCallback = null;

export function setPermissionCallback(cb) {
  _permissionCallback = cb;
}

const READ_ONLY_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'echo', 'git status',
  'git log', 'git diff', 'git show', 'find', 'grep', 'rg', 'python --version',
  'node --version', 'npm list', 'pip show', 'which', 'type', 'file',
];

function isReadOnlyCommand(cmd) {
  const trimmed = cmd.trim().toLowerCase();
  return READ_ONLY_COMMANDS.some(ro => trimmed.startsWith(ro));
}

async function checkPermission(toolName, description, isReadOnly = false) {
  const cfg = getConfig();
  if (cfg.permission_mode === 'accept-all') return true;
  if (cfg.permission_mode === 'auto' && isReadOnly) return true;
  if (_permissionCallback) {
    return await _permissionCallback(toolName, description);
  }
  return true;
}

// ─── Tool: Read ───────────────────────────────────────────────────────────────

registerTool({
  name: 'read_file',
  description: 'Read the contents of a file. Returns file content with line numbers.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to read' },
      start_line: { type: 'number', description: 'Starting line number (1-indexed, optional)' },
      end_line: { type: 'number', description: 'Ending line number (1-indexed, optional)' },
    },
    required: ['file_path'],
  },
  readOnly: true,
  async execute({ file_path, start_line, end_line }) {
    const resolved = path.resolve(process.cwd(), file_path);
    if (!fs.existsSync(resolved)) {
      return { error: `File not found: ${file_path}` };
    }
    const content = fs.readFileSync(resolved, 'utf8');
    const lines = content.split('\n');
    const s = start_line ? start_line - 1 : 0;
    const e = end_line ? end_line : lines.length;
    const slice = lines.slice(s, e);
    const numbered = slice.map((l, i) => `${String(s + i + 1).padStart(4)} | ${l}`).join('\n');
    return { content: numbered, total_lines: lines.length };
  },
});

// ─── Tool: Write ──────────────────────────────────────────────────────────────

registerTool({
  name: 'write_file',
  description: 'Create or overwrite a file with new content. Shows a diff of changes.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['file_path', 'content'],
  },
  readOnly: false,
  async execute({ file_path, content }, { emitDiff } = {}) {
    const allowed = await checkPermission('write_file', `Write to ${file_path}`, false);
    if (!allowed) return { error: 'Permission denied' };
    
    const resolved = path.resolve(process.cwd(), file_path);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    let oldContent = '';
    if (fs.existsSync(resolved)) {
      oldContent = fs.readFileSync(resolved, 'utf8');
    }
    
    fs.writeFileSync(resolved, content, 'utf8');
    const diff = createDiff(oldContent, content, file_path);
    return { success: true, diff, file_path };
  },
});

// ─── Tool: Edit ───────────────────────────────────────────────────────────────

registerTool({
  name: 'edit_file',
  description: 'Edit a file by replacing an exact string with new content. Shows a diff.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to edit' },
      old_string: { type: 'string', description: 'The exact string to find and replace' },
      new_string: { type: 'string', description: 'The replacement string' },
      replace_all: { type: 'boolean', description: 'Replace all occurrences (default: false)' },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
  readOnly: false,
  async execute({ file_path, old_string, new_string, replace_all = false }) {
    const allowed = await checkPermission('edit_file', `Edit ${file_path}`, false);
    if (!allowed) return { error: 'Permission denied' };
    
    const resolved = path.resolve(process.cwd(), file_path);
    if (!fs.existsSync(resolved)) {
      return { error: `File not found: ${file_path}` };
    }
    
    const oldContent = fs.readFileSync(resolved, 'utf8');
    if (!oldContent.includes(old_string)) {
      return { error: `String not found in ${file_path}. Make sure old_string matches exactly.` };
    }
    
    const newContent = replace_all
      ? oldContent.split(old_string).join(new_string)
      : oldContent.replace(old_string, new_string);
    
    fs.writeFileSync(resolved, newContent, 'utf8');
    const diff = createDiff(oldContent, newContent, file_path);
    return { success: true, diff, file_path };
  },
});

// ─── Tool: Bash ───────────────────────────────────────────────────────────────

registerTool({
  name: 'bash',
  description: 'Execute a shell command and return stdout/stderr. Use for running tests, git commands, building, etc.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      cwd: { type: 'string', description: 'Working directory for the command (optional)' },
    },
    required: ['command'],
  },
  readOnly: false,
  async execute({ command, timeout = 30000, cwd }) {
    const isReadOnly = isReadOnlyCommand(command);
    const allowed = await checkPermission('bash', `Run: ${command}`, isReadOnly);
    if (!allowed) return { error: 'Permission denied' };
    
    try {
      const workDir = cwd ? path.resolve(process.cwd(), cwd) : process.cwd();
      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });
      return { stdout: stdout.trim(), stderr: stderr.trim(), exit_code: 0 };
    } catch (err) {
      return {
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || err.message,
        exit_code: err.code || 1,
      };
    }
  },
});

// ─── Tool: Glob ───────────────────────────────────────────────────────────────

registerTool({
  name: 'glob',
  description: 'Find files matching a glob pattern. Returns a list of matching file paths.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g. **/*.js, src/**/*.ts)' },
      cwd: { type: 'string', description: 'Base directory for the search (default: current dir)' },
      ignore: { type: 'array', items: { type: 'string' }, description: 'Patterns to ignore' },
    },
    required: ['pattern'],
  },
  readOnly: true,
  async execute({ pattern, cwd, ignore = [] }) {
    const baseDir = cwd ? path.resolve(process.cwd(), cwd) : process.cwd();
    const defaultIgnore = ['node_modules/**', '.git/**', 'dist/**', 'build/**', ...ignore];
    
    const files = await glob(pattern, {
      cwd: baseDir,
      ignore: defaultIgnore,
      nodir: true,
    });
    
    return { files: files.sort(), count: files.length };
  },
});

// ─── Tool: Grep ───────────────────────────────────────────────────────────────

registerTool({
  name: 'grep',
  description: 'Search for a regex pattern in files. Returns matching lines with file paths and line numbers.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory or file to search in (default: current dir)' },
      glob_pattern: { type: 'string', description: 'File glob filter (e.g. **/*.js)' },
      case_sensitive: { type: 'boolean', description: 'Case sensitive search (default: false)' },
      max_results: { type: 'number', description: 'Maximum number of results (default: 50)' },
    },
    required: ['pattern'],
  },
  readOnly: true,
  async execute({ pattern, path: searchPath, glob_pattern, case_sensitive = false, max_results = 50 }) {
    const baseDir = searchPath ? path.resolve(process.cwd(), searchPath) : process.cwd();
    
    // Try ripgrep first, fall back to grep
    let cmd;
    try {
      execSync('which rg', { stdio: 'ignore' });
      const flags = case_sensitive ? '' : '-i';
      const globFlag = glob_pattern ? `--glob "${glob_pattern}"` : '';
      cmd = `rg ${flags} ${globFlag} --line-number --no-heading -m ${max_results} "${pattern}" "${baseDir}" 2>/dev/null | head -${max_results}`;
    } catch {
      const flags = case_sensitive ? '' : '-i';
      const include = glob_pattern ? `--include="${glob_pattern}"` : '';
      cmd = `grep -rn ${flags} ${include} "${pattern}" "${baseDir}" 2>/dev/null | head -${max_results}`;
    }
    
    try {
      const { stdout } = await execAsync(cmd, { timeout: 15000 });
      const lines = stdout.trim().split('\n').filter(Boolean);
      return { matches: lines, count: lines.length };
    } catch {
      return { matches: [], count: 0 };
    }
  },
});

// ─── Tool: List Directory ─────────────────────────────────────────────────────

registerTool({
  name: 'list_dir',
  description: 'List files and directories in a path. Shows file sizes and types.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list (default: current dir)' },
      depth: { type: 'number', description: 'Recursion depth (default: 1)' },
    },
    required: [],
  },
  readOnly: true,
  async execute({ path: dirPath = '.', depth = 1 }) {
    const resolved = path.resolve(process.cwd(), dirPath);
    
    function listRecursive(dir, currentDepth) {
      if (currentDepth > depth) return [];
      const entries = [];
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.') && item.name !== '.env') continue;
          if (['node_modules', '.git', 'dist', 'build'].includes(item.name)) continue;
          const fullPath = path.join(dir, item.name);
          const rel = path.relative(process.cwd(), fullPath);
          if (item.isDirectory()) {
            entries.push(`📁 ${rel}/`);
            if (currentDepth < depth) {
              entries.push(...listRecursive(fullPath, currentDepth + 1));
            }
          } else {
            const stat = fs.statSync(fullPath);
            const size = stat.size < 1024 ? `${stat.size}B` : `${(stat.size / 1024).toFixed(1)}KB`;
            entries.push(`📄 ${rel} (${size})`);
          }
        }
      } catch {}
      return entries;
    }
    
    const entries = listRecursive(resolved, 1);
    return { entries, path: dirPath };
  },
});

// ─── Tool: WebFetch ───────────────────────────────────────────────────────────

registerTool({
  name: 'web_fetch',
  description: 'Fetch content from a URL and extract readable text.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      prompt: { type: 'string', description: 'What to extract from the page (optional)' },
    },
    required: ['url'],
  },
  readOnly: true,
  async execute({ url, prompt }) {
    try {
      const { default: fetch } = await import('node-fetch');
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GemmaAgent/1.0)' },
        timeout: 15000,
      });
      const html = await res.text();
      // Strip HTML tags
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 8000);
      return { content: text, url, status: res.status };
    } catch (err) {
      return { error: err.message, url };
    }
  },
});

// ─── Tool: WebSearch ──────────────────────────────────────────────────────────

registerTool({
  name: 'web_search',
  description: 'Search the web using DuckDuckGo. Returns a list of results with titles, URLs, and snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Maximum results to return (default: 5)' },
    },
    required: ['query'],
  },
  readOnly: true,
  async execute({ query, max_results = 5 }) {
    try {
      const { default: fetch } = await import('node-fetch');
      const encoded = encodeURIComponent(query);
      const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(url, { timeout: 10000 });
      const data = await res.json();
      
      const results = [];
      if (data.AbstractText) {
        results.push({ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL });
      }
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, max_results - results.length)) {
          if (topic.Text && topic.FirstURL) {
            results.push({ title: topic.Text.split(' - ')[0], snippet: topic.Text, url: topic.FirstURL });
          }
        }
      }
      return { results: results.slice(0, max_results), query };
    } catch (err) {
      return { error: err.message, query };
    }
  },
});

// ─── Tool: AskUser ────────────────────────────────────────────────────────────

registerTool({
  name: 'ask_user',
  description: 'Ask the user a clarifying question mid-task. Pauses execution until the user responds.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user' },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            description: { type: 'string' },
          },
        },
        description: 'Optional list of choices to present to the user',
      },
    },
    required: ['question'],
  },
  readOnly: true,
  async execute({ question, options }, { askUserCallback } = {}) {
    if (askUserCallback) {
      return await askUserCallback(question, options);
    }
    return { answer: '(no callback registered)' };
  },
});
