/**
 * mode_tab.js — Mode switcher component
 */

import chalk from 'chalk';

export const MODES = {
  PLAN: 'plan',
  ACT: 'act',
  GOD: 'god',
  GENERAL: 'general'
};

export class ModeTab {
  constructor(onChange) {
    this.modes = [MODES.PLAN, MODES.ACT, MODES.GENERAL, MODES.GOD];
    this.currentIdx = 0;
    this.onChange = onChange;
  }

  toggle() {
    this.currentIdx = (this.currentIdx + 1) % this.modes.length;
    if (this.onChange) this.onChange(this.modes[this.currentIdx]);
  }

  get currentMode() {
    return this.modes[this.currentIdx];
  }

  render(width) {
    const parts = this.modes.map((m, idx) => {
      const label = m.toUpperCase();
      if (idx === this.currentIdx) {
        let color = chalk.bgHex('#238636').white.bold;
        if (m === MODES.PLAN) color = chalk.bgHex('#1f6feb').white.bold;
        if (m === MODES.GOD) color = chalk.bgHex('#8957e5').white.bold;
        if (m === MODES.GENERAL) color = chalk.bgYellow.black.bold;
        return ` ${color(` ${label} `)} `;
      } else {
        return ` ${chalk.dim(label)} `;
      }
    });

    return ['  ' + parts.join(' │ ')];
  }
}
