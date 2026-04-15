/**
 * diff.js — Git-style colored diff rendering
 */

import { diffLines } from 'diff';
import chalk from 'chalk';

export function createDiff(oldContent, newContent, filePath = '') {
  const changes = diffLines(oldContent, newContent);
  const lines = [];
  
  if (filePath) {
    lines.push(chalk.bold(`--- a/${filePath}`));
    lines.push(chalk.bold(`+++ b/${filePath}`));
  }
  
  for (const part of changes) {
    if (part.added) {
      for (const line of part.value.split('\n').filter((_, i, a) => i < a.length - 1 || line !== '')) {
        lines.push(chalk.green(`+ ${line}`));
      }
    } else if (part.removed) {
      for (const line of part.value.split('\n').filter((_, i, a) => i < a.length - 1 || line !== '')) {
        lines.push(chalk.red(`- ${line}`));
      }
    }
  }
  
  return lines.join('\n');
}

export function renderDiff(diff) {
  if (!diff) return '';
  return diff;
}
