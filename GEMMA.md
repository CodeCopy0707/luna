# Gemma Agent — Project Context

## About
Gemma Agent is a powerful CLI coding assistant powered by Google Gemini AI. It combines the best features from ClawSpring, Codebuff, Claude Code, and OpenClaw.

## Architecture

### Core Components
- **Agent Loop** (`agent.js`) — Streaming chat, tool dispatch, multi-turn conversations
- **Gemini Provider** (`gemini.js`) — Google Generative AI integration with function calling
- **Tool System** (`tools.js`) — 15+ built-in tools with permission system
- **REPL** (`cli.js`) — Interactive terminal with 15+ slash commands

### Multi-Agent System
Inspired by Codebuff's architecture:
- **File Picker Agent** — Scans codebase to identify relevant files
- **Planner Agent** — Creates detailed implementation plans
- **Editor Agent** — Implements code changes precisely
- **Reviewer Agent** — Reviews for correctness, security, best practices
- **Researcher Agent** — Searches documentation and examples
- **Tester Agent** — Writes and runs tests

### Key Features
1. **Brainstorm Mode** — Multi-persona AI debates (ClawSpring-inspired)
2. **Worker Mode** — Auto-implements TODO tasks
3. **Telegram Gateway** — Control from phone (OpenClaw-inspired)
4. **Memory System** — Persistent user preferences and project decisions
5. **Task Management** — Track multi-step work with dependencies
6. **Session Management** — Auto-save, resume, load conversations

## Tech Stack
- **Runtime**: Node.js 18+
- **AI**: Google Generative AI SDK (@google/generative-ai)
- **CLI**: chalk, boxen, ora, readline
- **Utilities**: glob, diff, node-telegram-bot-api

## Conventions
- Use ESM imports (type: "module" in package.json)
- Async/await for all async operations
- Chalk for colored terminal output
- Tool registry pattern for extensibility
- Permission callback system for safety

## File Organization
```
src/
├── cli.js          # Main entry point, REPL, slash commands
├── agent.js        # Agent loop, multi-agent orchestrator
├── gemini.js       # Gemini AI provider
├── tools.js        # Tool registry + built-in tools
├── config.js       # Configuration management
├── memory.js       # Persistent memory system
├── tasks.js        # Task management
├── session.js      # Session persistence
├── brainstorm.js   # Multi-persona brainstorm
├── telegram.js     # Telegram bot bridge
└── diff.js         # Git-style diff rendering
```

## Important Notes
- Always check for GEMINI_API_KEY before starting
- Permission system has 3 modes: auto, accept-all, manual
- Sessions auto-save to ~/.gemma-agent/sessions/
- Memories stored in ~/.gemma-agent/memory/
- Brainstorm outputs go to ./brainstorm_outputs/
- Tool results should include diffs when modifying files
- Telegram bridge requires node-telegram-bot-api

## Development Guidelines
- Keep tool execute functions async
- Use chalk for all colored output
- Emit progress events in long-running operations
- Handle errors gracefully with try/catch
- Validate API keys before making requests
- Use ora spinners for long operations
- Format diffs with git-style +/- lines
