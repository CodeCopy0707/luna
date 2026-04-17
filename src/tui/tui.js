/**
 * tui.js — Differential rendering engine inspired by pi-tui
 */

import stripAnsi from 'strip-ansi';

// Unique marker that doesn't render visually but can be detected in the string
export const CURSOR_MARKER = '\x1b_CURSOR\x1b\\';

export class TUI {
  constructor(terminal) {
    this.terminal = terminal;
    this.children = [];
    this.topSticky = [];
    this.bottomSticky = [];
    this._focusedComponent = null;
    this._lastLines = [];
    this._isStarted = false;
    this.scrollOffset = 0;

    this.terminal.onResize = () => {
      this.fullRender();
    };
  }

  addChild(component) {
    if (!this.children.includes(component)) this.children.push(component);
  }

  removeChild(component) {
    this.children = this.children.filter(c => c !== component);
    this.topSticky = this.topSticky.filter(c => c !== component);
    this.bottomSticky = this.bottomSticky.filter(c => c !== component);
    if (this._focusedComponent === component) this._focusedComponent = null;
  }

  stickTop(component) {
    if (!this.topSticky.includes(component)) this.topSticky.push(component);
  }

  stickBottom(component) {
    if (!this.bottomSticky.includes(component)) this.bottomSticky.unshift(component);
  }

  setFocus(component) {
    this._focusedComponent = component;
  }

  start() {
    if (this._isStarted) return;
    this.terminal.enterRawMode();
    this.terminal.hideCursor();
    this.terminal.stdin.on('data', this._handleInput.bind(this));
    this.terminal.stdin.on('keypress', this._handleKeypress.bind(this));
    this._isStarted = true;
    this.fullRender();
  }

  stop() {
    if (!this._isStarted) return;
    this.terminal.showCursor();
    this.terminal.exitRawMode();
    this._isStarted = false;
  }

  _handleInput(data) {
    if (!this._isStarted) return;
    if (this._focusedComponent && this._focusedComponent.handleInput) {
      this._focusedComponent.handleInput(data.toString());
    }
    this.requestRender();
  }

  _handleKeypress(str, key) {
    if (!this._isStarted) return;
    
    // Global scroll keys
    if (key.name === 'pageup') {
      this.scrollOffset = Math.min(this.scrollOffset + 5, 2000);
      this.requestRender();
      return;
    }
    if (key.name === 'pagedown') {
      this.scrollOffset = Math.max(0, this.scrollOffset - 5);
      this.requestRender();
      return;
    }

    if (this._focusedComponent && this._focusedComponent.handleKeypress) {
      if (this._focusedComponent.handleKeypress(str, key)) {
        this.requestRender();
        return;
      }
    }
  }

  requestRender() {
    if (!this._isStarted) return;
    process.nextTick(() => this.render());
  }

  fullRender() {
    this._lastLines = [];
    this.terminal.clearScreen();
    this.render();
  }

  render() {
    if (!this._isStarted) return;

    const width = this.terminal.columns;
    const height = this.terminal.rows;

    const topLines = [];
    for (const comp of this.topSticky) topLines.push(...comp.render(width));

    const bottomLines = [];
    for (const comp of this.bottomSticky) bottomLines.push(...comp.render(width));

    const availableHeight = height - topLines.length - bottomLines.length;
    
    let bodyLines = [];
    for (const comp of this.children) {
      if (this.topSticky.includes(comp) || this.bottomSticky.includes(comp)) continue;
      bodyLines.push(...comp.render(width));
    }

    const end = Math.max(availableHeight, bodyLines.length - this.scrollOffset);
    const start = Math.max(0, end - availableHeight);
    const visibleBody = bodyLines.slice(start, end);

    const finalLines = [...topLines, ...visibleBody, ...bottomLines];
    while (finalLines.length < height) finalLines.push('');

    // Differential rendering loop
    let cursorX = -1, cursorY = -1;

    for (let y = 0; y < height; y++) {
      let line = finalLines[y] || '';
      
      // Look for cursor marker BEFORE stripping ansi/marker for output
      const markerIdx = line.indexOf(CURSOR_MARKER);
      if (markerIdx !== -1) {
        // Position is index of marker relative to visible text
        cursorX = stripAnsi(line.slice(0, markerIdx)).length;
        cursorY = y;
        // Strip the marker for visual output
        line = line.replace(CURSOR_MARKER, '');
      }

      if (line !== this._lastLines[y]) {
        this.terminal.moveCursor(0, y);
        this.terminal.write('\x1b[2K' + line);
        this._lastLines[y] = line;
      }
    }

    if (cursorX !== -1) {
      this.terminal.moveCursor(cursorX, cursorY);
      this.terminal.showCursor();
    } else {
      this.terminal.hideCursor();
    }
  }
}
