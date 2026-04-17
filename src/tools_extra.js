/**
 * tools_extra.js — Additional tools for Gemma Agent v3
 * read_files, write_files, regex_replace, apply_patch, run_tests, lint_fix
 */

import fs from 'fs';
import path from 'path';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { registerTool } from './tools.js';
import { createDiff } from './diff.js';

const execAsync = promisify(exec);

// Re-use the same permission check pattern from tools.js
import { getConfig } from './config.js';

let _permissionCallback = null;

async function checkPermission(toolName, description, isReadOnly = false) {
  const cfg = getConfig();
  if (cfg.permission_mode === 'accept-all') return true;
  if (cfg.permission_mode === 'auto' && isReadOnly) return true;
  if (_permissionCallback) {
    return await _permissionCallback(toolName, description);
  }
  return true;
}

// ─── Tool: Read Files (batch) ─────────────────────────────────────────────────

registerTool({
  name: 'read_files',
  description: 'Read multiple files at once. Returns an array of file contents with line numbers. More efficient than multiple read_file calls.',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'Array of files to read',
        items: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file to read' },
            start_line: { type: 'number', description: 'Starting line number (1-indexed, optional)' },
            end_line: { type: 'number', description: 'Ending line number (1-indexed, optional)' },
          },
          required: ['file_path'],
        },
      },
    },
    required: ['files'],
  },
  readOnly: true,
  async execute({ files }) {
    const results = [];
    for (const { file_path, start_line, end_line } of files) {
      const resolved = path.resolve(process.cwd(), file_path);
      if (!fs.existsSync(resolved)) {
        results.push({ file_path, error: `File not found: ${file_path}` });
        continue;
      }
      const content = fs.readFileSync(resolved, 'utf8');
      const lines = content.split('\n');
      const s = start_line ? start_line - 1 : 0;
      const e = end_line ? end_line : lines.length;
      const slice = lines.slice(s, e);
      const numbered = slice.map((l, i) => `${String(s + i + 1).padStart(4)} | ${l}`).join('\n');
      results.push({ file_path, content: numbered, total_lines: lines.length });
    }
    return { results, count: results.length };
  },
});

// ─── Tool: Write Files (batch) ────────────────────────────────────────────────

registerTool({
  name: 'write_files',
  description: 'Write multiple files at once. Creates directories as needed and shows diffs for each file.',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'Array of files to write',
        items: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Path to the file to write' },
            content: { type: 'string', description: 'Content to write to the file' },
          },
          required: ['file_path', 'content'],
        },
      },
    },
    required: ['files'],
  },
  readOnly: false,
  async execute({ files }) {
    const allowed = await checkPermission(
      'write_files',
      `Write ${files.length} file(s): ${files.map(f => f.file_path).join(', ')}`,
      false
    );
    if (!allowed) return { error: 'Permission denied' };

    const results = [];
    for (const { file_path, content } of files) {
      const resolved = path.resolve(process.cwd(), file_path);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let oldContent = '';
      if (fs.existsSync(resolved)) {
        oldContent = fs.readFileSync(resolved, 'utf8');
      }

      fs.writeFileSync(resolved, content, 'utf8');
      const diff = createDiff(oldContent, content, file_path);
      results.push({ file_path, success: true, diff });
    }
    return { results, count: results.length };
  },
});

// ─── Tool: Regex Replace ──────────────────────────────────────────────────────

registerTool({
  name: 'regex_replace',
  description: 'Replace text in a file using a regex pattern. Shows a diff of changes. Supports flags and optional max replacement count.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to edit' },
      pattern: { type: 'string', description: 'Regex pattern string to match' },
      replacement: { type: 'string', description: 'Replacement string (supports $1, $2 capture groups)' },
      flags: { type: 'string', description: 'Regex flags (default: "g")' },
      max_replacements: { type: 'number', description: 'Maximum number of replacements to make (optional, default: unlimited)' },
    },
    required: ['file_path', 'pattern', 'replacement'],
  },
  readOnly: false,
  async execute({ file_path, pattern, replacement, flags = 'g', max_replacements }) {
    const allowed = await checkPermission('regex_replace', `Regex replace in ${file_path}`, false);
    if (!allowed) return { error: 'Permission denied' };

    const resolved = path.resolve(process.cwd(), file_path);
    if (!fs.existsSync(resolved)) {
      return { error: `File not found: ${file_path}` };
    }

    const oldContent = fs.readFileSync(resolved, 'utf8');

    let regex;
    try {
      regex = new RegExp(pattern, flags);
    } catch (err) {
      return { error: `Invalid regex pattern: ${err.message}` };
    }

    let newContent;
    if (max_replacements && max_replacements > 0) {
      let count = 0;
      newContent = oldContent.replace(regex, (...args) => {
        if (count >= max_replacements) return args[0]; // return original match
        count++;
        // Reconstruct replacement with capture groups
        return replacement.replace(/\$(\d+)/g, (_, n) => args[parseInt(n)] || '');
      });
    } else {
      newContent = oldContent.replace(regex, replacement);
    }

    if (oldContent === newContent) {
      return { warning: 'No matches found for the given pattern', file_path };
    }

    fs.writeFileSync(resolved, newContent, 'utf8');
    const diff = createDiff(oldContent, newContent, file_path);
    const matchCount = (oldContent.match(regex) || []).length;
    return { success: true, diff, file_path, matches_found: matchCount };
  },
});

// ─── Tool: Apply Patch ────────────────────────────────────────────────────────

registerTool({
  name: 'apply_patch',
  description: 'Apply a unified diff patch to a file. The patch should be in standard unified diff format.',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the file to patch' },
      patch: { type: 'string', description: 'Unified diff patch string' },
    },
    required: ['file_path', 'patch'],
  },
  readOnly: false,
  async execute({ file_path, patch }) {
    const allowed = await checkPermission('apply_patch', `Apply patch to ${file_path}`, false);
    if (!allowed) return { error: 'Permission denied' };

    const resolved = path.resolve(process.cwd(), file_path);
    if (!fs.existsSync(resolved)) {
      return { error: `File not found: ${file_path}` };
    }

    const oldContent = fs.readFileSync(resolved, 'utf8');
    const oldLines = oldContent.split('\n');

    // Parse unified diff hunks
    const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
    const patchLines = patch.split('\n');
    const hunks = [];
    let currentHunk = null;

    for (const line of patchLines) {
      const hunkMatch = line.match(hunkRegex);
      if (hunkMatch) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = {
          oldStart: parseInt(hunkMatch[1]),
          oldCount: parseInt(hunkMatch[2] || '1'),
          newStart: parseInt(hunkMatch[3]),
          newCount: parseInt(hunkMatch[4] || '1'),
          lines: [],
        };
      } else if (currentHunk) {
        // Only process lines that start with +, -, or space (context)
        if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '') {
          currentHunk.lines.push(line);
        }
        // Skip --- and +++ header lines
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    if (hunks.length === 0) {
      return { error: 'No valid hunks found in patch. Ensure the patch is in unified diff format.' };
    }

    // Apply hunks in reverse order to preserve line numbers
    const newLines = [...oldLines];
    let offset = 0;

    for (const hunk of hunks) {
      const startIdx = hunk.oldStart - 1 + offset;
      const removeLines = [];
      const addLines = [];

      for (const line of hunk.lines) {
        if (line.startsWith('-')) {
          removeLines.push(line.slice(1));
        } else if (line.startsWith('+')) {
          addLines.push(line.slice(1));
        }
      }

      // Count context + removed lines to know how many to splice out
      let spliceCount = 0;
      for (const line of hunk.lines) {
        if (line.startsWith('-') || line.startsWith(' ')) {
          spliceCount++;
        }
      }

      // Build replacement lines (context + added)
      const replacementLines = [];
      for (const line of hunk.lines) {
        if (line.startsWith(' ')) {
          replacementLines.push(line.slice(1));
        } else if (line.startsWith('+')) {
          replacementLines.push(line.slice(1));
        }
      }

      newLines.splice(startIdx, spliceCount, ...replacementLines);
      offset += replacementLines.length - spliceCount;
    }

    const newContent = newLines.join('\n');
    fs.writeFileSync(resolved, newContent, 'utf8');
    const diff = createDiff(oldContent, newContent, file_path);
    return { success: true, diff, file_path, hunks_applied: hunks.length };
  },
});

// ─── Tool: Run Tests ──────────────────────────────────────────────────────────

registerTool({
  name: 'run_tests',
  description: 'Detect and run the project\'s test suite. Auto-detects: jest, mocha, pytest, cargo test, go test. Returns test output.',
  parameters: {
    type: 'object',
    properties: {
      test_path: { type: 'string', description: 'Specific test file or directory to run (optional)' },
      framework: { type: 'string', description: 'Test framework to use (optional, auto-detected). Options: jest, mocha, pytest, cargo, go, npm' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 60000)' },
    },
    required: [],
  },
  readOnly: true,
  async execute({ test_path, framework, timeout = 60000 }) {
    const cwd = process.cwd();
    let cmd = null;
    let detectedFramework = framework || null;

    if (!detectedFramework) {
      // Auto-detect test framework
      // Check package.json for scripts.test
      const pkgPath = path.join(cwd, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          if (pkg.scripts && pkg.scripts.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
            detectedFramework = 'npm';
          }
          // Check devDependencies for specific frameworks
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.jest) detectedFramework = 'jest';
          else if (deps.mocha) detectedFramework = 'mocha';
          else if (deps.vitest) detectedFramework = 'vitest';
        } catch {}
      }

      // Check for pytest
      if (!detectedFramework) {
        const pytestFiles = ['pytest.ini', 'setup.cfg', 'pyproject.toml', 'tox.ini'];
        for (const f of pytestFiles) {
          if (fs.existsSync(path.join(cwd, f))) {
            try {
              const content = fs.readFileSync(path.join(cwd, f), 'utf8');
              if (content.includes('[tool.pytest') || content.includes('[pytest]') || f === 'pytest.ini') {
                detectedFramework = 'pytest';
                break;
              }
            } catch {}
          }
        }
        // Also check for test files pattern
        if (!detectedFramework && (
          fs.existsSync(path.join(cwd, 'tests')) ||
          fs.existsSync(path.join(cwd, 'test'))
        )) {
          try {
            execSync('which pytest', { stdio: 'ignore' });
            detectedFramework = 'pytest';
          } catch {}
        }
      }

      // Check for Cargo (Rust)
      if (!detectedFramework && fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
        detectedFramework = 'cargo';
      }

      // Check for Go
      if (!detectedFramework && fs.existsSync(path.join(cwd, 'go.mod'))) {
        detectedFramework = 'go';
      }
    }

    // Build command based on framework
    switch (detectedFramework) {
      case 'jest':
        cmd = test_path ? `npx jest ${test_path}` : 'npx jest';
        break;
      case 'mocha':
        cmd = test_path ? `npx mocha ${test_path}` : 'npx mocha';
        break;
      case 'vitest':
        cmd = test_path ? `npx vitest run ${test_path}` : 'npx vitest run';
        break;
      case 'pytest':
        cmd = test_path ? `python -m pytest ${test_path} -v` : 'python -m pytest -v';
        break;
      case 'cargo':
        cmd = test_path ? `cargo test ${test_path}` : 'cargo test';
        break;
      case 'go':
        cmd = test_path ? `go test ${test_path} -v` : 'go test ./... -v';
        break;
      case 'npm':
        cmd = 'npm test';
        break;
      default:
        return { error: 'Could not detect test framework. Please specify the framework parameter (jest, mocha, pytest, cargo, go, npm).' };
    }

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
        env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
      });
      return {
        framework: detectedFramework,
        command: cmd,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exit_code: 0,
        success: true,
      };
    } catch (err) {
      return {
        framework: detectedFramework,
        command: cmd,
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || err.message,
        exit_code: err.code || 1,
        success: false,
      };
    }
  },
});

// ─── Tool: Lint Fix ───────────────────────────────────────────────────────────

registerTool({
  name: 'lint_fix',
  description: 'Run linter with auto-fix on files or directories. Auto-detects: eslint, prettier, pylint/autopep8, rustfmt, gofmt. Returns linter output.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File or directory path to lint (optional, defaults to current dir)' },
      linter: { type: 'string', description: 'Linter to use (optional, auto-detected). Options: eslint, prettier, pylint, autopep8, black, rustfmt, gofmt' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
    },
    required: [],
  },
  readOnly: false,
  async execute({ path: targetPath = '.', linter, timeout = 30000 }) {
    const allowed = await checkPermission('lint_fix', `Run linter on ${targetPath}`, false);
    if (!allowed) return { error: 'Permission denied' };

    const cwd = process.cwd();
    const resolvedPath = path.resolve(cwd, targetPath);
    let cmd = null;
    let detectedLinter = linter || null;

    if (!detectedLinter) {
      // Auto-detect linter

      // Check for ESLint config files
      const eslintConfigs = ['.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'];
      for (const cfg of eslintConfigs) {
        if (fs.existsSync(path.join(cwd, cfg))) {
          detectedLinter = 'eslint';
          break;
        }
      }

      // Check package.json for eslintConfig or eslint in deps
      if (!detectedLinter) {
        const pkgPath = path.join(cwd, 'package.json');
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (pkg.eslintConfig || deps.eslint) {
              detectedLinter = 'eslint';
            } else if (deps.prettier) {
              detectedLinter = 'prettier';
            }
          } catch {}
        }
      }

      // Check for Prettier config
      if (!detectedLinter) {
        const prettierConfigs = ['.prettierrc', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml', '.prettierrc.toml', 'prettier.config.js', 'prettier.config.cjs'];
        for (const cfg of prettierConfigs) {
          if (fs.existsSync(path.join(cwd, cfg))) {
            detectedLinter = 'prettier';
            break;
          }
        }
      }

      // Check for Python linters
      if (!detectedLinter) {
        const pyprojectPath = path.join(cwd, 'pyproject.toml');
        if (fs.existsSync(pyprojectPath)) {
          try {
            const content = fs.readFileSync(pyprojectPath, 'utf8');
            if (content.includes('[tool.black]')) {
              detectedLinter = 'black';
            } else if (content.includes('[tool.autopep8]')) {
              detectedLinter = 'autopep8';
            } else if (content.includes('[tool.pylint]')) {
              detectedLinter = 'pylint';
            }
          } catch {}
        }
        // Check for setup.cfg
        if (!detectedLinter) {
          const setupCfgPath = path.join(cwd, 'setup.cfg');
          if (fs.existsSync(setupCfgPath)) {
            try {
              const content = fs.readFileSync(setupCfgPath, 'utf8');
              if (content.includes('[pylint]') || content.includes('[pycodestyle]')) {
                detectedLinter = 'autopep8';
              }
            } catch {}
          }
        }
      }

      // Check for Rust
      if (!detectedLinter && fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
        detectedLinter = 'rustfmt';
      }

      // Check for Go
      if (!detectedLinter && fs.existsSync(path.join(cwd, 'go.mod'))) {
        detectedLinter = 'gofmt';
      }
    }

    // Build command based on linter
    switch (detectedLinter) {
      case 'eslint':
        cmd = `npx eslint --fix "${targetPath}"`;
        break;
      case 'prettier':
        cmd = `npx prettier --write "${targetPath}"`;
        break;
      case 'pylint':
        cmd = `python -m pylint "${targetPath}"`;
        break;
      case 'autopep8':
        cmd = `python -m autopep8 --in-place --recursive "${targetPath}"`;
        break;
      case 'black':
        cmd = `python -m black "${targetPath}"`;
        break;
      case 'rustfmt':
        if (targetPath === '.') {
          cmd = 'cargo fmt';
        } else {
          cmd = `rustfmt "${targetPath}"`;
        }
        break;
      case 'gofmt':
        if (targetPath === '.') {
          cmd = 'gofmt -w .';
        } else {
          cmd = `gofmt -w "${targetPath}"`;
        }
        break;
      default:
        return { error: 'Could not detect linter. Please specify the linter parameter (eslint, prettier, pylint, autopep8, black, rustfmt, gofmt).' };
    }

    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });
      return {
        linter: detectedLinter,
        command: cmd,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exit_code: 0,
        success: true,
      };
    } catch (err) {
      return {
        linter: detectedLinter,
        command: cmd,
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || err.message,
        exit_code: err.code || 1,
        success: false,
      };
    }
  },
});
