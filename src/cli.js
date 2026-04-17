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
import { Text, Markdown, Spacer, Divider, Loader, StatusBar, SelectList } from './tui/components.js';
import { Editor }     from './tui/editor.js';
import { ModeTab, MODES } from './tui/mode_tab.js';

import { Agent, MultiAgentOrchestrator } from './agent.js';
import { getConfig, setConfig }          from './config.js';
import { saveSession, loadSession, loadLatestSession, listSessions } from './session.js';
import { listMemories, searchMemory }    from './memory.js';
import { listTasks, formatTaskList }     from './tasks.js';
import { runBrainstorm, readTodoList, markTodoDone } from './brainstorm.js';
import { startTelegramBridge, stopTelegramBridge, getTelegramStatus, isTelegramRunning } from './telegram.js';
import { renderDiff }                    from './diff.js';
import { setPermissionCallback }         from './tools.js';
import { initProviders, getAllModels, getActiveProvider, setActiveProvider, getAllProviders } from './providers/index.js';

// ─── Register extra tools (side-effect imports) ──────────────────────────────
import './tools_extra.js';
import './task_buckets.js';
import './shared_memory.js';
import './checkpoint.js';
import './scheduler/cron.js';

// ─── Theme ────────────────────────────────────────────────────────────────────

const THEME = {
  // Message bubbles
  userBg:      (s) => chalk.bgHex('#1a1a2e')(s),
  assistantBg: (s) => chalk.bgHex('#0d1117')(s),
  toolBg:      (s) => chalk.bgHex('#0a0a0a')(s),

  // Labels
  userLabel:      chalk.bold.hex('#58a6ff')('❯ You'),
  assistantLabel: chalk.bold.hex('#7ee787')('✦ Gemma'),
  toolLabel:      (name) => chalk.hex('#8b949e')(`  ⚙  ${name}`),
  toolOk:         chalk.hex('#7ee787')('  ✓'),
  toolErr:        (e) => chalk.hex('#f85149')(`  ✗ ${e}`),

  // Status bar
  statusBg: (s) => chalk.bgHex('#161b22')(chalk.hex('#c9d1d9')(s)),
  statusAccent: (s) => chalk.bgHex('#238636')(chalk.white(s)),

  // Editor
  editorBorder: (s) => chalk.hex('#30363d')(s),

  // Dividers
  divider: (s) => chalk.hex('#21262d')(s),

  // Markdown
  md: {
    heading:         (s) => chalk.bold.hex('#58a6ff')(s),
    bold:            (s) => chalk.bold.hex('#c9d1d9')(s),
    italic:          (s) => chalk.italic.hex('#8b949e')(s),
    code:            (s) => chalk.bgHex('#161b22').hex('#e6edf3')(` ${s} `),
    codeBlock:       (s) => chalk.hex('#e6edf3')(s),
    codeBlockBorder: (s) => chalk.hex('#30363d')(s),
    quote:           (s) => chalk.italic.hex('#8b949e')(s),
    quoteBorder:     (s) => chalk.hex('#3b82f6')('│ '),
    listBullet:      (s) => chalk.hex('#58a6ff')(s),
    link:            (s) => chalk.underline.hex('#58a6ff')(s),
    hr:              (s) => chalk.hex('#21262d')(s),
  },
};

// ─── Permission overlay ───────────────────────────────────────────────────────

function makePermissionText(description) {
  return new Text(
    chalk.hex('#e3b341')('  ⚠  Permission required\n') +
    chalk.hex('#c9d1d9')('  ' + description) + '\n\n' +
    chalk.hex('#8b949e')('  [y] Allow  [n] Deny  [a] Accept-all'),
    0, 0
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const cfg = getConfig();

  // Initialize all providers
  initProviders();

  // Check if at least one provider is configured
  const providers = getAllProviders();
  const configuredProviders = Array.from(providers.entries()).filter(([, p]) => p.isConfigured());
  if (configuredProviders.length === 0) {
    console.error(chalk.red('\n❌ No AI providers configured!\n'));
    console.error(chalk.yellow('Set at least one API key:'));
    console.error(chalk.white('  export GEMINI_API_KEY=your_key'));
    console.error(chalk.white('  export GROQ_API_KEY=your_key'));
    console.error(chalk.white('  export NVIDIA_API_KEY=your_key'));
    console.error(chalk.white('  export MISTRAL_API_KEY=your_key'));
    console.error(chalk.white('  export OPENROUTER_API_KEY=your_key'));
    console.error(chalk.white('  (LLM7 works without an API key)\n'));
    console.error(chalk.dim('Or use /config to set keys after starting.'));
    // Don't exit — LLM7 should always work
    if (!providers.get('llm7')?.isConfigured()) {
      process.exit(1);
    }
  }

  // ─── Terminal + TUI ─────────────────────────────────────────────────────────

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);

  // ─── Status bar (always at top) ─────────────────────────────────────────────

  const statusBar = new StatusBar(
    () => {
      const c = getConfig();
      const model = c.model || 'gemini-2.0-flash';
      const provider = c.active_provider || 'gemini';
      // Strip provider prefix from model display if present
      const displayModel = model.includes('/') ? model.split('/').slice(1).join('/') : model;
      const tg = isTelegramRunning() ? chalk.hex('#7ee787')(' ●tg') : '';
      return THEME.statusAccent(' ✦ Gemma ') + THEME.statusBg(` ${chalk.hex('#58a6ff')(provider)} ${chalk.hex('#8b949e')('›')} ${chalk.hex('#c9d1d9')(displayModel)}${tg} `);
    },
    (width) => {
      const cost = agent ? agent.getCostEstimate() : null;
      const modeStr = currentMode ? currentMode.toUpperCase() : '';
      const costStr = cost && parseFloat(cost.estimated_usd) > 0 ? `$${cost.estimated_usd}` : '';
      const parts = [modeStr, costStr].filter(Boolean).join(' │ ');
      return THEME.statusBg(` ${parts} `);
    },
    // Fill gap with status bar background color
    THEME.statusBg
  );
  tui.addChild(statusBar);
  tui.stickTop(statusBar);

  // ─── Mode / Editor state ────────────────────────────────────────────────────

  let editor = null;
  let agent = null;
  let runTurn = async () => {};
  let currentMode = MODES.PLAN;

  // ─── Mode Tab (Plan/Act) ───────────────────────────────────────────────────

  const modeTab = new ModeTab((mode) => {
    const prevMode = currentMode;
    currentMode = mode;
    if (!agent) return;

    agent.setMode(mode);

    if (mode === MODES.ACT && prevMode === MODES.PLAN) {
      // Capture the plan when switching from PLAN to ACT mode
      agent.capturePlan();

      if (agent.hasPendingPlan()) {
        _insertBeforeEditor(new Text(chalk.cyan('▶ Switched to ACT mode. Plan captured. Type "implement" or "execute" to run the plan.'), 1, 0));
      } else {
        _insertBeforeEditor(new Text(chalk.yellow('⚠ No plan found yet. Create a plan in PLAN mode first, then switch to ACT.'), 1, 0));
      }
    } else if (mode === MODES.GOD) {
      _insertBeforeEditor(new Text(chalk.magenta('🚀 GOD MODE: Fully autonomous. I will complete tasks without asking for permission.'), 1, 0));
    } else if (mode === MODES.GENERAL) {
      _insertBeforeEditor(new Text(chalk.yellow('🔧 GENERAL MODE: Balanced access for everyday tasks.'), 1, 0));
    }
    tui.requestRender();
  });
  tui.addChild(modeTab);
  tui.stickTop(modeTab);

  // ─── Welcome message ─────────────────────────────────────────────────────────

  tui.addChild(new Text(
    chalk.hex('#7ee787')('  ✦ ') + chalk.bold.hex('#e6edf3')('Gemma Agent v3') + chalk.hex('#8b949e')('  ─  Multi-provider AI coding assistant'),
    0, 0
  ));
  tui.addChild(new Text(
    chalk.hex('#8b949e')('  Providers: ') +
    chalk.hex('#58a6ff')('Gemini') + chalk.hex('#30363d')(' · ') +
    chalk.hex('#f97316')('Groq') + chalk.hex('#30363d')(' · ') +
    chalk.hex('#a78bfa')('LLM7') + chalk.hex('#30363d')(' · ') +
    chalk.hex('#22d3ee')('Nvidia') + chalk.hex('#30363d')(' · ') +
    chalk.hex('#fb923c')('Mistral') + chalk.hex('#30363d')(' · ') +
    chalk.hex('#10b981')('OpenRouter') +
    chalk.hex('#8b949e')('  │  Type ') + chalk.hex('#58a6ff')('/help') + chalk.hex('#8b949e')(' for commands  │  Tab to switch modes'),
    0, 0
  ));

  // ─── Editor ──────────────────────────────────────────────────────────────────

  editor = new Editor(tui, { border: THEME.editorBorder });
  tui.addChild(editor);
  tui.stickBottom(editor);
  tui.setFocus(editor);

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
      const argsStr = JSON.stringify(args).slice(0, 80);
      const toolLine = new Text(
        THEME.toolLabel(name) + chalk.hex('#484f58')(` ${argsStr}`),
        0, 0
      );
      _insertBeforeEditor(toolLine);
      _lastToolLine = toolLine;
      tui.requestRender();
    },

    onToolEnd: (name, result) => {
      if (_lastToolLine) {
        let suffix = THEME.toolOk;
        if (result.error) suffix = THEME.toolErr(result.error.toString().slice(0, 60));
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
        tui.scrollOffset = 0;
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
        tui.scrollOffset = 0;
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
    // Always follow the newest output when a new turn begins (Claude Code–like).
    tui.scrollOffset = 0;

    if (showUser) {
      _insertBeforeEditor(new Text(
        THEME.divider('─'.repeat(Math.min(terminal.columns, 80))),
        0, 0
      ));
      _insertBeforeEditor(new Text(THEME.userLabel, 1, 0));
      _insertBeforeEditor(new Markdown(
        trimmed,
        2, 0, THEME.md, THEME.userBg
      ));
    }

    if (trimmed.startsWith('/')) {
      await handleCommand(trimmed, agent, tui, editor, terminal);
      tui.requestRender();
      return;
    }

    editor.disableSubmit = true;

    _streamingMd = new Markdown('', 2, 0, THEME.md, THEME.assistantBg);
    _insertBeforeEditor(new Text(THEME.assistantLabel, 1, 0));
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
        chalk.bold.cyan('Gemma Agent v3 Commands\n'),
        chalk.bold('  Core'),
        chalk.white('  /help') + chalk.dim('                    Show this help'),
        chalk.white('  /clear') + chalk.dim('                   Clear conversation history'),
        chalk.white('  /model [name]') + chalk.dim('            Interactive model selection (↑↓ arrows)'),
        chalk.white('  /provider [name]') + chalk.dim('         Switch AI provider'),
        chalk.white('  /config [key=value]') + chalk.dim('      Show or set configuration'),
        '',
        chalk.bold('  Sessions'),
        chalk.white('  /save [name]') + chalk.dim('             Save current session'),
        chalk.white('  /load [file|#]') + chalk.dim('           Load a saved session'),
        chalk.white('  /resume') + chalk.dim('                  Resume last session'),
        chalk.white('  /cost') + chalk.dim('                    Show token usage and cost'),
        '',
        chalk.bold('  Knowledge'),
        chalk.white('  /memory [query]') + chalk.dim('          List or search memories'),
        chalk.white('  /tasks') + chalk.dim('                   List all tasks'),
        chalk.white('  /buckets') + chalk.dim('                 List task buckets'),
        '',
        chalk.bold('  Agents'),
        chalk.white('  /agents') + chalk.dim('                  Show all agent task statuses'),
        chalk.white('  /spawn <id> <task>') + chalk.dim('       Spawn a specialist agent'),
        chalk.white('  /multi <task>') + chalk.dim('            Run full multi-agent pipeline'),
        chalk.white('  /brainstorm [topic]') + chalk.dim('      Multi-persona brainstorm'),
        chalk.white('  /worker') + chalk.dim('                  Auto-implement TODO tasks'),
        '',
        chalk.bold('  System'),
        chalk.white('  /checkpoint [list|rollback|diff]') + chalk.dim(' Checkpoint & rollback'),
        chalk.white('  /cron [list|run|remove]') + chalk.dim('  Scheduled cron jobs'),
        '',
        chalk.bold('  Other'),
        chalk.white('  /telegram [token] [id]') + chalk.dim('   Start Telegram bridge'),
        chalk.white('  /exit') + chalk.dim('                    Exit Gemma Agent'),
        '',
        chalk.bold('  Modes') + chalk.dim(' (Tab to cycle)'),
        chalk.cyan('  PLAN') + chalk.dim('    Research & planning only'),
        chalk.green('  ACT') + chalk.dim('     Execute & implement'),
        chalk.yellow('  GENERAL') + chalk.dim(' Basic balanced tasks'),
        chalk.magenta('  GOD') + chalk.dim('     Fully autonomous'),
        '',
        chalk.dim('  PgUp/PgDn scroll output  |  End jump to bottom'),
        chalk.dim('  @ to autocomplete files/dirs  |  Ctrl+C to copy  |  Ctrl+V to paste'),
        chalk.dim('  Agents: file-picker, planner, editor, reviewer, researcher, tester, git-committer,'),
        chalk.dim('          debugger, optimizer, architect, doc-writer, refactorer, security-auditor'),
      ].join('\n'));
      break;

    case 'clear':
      agent.clearHistory();
      print(chalk.green('✓ Conversation history cleared'));
      break;

    case 'model': {
      if (args.length > 0) {
        // Direct set: /model groq/llama-3.3-70b or /model mistral-large-latest
        const newModel = args[0];
        if (newModel.includes('/')) {
          const slashIdx = newModel.indexOf('/');
          const provName = newModel.slice(0, slashIdx);
          try {
            setActiveProvider(provName);
          } catch (e) {
            print(chalk.red(`✗ Unknown provider: ${provName}`));
            break;
          }
        }
        setConfig('model', newModel);
        agent.model = newModel;
        const c = getConfig();
        print(chalk.hex('#7ee787')(`✓ Provider: ${c.active_provider}  Model: ${newModel}`));
        break;
      }

      // Two-step interactive: 1) Pick provider  2) Pick model from that provider
      try {
        const allProviders = getAllProviders();
        const cfg = getConfig();

        // ── Step 1: Provider selection ──────────────────────────────────────
        const providerItems = [];
        for (const [name, provider] of allProviders) {
          if (!provider.isConfigured()) continue;
          const isActive = name === cfg.active_provider;
          providerItems.push({
            value: name,
            label: isActive ? chalk.hex('#7ee787')(`★ ${name}`) : `  ${name}`,
            description: isActive ? chalk.hex('#7ee787')('(active)') : '',
          });
        }

        if (providerItems.length === 0) {
          print(chalk.yellow('No configured providers. Set an API key first.'));
          break;
        }

        // Show provider selector
        const provSelector = new SelectList(providerItems, 8);
        const activeIdx = providerItems.findIndex(i => i.value === cfg.active_provider);
        if (activeIdx >= 0) provSelector.selectedIndex = activeIdx;

        const provPromise = new Promise((resolve) => {
          provSelector.onSelect = (item) => resolve(item);
          provSelector.onCancel = () => resolve(null);
        });

        const provHeader = new Text(
          chalk.hex('#58a6ff')('  Step 1/2 ') + chalk.hex('#8b949e')('— Select provider (↑↓ Enter Esc)'),
          0, 0
        );
        let editorIdx = tui.children.indexOf(editor);
        tui.children.splice(editorIdx, 0, provHeader);
        tui.children.splice(editorIdx + 1, 0, provSelector);
        tui.requestRender();

        const provHandler = {
          handleInput(data) {
            if (data === '\x1b') { provSelector.onCancel?.(); }
            else { provSelector.handleInput(data); }
            tui.requestRender();
          },
        };
        tui.setFocus(provHandler);

        const selectedProvider = await provPromise;
        tui.removeChild(provHeader);
        tui.removeChild(provSelector);
        tui.setFocus(editor);

        if (!selectedProvider) {
          print(chalk.hex('#8b949e')('  Model selection cancelled.'));
          break;
        }

        const provName = selectedProvider.value;

        // Switch provider immediately
        try {
          setActiveProvider(provName);
        } catch (e) {
          print(chalk.red(`✗ ${e.message}`));
          break;
        }

        print(chalk.hex('#8b949e')(`  ⏳ Fetching models from ${provName}...`));
        tui.requestRender();

        // ── Step 2: Model selection from chosen provider ────────────────────
        const provider = allProviders.get(provName);
        let models;
        try {
          models = await provider.getModels();
        } catch (fetchErr) {
          print(chalk.red(`✗ Failed to fetch models: ${fetchErr.message}`));
          break;
        }

        if (!models || models.length === 0) {
          print(chalk.yellow(`No models found for provider: ${provName}`));
          break;
        }

        const modelItems = models.map(m => {
          const ctx = m.context && m.context !== 'unknown' ? chalk.hex('#8b949e')(` (${m.context})`) : '';
          const notes = m.notes ? chalk.hex('#484f58')(` ${m.notes}`) : '';
          return {
            value: m.id,
            label: `  ${m.id}`,
            description: `${ctx}${notes}`,
          };
        });

        const modelSelector = new SelectList(modelItems, 14);
        // Try to highlight current model
        const curModel = cfg.model?.includes('/') ? cfg.model.split('/').slice(1).join('/') : cfg.model;
        const curIdx = modelItems.findIndex(i => i.value === curModel);
        if (curIdx >= 0) modelSelector.selectedIndex = curIdx;

        const modelPromise = new Promise((resolve) => {
          modelSelector.onSelect = (item) => resolve(item);
          modelSelector.onCancel = () => resolve(null);
        });

        const modelHeader = new Text(
          chalk.hex('#58a6ff')(`  Step 2/2 `) + chalk.hex('#8b949e')(`— Select model from ${provName} (↑↓ Enter Esc)`) + '\n' +
          chalk.hex('#484f58')(`  ${models.length} models available`),
          0, 0
        );
        editorIdx = tui.children.indexOf(editor);
        tui.children.splice(editorIdx, 0, modelHeader);
        tui.children.splice(editorIdx + 1, 0, modelSelector);
        tui.requestRender();

        const modelHandler = {
          handleInput(data) {
            if (data === '\x1b') { modelSelector.onCancel?.(); }
            else { modelSelector.handleInput(data); }
            tui.requestRender();
          },
        };
        tui.setFocus(modelHandler);

        const selectedModel = await modelPromise;
        tui.removeChild(modelHeader);
        tui.removeChild(modelSelector);
        tui.setFocus(editor);

        if (selectedModel) {
          // Store as provider/model for proper routing
          const fullModelId = `${provName}/${selectedModel.value}`;
          setConfig('model', fullModelId);
          agent.model = fullModelId;
          print(chalk.hex('#7ee787')(`✓ Provider: ${chalk.bold(provName)}  Model: ${chalk.bold(selectedModel.value)}`));
        } else {
          print(chalk.hex('#8b949e')('  Model selection cancelled.'));
        }
      } catch (err) {
        print(chalk.red(`✗ Failed: ${err.message}`));
      }
      break;
    }

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

    case 'provider': {
      const providerName = args[0];
      if (!providerName) {
        // List all providers with status
        const allProviders = getAllProviders();
        const cfg = getConfig();
        const lines = [chalk.cyan('AI Providers:\n')];
        for (const [name, provider] of allProviders) {
          const isActive = name === cfg.active_provider;
          const isConfigured = provider.isConfigured();
          const status = isConfigured ? chalk.green('✓ configured') : chalk.red('✗ no API key');
          const marker = isActive ? chalk.green(' ← active') : '';
          lines.push(chalk.white(`  ${name}`) + chalk.dim(` — ${status}`) + marker);
        }
        lines.push('');
        lines.push(chalk.dim('  Usage: /provider <name> to switch, /model to select model'));
        lines.push(chalk.dim('  Providers: gemini, groq, llm7, nvidia, mistral, openrouter'));
        print(lines.join('\n'));
      } else {
        try {
          setActiveProvider(providerName);
          const provider = getAllProviders().get(providerName);
          const modelCount = (await provider.getModels()).length;
          print(chalk.green(`✓ Switched to ${providerName} (${modelCount} models). Use /model to select a model.`));
        } catch (err) {
          print(chalk.red(`✗ ${err.message}`));
        }
      }
      break;
    }

    case 'buckets': {
      try {
        const { listBuckets, formatBucketList } = await import('./task_buckets.js');
        const buckets = listBuckets();
        if (!buckets.length) {
          print(chalk.yellow('No task buckets. The agent creates them for complex tasks.'));
        } else {
          print(chalk.cyan('Task Buckets:\n') + formatBucketList(buckets));
        }
      } catch (err) {
        print(chalk.red(`✗ ${err.message}`));
      }
      break;
    }

    case 'checkpoint': {
      try {
        const { listCheckpoints, rollbackToCheckpoint, getCheckpointDiff } = await import('./checkpoint.js');
        const sub = args[0];

        if (!sub || sub === 'list') {
          const checkpoints = listCheckpoints();
          if (!checkpoints.length) {
            print(chalk.yellow('No checkpoints. The agent creates them automatically before risky changes.'));
          } else {
            const lines = [chalk.cyan('Checkpoints:\n')];
            checkpoints.forEach((cp, i) => {
              lines.push(chalk.white(`  [${i + 1}] ${cp.id}`) + chalk.dim(` — ${cp.label} (${cp.fileCount} files, ${cp.timestamp})`));
            });
            lines.push(chalk.dim('\nUsage: /checkpoint rollback <id>  |  /checkpoint diff <id>'));
            print(lines.join('\n'));
          }
        } else if (sub === 'rollback' && args[1]) {
          const result = rollbackToCheckpoint(args[1]);
          if (result.error) {
            print(chalk.red(`✗ ${result.error}`));
          } else {
            print(chalk.green(`✓ Rolled back to checkpoint: ${result.label}\n  Files restored: ${result.files.join(', ')}`));
          }
        } else if (sub === 'diff' && args[1]) {
          const result = getCheckpointDiff(args[1]);
          if (result.error) {
            print(chalk.red(`✗ ${result.error}`));
          } else {
            const lines = [chalk.cyan(`Checkpoint diff: ${result.label}\n`)];
            for (const d of result.diffs) {
              lines.push(chalk.white(`  ${d.path}: ${d.status}`));
              if (d.diff) lines.push(d.diff);
            }
            print(lines.join('\n'));
          }
        } else {
          print(chalk.yellow('Usage: /checkpoint [list|rollback <id>|diff <id>]'));
        }
      } catch (err) {
        print(chalk.red(`✗ ${err.message}`));
      }
      break;
    }

    case 'cron': {
      try {
        const { listJobs, removeJob, runJob } = await import('./scheduler/cron.js');
        const sub = args[0];

        if (!sub || sub === 'list') {
          const jobs = listJobs();
          if (!jobs.length) {
            print(chalk.yellow('No cron jobs. The agent can schedule them with the cron_schedule tool.'));
          } else {
            const lines = [chalk.cyan('Cron Jobs:\n')];
            jobs.forEach(j => {
              const status = j.enabled ? chalk.green('✓') : chalk.red('✗');
              const last = j.lastRun ? chalk.dim(` last: ${j.lastRun}`) : chalk.dim(' never run');
              lines.push(`  ${status} ${chalk.white(j.name)} ${chalk.dim(`(${j.schedule})`)} runs: ${j.runCount}${last}`);
            });
            lines.push(chalk.dim('\nUsage: /cron run <name>  |  /cron remove <name>'));
            print(lines.join('\n'));
          }
        } else if (sub === 'run' && args[1]) {
          const result = await runJob(args[1]);
          if (result.error) {
            print(chalk.red(`✗ ${result.error}`));
          } else {
            print(chalk.green(`✓ Job "${args[1]}" triggered. Result: ${result.success ? 'success' : 'failed'}`));
          }
        } else if (sub === 'remove' && args[1]) {
          const result = removeJob(args[1]);
          if (result.error) {
            print(chalk.red(`✗ ${result.error}`));
          } else {
            print(chalk.green(`✓ Job "${args[1]}" removed.`));
          }
        } else {
          print(chalk.yellow('Usage: /cron [list|run <name>|remove <name>]'));
        }
      } catch (err) {
        print(chalk.red(`✗ ${err.message}`));
      }
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
