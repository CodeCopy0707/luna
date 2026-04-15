/**
 * editor.js — Multi-line editor with autocomplete, history, paste handling
 * Inspired by pi-tui's Editor component
 */

import chalk from 'chalk';
import { visibleWidth, truncateToWidth, wrapTextWithAnsi, Key, matchesKey } from './utils.js';
import { SelectList } from './components.js';

const SLASH_COMMANDS = [
  { value: 'help',       label: '/help',       description: 'Show all commands' },
  { value: 'clear',      label: '/clear',       description: 'Clear conversation history' },
  { value: 'model',      label: '/model',       description: 'Show or switch AI model' },
  { value: 'config',     label: '/config',      description: 'Show or set configuration' },
  { value: 'save',       label: '/save',        description: 'Save current session' },
  { value: 'load',       label: '/load',        description: 'Load a saved session' },
  { value: 'resume',     label: '/resume',      description: 'Resume last session' },
  { value: 'cost',       label: '/cost',        description: 'Show token usage and cost' },
  { value: 'memory',     label: '/memory',      description: 'List or search memories' },
  { value: 'tasks',      label: '/tasks',       description: 'List all tasks' },
  { value: 'brainstorm', label: '/brainstorm',  description: 'Multi-persona brainstorm' },
  { value: 'worker',     label: '/worker',      description: 'Auto-implement TODO tasks' },
  { value: 'telegram',   label: '/telegram',    description: 'Start Telegram bridge' },
  { value: 'multi',      label: '/multi',       description: 'Run multi-agent pipeline' },
  { value: 'exit',       label: '/exit',        description: 'Exit Gemma Agent' },
];

export class Editor {
  constructor(tui, theme = {}) {
    this.tui = tui;
    this.theme = {
      border:      (s) => chalk.dim(s),
      placeholder: (s) => chalk.dim(s),
      text:        (s) => s,
      ...theme,
    };

    this.lines = [''];       // array of line strings
    this.cursorRow = 0;      // cursor line index
    this.cursorCol = 0;      // cursor column index
    this.scrollOffset = 0;   // first visible line
    this.focused = true;
    this.disableSubmit = false;

    this.onSubmit = null;
    this.onChange = null;
    this.onTab = null;

    // Input history (up/down arrow)
    this._history = [];
    this._historyIdx = -1;
    this._historyDraft = '';

    // Autocomplete
    this._autocomplete = null;  // SelectList when active
    this._acPrefix = '';

    // Bracketed paste
    this._pasteBuffer = '';
    this._inPaste = false;
  }

  getValue() {
    return this.lines.join('\n');
  }

  setValue(text) {
    this.lines = text.split('\n');
    this.cursorRow = this.lines.length - 1;
    this.cursorCol = this.lines[this.cursorRow].length;
    this._closeAutocomplete();
    this.tui?.requestRender();
  }

  clear() {
    this.lines = [''];
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scrollOffset = 0;
    this._closeAutocomplete();
    this.tui?.requestRender();
  }

  // ─── Input Handling ─────────────────────────────────────────────────────────

  handleInput(data) {
    // Bracketed paste start/end
    if (data === '\x1b[200~') { this._inPaste = true; this._pasteBuffer = ''; return; }
    if (data === '\x1b[201~') {
      this._inPaste = false;
      this._insertText(this._pasteBuffer);
      this._pasteBuffer = '';
      this.tui?.requestRender();
      return;
    }
    if (this._inPaste) { this._pasteBuffer += data; return; }

    // Autocomplete active — route navigation keys to it
    if (this._autocomplete) {
      if (data === '\x1b[A' || data === '\x1b[B' || data === '\r') {
        if (data === '\r') {
          const item = this._autocomplete.filteredItems[this._autocomplete.selectedIndex];
          if (item) this._applyAutocomplete(item);
          return;
        }
        this._autocomplete.handleInput(data);
        this.tui?.requestRender();
        return;
      }
      if (data === '\x1b' || data === '\t') {
        this._closeAutocomplete();
        this.tui?.requestRender();
        return;
      }
    }

    // Ctrl+C — exit
    if (data === '\x03') {
      process.exit(0);
    }

    // Enter — submit
    if (data === '\r') {
      if (this.disableSubmit) return;
      const value = this.getValue().trim();
      if (!value) return;
      this._history.unshift(value);
      if (this._history.length > 100) this._history.pop();
      this._historyIdx = -1;
      this.clear();
      this.onSubmit?.(value);
      return;
    }

    // Alt+Enter / Shift+Enter — new line
    if (data === '\x1b\r' || data === '\x1b[13;2u' || data === '\n') {
      this._insertNewline();
      this.tui?.requestRender();
      return;
    }

    // Tab — trigger autocomplete
    if (data === '\t') {
      // Allow parent UI to consume Tab (e.g. mode switch) when editor is empty
      if (this.getValue().trim() === '' && this.onTab?.() === true) {
        return;
      }
      this._triggerAutocomplete();
      this.tui?.requestRender();
      return;
    }

    // Backspace
    if (data === '\x7f') {
      this._backspace();
      this._checkAutocomplete();
      this.tui?.requestRender();
      return;
    }

    // Delete
    if (data === '\x1b[3~') {
      this._deleteForward();
      this.tui?.requestRender();
      return;
    }

    // Arrow keys
    if (data === '\x1b[A') { this._moveUp(); this.tui?.requestRender(); return; }
    if (data === '\x1b[B') { this._moveDown(); this.tui?.requestRender(); return; }
    if (data === '\x1b[C') { this._moveRight(); this.tui?.requestRender(); return; }
    if (data === '\x1b[D') { this._moveLeft(); this.tui?.requestRender(); return; }

    // Home / End
    if (data === '\x1b[H' || data === '\x01') { this.cursorCol = 0; this.tui?.requestRender(); return; }
    if (data === '\x1b[F' || data === '\x05') { this.cursorCol = this.lines[this.cursorRow].length; this.tui?.requestRender(); return; }

    // Ctrl+W — delete word backwards
    if (data === '\x17') { this._deleteWordBack(); this.tui?.requestRender(); return; }

    // Ctrl+U — delete to start of line
    if (data === '\x15') {
      this.lines[this.cursorRow] = this.lines[this.cursorRow].slice(this.cursorCol);
      this.cursorCol = 0;
      this._checkAutocomplete();
      this.tui?.requestRender();
      return;
    }

    // Ctrl+K — delete to end of line
    if (data === '\x0b') {
      this.lines[this.cursorRow] = this.lines[this.cursorRow].slice(0, this.cursorCol);
      this.tui?.requestRender();
      return;
    }

    // Ctrl+Left / Alt+Left — word left
    if (data === '\x1b[1;5D' || data === '\x1bb') { this._wordLeft(); this.tui?.requestRender(); return; }
    // Ctrl+Right / Alt+Right — word right
    if (data === '\x1b[1;5C' || data === '\x1bf') { this._wordRight(); this.tui?.requestRender(); return; }

    // Printable character
    if (data.length === 1 && data >= ' ') {
      this._insertText(data);
      this._checkAutocomplete();
      this.tui?.requestRender();
      return;
    }

    // Multi-byte printable (emoji, CJK, etc.)
    if (data.length > 1 && !data.startsWith('\x1b')) {
      this._insertText(data);
      this.tui?.requestRender();
    }
  }

  // ─── Cursor Movement ────────────────────────────────────────────────────────

  _moveUp() {
    if (this.cursorRow > 0) {
      this.cursorRow--;
      this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
    } else {
      // History navigation
      if (this._historyIdx < this._history.length - 1) {
        if (this._historyIdx === -1) this._historyDraft = this.getValue();
        this._historyIdx++;
        this.setValue(this._history[this._historyIdx]);
      }
    }
  }

  _moveDown() {
    if (this.cursorRow < this.lines.length - 1) {
      this.cursorRow++;
      this.cursorCol = Math.min(this.cursorCol, this.lines[this.cursorRow].length);
    } else {
      // History navigation back
      if (this._historyIdx >= 0) {
        this._historyIdx--;
        if (this._historyIdx === -1) {
          this.setValue(this._historyDraft);
        } else {
          this.setValue(this._history[this._historyIdx]);
        }
      }
    }
  }

  _moveLeft() {
    if (this.cursorCol > 0) {
      this.cursorCol--;
    } else if (this.cursorRow > 0) {
      this.cursorRow--;
      this.cursorCol = this.lines[this.cursorRow].length;
    }
  }

  _moveRight() {
    if (this.cursorCol < this.lines[this.cursorRow].length) {
      this.cursorCol++;
    } else if (this.cursorRow < this.lines.length - 1) {
      this.cursorRow++;
      this.cursorCol = 0;
    }
  }

  _wordLeft() {
    const line = this.lines[this.cursorRow];
    let col = this.cursorCol;
    while (col > 0 && line[col - 1] === ' ') col--;
    while (col > 0 && line[col - 1] !== ' ') col--;
    this.cursorCol = col;
  }

  _wordRight() {
    const line = this.lines[this.cursorRow];
    let col = this.cursorCol;
    while (col < line.length && line[col] !== ' ') col++;
    while (col < line.length && line[col] === ' ') col++;
    this.cursorCol = col;
  }

  // ─── Text Editing ────────────────────────────────────────────────────────────

  _insertText(text) {
    const insertLines = text.split('\n');
    const line = this.lines[this.cursorRow];
    const before = line.slice(0, this.cursorCol);
    const after = line.slice(this.cursorCol);

    if (insertLines.length === 1) {
      this.lines[this.cursorRow] = before + text + after;
      this.cursorCol += text.length;
    } else {
      this.lines[this.cursorRow] = before + insertLines[0];
      const newLines = insertLines.slice(1, -1);
      const lastNew = insertLines[insertLines.length - 1] + after;
      this.lines.splice(this.cursorRow + 1, 0, ...newLines, lastNew);
      this.cursorRow += insertLines.length - 1;
      this.cursorCol = insertLines[insertLines.length - 1].length;
    }
    this.onChange?.(this.getValue());
  }

  _insertNewline() {
    const line = this.lines[this.cursorRow];
    const before = line.slice(0, this.cursorCol);
    const after = line.slice(this.cursorCol);
    this.lines[this.cursorRow] = before;
    this.lines.splice(this.cursorRow + 1, 0, after);
    this.cursorRow++;
    this.cursorCol = 0;
    this.onChange?.(this.getValue());
  }

  _backspace() {
    if (this.cursorCol > 0) {
      const line = this.lines[this.cursorRow];
      this.lines[this.cursorRow] = line.slice(0, this.cursorCol - 1) + line.slice(this.cursorCol);
      this.cursorCol--;
    } else if (this.cursorRow > 0) {
      const prevLen = this.lines[this.cursorRow - 1].length;
      this.lines[this.cursorRow - 1] += this.lines[this.cursorRow];
      this.lines.splice(this.cursorRow, 1);
      this.cursorRow--;
      this.cursorCol = prevLen;
    }
    this.onChange?.(this.getValue());
  }

  _deleteForward() {
    const line = this.lines[this.cursorRow];
    if (this.cursorCol < line.length) {
      this.lines[this.cursorRow] = line.slice(0, this.cursorCol) + line.slice(this.cursorCol + 1);
    } else if (this.cursorRow < this.lines.length - 1) {
      this.lines[this.cursorRow] += this.lines[this.cursorRow + 1];
      this.lines.splice(this.cursorRow + 1, 1);
    }
    this.onChange?.(this.getValue());
  }

  _deleteWordBack() {
    const line = this.lines[this.cursorRow];
    let col = this.cursorCol;
    while (col > 0 && line[col - 1] === ' ') col--;
    while (col > 0 && line[col - 1] !== ' ') col--;
    this.lines[this.cursorRow] = line.slice(0, col) + line.slice(this.cursorCol);
    this.cursorCol = col;
    this.onChange?.(this.getValue());
  }

  // ─── Autocomplete ────────────────────────────────────────────────────────────

  _checkAutocomplete() {
    const line = this.lines[this.cursorRow];
    const before = line.slice(0, this.cursorCol);

    if (before.startsWith('/') && !before.includes(' ')) {
      const prefix = before.slice(1).toLowerCase();
      const matches = SLASH_COMMANDS.filter(c => c.value.startsWith(prefix));
      if (matches.length > 0) {
        if (!this._autocomplete) {
          this._autocomplete = new SelectList(matches, 8);
          this._autocomplete.onSelect = (item) => this._applyAutocomplete(item);
          this._autocomplete.onCancel = () => this._closeAutocomplete();
        } else {
          this._autocomplete.items = matches;
          this._autocomplete.setFilter('');
          this._autocomplete.selectedIndex = 0;
        }
        this._acPrefix = prefix;
        return;
      }
    }
    this._closeAutocomplete();
  }

  _triggerAutocomplete() {
    const line = this.lines[this.cursorRow];
    const before = line.slice(0, this.cursorCol);
    if (before.startsWith('/')) {
      this._checkAutocomplete();
    }
  }

  _applyAutocomplete(item) {
    this.lines[this.cursorRow] = '/' + item.value;
    this.cursorCol = this.lines[this.cursorRow].length;
    this._closeAutocomplete();
    this.tui?.requestRender();
  }

  _closeAutocomplete() {
    this._autocomplete = null;
    this._acPrefix = '';
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  render(width) {
    const lines = [];
    const innerWidth = Math.max(4, width - 2);

    // Top border
    lines.push(this.theme.border('─'.repeat(width)));

    const maxEditorLines = 8;
    const totalLines = this.lines.length;

    // Clamp scroll
    if (this.cursorRow < this.scrollOffset) this.scrollOffset = this.cursorRow;
    if (this.cursorRow >= this.scrollOffset + maxEditorLines) {
      this.scrollOffset = this.cursorRow - maxEditorLines + 1;
    }

    const visibleLines = this.lines.slice(this.scrollOffset, this.scrollOffset + maxEditorLines);

    for (let i = 0; i < visibleLines.length; i++) {
      const lineIdx = i + this.scrollOffset;
      const lineText = visibleLines[i];

      if (lineIdx === this.cursorRow && this.focused) {
        const before = lineText.slice(0, this.cursorCol);
        const atCursor = lineText[this.cursorCol] || ' ';
        const after = lineText.slice(this.cursorCol + 1);
        // Build cursor line — truncate the whole thing to innerWidth
        const rendered = truncateToWidth(
          ' ' + before + chalk.bgWhite.black(atCursor) + after,
          width
        );
        lines.push(rendered);
      } else {
        lines.push(truncateToWidth(' ' + lineText, width));
      }
    }

    // Bottom border with optional scroll %
    if (totalLines > maxEditorLines) {
      const pct = Math.round((this.scrollOffset / (totalLines - maxEditorLines)) * 100);
      lines.push(this.theme.border(truncateToWidth(`─ ${pct}% `, width, '─').padEnd(width, '─')));
    } else {
      lines.push(this.theme.border('─'.repeat(width)));
    }

    // Hint line
    lines.push(truncateToWidth(
      chalk.dim(' Enter:send  Alt+Enter:newline  Tab:mode(empty)/autocomplete  ↑↓:history'),
      width
    ));

    // Autocomplete dropdown
    if (this._autocomplete) {
      lines.push(...this._autocomplete.render(width));
    }

    return lines;
  }
}
