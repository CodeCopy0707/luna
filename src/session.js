/**
 * session.js — Session persistence (save/load/resume)
 * Saves conversations to ~/.gemma-agent/sessions/
 */

import fs from 'fs';
import path from 'path';
import { CONFIG_DIR_PATH } from './config.js';

const SESSIONS_DIR = path.join(CONFIG_DIR_PATH, 'sessions');
const DAILY_DIR = path.join(SESSIONS_DIR, 'daily');
const LATEST_FILE = path.join(SESSIONS_DIR, 'session_latest.json');
const HISTORY_FILE = path.join(SESSIONS_DIR, 'history.json');

function ensureDirs() {
  for (const dir of [SESSIONS_DIR, DAILY_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function generateSessionId() {
  return Math.random().toString(36).slice(2, 10);
}

function getTodayDir() {
  const today = new Date().toISOString().slice(0, 10);
  const dir = path.join(DAILY_DIR, today);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveSession(messages, name = null, dailyLimit = 5) {
  ensureDirs();
  const sessionId = generateSessionId();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = name ? `${name}.json` : `session_${timestamp}_${sessionId}.json`;
  
  const sessionData = {
    session_id: sessionId,
    saved_at: new Date().toISOString(),
    turn_count: messages.filter(m => m.role === 'user').length,
    messages,
  };
  
  // Save to daily dir
  const todayDir = getTodayDir();
  const dailyPath = path.join(todayDir, fileName);
  fs.writeFileSync(dailyPath, JSON.stringify(sessionData, null, 2), 'utf8');
  
  // Save as latest
  fs.writeFileSync(LATEST_FILE, JSON.stringify(sessionData, null, 2), 'utf8');
  
  // Append to history
  let history = { total_turns: 0, sessions: [] };
  if (fs.existsSync(HISTORY_FILE)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch {}
  }
  history.sessions.unshift({ ...sessionData });
  history.total_turns = history.sessions.reduce((s, sess) => s + (sess.turn_count || 0), 0);
  
  // Cap history
  if (history.sessions.length > 100) history.sessions = history.sessions.slice(0, 100);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  
  // Cap daily files
  const dailyFiles = fs.readdirSync(todayDir).filter(f => f.endsWith('.json'));
  if (dailyFiles.length > dailyLimit) {
    const sorted = dailyFiles.sort();
    for (const old of sorted.slice(0, dailyFiles.length - dailyLimit)) {
      fs.unlinkSync(path.join(todayDir, old));
    }
  }
  
  return { path: dailyPath, session_id: sessionId };
}

export function loadSession(filePath) {
  let resolved = filePath;
  if (!path.isAbsolute(filePath)) {
    // Try sessions dir
    const inSessions = path.join(SESSIONS_DIR, filePath);
    if (fs.existsSync(inSessions)) resolved = inSessions;
    else {
      // Search daily dirs
      for (const day of fs.readdirSync(DAILY_DIR)) {
        const candidate = path.join(DAILY_DIR, day, filePath);
        if (fs.existsSync(candidate)) { resolved = candidate; break; }
      }
    }
  }
  
  if (!fs.existsSync(resolved)) return { error: `Session file not found: ${filePath}` };
  
  try {
    const data = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    return data;
  } catch (err) {
    return { error: `Failed to load session: ${err.message}` };
  }
}

export function loadLatestSession() {
  if (!fs.existsSync(LATEST_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(LATEST_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function listSessions() {
  ensureDirs();
  const result = [];
  
  if (!fs.existsSync(DAILY_DIR)) return result;
  
  const days = fs.readdirSync(DAILY_DIR).sort().reverse();
  for (const day of days) {
    const dayDir = path.join(DAILY_DIR, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.json')).sort().reverse();
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dayDir, file), 'utf8'));
        result.push({
          date: day,
          file,
          path: path.join(dayDir, file),
          session_id: data.session_id,
          saved_at: data.saved_at,
          turn_count: data.turn_count,
        });
      } catch {}
    }
  }
  
  return result;
}
