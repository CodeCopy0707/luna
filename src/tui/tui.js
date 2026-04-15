/**
 * tui.js — Main TUI engine with differential rendering
 * Three-strategy rendering: first render, full re-render, differential update
 * Uses CSI 2026 synchronized output for flicker-free updates
 */

import { visibleWidth } from './utils.js';
import { ModeTab } from './mode_tab.js';

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
    // Handle mouse click events (format: \x1b[<num>;<num>M)
    if (data.startsWith('\x1b[') && data.includes('M') && !data.includes(';~')) {
      // Parse mouse click: \x1b[<Cb>;<Cx>;<Cm>M
      // Cb = button, Cx = x, Cm = y (1-indexed)
      const match = data.match(/\x1b\[(\d+);(\d+);(\d+)M/);
      if (match) {
        const button = parseInt(match[1]);
        const x = parseInt(match[2]) - 1;  // Convert to 0-indexed
        const y = parseInt(match[3]) - 1;
        
        // Only handle left click (button 0) on clickable components
        if (button === 0) {
          // Check ModeTab first (it's usually at the top, around y=0 or y=1)
          for (const child of this.children) {
            if (child instanceof ModeTab && (y <= 1)) {
              if (child.handleClick(x)) {
                this.requestRender();
                return;
              }
            }
          }
        }
      }
    }
    
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
    // Full redraw each frame for stability across terminals.
    // Differential rendering was causing stale line artifacts while typing.
    this.terminal.clearScreen();
    this.terminal.write(currentLines.join('\r\n') + '\r\n');
    this._renderedLineCount = currentLines.length;

    this.terminal.endSync?.();
    this._prevLines = currentLines;
    this._prevWidth = width;
  }
}
