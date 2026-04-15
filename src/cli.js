#!/usr/bin/env node
/**
 * cli.js — Gemma Agent CLI with full TUI
 * Differential rendering, flicker-free, pi-tui inspired
 */

import chalk from 'chalk';
import path from 'path';
import process from 'process';

import { TUI }        from './tui/tui.js';
import { ProcessTerminal } from './tui/terminal.js';
import { Text, Markdown, Spacer, Divider, Loader, StatusBar } from './tui/components.js';
import { Editor }     from './tui/editor.js';
import { ModeTab, MODES } from './tui/mode_tab.js';

import { Agent, MultiAgentOrchestrator } from './agent.js';
import { getConfig, setConfig }          from './config.js';
import { saveSession, loadSession, loadLatestSession, listSessions } from './session.js';
import { listMemories, searchMemory }    from './memory.js';
import { listTasks, formatTaskList }     from './tasks.js';
import { runBrainstorm, readTodoList, markTodoDone } from './brainstorm.js';
import { startTelegramBridge, stopTelegramBridge, getTelegramStatus, isTelegramRunning } from './telegram.js';
import { AVAILABLE_MODELS }              from './gemini.js';
import { renderDiff }                    from './diff.js';
import { setPermissionCallback }         from './tools.js';

// ─── Theme ────────────────────────────────────────────────────────────────────

const THEME = {
  // Message bubbles
  userBg:      (s) => chalk.bgHex('#1a1a2e')(s),
  assistantBg: (s) => chalk.bgHex('#0d1117')(s),
  toolBg:      (s) => chalk.bgHex('#0a0a0a')(s),

  // Labels
  userLabel:      chalk.bold.cyan('You'),
  assistantLabel: chalk.bold.green('Gemma'),
  toolLabel:      (name) => chalk.dim(`⚙  ${name}`),
  toolOk:         chalk.green('  ✓'),
  toolErr:        (e) => chalk.red(`  ✗ ${e}`),

  // Status bar
  statusBg: (s) => chalk.bgHex('#161b22')(chalk.white(s)),

  // Editor
  editorBorder: (s) => chalk.dim.cyan(s),

  // Markdown
  md: {
    heading:         (s) => chalk.bold.cyan(s),
    bold:            (s) => chalk.bold(s),
    italic:          (s) => chalk.italic(s),
    code:            (s) => chalk.bgGray.white(` ${s} `),
    codeBlock:       (s) => chalk.white(s),
    codeBlockBorder: (s) => chalk.dim.cyan(s),
    quote:           (s) => chalk.italic.gray(s),
    quoteBorder:     (s) => chalk.dim.cyan('│ '),
    listBullet:      (s) => chalk.cyan(s),
    link:            (s) => chalk.underline.blue(s),
    hr:              (s) => chalk.dim.cyan(s),
  },
};

// ─── Permission overlay ───────────────────────────────────────────────────────

function makePermissionText(description) {
  return new Text(
    chalk.yellow('⚠  Permission required\n') +
    chalk.white(description) + '\n\n' +
    chalk.dim('[y] Allow  [n] Deny  [a] Accept-all'),
    2, 1
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = getConfig();

  if (!cfg.gemini_api_key) {
    console.error(chalk.red('\n❌ GEMINI_API_KEY not set!\n'));
    console.error(chalk.yellow('Set it with:'));
    console.error(chalk.white('  export GEMINI_API_KEY=your_key'));
    console.error(chalk.white('  or: node src/cli.js  then  /config gemini_api_key=YOUR_KEY\n'));
    process.exit(1);
  }

  // ─── Terminal + TUI ─────────────────────────────────────────────────────────

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // ─── Status bar (always at top) ─────────────────────────────────────────────

  const statusBar = new StatusBar(
    () => {
      const model = getConfig().model || 'gemini-2.0-flash';
      const tg = isTelegramRunning() ? chalk.green(' [tg]') : '';
      return THEME.statusBg(` Gemma Agent  model:${model}${tg} `);
    },
    (width) => {
      const cost = agent ? agent.getCostEstimate() : null;
      const costStr = cost ? ` $${cost.estimated_usd} ` : ' ';
      return THEME.statusBg(costStr);
    }
  );
  tui.addChild(statusBar);
  tui.addChild(new Divider('─', (s) => chalk.dim.cyan(s)));

  // ─── Welcome message ─────────────────────────────────────────────────────────

  tui.addChild(new Markdown(
    `# Gemma Agent\n\nPowered by **Google Gemini AI**. Type \`/help\` for commands.\n`,
    1, 0, THEME.md
  ));
  tui.addChild(new Divider());

  // ─── Editor ──────────────────────────────────────────────────────────────────

  const editor = new Editor(tui, { border: THEME.editorBorder });
  tui.addChild(editor);
  tui.setFocus(editor);
  let agent = null;
  let runTurn = async () => {};
  let currentMode = MODES.PLAN;

  // ─── Mode Tab (Plan/Act) ───────────────────────────────────────────────────

  const modeTab = new ModeTab((mode) => {
    const prevMode = currentMode;
    currentMode = mode;
    if (!agent) return;

    agent.setMode(mode);

    if (mode === MODES.ACT && prevMode !== MODES.ACT) {
      // Capture the plan when switching to ACT mode
      agent.capturePlan();

      if (agent.hasPendingPlan()) {
        _insertBeforeEditor(new Text(chalk.cyan('▶ Switching to ACT mode: implementing captured plan...'), 1, 0));
        void runTurn(
          'Implement the captured PLAN mode strategy now. Execute step-by-step, use tools and subagents as needed, and report progress with completed changes.',
          { showUser: false, loaderText: 'Implementing plan...' }
        );
      } else {
        _insertBeforeEditor(new Text(chalk.yellow('⚠ No captured plan found yet. Ask in PLAN mode first, then switch to ACT.'), 1, 0));
      }
    }
    tui.requestRender();
  });
  tui.addChild(modeTab);

  // ─── Agent ───────────────────────────────────────────────────────────────────

  let currentLoader = null;

  agent = new Agent({
    model: cfg.model,

    onText: (text) => {
      // Stream text into the streaming markdown component
      if (_streamingMd) {
        _streamingMd.setText(_streamingMd.text + text);
        tui.requestRender();
      }
    },

    onLog: (msg) => {
      _insertBeforeEditor(new Text(chalk.dim(msg), 1, 0));
      tui.requestRender();
    },

    onToolStart: (name, args) => {
      // Remove streaming md if present, add tool line
      if (_streamingMd) {
        _finalizeStreaming();
      }
      const toolLine = new Text(
        THEME.toolLabel(name) + chalk.dim(` ${JSON.stringify(args).slice(0, 60)}`),
        1, 0
      );
      _insertBeforeEditor(toolLine);
      _lastToolLine = toolLine;
      tui.requestRender();
    },

    onToolEnd: (name, result) => {
      if (_lastToolLine) {
        let suffix = THEME.toolOk;
        if (result.error) suffix = THEME.toolErr(result.error);
        _lastToolLine.setText(_lastToolLine.text + suffix);
        _lastToolLine = null;
      }
      if (result.diff) {
        _insertBeforeEditor(new Text(result.diff, 1, 0));
      }
      tui.requestRender();
    },

    onError: (err) => {
      _insertBeforeEditor(new Text(chalk.red(`\n✗ Error: ${err}\n`), 1, 0));
      tui.requestRender();
    },

    permissionCallback: (toolName, description) => {
      return new Promise((resolve) => {
        _pendingPermission = { resolve };
        const permText = makePermissionText(description);
        _insertBeforeEditor(permText);
        _permissionComponent = permText;
        tui.requestRender();

        // Temporarily hijack input
        const origFocus = tui._focusedComponent;
        const permHandler = {
          handleInput(data) {
            const d = data.toLowerCase();
            if (d === 'y') {
              _closePermission(permText, true, resolve);
              tui.setFocus(editor);
            } else if (d === 'n') {
              _closePermission(permText, false, resolve);
              tui.setFocus(editor);
            } else if (d === 'a') {
              setConfig('permission_mode', 'accept-all');
              _closePermission(permText, true, resolve);
              tui.setFocus(editor);
            }
          }
        };
        tui.setFocus(permHandler);
      });
    },

    askUserCallback: (question, options) => {
      return new Promise((resolve) => {
        let text = chalk.cyan('❓ ') + chalk.white(question) + '\n';
        if (options?.length) {
          options.forEach((o, i) => {
            text += chalk.white(`  [${i + 1}] ${o.label}`) + chalk.dim(` — ${o.description || ''}\n`);
          });
          text += chalk.dim('\nType a number or your answer, then Enter');
        }
        const askComp = new Text(text, 1, 1);
        _insertBeforeEditor(askComp);
        tui.requestRender();

        const askEditor = new Editor(tui, { border: THEME.editorBorder });
        askEditor.onSubmit = (val) => {
          tui.removeChild(askComp);
          tui.removeChild(askEditor);
          tui.setFocus(editor);
          const num = parseInt(val);
          if (!isNaN(num) && options?.[num - 1]) {
            resolve({ answer: options[num - 1].label });
          } else {
            resolve({ answer: val });
          }
        };
        _insertBeforeEditor(askEditor);
        tui.setFocus(askEditor);
      });
    },
  });

  setPermissionCallback(agent.permissionCallback);

  // ─── Streaming state ─────────────────────────────────────────────────────────

  let _streamingMd = null;
  let _lastToolLine = null;
  let _pendingPermission = null;
  let _permissionComponent = null;

  function _insertBeforeEditor(component) {
    const editorIdx = tui.children.indexOf(editor);
    if (editorIdx === -1) {
      tui.children.push(component);
    } else {
      tui.children.splice(editorIdx, 0, component);
    }
  }

  function _finalizeStreaming() {
    _streamingMd = null;
  }

  function _closePermission(comp, allowed, resolve) {
    tui.removeChild(comp);
    _permissionComponent = null;
    _pendingPermission = null;
    resolve(allowed);
    tui.requestRender();
  }

  runTurn = async (trimmed, { showUser = true, loaderText = 'Thinking...' } = {}) => {
    if (!trimmed || editor.disableSubmit) return;

    if (showUser) {
      _insertBeforeEditor(new Text(
        chalk.dim('─'.repeat(Math.min(terminal.columns, 80))),
        0, 0
      ));
      _insertBeforeEditor(new Markdown(
        `**${THEME.userLabel}**\n\n${trimmed}`,
        1, 0, THEME.md, THEME.userBg
      ));
    }

    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed, agent, tui, editor, terminal);
      tui.requestRender();
      return;
    }

    editor.disableSubmit = true;

    _streamingMd = new Markdown('', 1, 0, THEME.md, THEME.assistantBg);
    _insertBeforeEditor(new Text(
      chalk.bold.green('Gemma'),
      1, 0
    ));
    _insertBeforeEditor(_streamingMd);

    const loader = new Loader(tui, (s) => chalk.cyan(s), (s) => chalk.dim(s), loaderText);
    _insertBeforeEditor(loader);
    loader.start();

    try {
      await agent.run(trimmed);
    } catch (err) {
      _insertBeforeEditor(new Text(chalk.red(`✗ ${err.message}`), 1, 0));
    } finally {
      loader.stop();
      tui.removeChild(loader);
      _finalizeStreaming();
      editor.disableSubmit = false;
      tui.requestRender();
    }
  };

  // ─── Submit handler ──────────────────────────────────────────────────────────

  editor.onSubmit = async (value) => {
    const trimmed = value.trim();
    await runTurn(trimmed, { showUser: true, loaderText: 'Thinking...' });
  };
  editor.onTab = () => {
    modeTab.toggle();
    return true;
  };

  // ─── Auto-start Telegram ─────────────────────────────────────────────────────

  if (cfg.telegram_auto_start && cfg.telegram_token && cfg.telegram_chat_id) {
    try {
      await startTelegramBridge(cfg.telegram_token, cfg.telegram_chat_id, agent, {
        onLog: (msg) => {
          _insertBeforeEditor(new Text(msg, 1, 0));
          tui.requestRender();
        },
      });
    } catch (err) {
      _insertBeforeEditor(new Text(chalk.yellow(`⚠ Telegram auto-start failed: ${err.message}`), 1, 0));
    }
  }

  // ─── Graceful exit ───────────────────────────────────────────────────────────

  process.on('exit', () => {
    tui.stop();
  });

  process.on('SIGINT', async () => {
    tui.stop();
    console.log(chalk.yellow('\n\nSaving session...'));
    const r = saveSession(agent.messages);
    console.log(chalk.green(`✓ Session saved: ${r.path}`));
    if (isTelegramRunning()) await stopTelegramBridge();
    process.exit(0);
  });

  // ─── Start ───────────────────────────────────────────────────────────────────

  tui.start();
}

// ─── Command Handler ──────────────────────────────────────────────────────────

async function handleCommand(input, agent, tui, editor, terminal) {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  function print(text, md = false) {
    const comp = md
      ? new Markdown(text, 1, 0, {
          heading:         (s) => chalk.bold.cyan(s),
          bold:            (s) => chalk.bold(s),
          italic:          (s) => chalk.italic(s),
          code:            (s) => chalk.bgGray.white(` ${s} `),
          codeBlock:       (s) => chalk.white(s),
          codeBlockBorder: (s) => chalk.dim.cyan(s),
          quote:           (s) => chalk.italic.gray(s),
          quoteBorder:     (s) => chalk.dim.cyan('│ '),
          listBullet:      (s) => chalk.cyan(s),
          link:            (s) => chalk.underline.blue(s),
          hr:              (s) => chalk.dim.cyan(s),
        })
      : new Text(text, 1, 0);

    const editorIdx = tui.children.indexOf(editor);
    if (editorIdx === -1) tui.children.push(comp);
    else tui.children.splice(editorIdx, 0, comp);
  }

  switch (cmd) {

    case 'help':
      print([
        chalk.bold.cyan('Gemma Agent Commands\n'),
        chalk.white('/help') + chalk.dim('                    Show this help'),
        chalk.white('/clear') + chalk.dim('                   Clear conversation history'),
        chalk.white('/model [name]') + chalk.dim('            Show or switch AI model'),
        chalk.white('/config [key=value]') + chalk.dim('      Show or set configuration'),
        chalk.white('/save [name]') + chalk.dim('             Save current session'),
        chalk.white('/load [file|#]') + chalk.dim('           Load a saved session'),
        chalk.white('/resume') + chalk.dim('                  Resume last session'),
        chalk.white('/cost') + chalk.dim('                    Show token usage and cost'),
        chalk.white('/memory [query]') + chalk.dim('          List or search memories'),
        chalk.white('/tasks') + chalk.dim('                   List all tasks'),
        chalk.white('/agents') + chalk.dim('                  Show all agent task statuses'),
        chalk.white('/spawn <id> <task>') + chalk.dim('       Spawn a specialist agent directly'),
        chalk.white('/brainstorm [topic]') + chalk.dim('      Multi-persona brainstorm'),
        chalk.white('/worker') + chalk.dim('                  Auto-implement TODO tasks'),
        chalk.white('/multi <task>') + chalk.dim('            Run full Codebuff-style pipeline'),
        chalk.white('/telegram [token] [id]') + chalk.dim('   Start Telegram bridge'),
        chalk.white('/exit') + chalk.dim('                    Exit Gemma Agent'),
        '',
        chalk.dim('Agents: file-picker, planner, editor, reviewer, researcher, tester, git-committer, debugger'),
      ].join('\n'));
      break;

    case 'clear':
      agent.clearHistory();
      print(chalk.green('✓ Conversation history cleared'));
      break;

    case 'model':
      if (args.length === 0) {
        const cfg = getConfig();
        const lines = [chalk.cyan(`Current model: ${cfg.model}\n`), chalk.white('Available models:')];
        AVAILABLE_MODELS.forEach(m => {
          const marker = m.id === cfg.model ? chalk.green(' ✓') : '';
          lines.push(chalk.white(`  ${m.id}`) + chalk.dim(` — ${m.name} (${m.context}) ${m.notes}`) + marker);
        });
        print(lines.join('\n'));
      } else {
        setConfig('model', args[0]);
        agent.model = args[0];
        print(chalk.green(`✓ Model set to: ${args[0]}`));
      }
      break;

    case 'config':
      if (args.length === 0) {
        const cfg = getConfig();
        const lines = [chalk.cyan('Configuration:\n')];
        Object.entries(cfg).forEach(([k, v]) => {
          const val = (k.includes('key') || k.includes('token')) ? '***' : JSON.stringify(v);
          lines.push(chalk.white(`  ${k}: `) + chalk.yellow(val));
        });
        print(lines.join('\n'));
      } else {
        const eqIdx = args[0].indexOf('=');
        if (eqIdx !== -1) {
          const key = args[0].slice(0, eqIdx);
          const value = args[0].slice(eqIdx + 1);
          setConfig(key, value);
          print(chalk.green(`✓ ${key} = ${value}`));
        }
      }
      break;

    case 'save': {
      const name = args[0] || null;
      const r = saveSession(agent.messages, name);
      print(chalk.green(`✓ Session saved: ${r.path}`));
      break;
    }

    case 'load': {
      if (args.length === 0) {
        const sessions = listSessions();
        if (!sessions.length) { print(chalk.yellow('No saved sessions.')); break; }
        const lines = [chalk.cyan('Saved sessions:\n')];
        let lastDate = '';
        sessions.forEach((s, i) => {
          if (s.date !== lastDate) { lines.push(chalk.bold(`\n── ${s.date} ──`)); lastDate = s.date; }
          lines.push(chalk.white(`  [${i + 1}] ${s.file}`) + chalk.dim(` (${s.turn_count} turns)`));
        });
        lines.push(chalk.dim('\nUsage: /load <number> or /load <filename>'));
        print(lines.join('\n'));
      } else {
        const num = parseInt(args[0]);
        let filePath = args[0];
        if (!isNaN(num)) {
          const sessions = listSessions();
          if (sessions[num - 1]) filePath = sessions[num - 1].path;
        }
        const loaded = loadSession(filePath);
        if (loaded.error) { print(chalk.red(`✗ ${loaded.error}`)); break; }
        agent.messages = loaded.messages || [];
        print(chalk.green(`✓ Session loaded (${agent.messages.length} messages)`));
      }
      break;
    }

    case 'resume': {
      const latest = loadLatestSession();
      if (!latest) { print(chalk.yellow('No recent session found.')); break; }
      agent.messages = latest.messages || [];
      print(chalk.green(`✓ Resumed session (${agent.messages.length} messages)`));
      break;
    }

    case 'cost': {
      const cost = agent.getCostEstimate();
      print([
        chalk.cyan('💰 Token Usage:'),
        chalk.white(`  Input:  ${cost.input_tokens.toLocaleString()}`),
        chalk.white(`  Output: ${cost.output_tokens.toLocaleString()}`),
        chalk.white(`  Est. cost: $${cost.estimated_usd} USD`),
      ].join('\n'));
      break;
    }

    case 'memory': {
      if (args.length === 0) {
        const mems = listMemories();
        if (!mems.length) { print(chalk.yellow('No memories stored.')); break; }
        const lines = [chalk.cyan(`${mems.length} memories:\n`)];
        mems.forEach(m => {
          lines.push(chalk.white(`  [${m.type}/${m.scope}] ${m.name}`) + chalk.dim(` — ${m.description}`));
        });
        print(lines.join('\n'));
      } else {
        const results = searchMemory(args.join(' '));
        if (!results.length) { print(chalk.yellow(`No memories found for: ${args.join(' ')}`)); break; }
        const lines = [chalk.cyan(`Found ${results.length} memories:\n`)];
        results.forEach(m => {
          lines.push(chalk.white(`  [${m.type}/${m.scope}] ${m.name}`));
          lines.push(chalk.dim(`    ${(m.content || '').slice(0, 100)}`));
        });
        print(lines.join('\n'));
      }
      break;
    }

    case 'tasks': {
      const tasks = listTasks();
      if (!tasks.length) { print(chalk.yellow('No tasks.')); break; }
      print(chalk.cyan('Tasks:\n') + formatTaskList(tasks));
      break;
    }

    case 'brainstorm': {
      const topic = args.join(' ') || 'general project improvement';
      print(chalk.cyan(`🧠 Starting brainstorm: ${topic}\n`));

      const loader = new Loader(tui, (s) => chalk.cyan(s), (s) => chalk.dim(s), 'Generating personas...');
      const editorIdx = tui.children.indexOf(editor);
      tui.children.splice(editorIdx, 0, loader);
      loader.start();
      tui.requestRender();

      try {
        const result = await runBrainstorm(topic, 5, {
          onProgress: (msg) => {
            loader.setMessage(msg.replace(/\x1b\[[0-9;]*m/g, '').trim());
          },
          model: agent.model,
        });
        loader.stop();
        tui.removeChild(loader);
        print(chalk.green(`✓ Brainstorm complete!\n`) +
          chalk.white(`  Output: ${result.outputFile}\n`) +
          chalk.white(`  TODO:   ${result.todoFile}\n\n`) +
          chalk.cyan('── Master Plan ──\n\n') + result.synthesis);
      } catch (err) {
        loader.stop();
        tui.removeChild(loader);
        print(chalk.red(`✗ Brainstorm failed: ${err.message}`));
      }
      break;
    }

    case 'worker': {
      const todoData = readTodoList();
      if (todoData.error) { print(chalk.red(`✗ ${todoData.error}`)); break; }
      const pending = todoData.tasks.filter(t => !t.done);
      if (!pending.length) { print(chalk.green('✓ All tasks completed!')); break; }

      print(chalk.cyan(`👷 Worker starting — ${pending.length} task(s)\n`));
      editor.disableSubmit = true;

      for (const task of pending) {
        print(chalk.cyan(`\n── Task ${task.num}: ${task.text} ──`));
        try {
          await agent.run(`Implement this task: ${task.text}\n\nRead relevant files, make the changes, verify they work.`);
          markTodoDone(task.num, todoData.filePath);
          print(chalk.green(`✓ Task ${task.num} done`));
        } catch (err) {
          print(chalk.red(`✗ Task ${task.num} failed: ${err.message}`));
        }
      }

      editor.disableSubmit = false;
      print(chalk.green('\n✓ Worker finished'));
      break;
    }

    case 'telegram': {
      if (args.length >= 2) {
        try {
          await startTelegramBridge(args[0], args[1], agent, {
            onLog: (msg) => { print(msg); tui.requestRender(); },
          });
          print(chalk.green(`✓ Telegram bridge started`));
        } catch (err) {
          print(chalk.red(`✗ ${err.message}`));
        }
      } else if (args[0] === 'stop') {
        await stopTelegramBridge();
        print(chalk.green('✓ Telegram bridge stopped'));
      } else if (args[0] === 'status') {
        const s = getTelegramStatus();
        print([
          chalk.cyan('Telegram Status:'),
          chalk.white(`  Running: ${s.running ? chalk.green('Yes') : chalk.red('No')}`),
          chalk.white(`  Chat ID: ${s.chat_id || 'Not configured'}`),
        ].join('\n'));
      } else {
        const cfg = getConfig();
        if (cfg.telegram_token && cfg.telegram_chat_id) {
          try {
            await startTelegramBridge(cfg.telegram_token, cfg.telegram_chat_id, agent, {
              onLog: (msg) => { print(msg); tui.requestRender(); },
            });
          } catch (err) {
            print(chalk.red(`✗ ${err.message}`));
          }
        } else {
          print(chalk.yellow('Usage: /telegram <token> <chat_id>'));
        }
      }
      break;
    }

    case 'multi': {
      const taskDesc = args.join(' ') || 'Improve the codebase';
      print(chalk.cyan(`🤖 Multi-Agent Pipeline: ${taskDesc}\n`));

      const loader = new Loader(tui, (s) => chalk.cyan(s), (s) => chalk.dim(s), 'Running pipeline...');
      const editorIdx = tui.children.indexOf(editor);
      tui.children.splice(editorIdx, 0, loader);
      loader.start();
      editor.disableSubmit = true;

      try {
        const orchestrator = new MultiAgentOrchestrator({
          model: agent.model,
          permissionCallback: agent.permissionCallback,
        });
        const result = await orchestrator.runPipeline(taskDesc, {
          onProgress: (msg) => {
            loader.setMessage(msg.replace(/\x1b\[[0-9;]*m/g, '').trim());
            print(chalk.dim(msg));
            tui.requestRender();
          },
        });
        loader.stop();
        tui.removeChild(loader);
        print(
          chalk.green('✓ Pipeline complete!\n\n') +
          chalk.cyan('── Review ──\n\n') + result.review + '\n\n' +
          chalk.cyan('── Tests ──\n\n') + result.tests
        );
      } catch (err) {
        loader.stop();
        tui.removeChild(loader);
        print(chalk.red(`✗ Pipeline failed: ${err.message}`));
      }
      editor.disableSubmit = false;
      break;
    }

    case 'agents': {
      // Show all running/completed agent tasks
      const status = agent.getAgentStatus?.() || 'No agent tasks.';
      const cost   = agent.getCostEstimate?.();
      const lines  = [chalk.cyan('🤖 Agent Tasks:\n'), status];
      if (cost) {
        lines.push('');
        lines.push(chalk.dim(`Total cost: $${cost.estimated_usd} USD  (in:${cost.input_tokens} out:${cost.output_tokens})`));
      }
      print(lines.join('\n'));
      break;
    }

    case 'spawn': {
      // /spawn <agent_id> <task...>
      const agentId = args[0];
      const spawnTask = args.slice(1).join(' ');
      if (!agentId || !spawnTask) {
        print(chalk.yellow('Usage: /spawn <agent_id> <task>\nAgents: file-picker, planner, editor, reviewer, researcher, tester, git-committer, debugger'));
        break;
      }
      print(chalk.cyan(`🚀 Spawning ${agentId}: ${spawnTask}\n`));
      const spawnLoader = new Loader(tui, (s) => chalk.cyan(s), (s) => chalk.dim(s), `Running ${agentId}...`);
      const spawnIdx = tui.children.indexOf(editor);
      tui.children.splice(spawnIdx, 0, spawnLoader);
      spawnLoader.start();
      editor.disableSubmit = true;
      try {
        const { AgentManager } = await import('./agents/manager.js');
        const { getConfig: gc } = await import('./config.js');
        const mgr = new AgentManager({
          model: agent.model || gc().model,
          onText:      () => {},
          onToolStart: (n) => spawnLoader.setMessage(`⚙ ${n}`),
          onToolEnd:   () => {},
          onLog:       (m) => { print(chalk.dim(m)); tui.requestRender(); },
          permissionCallback: agent.permissionCallback,
        });
        const result = await mgr.run(agentId, spawnTask);
        spawnLoader.stop();
        tui.removeChild(spawnLoader);
        print(chalk.green(`✓ ${agentId} done\n\n`) + (result.text || result.error || ''));
      } catch (err) {
        spawnLoader.stop();
        tui.removeChild(spawnLoader);
        print(chalk.red(`✗ ${err.message}`));
      }
      editor.disableSubmit = false;
      break;
    }

    case 'exit':
    case 'quit': {
      tui.stop();
      console.log(chalk.yellow('\nSaving session...'));
      const r = saveSession(agent.messages);
      console.log(chalk.green(`✓ Session saved: ${r.path}`));
      if (isTelegramRunning()) await stopTelegramBridge();
      process.exit(0);
    }

    default:
      print(chalk.yellow(`Unknown command: /${cmd}`) + chalk.dim('  (type /help for commands)'));
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error(chalk.red(`Fatal: ${err.message}`));
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
