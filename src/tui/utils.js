/**
 * utils.js — ANSI-aware string utilities
 * visibleWidth, truncateToWidth, wrapTextWithAnsi, stripAnsi
 */

// Matches all ANSI escape sequences
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)/g;

export function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

/** Visible character width ignoring ANSI codes */
export function visibleWidth(str) {
  if (!str) return 0;
  return stripAnsi(str).length;
}

/**
 * Truncate `str` to `maxWidth` visible chars, preserving ANSI codes.
 * Appends `ellipsis` (default '…') if truncated.
 */
export function truncateToWidth(str, maxWidth, ellipsis = '…') {
  if (!str) return '';
  if (maxWidth <= 0) return '';
  const ellipsisLen = visibleWidth(ellipsis);
  if (visibleWidth(str) <= maxWidth) return str;

  const target = Math.max(0, maxWidth - ellipsisLen);
  let visible = 0;
  let result = '';
  let i = 0;

  while (i < str.length) {
    // Check for ANSI escape
    const ansiMatch = str.slice(i).match(/^\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)/);
    if (ansiMatch) {
      result += ansiMatch[0];
      i += ansiMatch[0].length;
      continue;
    }
    if (visible >= target) break;
    result += str[i];
    visible++;
    i++;
  }

  return result + '\x1b[0m' + ellipsis;
}

/**
 * Wrap `str` to `maxWidth` visible chars per line, preserving ANSI codes.
 * Returns array of lines. Safe against zero/negative maxWidth.
 */
export function wrapTextWithAnsi(str, maxWidth) {
  if (!str) return [''];
  // Guard: if maxWidth is too small just return the string as-is
  if (maxWidth <= 4) return [str];

  const inputLines = str.split('\n');
  const result = [];

  for (const inputLine of inputLines) {
    if (visibleWidth(inputLine) <= maxWidth) {
      result.push(inputLine);
      continue;
    }

    // Word-wrap
    const words = inputLine.split(' ');
    let current = '';
    let currentWidth = 0;

    for (const word of words) {
      const wordWidth = visibleWidth(word);
      if (currentWidth === 0) {
        current = word;
        currentWidth = wordWidth;
      } else if (currentWidth + 1 + wordWidth <= maxWidth) {
        current += ' ' + word;
        currentWidth += 1 + wordWidth;
      } else {
        result.push(current);
        current = word;
        currentWidth = wordWidth;
      }
    }
    if (current) result.push(current);
  }

  return result.length > 0 ? result : [''];
}

/** Pad a string to exactly `width` visible chars */
export function padToWidth(str, width) {
  if (!str) str = '';
  const vw = visibleWidth(str);
  if (vw >= width) return str;
  return str + ' '.repeat(width - vw);
}

/** Key matching helpers */
export const Key = {
  enter:     '\r',
  escape:    '\x1b',
  tab:       '\t',
  backspace: '\x7f',
  delete:    '\x1b[3~',
  up:        '\x1b[A',
  down:      '\x1b[B',
  right:     '\x1b[C',
  left:      '\x1b[D',
  home:      '\x1b[H',
  end:       '\x1b[F',
  pageUp:    '\x1b[5~',
  pageDown:  '\x1b[6~',
  ctrl:  (c) => String.fromCharCode(c.charCodeAt(0) - 96),
  alt:   (c) => `\x1b${c}`,
  shift: (c) => c.toUpperCase(),
};

export function matchesKey(data, key) {
  return data === key;
}
