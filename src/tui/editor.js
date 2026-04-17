/**
 * editor.js — Multi-line editor with CURSOR_MARKER logic and full keyboard support
 */

import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';
import stripAnsi from 'strip-ansi';
import { CURSOR_MARKER } from './tui.js';
import { BaseComponent } from './components.js';

export class Editor extends BaseComponent {
  constructor(tui, options = {}) {
    super();
    this.tui = tui;
    this.options = options;
    this.value = '';
    this.cursor = 0;
    this.history = [];
    this.historyIdx = -1;
    this.onSubmit = null;
    this.onTab = null;
    this.disableSubmit = false;
    this.borderStyle = options.border || ((s) => s);
  }

  handleInput(data) {
    if (this.disableSubmit) return;
    
    // We only use handleInput for BULK data (pastes)
    // Single characters are handled in handleKeypress to avoid double-processing
    if (data.length > 1 && !data.startsWith('\x1b')) {
      const filtered = data.replace(/[\x00-\x1f\x7f]/g, ''); // Filter all control chars including DEL
      if (filtered.length > 0) {
        this.value = this.value.slice(0, this.cursor) + filtered + this.value.slice(this.cursor);
        this.cursor += filtered.length;
        this.invalidate();
      }
    }
  }

  handleKeypress(str, key) {
    if (this.disableSubmit) return false;

    // --- Control Keys (Bash/Emacs Style) ---
    if (key.ctrl) {
      switch (key.name) {
        case 'a': this.cursor = 0; break;
        case 'e': this.cursor = this.value.length; break;
        case 'u': // Delete line
          this.value = '';
          this.cursor = 0;
          break;
        case 'k': // Delete to end
          this.value = this.value.slice(0, this.cursor);
          break;
        case 'w': // Delete previous word
          const b4 = this.value.slice(0, this.cursor);
          const m = b4.match(/(\s*\w+|\s*\W+)\s*$/);
          if (m) {
            this.value = this.value.slice(0, this.cursor - m[0].length) + this.value.slice(this.cursor);
            this.cursor -= m[0].length;
          }
          break;
        case 'h': // Backspace
          if (this.cursor > 0) {
            this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
            this.cursor--;
          }
          break;
        case 'd': // Delete forward
          if (this.cursor < this.value.length) {
            this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
          }
          break;
        case 'b': // Left
          this.cursor = Math.max(0, this.cursor - 1);
          break;
        case 'f': // Right
          this.cursor = Math.min(this.value.length, this.cursor + 1);
          break;
        case 'p': // Up (History previous)
          this._historyUp();
          break;
        case 'n': // Down (History next)
          this._historyDown();
          break;
        case 'l': // Clear screen
          this.tui.fullRender();
          return true;
        default:
          return false;
      }
      this.invalidate();
      return true;
    }

    // --- Meta Keys (usually Alt/Option on Mac) ---
    if (key.meta) {
      switch (key.name) {
        case 'b': // Word left
        case 'left':
          const textBefore = this.value.slice(0, this.cursor);
          const matchBefore = textBefore.match(/(\s*\w+|\s*\W+)\s*$/);
          this.cursor = matchBefore ? this.cursor - matchBefore[0].length : 0;
          break;
        case 'f': // Word right
        case 'right':
          const textAfter = this.value.slice(this.cursor);
          const matchAfter = textAfter.match(/^\s*(\w+\s*|\W+\s*)/);
          this.cursor += matchAfter ? matchAfter[0].length : textAfter.length;
          break;
        case 'backspace': // Word delete
          const bBefore = this.value.slice(0, this.cursor);
          const mBefore = bBefore.match(/(\s*\w+|\s*\W+)\s*$/);
          if (mBefore) {
            this.value = this.value.slice(0, this.cursor - mBefore[0].length) + this.value.slice(this.cursor);
            this.cursor -= mBefore[0].length;
          }
          break;
        default:
          return false;
      }
      this.invalidate();
      return true;
    }

    // --- Normal Keys & Aliases ---
    switch (key.name) {
      case 'return':
      case 'enter':
        if (key.shift) {
          this.value = this.value.slice(0, this.cursor) + '\n' + this.value.slice(this.cursor);
          this.cursor++;
        } else {
          const val = this.value;
          if (val.trim()) {
            this.history.unshift(val);
            this.historyIdx = -1;
            this.value = '';
            this.cursor = 0;
            if (this.onSubmit) this.onSubmit(val);
          }
        }
        break;

      case 'backspace':
        if (this.cursor > 0) {
          this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor);
          this.cursor--;
        }
        break;

      case 'delete': // Forward delete (Fn+Backspace on Mac)
        if (this.cursor < this.value.length) {
          this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1);
        }
        break;

      case 'left':
        this.cursor = Math.max(0, this.cursor - 1);
        break;

      case 'right':
        this.cursor = Math.min(this.value.length, this.cursor + 1);
        break;

      case 'up':
        this._historyUp();
        break;

      case 'down':
        this._historyDown();
        break;

      case 'home':
        this.cursor = 0;
        break;

      case 'end':
        this.cursor = this.value.length;
        break;

      case 'space':
        this.value = this.value.slice(0, this.cursor) + ' ' + this.value.slice(this.cursor);
        this.cursor++;
        break;

      case 'tab':
        if (this.onTab) return this.onTab();
        return true;

      default:
        // Printable characters handled by 'str' when key.name is undefined
        if (!key.ctrl && !key.meta && str && str.length === 1 && str >= ' ') {
          this.value = this.value.slice(0, this.cursor) + str + this.value.slice(this.cursor);
          this.cursor++;
        } else {
          return false;
        }
    }

    this.invalidate();
    return true;
  }

  _historyUp() {
    if (this.history.length > 0 && this.historyIdx < this.history.length - 1) {
      this.historyIdx++;
      this.value = this.history[this.historyIdx];
      this.cursor = this.value.length;
    }
  }

  _historyDown() {
    if (this.historyIdx > 0) {
      this.historyIdx--;
      this.value = this.history[this.historyIdx];
      this.cursor = this.value.length;
    } else {
      this.historyIdx = -1;
      this.value = '';
      this.cursor = 0;
    }
  }

  doRender(width) {
    const lines = [];
    const borderStyle = this.borderStyle;
    const borderTop = borderStyle('┌' + '─'.repeat(width - 2) + '┐');
    const borderBottom = borderStyle('└' + '─'.repeat(width - 2) + '┘');
    
    lines.push(borderTop);
    
    let displayValue = this.value;
    let placeholder = false;
    if (!displayValue && !this.disableSubmit) {
       displayValue = 'Type a message... (Shift+Enter for newline, Tab to switch modes)';
       placeholder = true;
    }

    // Inject cursor marker
    let valueWithMarker = displayValue;
    if (!this.disableSubmit && !placeholder) {
      valueWithMarker = displayValue.slice(0, this.cursor) + CURSOR_MARKER + displayValue.slice(this.cursor);
    } else if (placeholder) {
      valueWithMarker = CURSOR_MARKER + displayValue;
    }

    const wrapped = wrapAnsi(valueWithMarker, width - 6, { hard: true, trim: false });
    
    wrapped.split('\n').forEach(line => {
      let styledLine = placeholder ? chalk.dim(line) : line;
      
      // Calculate visible width of the line to pad correctly
      // We must strip ANSI AND our CURSOR_MARKER to get the real visual length
      const visibleLength = stripAnsi(line.replace(CURSOR_MARKER, '')).length;
      const padding = Math.max(0, width - 4 - visibleLength);
      
      lines.push(borderStyle('│ ') + styledLine + ' '.repeat(padding) + borderStyle(' │'));
    });
    
    if (lines.length === 1 && !this.disableSubmit && !placeholder && !this.value) {
       lines.push(borderStyle('│ ') + CURSOR_MARKER + ' '.repeat(width - 5) + borderStyle(' │'));
    }

    lines.push(borderBottom);
    return lines;
  }
}
