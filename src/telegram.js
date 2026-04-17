/**
 * telegram.js — Telegram Bot Bridge
 * Connects Telegram to the Gemma agent
 * Inspired by ClawSpring's Telegram bridge
 */

import chalk from 'chalk';
import { getConfig, setConfig } from './config.js';

let _bot = null;
let _agent = null;
let _isRunning = false;
let _authorizedChatId = null;
let _typingInterval = null;

export function isTelegramRunning() {
  return _isRunning;
}

export async function startTelegramBridge(token, chatId, agent, { onLog } = {}) {
  if (_isRunning) {
    onLog?.('Telegram bridge is already running.');
    return;
  }
  
  // Force stop any phantom instance
  if (_bot) {
    try {
      await _bot.stopPolling();
      await new Promise(r => setTimeout(r, 1000)); // Wait for Telegram to acknowledge
    } catch (e) {}
  }

  try {
    const { default: TelegramBot } = await import('node-telegram-bot-api');
    
    _bot = new TelegramBot(token, { polling: true });
    _agent = agent;
    _authorizedChatId = String(chatId);
    _isRunning = true;
    
    // Save config
    setConfig('telegram_token', token);
    setConfig('telegram_chat_id', String(chatId));
    setConfig('telegram_auto_start', true);
    
    onLog?.(chalk.green(`✓ Telegram bridge started. Authorized chat: ${chatId}`));
    
    _bot.on('message', async (msg) => {
      // ... same message logic ...
      const fromChatId = String(msg.chat.id);
      
      if (fromChatId !== _authorizedChatId) {
        _bot.sendMessage(fromChatId, '⛔ Unauthorized.');
        return;
      }
      
      const text = msg.text || '';
      onLog?.(chalk.cyan(`📩 Telegram: ${text}`));
      
      // Handle stop commands
      if (text === '/stop' || text === '/off') {
        await stopTelegramBridge();
        _bot.sendMessage(fromChatId, '✓ Gemma bridge stopped.');
        return;
      }
      
      // Start typing indicator
      _typingInterval = setInterval(() => {
        _bot.sendChatAction(fromChatId, 'typing').catch(() => {});
      }, 4000);
      _bot.sendChatAction(fromChatId, 'typing').catch(() => {});
      
      try {
        let responseText = '';
        
        // Check if it's a slash command
        if (text.startsWith('/') && !text.startsWith('/start')) {
          // Pass through to agent as a command hint
          const result = await _agent.run(`Execute this command: ${text}`);
          responseText = result.text || '(no response)';
        } else {
          const result = await _agent.run(text);
          responseText = result.text || '(no response)';
        }
        
        clearInterval(_typingInterval);
        
        // Telegram has 4096 char limit per message
        if (responseText.length > 4000) {
          const chunks = responseText.match(/.{1,4000}/gs) || [];
          for (const chunk of chunks) {
            await _bot.sendMessage(fromChatId, chunk, { parse_mode: 'Markdown' }).catch(() => {
              _bot.sendMessage(fromChatId, chunk); // fallback without markdown
            });
          }
        } else {
          await _bot.sendMessage(fromChatId, responseText, { parse_mode: 'Markdown' }).catch(() => {
            _bot.sendMessage(fromChatId, responseText);
          });
        }
      } catch (err) {
        clearInterval(_typingInterval);
        _bot.sendMessage(fromChatId, `❌ Error: ${err.message}`);
        onLog?.(chalk.red(`Telegram error: ${err.message}`));
      }
    });
    
    _bot.on('polling_error', (err) => {
      onLog?.(chalk.red(`Telegram polling error: ${err.message}`));
    });
    
  } catch (err) {
    _isRunning = false;
    throw new Error(`Failed to start Telegram bridge: ${err.message}`);
  }
}

export async function stopTelegramBridge() {
  if (!_isRunning || !_bot) return;
  clearInterval(_typingInterval);
  await _bot.stopPolling();
  _bot = null;
  _isRunning = false;
  setConfig('telegram_auto_start', false);
}

export function getTelegramStatus() {
  const cfg = getConfig();
  return {
    running: _isRunning,
    chat_id: _authorizedChatId || cfg.telegram_chat_id,
    configured: !!(cfg.telegram_token && cfg.telegram_chat_id),
  };
}
