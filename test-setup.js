#!/usr/bin/env node
/**
 * test-setup.js — Verify Gemma Agent installation
 * Run this to check if everything is set up correctly
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log(chalk.cyan.bold('\n🔍 Gemma Agent Setup Verification\n'));

let allGood = true;

// Check Node version
console.log(chalk.white('Checking Node.js version...'));
const nodeVersion = process.version;
const major = parseInt(nodeVersion.slice(1).split('.')[0]);
if (major >= 18) {
  console.log(chalk.green(`  ✓ Node.js ${nodeVersion} (>= 18.0.0 required)`));
} else {
  console.log(chalk.red(`  ✗ Node.js ${nodeVersion} (>= 18.0.0 required)`));
  allGood = false;
}

// Check required files
console.log(chalk.white('\nChecking required files...'));
const requiredFiles = [
  'package.json',
  'src/cli.js',
  'src/agent.js',
  'src/gemini.js',
  'src/tools.js',
  'src/config.js',
  'src/memory.js',
  'src/tasks.js',
  'src/session.js',
  'src/brainstorm.js',
  'src/telegram.js',
  'src/diff.js',
];

for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    console.log(chalk.green(`  ✓ ${file}`));
  } else {
    console.log(chalk.red(`  ✗ ${file} (missing)`));
    allGood = false;
  }
}

// Check dependencies
console.log(chalk.white('\nChecking dependencies...'));
const requiredDeps = [
  '@google/generative-ai',
  'chalk',
  'commander',
  'glob',
  'node-fetch',
  'node-telegram-bot-api',
  'diff',
  'marked',
  'marked-terminal',
  'ora',
  'boxen',
  'figures',
  'strip-ansi',
];

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const installedDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

for (const dep of requiredDeps) {
  if (installedDeps[dep]) {
    console.log(chalk.green(`  ✓ ${dep}`));
  } else {
    console.log(chalk.red(`  ✗ ${dep} (not installed)`));
    allGood = false;
  }
}

// Check API key
console.log(chalk.white('\nChecking API key...'));
if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
  console.log(chalk.green('  ✓ GEMINI_API_KEY is set'));
} else {
  console.log(chalk.yellow('  ⚠ GEMINI_API_KEY not set (required to run)'));
  console.log(chalk.gray('    Set it with: export GEMINI_API_KEY=your_key'));
}

// Check directories
console.log(chalk.white('\nChecking directories...'));
const homeDir = process.env.HOME || process.env.USERPROFILE;
const configDir = path.join(homeDir, '.gemma-agent');
if (fs.existsSync(configDir)) {
  console.log(chalk.green(`  ✓ Config directory exists: ${configDir}`));
} else {
  console.log(chalk.yellow(`  ⚠ Config directory will be created on first run: ${configDir}`));
}

// Test imports
console.log(chalk.white('\nTesting module imports...'));
try {
  await import('./src/config.js');
  console.log(chalk.green('  ✓ config.js'));
} catch (err) {
  console.log(chalk.red(`  ✗ config.js: ${err.message}`));
  allGood = false;
}

try {
  await import('./src/tools.js');
  console.log(chalk.green('  ✓ tools.js'));
} catch (err) {
  console.log(chalk.red(`  ✗ tools.js: ${err.message}`));
  allGood = false;
}

try {
  await import('./src/gemini.js');
  console.log(chalk.green('  ✓ gemini.js'));
} catch (err) {
  console.log(chalk.red(`  ✗ gemini.js: ${err.message}`));
  allGood = false;
}

try {
  await import('./src/agent.js');
  console.log(chalk.green('  ✓ agent.js'));
} catch (err) {
  console.log(chalk.red(`  ✗ agent.js: ${err.message}`));
  allGood = false;
}

// Summary
console.log(chalk.white('\n' + '─'.repeat(50)));
if (allGood) {
  console.log(chalk.green.bold('\n✅ All checks passed! Gemma Agent is ready to use.\n'));
  console.log(chalk.white('To start:'));
  console.log(chalk.cyan('  npm start\n'));
} else {
  console.log(chalk.red.bold('\n❌ Some checks failed. Please fix the issues above.\n'));
  console.log(chalk.white('To install dependencies:'));
  console.log(chalk.cyan('  npm install\n'));
}

console.log(chalk.gray('For help, see: README.md or QUICKSTART.md\n'));
