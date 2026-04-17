/**
 * terminal.js — Low-level terminal abstraction
 */

import readline from 'readline';

export class ProcessTerminal {
  constructor() {
    this.stdin = process.stdin;
    this.stdout = process.stdout;
    this._onResize = null;
    this._isRaw = false;

    // Handle resize
    this.stdout.on('resize', () => {
      if (this._onResize) this._onResize();
    });
  }

  get columns() {
    return this.stdout.columns || 80;
  }

  get rows() {
    return this.stdout.rows || 24;
  }

  set onResize(cb) {
    this._onResize = cb;
  }

  enterRawMode() {
    if (this._isRaw) return;
    if (this.stdin.isTTY) {
      this.stdin.setRawMode(true);
      this.stdin.resume();
      this.stdin.setEncoding('utf8');
      readline.emitKeypressEvents(this.stdin);
      this._isRaw = true;
    }
  }

  exitRawMode() {
    if (!this._isRaw) return;
    if (this.stdin.isTTY) {
      this.stdin.setRawMode(false);
      this.stdin.pause();
      this._isRaw = false;
    }
  }

  write(data) {
    this.stdout.write(data);
  }

  clearScreen() {
    this.write('\x1b[2J\x1b[H');
  }

  hideCursor() {
    this.write('\x1b[?25l');
  }

  showCursor() {
    this.write('\x1b[?25h');
  }

  moveCursor(x, y) {
    this.write(`\x1b[${y + 1};${x + 1}H`);
  }
}
