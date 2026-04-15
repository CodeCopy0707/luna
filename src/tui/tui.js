/**
 * tui.js — Main TUI engine with differential rendering
 * Three-strategy rendering: first render, full re-render, differential update
 * Uses CSI 2026 synchronized output for flicker-free updates
 */

import { visibleWidth } from './utils.js';

export class TUI {
  constructor(terminal) {
    this.terminal = terminal;
    this.children = [];
    this._focusedComponent = null;
    this._prevLines = null;
    this._prevWidth = -1;
    this._renderPending = false;
    this._started = false;
    this._renderedLineCount = 0;
    this.onDebug = null;
  }

  // ─── Child Management ────────────────────────────────────────────────────────

  addChild(component) {
    this.children.push(component);
    this.requestRender();
  }

  removeChild(component) {
    const idx = this.children.indexOf(component);
    if (idx !== -1) this.children.splice(idx, 1);
    this.requestRender();
  }

  setFocus(component) {
    if (this._focusedComponent && this._focusedComponent !== component) {
      if ('focused' in this._focusedComponent) this._focusedComponent.focused = false;
    }
    this._focusedComponent = component;
    if (component && 'focused' in component) component.focused = true;
    this.requestRender();
  }

  requestRender() {
    if (this._renderPending) return;
    this._renderPending = true;
    setImmediate(() => {
      this._renderPending = false;
      this._render();
    });
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────

  start() {
    this._started = true;
    this.terminal.start(
      (data) => this._handleInput(data),
      () => this._handleResize()
    );
    this.terminal.hideCursor();
    this.terminal.enableBracketedPaste?.();
    this._render();
  }

  stop() {
    this._started = false;
    this.terminal.disableBracketedPaste?.();
    this.terminal.showCursor();
    this.terminal.stop();
  }

  // ─── Input ───────────────────────────────────────────────────────────────────

  _handleInput(data) {
    if (this._focusedComponent?.handleInput) {
      this._focusedComponent.handleInput(data);
    }
  }

  _handleResize() {
    this._prevLines = null;
    this._prevWidth = -1;
    this.requestRender();
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  _collectLines(width) {
    const lines = [];
    for (const child of this.children) {
      try {
        const childLines = child.render(width);
        for (const line of childLines) {
          lines.push(line);
        }
      } catch (err) {
        lines.push(`[render error: ${err.message}]`);
      }
    }
    return lines;
  }

  _render() {
    if (!this._started) return;

    const width = this.terminal.columns;
    const currentLines = this._collectLines(width);

    this.terminal.beginSync?.();

    const isFirstRender = this._prevLines === null;
    const widthChanged = this._prevWidth !== width;

    if (isFirstRender || widthChanged) {
      // Strategy 1 & 2: First render or width changed — clear screen, full write
      if (widthChanged) this.terminal.clearScreen();
      this.terminal.write(currentLines.join('\r\n') + '\r\n');
      this._renderedLineCount = currentLines.length;

    } else {
      // Strategy 3: Differential update
      // Move cursor back to the very first line we own
      if (this._renderedLineCount > 0) {
        // Move up N-1 lines (we're already on the last line after the previous write)
        this.terminal.write(`\x1b[${this._renderedLineCount}A\r`);
      }

      // Find first changed line
      let firstChanged = 0;
      const minLen = Math.min(currentLines.length, this._prevLines.length);
      while (firstChanged < minLen && currentLines[firstChanged] === this._prevLines[firstChanged]) {
        firstChanged++;
      }

      // Nothing changed — move cursor back to bottom and bail
      if (firstChanged === currentLines.length && currentLines.length === this._prevLines.length) {
        this.terminal.write(`\x1b[${this._renderedLineCount}B\r`);
        this.terminal.endSync?.();
        return;
      }

      // Move down to first changed line
      if (firstChanged > 0) {
        this.terminal.write(`\x1b[${firstChanged}B\r`);
      }

      // Rewrite from firstChanged to end, clearing each line first
      const toRender = currentLines.slice(firstChanged);
      const parts = toRender.map(l => `\x1b[2K${l}`);
      this.terminal.write(parts.join('\r\n') + '\r\n');

      // Clear any extra lines left over from a longer previous render
      if (currentLines.length < this._prevLines.length) {
        const extra = this._prevLines.length - currentLines.length;
        for (let i = 0; i < extra; i++) {
          this.terminal.write('\x1b[2K\r\n');
        }
        // Move cursor back up past the cleared lines so we're at the bottom of content
        this.terminal.write(`\x1b[${extra}A\r`);
      }

      this._renderedLineCount = currentLines.length;
    }

    this.terminal.endSync?.();
    this._prevLines = currentLines;
    this._prevWidth = width;
  }
}
