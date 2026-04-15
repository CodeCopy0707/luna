/**
 * components.js — Built-in TUI components
 * Text, Markdown, Loader, Spacer, Divider, StatusBar
 */

import chalk from 'chalk';
import { visibleWidth, truncateToWidth, wrapTextWithAnsi, padToWidth } from './utils.js';

// ─── Text ─────────────────────────────────────────────────────────────────────

export class Text {
  constructor(text = '', paddingX = 1, paddingY = 0, bgFn = null) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.bgFn = bgFn;
    this._cache = null;
    this._cacheWidth = -1;
  }

  setText(text) {
    this.text = text;
    this.invalidate();
  }

  invalidate() {
    this._cache = null;
    this._cacheWidth = -1;
  }

  render(width) {
    if (this._cache && this._cacheWidth === width) return this._cache;

    const innerWidth = Math.max(4, width - this.paddingX * 2);
    const lines = [];

    for (let i = 0; i < this.paddingY; i++) lines.push('');

    const rawLines = this.text.split('\n');
    for (const raw of rawLines) {
      const wrapped = wrapTextWithAnsi(raw, innerWidth);
      for (const wl of wrapped) {
        const padded = ' '.repeat(this.paddingX) + wl;
        lines.push(this.bgFn ? this.bgFn(padToWidth(padded, width)) : padded);
      }
    }

    // Bottom padding
    for (let i = 0; i < this.paddingY; i++) lines.push('');

    this._cache = lines;
    this._cacheWidth = width;
    return lines;
  }
}

// ─── Markdown ─────────────────────────────────────────────────────────────────

const DEFAULT_MD_THEME = {
  heading:        (s) => chalk.bold.cyan(s),
  bold:           (s) => chalk.bold(s),
  italic:         (s) => chalk.italic(s),
  code:           (s) => chalk.bgGray.white(` ${s} `),
  codeBlock:      (s) => chalk.white(s),
  codeBlockBorder:(s) => chalk.dim(s),
  quote:          (s) => chalk.italic.gray(s),
  quoteBorder:    (s) => chalk.dim('│ '),
  listBullet:     (s) => chalk.cyan(s),
  link:           (s) => chalk.underline.blue(s),
  hr:             (s) => chalk.dim(s),
};

export class Markdown {
  constructor(text = '', paddingX = 1, paddingY = 0, theme = {}, bgFn = null) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.theme = { ...DEFAULT_MD_THEME, ...theme };
    this.bgFn = bgFn;
    this._cache = null;
    this._cacheWidth = -1;
  }

  setText(text) {
    this.text = text;
    this.invalidate();
  }

  invalidate() {
    this._cache = null;
    this._cacheWidth = -1;
  }

  _renderMarkdown(text, innerWidth) {
    const safeWidth = Math.max(4, innerWidth);
    const lines = [];
    const rawLines = text.split('\n');
    let inCodeBlock = false;
    let codeLang = '';
    let codeLines = [];

    const flush = () => {
      lines.push(this.theme.codeBlockBorder(`┌─${codeLang ? ' ' + codeLang + ' ' : ''}${'─'.repeat(Math.max(0, safeWidth - 4 - (codeLang ? codeLang.length + 2 : 0)))}┐`));
      for (const cl of codeLines) {
        const wrapped = wrapTextWithAnsi(cl, safeWidth - 2);
        for (const wl of wrapped) {
          lines.push(this.theme.codeBlock(' ' + padToWidth(wl, safeWidth - 2)));
        }
      }
      lines.push(this.theme.codeBlockBorder('└' + '─'.repeat(Math.max(0, safeWidth - 2)) + '┘'));
      codeLines = [];
      codeLang = '';
    };

    for (const raw of rawLines) {
      if (raw.startsWith('```')) {
        if (inCodeBlock) {
          flush();
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
          codeLang = raw.slice(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(raw);
        continue;
      }

      // Headings — check h3 first to avoid partial match with h2/h1
      const h3m = raw.match(/^### (.+)/);
      const h2m = raw.match(/^## (.+)/);
      const h1m = raw.match(/^# (.+)/);
      if (h3m) { lines.push(...wrapTextWithAnsi(this.theme.heading('### ' + h3m[1]), safeWidth)); continue; }
      if (h2m) { lines.push(...wrapTextWithAnsi(this.theme.heading('## ' + h2m[1]), safeWidth)); continue; }
      if (h1m) { lines.push(...wrapTextWithAnsi(this.theme.heading('# ' + h1m[1]), safeWidth)); continue; }

      // HR
      if (/^---+$/.test(raw) || /^\*\*\*+$/.test(raw)) {
        lines.push(this.theme.hr('─'.repeat(safeWidth)));
        continue;
      }

      // Blockquote
      if (raw.startsWith('> ')) {
        const content = this._inlineFormat(raw.slice(2));
        for (const wl of wrapTextWithAnsi(content, safeWidth - 2)) {
          lines.push(this.theme.quoteBorder() + this.theme.quote(wl));
        }
        continue;
      }

      // List items
      const lim = raw.match(/^(\s*)([-*+]|\d+\.) (.+)/);
      if (lim) {
        const indent = lim[1];
        const bullet = (lim[2] === '-' || lim[2] === '*' || lim[2] === '+') ? '•' : lim[2];
        const content = this._inlineFormat(lim[3]);
        const wrapped = wrapTextWithAnsi(content, safeWidth - indent.length - 3);
        for (let wi = 0; wi < wrapped.length; wi++) {
          const prefix = wi === 0 ? indent + this.theme.listBullet(bullet) + ' ' : indent + '  ';
          lines.push(prefix + wrapped[wi]);
        }
        continue;
      }

      // Empty line
      if (raw.trim() === '') {
        lines.push('');
        continue;
      }

      // Normal paragraph
      const formatted = this._inlineFormat(raw);
      lines.push(...wrapTextWithAnsi(formatted, safeWidth));
    }

    if (inCodeBlock) flush();
    return lines;
  }

  _inlineFormat(text) {
    // Bold **text** or __text__
    text = text.replace(/\*\*(.+?)\*\*/g, (_, t) => this.theme.bold(t));
    text = text.replace(/__(.+?)__/g, (_, t) => this.theme.bold(t));
    // Italic *text* or _text_
    text = text.replace(/\*([^*]+?)\*/g, (_, t) => this.theme.italic(t));
    text = text.replace(/_([^_]+?)_/g, (_, t) => this.theme.italic(t));
    // Inline code `text`
    text = text.replace(/`([^`]+?)`/g, (_, t) => this.theme.code(t));
    // Links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t) => this.theme.link(t));
    return text;
  }

  render(width) {
    if (this._cache && this._cacheWidth === width) return this._cache;

    const innerWidth = Math.max(4, width - this.paddingX * 2);
    const lines = [];

    for (let i = 0; i < this.paddingY; i++) lines.push('');

    const mdLines = this._renderMarkdown(this.text, innerWidth);
    for (const ml of mdLines) {
      const padded = ' '.repeat(this.paddingX) + ml;
      lines.push(this.bgFn ? this.bgFn(padToWidth(padded, width)) : padded);
    }

    for (let i = 0; i < this.paddingY; i++) lines.push('');

    this._cache = lines;
    this._cacheWidth = width;
    return lines;
  }
}

// ─── Spacer ───────────────────────────────────────────────────────────────────

export class Spacer {
  constructor(lines = 1) {
    this.lines = lines;
  }
  render(_width) {
    return Array(this.lines).fill('');
  }
}

// ─── Divider ──────────────────────────────────────────────────────────────────

export class Divider {
  constructor(char = '─', colorFn = (s) => chalk.dim(s)) {
    this.char = char;
    this.colorFn = colorFn;
  }
  render(width) {
    return [this.colorFn(this.char.repeat(width))];
  }
}

// ─── StatusBar ────────────────────────────────────────────────────────────────

export class StatusBar {
  constructor(leftFn, rightFn = null) {
    this.leftFn = leftFn;
    this.rightFn = rightFn;
  }
  render(width) {
    const left = this.leftFn(width);
    const right = this.rightFn ? this.rightFn(width) : '';
    const gap = width - visibleWidth(left) - visibleWidth(right);
    return [left + ' '.repeat(Math.max(0, gap)) + right];
  }
}

// ─── Loader ───────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Loader {
  constructor(tui, spinnerColorFn = (s) => chalk.cyan(s), msgColorFn = (s) => chalk.dim(s), message = 'Loading...') {
    this.tui = tui;
    this.spinnerColorFn = spinnerColorFn;
    this.msgColorFn = msgColorFn;
    this.message = message;
    this._frame = 0;
    this._interval = null;
    this._running = false;
  }

  setMessage(msg) {
    this.message = msg;
    this.tui?.requestRender();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._interval = setInterval(() => {
      this._frame = (this._frame + 1) % SPINNER_FRAMES.length;
      this.tui?.requestRender();
    }, 80);
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    clearInterval(this._interval);
    this._interval = null;
  }

  render(width) {
    const spinner = this.spinnerColorFn(SPINNER_FRAMES[this._frame]);
    const msg = this.msgColorFn(this.message);
    return [truncateToWidth(` ${spinner} ${msg}`, width)];
  }
}

// ─── SelectList ───────────────────────────────────────────────────────────────

export class SelectList {
  constructor(items = [], maxVisible = 8, theme = {}) {
    this.items = items;
    this.maxVisible = maxVisible;
    this.theme = {
      selectedPrefix: (s) => chalk.cyan(s),
      selectedText:   (s) => chalk.bold(s),
      description:    (s) => chalk.dim(s),
      scrollInfo:     (s) => chalk.dim(s),
      noMatch:        (s) => chalk.dim(s),
      ...theme,
    };
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.filter = '';
    this.onSelect = null;
    this.onCancel = null;
    this.onSelectionChange = null;
  }

  get filteredItems() {
    if (!this.filter) return this.items;
    const f = this.filter.toLowerCase();
    return this.items.filter(i => i.label.toLowerCase().includes(f) || i.value.toLowerCase().includes(f));
  }

  setFilter(f) {
    this.filter = f;
    this.selectedIndex = 0;
    this.scrollOffset = 0;
  }

  handleInput(data) {
    const items = this.filteredItems;
    if (data === '\x1b[A') { // up
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this._clampScroll();
      this.onSelectionChange?.(items[this.selectedIndex]);
    } else if (data === '\x1b[B') { // down
      this.selectedIndex = Math.min(items.length - 1, this.selectedIndex + 1);
      this._clampScroll();
      this.onSelectionChange?.(items[this.selectedIndex]);
    } else if (data === '\r') {
      if (items[this.selectedIndex]) this.onSelect?.(items[this.selectedIndex]);
    } else if (data === '\x1b') {
      this.onCancel?.();
    }
  }

  _clampScroll() {
    if (this.selectedIndex < this.scrollOffset) this.scrollOffset = this.selectedIndex;
    if (this.selectedIndex >= this.scrollOffset + this.maxVisible) {
      this.scrollOffset = this.selectedIndex - this.maxVisible + 1;
    }
  }

  render(width) {
    const items = this.filteredItems;
    if (items.length === 0) {
      return [this.theme.noMatch('  (no matches)')];
    }

    const visible = items.slice(this.scrollOffset, this.scrollOffset + this.maxVisible);
    const lines = visible.map((item, i) => {
      const idx = i + this.scrollOffset;
      const isSelected = idx === this.selectedIndex;
      const prefix = isSelected ? this.theme.selectedPrefix('❯ ') : '  ';
      const label = isSelected ? this.theme.selectedText(item.label) : item.label;
      const desc = item.description ? '  ' + this.theme.description(item.description) : '';
      return truncateToWidth(prefix + label + desc, width);
    });

    if (items.length > this.maxVisible) {
      const info = `${this.scrollOffset + 1}-${Math.min(this.scrollOffset + this.maxVisible, items.length)}/${items.length}`;
      lines.push(this.theme.scrollInfo(`  ${info}`));
    }

    return lines;
  }
}
