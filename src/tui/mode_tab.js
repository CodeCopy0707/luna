/**
 * mode_tab.js — Plan/Act mode tab switcher component
 * Click or Tab key cycles between PLAN and ACT modes.
 * Renders as a tab bar above the editor.
 */

import chalk from 'chalk';
import { truncateToWidth, visibleWidth } from './utils.js';

export const MODES = {
  PLAN: 'plan',
  ACT:  'act',
};

export class ModeTab {
  constructor(onModeChange) {
    this.mode = MODES.PLAN;
    this.onModeChange = onModeChange;
    this.focused = false;
    this._planStartX = 0;  // Start position of PLAN tab for click detection
    this._actStartX = 0;   // Start position of ACT tab for click detection
    this._tabWidth = 10;   // Approximate width of each tab
  }

  toggle() {
    this.mode = this.mode === MODES.PLAN ? MODES.ACT : MODES.PLAN;
    this.onModeChange?.(this.mode);
  }

  setMode(mode) {
    if (mode === MODES.PLAN || mode === MODES.ACT) {
      this.mode = mode;
      this.onModeChange?.(this.mode);
    }
  }

  isPlan() { return this.mode === MODES.PLAN; }
  isAct()  { return this.mode === MODES.ACT;  }

  /**
   * Handle click events on the mode tabs
   * @param {number} x - Click X position (0-indexed from left)
   * @returns {boolean} - True if click was handled
   */
  handleClick(x) {
    // Check if click is within PLAN tab range
    if (x >= this._planStartX && x < this._planStartX + this._tabWidth) {
      if (this.mode !== MODES.PLAN) {
        this.setMode(MODES.PLAN);
        return true;
      }
    }
    // Check if click is within ACT tab range
    else if (x >= this._actStartX && x < this._actStartX + this._tabWidth) {
      if (this.mode !== MODES.ACT) {
        this.setMode(MODES.ACT);
        return true;
      }
    }
    return false;
  }

  handleInput(data) {
    // Handle Tab key to switch modes
    if (data === '\t' || data === '\x1b[Z') {
      this.toggle();
    }
  }

  render(width) {
    const planActive = this.mode === MODES.PLAN;
    const actActive  = this.mode === MODES.ACT;

    const planTab = planActive
      ? chalk.bgCyan.black.bold(' 📋 PLAN ')
      : chalk.dim(' 📋 PLAN ');

    const actTab = actActive
      ? chalk.bgGreen.black.bold(' ⚡ ACT ')
      : chalk.dim(' ⚡ ACT ');

    const sep = chalk.dim(' │ ');
    const hint = chalk.dim('  Tab/Click: switch mode');

    const modeDesc = planActive
      ? chalk.cyan('  Research & plan — no code changes')
      : chalk.green('  Execute & implement — full access');

    // Calculate positions for click detection
    this._planStartX = 0;
    this._actStartX = visibleWidth(planTab + sep);

    const left = planTab + sep + actTab + modeDesc;
    const right = hint;
    const gap = Math.max(0, width - visibleWidth(left) - visibleWidth(right));

    return [left + ' '.repeat(gap) + right];
  }
}
