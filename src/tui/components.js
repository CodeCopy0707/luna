/**
 * components.js — TUI Component library (pi-tui style)
 */

import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import wrapAnsi from 'wrap-ansi';
import stripAnsi from 'strip-ansi';

export class BaseComponent {
  constructor() {
    this.cachedLines = null;
    this.lastWidth = -1;
  }

  invalidate() {
    this.cachedLines = null;
  }

  render(width) {
    if (this.cachedLines && this.lastWidth === width) {
      return this.cachedLines;
    }
    this.lastWidth = width;
    this.cachedLines = this.doRender(width);
    return this.cachedLines;
  }

  doRender(width) {
    return [''];
  }
}

export class Text extends BaseComponent {
  constructor(text, marginTop = 0, marginBottom = 0) {
    super();
    this.text = text;
    this.marginTop = marginTop;
    this.marginBottom = marginBottom;
  }

  setText(text) {
    if (this.text === text) return;
    this.text = text;
    this.invalidate();
  }

  doRender(width) {
    const lines = [];
    for (let i = 0; i < this.marginTop; i++) lines.push('');
    const wrapped = wrapAnsi(this.text, width - 4, { hard: true, trim: false });
    wrapped.split('\n').forEach(line => lines.push('  ' + line));
    for (let i = 0; i < this.marginBottom; i++) lines.push('');
    return lines;
  }
}

export class Markdown extends BaseComponent {
  constructor(text, marginTop = 0, marginBottom = 0, theme = {}, bgFn = (s) => s) {
    super();
    this.text = text;
    this.marginTop = marginTop;
    this.marginBottom = marginBottom;
    this.theme = theme;
    this.bgFn = bgFn;
  }

  setText(text) {
    if (this.text === text) return;
    this.text = text;
    this.invalidate();
  }

  doRender(width) {
    const lines = [];
    for (let i = 0; i < this.marginTop; i++) lines.push('');

    const renderer = new TerminalRenderer({
      reflowText: true,
      firstItemUIndented: true,
      ...this.theme
    });

    const rendered = marked(this.text, { renderer });
    const wrapped = wrapAnsi(rendered, width - 6, { hard: true, trim: false });
    
    wrapped.split('\n').forEach(line => {
      lines.push('  ' + line);
    });

    for (let i = 0; i < this.marginBottom; i++) lines.push('');
    return lines.map(l => this.bgFn(l.padEnd(width)));
  }
}

export class Divider extends BaseComponent {
  constructor(char = '─', styleFn = (s) => s) {
    super();
    this.char = char;
    this.styleFn = styleFn;
  }
  doRender(width) {
    return [this.styleFn(this.char.repeat(width))];
  }
}

export class Spacer extends BaseComponent {
  constructor(height = 1) {
    super();
    this.height = height;
  }
  doRender(width) {
    return new Array(this.height).fill('');
  }
}

export class StatusBar extends BaseComponent {
  constructor(leftFn, rightFn, fillFn = (s) => s) {
    super();
    this.leftFn = leftFn;
    this.rightFn = rightFn;
    this.fillFn = fillFn;
  }

  doRender(width) {
    const left = this.leftFn();
    const right = this.rightFn(width);
    const leftLen = stripAnsi(left).length;
    const rightLen = stripAnsi(right).length;
    const gap = Math.max(0, width - leftLen - rightLen);
    const bar = left + this.fillFn(' '.repeat(gap)) + right;
    return [bar];
  }
  
  // Status bar should probably never be fully cached if it depends on external state
  render(width) {
    return this.doRender(width);
  }
}

export class Loader extends BaseComponent {
  constructor(tui, colorFn = (s) => s, dimFn = (s) => s, text = 'Thinking...') {
    super();
    this.tui = tui;
    this.colorFn = colorFn;
    this.dimFn = dimFn;
    this.text = text;
    this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    this.frameIdx = 0;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % this.frames.length;
      this.tui.requestRender();
    }, 80);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  doRender(width) {
    const frame = this.colorFn(this.frames[this.frameIdx]);
    const label = this.dimFn(this.text);
    return ['', `  ${frame} ${label}`, ''];
  }

  // Animation needs dynamic render
  render(width) {
    return this.doRender(width);
  }
}

export class SelectList extends BaseComponent {
  constructor(items, maxHeight = 10) {
    super();
    this.items = items;
    this.maxHeight = maxHeight;
    this.selectedIndex = 0;
    this.scrollPos = 0;
    this.onSelect = null;
    this.onCancel = null;
  }

  handleInput(data) {
    const key = data.toString();
    if (key === '\x1b[A') { // Up
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    } else if (key === '\x1b[B') { // Down
      this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
    } else if (key === '\r' || key === '\n') {
      if (this.onSelect) this.onSelect(this.items[this.selectedIndex]);
    } else if (key === '\x1b') {
      if (this.onCancel) this.onCancel();
    }

    if (this.selectedIndex < this.scrollPos) {
      this.scrollPos = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollPos + this.maxHeight) {
      this.scrollPos = this.selectedIndex - this.maxHeight + 1;
    }
    this.invalidate();
  }

  doRender(width) {
    const lines = [];
    const visibleItems = this.items.slice(this.scrollPos, this.scrollPos + this.maxHeight);

    visibleItems.forEach((item, idx) => {
      const isSelected = (idx + this.scrollPos) === this.selectedIndex;
      const prefix = isSelected ? chalk.cyan(' ❯ ') : '   ';
      const label = isSelected ? chalk.bold.white(item.label) : chalk.gray(item.label);
      const desc = item.description ? chalk.dim(` ${item.description}`) : '';
      
      let line = prefix + label + desc;
      if (isSelected) line = chalk.bgHex('#161b22')(line.padEnd(width - 2)) + ' ';
      else line = line.padEnd(width);
      
      lines.push(line);
    });

    return lines;
  }
}
