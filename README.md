# Gemma Agent 🤖

A powerful CLI coding agent powered by **Google Gemini AI** — inspired by ClawSpring, Codebuff, Claude Code, and OpenClaw.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

## ✨ Features

### 🎯 Core Capabilities
- **Multi-Agent Architecture** — File Picker, Planner, Editor, Reviewer agents work together (like Codebuff)
- **Interactive REPL** — Slash commands, session management, real-time streaming (like ClawSpring)
- **Telegram Gateway** — Control the agent from your phone via Telegram Bot (like OpenClaw)
- **Brainstorm Mode** — Multi-persona AI debates with auto-generated TODO lists
- **Worker Mode** — Auto-implements pending tasks from brainstorm outputs
- **Task Management** — Track multi-step work with dependency edges
- **Persistent Memory** — Remember user preferences, project decisions, feedback across sessions
- **Session Management** — Auto-save, resume, load previous conversations

### 🛠️ Built-in Tools
- **File Operations**: `read_file`, `write_file`, `edit_file` (with git-style diffs)
- **Shell**: `bash` (run commands, tests, git operations)
- **Search**: `glob`, `grep` (find files and search code)
- **Web**: `web_fetch`, `web_search` (documentation lookups)
- **Directory**: `list_dir` (explore project structure)
- **Interactive**: `ask_user` (pause and ask clarifying questions)
- **Memory**: `memory_save`, `memory_search`, `memory_list`, `memory_delete`
- **Tasks**: `task_create`, `task_update`, `task_list`, `task_get`

### 🎨 User Experience
- **Git-style Diffs** — See exactly what changed in files
- **Permission System** — Auto, accept-all, or manual approval modes
- **Colored Output** — Beautiful terminal UI with chalk and boxen
- **Streaming Responses** — Real-time text generation
- **Cost Tracking** — Monitor token usage and estimated costs

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/gemma-agent
cd gemma-agent

# Install dependencies
npm install

# Set your Gemini API key
export GEMINI_API_KEY=your_api_key_here

# Start the agent
npm start
```

### Get Your Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click "Create API Key"
3. Copy your key and export it:

```bash
export GEMINI_API_KEY=AIza...
```

Or set it in the REPL:

```bash
gemma /config gemini_api_key=AIza...
```

## 📖 Usage

### Basic Chat

```bash
[myproject] ❯ explain how async/await works in JavaScript

╭─ Gemma ● ─────────────────────────
│
Async/await is syntactic sugar over Promises...
[detailed explanation streams here]
╰───────────────────────────────────
```

### File Operations

```bash
[myproject] ❯ read the package.json file and add a new script called "dev"

⚙  read_file({"file_path":"package.json"})
  ✓
⚙  edit_file({"file_path":"package.json",...})
  ✓

--- a/package.json
+++ b/package.json
@@ -5,6 +5,7 @@
   "scripts": {
     "start": "node src/index.js",
+    "dev": "node --watch src/index.js",
     "test": "jest"
   }
```

### Slash Commands

```bash
/help                          # Show all commands
/model                         # List available models
/model gemini-2.5-pro-preview  # Switch model
/config                        # Show configuration
/save my-session               # Save session
/load my-session               # Load session
/resume                        # Resume last session
/cost                          # Show token usage
/memory                        # List memories
/tasks                         # List tasks
/brainstorm [topic]            # Multi-persona brainstorm
/worker                        # Auto-implement TODO tasks
/telegram <token> <chat_id>    # Start Telegram bridge
/multi <task>                  # Run multi-agent pipeline
/clear                         # Clear history
/exit                          # Exit
```

## 🧠 Brainstorm Mode

Run a multi-persona AI debate to explore ideas:

```bash
[myproject] ❯ /brainstorm improve authentication system

🧠 Generating expert personas...
✓ 5 experts assembled

🏗️ Software Architect is thinking...
  └─ Perspective captured.
🛡️ Security Engineer is thinking...
  └─ Perspective captured.
⚡ Performance Specialist is thinking...
  └─ Perspective captured.
💡 Product Innovator is thinking...
  └─ Perspective captured.
🔧 Code Quality Lead is thinking...
  └─ Perspective captured.

📝 Synthesizing Master Plan...

✓ Brainstorm complete!
  Output: brainstorm_outputs/brainstorm_20260415_210530.md
  TODO:   brainstorm_outputs/todo_list.txt
```

Then auto-implement the tasks:

```bash
[myproject] ❯ /worker

👷 Worker starting — 3 task(s) to implement

── Worker (1/3): Add JWT token refresh mechanism ──
[agent reads code, implements changes, verifies]
✓ Task 1 completed

── Worker (2/3): Implement rate limiting on login endpoint ──
[agent implements]
✓ Task 2 completed

✓ Worker finished
```

## 📱 Telegram Gateway

Control Gemma from your phone:

### Setup

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Get your chat ID from `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. Configure Gemma:

```bash
[myproject] ❯ /telegram YOUR_BOT_TOKEN YOUR_CHAT_ID

✓ Telegram bridge started. Authorized chat: 123456789
```

### Usage

Send messages to your bot:

```
You (Telegram): List all Python files in src/

Bot: Found 5 Python files:
- src/main.py
- src/utils.py
- src/config.py
...
```

Slash commands work too:

```
You: /cost
Bot: 💰 Token Usage:
Input: 1,234
Output: 567
Est. cost: $0.0023 USD
```

## 🤖 Multi-Agent Pipeline

Run specialized agents in sequence (like Codebuff):

```bash
[myproject] ❯ /multi add authentication to the API

🤖 Multi-Agent Pipeline Mode

🔍 File Picker Agent scanning codebase...
📋 Planner Agent creating implementation plan...
✏️  Editor Agent implementing changes...
🔎 Reviewer Agent validating changes...

✓ Pipeline complete!

── Review ──
The implementation looks solid. JWT tokens are properly
validated, passwords are hashed with bcrypt, and rate
limiting is in place. One suggestion: add refresh token
rotation for better security.
```

## 💾 Memory System

Save important information across sessions:

```bash
# Agent automatically saves memories
[myproject] ❯ remember that I prefer 4-space indentation

⚙  memory_save({"name":"coding_style",...})
  ✓ Memory saved: coding_style [feedback/user]

# Search memories
[myproject] ❯ /memory python

Found 1 memory:
  [feedback/user] coding_style
    Prefer 4-space indentation and type hints in Python
```

## 📊 Task Management

Track complex work:

```bash
[myproject] ❯ create three tasks: design auth schema, implement login, write tests

⚙  task_create({"subject":"Design auth schema"})
  ✓ #1 created
⚙  task_create({"subject":"Implement login endpoint"})
  ✓ #2 created
⚙  task_create({"subject":"Write tests"})
  ✓ #3 created
⚙  task_update({"task_id":"2","add_blocked_by":["1"]})
  ✓ #2 updated
⚙  task_update({"task_id":"3","add_blocked_by":["2"]})
  ✓ #3 updated

[myproject] ❯ /tasks

Tasks:
  #1 ○ Design auth schema
  #2 ○ Implement login endpoint [blocked by: 1]
  #3 ○ Write tests [blocked by: 2]
```

## 🎛️ Configuration

### Permission Modes

- **auto** (default) — Prompts for writes/commands, auto-approves reads
- **accept-all** — Never prompts, runs everything
- **manual** — Prompts for every operation

```bash
[myproject] ❯ /config permission_mode=accept-all
✓ permission_mode = accept-all
```

### Available Models

```bash
[myproject] ❯ /model

Current model: gemma-4-26b-a4b-it

Available models:
  gemini-2.5-pro-preview-05-06 — Gemini 2.5 Pro (1M) Most capable
  gemma-4-26b-a4b-it             — Gemini 2.0 Flash (1M) Fast, recommended
  gemma-4-26b-a4b-it-lite        — Gemini 2.0 Flash Lite (1M) Fastest, cheapest
  gemini-1.5-pro               — Gemini 1.5 Pro (2M) Largest context
  gemini-1.5-flash             — Gemini 1.5 Flash (1M) Balanced
```

## 📁 Project Structure

```
gemma-agent/
├── src/
│   ├── cli.js          # Main REPL with slash commands
│   ├── agent.js        # Core agent loop + multi-agent orchestrator
│   ├── gemini.js       # Google Gemini AI provider
│   ├── tools.js        # All built-in tools + registry
│   ├── config.js       # Configuration management
│   ├── memory.js       # Persistent memory system
│   ├── tasks.js        # Task management
│   ├── session.js      # Session save/load/resume
│   ├── brainstorm.js   # Multi-persona brainstorm mode
│   ├── telegram.js     # Telegram bot bridge
│   └── diff.js         # Git-style diff rendering
├── package.json
└── README.md
```

## 🔧 Advanced Usage

### Project Context

Create a `GEMMA.md` or `CLAUDE.md` file in your project root:

```markdown
# My Project

## Stack
- Node.js 18+, Express, PostgreSQL
- Tests: Jest

## Conventions
- Use ESM imports
- Format with Prettier
- Full JSDoc comments required

## Important
- Never commit .env files
- Run tests before committing
```

Gemma will automatically inject this context into every conversation.

### Session Management

Sessions are auto-saved to `~/.gemma-agent/sessions/`:

```
~/.gemma-agent/sessions/
├── session_latest.json          # Most recent (/resume)
├── history.json                 # All sessions
└── daily/
    └── 2026-04-15/
        ├── session_210530_a3f9.json
        └── session_183022_b7c1.json
```

## 🆚 Comparison

| Feature | Gemma Agent | ClawSpring | Codebuff | Claude Code |
|---------|-------------|------------|----------|-------------|
| **Language** | JavaScript | Python | TypeScript | TypeScript |
| **AI Provider** | Google Gemini | Any (Anthropic, OpenAI, Ollama) | OpenRouter | Anthropic only |
| **Multi-Agent** | ✅ Yes | ❌ No | ✅ Yes | ❌ No |
| **Telegram Gateway** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Brainstorm Mode** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Worker Mode** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Memory System** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **Task Management** | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| **Open Source** | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License — see LICENSE file for details

## 🙏 Acknowledgments

Inspired by:
- **ClawSpring** — Multi-persona brainstorm, worker mode, Telegram bridge
- **Codebuff** — Multi-agent architecture (File Picker → Planner → Editor → Reviewer)
- **Claude Code** — Tool system, permission handling, session management
- **OpenClaw** — Telegram gateway concept

## 📞 Support

- Issues: [GitHub Issues](https://github.com/yourusername/gemma-agent/issues)
- Discussions: [GitHub Discussions](https://github.com/yourusername/gemma-agent/discussions)

---

**Built with ❤️ using Google Gemini AI**
