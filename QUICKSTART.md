# Gemma Agent — Quick Start Guide

## 🚀 Installation (5 minutes)

### Step 1: Clone and Install

```bash
git clone https://github.com/yourusername/gemma-agent
cd gemma-agent
npm install
```

### Step 2: Get Your Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click **"Create API Key"**
3. Copy your key (starts with `AIza...`)

### Step 3: Set Your API Key

**Option A: Environment Variable (Recommended)**

```bash
export GEMINI_API_KEY=AIza...your_key_here
```

Add to `~/.bashrc` or `~/.zshrc` to make it permanent:

```bash
echo 'export GEMINI_API_KEY=AIza...your_key_here' >> ~/.zshrc
source ~/.zshrc
```

**Option B: In the REPL**

```bash
npm start
# Then in the REPL:
/config gemini_api_key=AIza...your_key_here
```

### Step 4: Start Gemma

```bash
npm start
```

You should see:

```
╭──────────────────────────────────────────╮
│                                          │
│   Gemma Agent v1.0.0                     │
│   Powered by Google Gemini AI            │
│   ────────────────────────────────────   │
│   Model:       gemma-4-26b-a4b-it          │
│   Permissions: auto                      │
│   Type /help for commands, Ctrl+C to exit│
│                                          │
╰──────────────────────────────────────────╯

[myproject] ❯ 
```

## 📝 First Steps

### 1. Ask a Question

```bash
[myproject] ❯ explain how promises work in JavaScript
```

### 2. Read a File

```bash
[myproject] ❯ read package.json and explain what this project does
```

### 3. Edit a File

```bash
[myproject] ❯ add a new script called "dev" to package.json that runs "node --watch src/cli.js"
```

You'll see a git-style diff:

```diff
--- a/package.json
+++ b/package.json
@@ -5,6 +5,7 @@
   "scripts": {
     "start": "node src/cli.js",
+    "dev": "node --watch src/cli.js",
     "test": "jest"
   }
```

### 4. Run a Command

```bash
[myproject] ❯ run npm test and show me the results
```

### 5. Search Code

```bash
[myproject] ❯ find all files that import chalk
```

## 🎯 Common Use Cases

### Code Review

```bash
[myproject] ❯ review src/agent.js for potential bugs and improvements
```

### Add a Feature

```bash
[myproject] ❯ add error handling to all async functions in src/tools.js
```

### Write Tests

```bash
[myproject] ❯ write unit tests for the memory.js module
```

### Debug an Error

```bash
[myproject] ❯ I'm getting "TypeError: Cannot read property 'length' of undefined" in line 42 of agent.js. Help me fix it.
```

### Refactor Code

```bash
[myproject] ❯ refactor the handleCommand function in cli.js to use a command registry pattern
```

## 🧠 Advanced Features

### Brainstorm Mode

Generate ideas with multiple AI personas:

```bash
[myproject] ❯ /brainstorm improve error handling in the agent

🧠 Starting brainstorm: improve error handling in the agent

🏗️ Software Architect is thinking...
🛡️ Security Engineer is thinking...
⚡ Performance Specialist is thinking...
💡 Product Innovator is thinking...
🔧 Code Quality Lead is thinking...

✓ Brainstorm complete!
  Output: brainstorm_outputs/brainstorm_20260415_210530.md
  TODO:   brainstorm_outputs/todo_list.txt
```

### Worker Mode

Auto-implement the TODO list:

```bash
[myproject] ❯ /worker

👷 Worker starting — 5 task(s) to implement

── Worker (1/5): Add try-catch blocks to all tool execute functions ──
[implements]
✓ Task 1 completed

── Worker (2/5): Create custom error classes ──
[implements]
✓ Task 2 completed

...
```

### Multi-Agent Pipeline

Run specialized agents in sequence:

```bash
[myproject] ❯ /multi add authentication to the API

🔍 File Picker Agent scanning codebase...
📋 Planner Agent creating implementation plan...
✏️  Editor Agent implementing changes...
🔎 Reviewer Agent validating changes...

✓ Pipeline complete!
```

### Telegram Control

Control Gemma from your phone:

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Get your chat ID
3. Configure:

```bash
[myproject] ❯ /telegram YOUR_BOT_TOKEN YOUR_CHAT_ID
```

Now send messages to your bot from Telegram!

## 💡 Pro Tips

### 1. Use Project Context

Create a `GEMMA.md` file in your project root:

```markdown
# My Project

## Stack
- Node.js 18+, Express, PostgreSQL
- Tests: Jest, coverage target: 80%

## Conventions
- Use ESM imports
- Format with Prettier
- Full JSDoc comments required

## Important
- Never commit .env files
- Run tests before committing
- Use semantic commit messages
```

Gemma will automatically read this and follow your conventions!

### 2. Save Important Sessions

```bash
[myproject] ❯ /save auth-implementation
✓ Session saved: auth-implementation.json

# Later:
[myproject] ❯ /load auth-implementation
✓ Session loaded (42 messages)
```

### 3. Use Memory for Preferences

```bash
[myproject] ❯ remember that I prefer async/await over .then() chains

⚙  memory_save(...)
✓ Memory saved: async_preference [feedback/user]
```

Gemma will remember this across all future sessions!

### 4. Track Complex Work with Tasks

```bash
[myproject] ❯ create a task to implement user authentication

⚙  task_create({"subject":"Implement user authentication"})
✓ #1 created

[myproject] ❯ /tasks

Tasks:
  #1 ○ Implement user authentication
```

### 5. Check Costs

```bash
[myproject] ❯ /cost

💰 Token Usage:
  Input:  12,345
  Output: 3,456
  Est. cost: $0.0234 USD
```

## 🔧 Configuration

### Change Model

```bash
[myproject] ❯ /model gemini-2.5-pro-preview-05-06
✓ Model set to: gemini-2.5-pro-preview-05-06
```

### Permission Modes

```bash
# Auto (default) — prompts for writes, auto-approves reads
[myproject] ❯ /config permission_mode=auto

# Accept-all — never prompts
[myproject] ❯ /config permission_mode=accept-all

# Manual — prompts for everything
[myproject] ❯ /config permission_mode=manual
```

### View All Settings

```bash
[myproject] ❯ /config

Current configuration:
  model: gemma-4-26b-a4b-it
  gemini_api_key: ***
  permission_mode: auto
  verbose: false
  max_tokens: 8192
  ...
```

## 🆘 Troubleshooting

### "GEMINI_API_KEY not set"

```bash
export GEMINI_API_KEY=your_key_here
```

Or set it in the REPL:

```bash
/config gemini_api_key=your_key_here
```

### "Permission denied" errors

Switch to accept-all mode:

```bash
/config permission_mode=accept-all
```

### Telegram bridge not working

1. Check your token and chat ID
2. Make sure the bot is not already running elsewhere
3. Try stopping and restarting:

```bash
/telegram stop
/telegram YOUR_TOKEN YOUR_CHAT_ID
```

### Out of memory errors

Switch to a lighter model:

```bash
/model gemma-4-26b-a4b-it-lite
```

## 📚 Next Steps

- Read the full [README.md](README.md)
- Check out [GEMMA.md](GEMMA.md) for project context
- Explore the [src/](src/) directory to understand the architecture
- Join discussions on GitHub

## 🎉 You're Ready!

Start building with Gemma Agent. Happy coding! 🚀

---

**Need help?** Open an issue on [GitHub](https://github.com/yourusername/gemma-agent/issues)
