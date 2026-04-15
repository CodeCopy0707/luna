/**
 * terminal.js — Terminal abstraction (ProcessTerminal)
 * Wraps process.stdin/stdout with raw mode, resize events, cursor control.
 */

import process from 'process';

export class ProcessTerminal {
  constructor() {
    this._onInput = null;
    this._onResize = null;
    this._started = false;
  }

  start(onInput, onResize) {
    this._onInput = onInput;
    this._onResize = onResize;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (data) => {
      this._onInput?.(data);
    });

    process.stdout.on('resize', () => {
      this._onResize?.();
    });

    this._started = true;
  }

  stop() {
    if (!this._started) return;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    this._started = false;
  }

  write(data) {
    process.stdout.write(data);
  }

  get columns() {
    return process.stdout.columns || 80;
  }

  get rows() {
    return process.stdout.rows || 24;
  }

  // Move cursor up by `lines` lines
  moveUp(lines) {
    if (lines > 0) this.write(`\x1b[${lines}A`);
  }

  // Move cursor to column 1
  moveToCol1() {
    this.write('\r');
  }

  hideCursor() {
    this.write('\x1b[?25l');
  }

  showCursor() {
    this.write('\x1b[?25h');
  }

  clearLine() {
    this.write('\x1b[2K\r');
  }

  clearFromCursor() {
    this.write('\x1b[J');
  }

  clearScreen() {
    this.write('\x1b[2J\x1b[H');
  }

  // Move cursor to absolute position (1-indexed)
  moveTo(row, col) {
    this.write(`\x1b[${row};${col}H`);
  }

  // Enable/disable bracketed paste mode
  enableBracketedPaste() {
    this.write('\x1b[?2004h');
  }

  disableBracketedPaste() {
    this.write('\x1b[?2004l');
  }

  // Synchronized output (CSI 2026) — atomic screen updates, no flicker
  beginSync() {
    this.write('\x1b[?2026h');
  }

  endSync() {
    this.write('\x1b[?2026l');
  }
}
