# Gemma Agent — Architecture Documentation

## 🏗️ System Overview

Gemma Agent is a CLI coding assistant that combines:
- **ClawSpring's** brainstorm mode, worker mode, and Telegram bridge
- **Codebuff's** multi-agent architecture (File Picker → Planner → Editor → Reviewer)
- **Claude Code's** tool system, permission handling, and session management
- **OpenClaw's** gateway concept for Telegram integration

## 📊 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI (cli.js)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   REPL       │  │   Commands   │  │   Telegram   │     │
│  │   Loop       │  │   Handler    │  │   Bridge     │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      Agent (agent.js)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Core Agent Loop                         │  │
│  │  • Message history management                        │  │
│  │  • Streaming response handling                       │  │
│  │  • Tool call dispatch                                │  │
│  │  • Multi-turn conversation                           │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Multi-Agent Orchestrator                     │  │
│  │  • File Picker Agent                                 │  │
│  │  • Planner Agent                                     │  │
│  │  • Editor Agent                                      │  │
│  │  • Reviewer Agent                                    │  │
│  │  • Researcher Agent                                  │  │
│  │  • Tester Agent                                      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Gemini Provider (gemini.js)               │
│  • Google Generative AI SDK integration                     │
│  • Function calling / tool use                              │
│  • Streaming response handling                              │
│  • Token counting                                           │
└─────────────┬───────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Tool System (tools.js)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ File Tools   │  │ Shell Tools  │  │ Search Tools │     │
│  │ • read_file  │  │ • bash       │  │ • glob       │     │
│  │ • write_file │  │              │  │ • grep       │     │
│  │ • edit_file  │  │              │  │ • list_dir   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Web Tools    │  │ Memory Tools │  │ Task Tools   │     │
│  │ • web_fetch  │  │ • memory_*   │  │ • task_*     │     │
│  │ • web_search │  │              │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Subsystems                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Config       │  │ Memory       │  │ Tasks        │     │
│  │ (config.js)  │  │ (memory.js)  │  │ (tasks.js)   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Session      │  │ Brainstorm   │  │ Telegram     │     │
│  │ (session.js) │  │(brainstorm.js│  │(telegram.js) │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## 🔄 Core Agent Loop

The agent loop is the heart of Gemma Agent. It handles:

1. **Message Management** — Maintains conversation history
2. **Streaming** — Real-time response generation
3. **Tool Dispatch** — Executes tool calls from the AI
4. **Multi-turn** — Continues until no more tool calls

### Flow

```javascript
async run(userMessage) {
  this.addMessage('user', userMessage);
  
  while (iterations < MAX_ITERATIONS) {
    // 1. Stream from Gemini
    for await (const event of streamChat({messages, systemPrompt})) {
      if (event.type === 'text') {
        // Emit text chunks
      } else if (event.type === 'tool_calls') {
        // Collect tool calls
      }
    }
    
    // 2. If no tool calls, we're done
    if (toolCalls.length === 0) break;
    
    // 3. Execute each tool call
    for (const tc of toolCalls) {
      const result = await tool.execute(args);
      this.addMessage('tool', result, { name, tool_call_id });
    }
    
    // 4. Loop back to step 1 with tool results
  }
}
```

## 🤖 Multi-Agent System

Inspired by Codebuff's architecture, Gemma uses specialized agents:

### Agent Types

| Agent | Purpose | Tools Used |
|-------|---------|------------|
| **File Picker** | Identify relevant files | glob, grep, list_dir |
| **Planner** | Create implementation plan | read_file, task_create |
| **Editor** | Implement changes | read_file, write_file, edit_file |
| **Reviewer** | Review code quality | read_file, bash (linters) |
| **Researcher** | Find documentation | web_search, web_fetch |
| **Tester** | Write and run tests | write_file, bash |

### Pipeline Flow

```
User Task
    ↓
File Picker Agent
    ↓ (relevant files)
Planner Agent
    ↓ (implementation plan)
Editor Agent
    ↓ (code changes)
Reviewer Agent
    ↓ (review feedback)
Result
```

### Implementation

```javascript
class MultiAgentOrchestrator {
  async runPipeline(task) {
    // 1. File Picker
    const picker = this.createAgent('file-picker');
    const files = await picker.run(`Find files for: ${task}`);
    
    // 2. Planner
    const planner = this.createAgent('planner');
    const plan = await planner.run(`Plan: ${task}\nFiles: ${files}`);
    
    // 3. Editor
    const editor = this.createAgent('editor');
    const impl = await editor.run(`Implement: ${plan}`);
    
    // 4. Reviewer
    const reviewer = this.createAgent('reviewer');
    const review = await reviewer.run(`Review: ${impl}`);
    
    return { files, plan, implementation: impl, review };
  }
}
```

## 🛠️ Tool System

### Tool Registry Pattern

All tools are registered in a central registry:

```javascript
const _tools = new Map();

export function registerTool(def) {
  _tools.set(def.name, def);
}

export function getTool(name) {
  return _tools.get(name);
}
```

### Tool Definition

```javascript
registerTool({
  name: 'read_file',
  description: 'Read the contents of a file',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: '...' },
    },
    required: ['file_path'],
  },
  readOnly: true,
  async execute({ file_path }) {
    // Implementation
    return { content, total_lines };
  },
});
```

### Permission System

Three modes:

1. **auto** (default) — Prompts for writes, auto-approves reads
2. **accept-all** — Never prompts
3. **manual** — Prompts for everything

```javascript
async function checkPermission(toolName, description, isReadOnly) {
  const cfg = getConfig();
  if (cfg.permission_mode === 'accept-all') return true;
  if (cfg.permission_mode === 'auto' && isReadOnly) return true;
  return await permissionCallback(toolName, description);
}
```

## 🧠 Brainstorm Mode

Inspired by ClawSpring's multi-persona brainstorm:

### Flow

```
1. Generate N expert personas (or use defaults)
2. Each persona provides perspective sequentially
3. Each builds on previous perspectives
4. Main agent synthesizes all perspectives
5. Generate TODO list from synthesis
```

### Persona Generation

```javascript
async function generatePersonas(topic, count) {
  const prompt = `Generate ${count} expert personas for: "${topic}"
  Return JSON: [{"emoji":"🏗️","role":"...","focus":"..."}]`;
  
  const result = await agent.run(prompt);
  const personas = JSON.parse(result.text);
  
  // Fallback to topic-based defaults
  if (!personas) {
    const type = detectTopicType(topic); // software, business, research
    return TOPIC_PERSONAS[type].slice(0, count);
  }
  
  return personas;
}
```

### Output

- `brainstorm_outputs/brainstorm_TIMESTAMP.md` — Full debate transcript
- `brainstorm_outputs/todo_list.txt` — Prioritized TODO list

## 👷 Worker Mode

Auto-implements tasks from TODO list:

### Flow

```
1. Read todo_list.txt
2. Parse pending tasks (- [ ] ...)
3. For each task:
   a. Create agent prompt
   b. Run agent
   c. Mark task done (- [x] ...)
4. Save updated todo_list.txt
```

### Implementation

```javascript
export function markTodoDone(taskNum, filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let count = 0;
  content = content.replace(/^- \[ \] /gm, (match) => {
    count++;
    if (count === taskNum) return '- [x] ';
    return match;
  });
  fs.writeFileSync(filePath, content, 'utf8');
}
```

## 📱 Telegram Bridge

Inspired by ClawSpring and OpenClaw:

### Architecture

```
Telegram Bot API
    ↓ (polling)
telegram.js
    ↓ (message)
Agent
    ↓ (response)
telegram.js
    ↓ (sendMessage)
Telegram Bot API
```

### Features

- **Authorization** — Only responds to configured chat_id
- **Typing Indicator** — Shows "typing..." while processing
- **Command Passthrough** — Slash commands work in Telegram
- **Auto-start** — Starts on launch if configured
- **Message Chunking** — Splits long responses (4096 char limit)

### Implementation

```javascript
_bot.on('message', async (msg) => {
  if (String(msg.chat.id) !== _authorizedChatId) {
    _bot.sendMessage(msg.chat.id, '⛔ Unauthorized.');
    return;
  }
  
  // Start typing indicator
  const interval = setInterval(() => {
    _bot.sendChatAction(msg.chat.id, 'typing');
  }, 4000);
  
  // Run agent
  const result = await _agent.run(msg.text);
  
  clearInterval(interval);
  
  // Send response (with chunking)
  await _bot.sendMessage(msg.chat.id, result.text);
});
```

## 💾 Memory System

Persistent storage of user preferences and project decisions:

### Storage

```
~/.gemma-agent/memory/
├── MEMORY.md              # Index (auto-generated)
├── coding_style.json      # Individual memories
├── project_context.json
└── user_preferences.json
```

### Memory Structure

```json
{
  "name": "coding_style",
  "type": "feedback",
  "description": "Python formatting preferences",
  "content": "Prefer 4-space indentation and type hints",
  "scope": "user",
  "confidence": 1.0,
  "source": "user",
  "created": "2026-04-15T20:00:00Z",
  "updated": "2026-04-15T20:00:00Z",
  "last_used_at": "2026-04-15T21:00:00Z"
}
```

### Ranking

Memories are ranked by: `confidence × recency`

```javascript
const daysSince = (Date.now() - new Date(m.last_used_at).getTime()) / (1000 * 60 * 60 * 24);
const recency = Math.exp(-daysSince / 30); // 30-day decay
const score = (m.confidence || 1) * recency;
```

## 📊 Task Management

Track multi-step work with dependency edges:

### Task Structure

```json
{
  "id": "1",
  "subject": "Implement authentication",
  "description": "Add JWT-based auth",
  "status": "in_progress",
  "created": "2026-04-15T20:00:00Z",
  "updated": "2026-04-15T21:00:00Z",
  "blocks": ["2", "3"],
  "blocked_by": [],
  "metadata": {}
}
```

### Dependency Graph

```
Task 1: Design schema
    ↓ blocks
Task 2: Implement endpoint
    ↓ blocks
Task 3: Write tests
```

## 💬 Session Management

Auto-save conversations for later resume:

### Storage Structure

```
~/.gemma-agent/sessions/
├── session_latest.json          # Most recent (/resume)
├── history.json                 # All sessions
└── daily/
    └── 2026-04-15/
        ├── session_210530_a3f9.json
        └── session_183022_b7c1.json
```

### Session Data

```json
{
  "session_id": "a3f9c1b2",
  "saved_at": "2026-04-15T21:05:30Z",
  "turn_count": 8,
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." },
    ...
  ]
}
```

## 🎨 Diff Rendering

Git-style colored diffs for file changes:

```javascript
export function createDiff(oldContent, newContent, filePath) {
  const changes = diffLines(oldContent, newContent);
  const lines = [];
  
  for (const part of changes) {
    if (part.added) {
      lines.push(chalk.green(`+ ${part.value}`));
    } else if (part.removed) {
      lines.push(chalk.red(`- ${part.value}`));
    }
  }
  
  return lines.join('\n');
}
```

## 🔐 Security Considerations

1. **API Key Storage** — Never commit keys, use env vars
2. **Permission System** — Prompts before destructive operations
3. **Telegram Auth** — Only responds to authorized chat_id
4. **Tool Sandboxing** — Tools run in current process (no isolation)
5. **Input Validation** — Validate file paths, commands

## 🚀 Performance

- **Streaming** — Real-time response generation
- **Token Counting** — Estimate costs before requests
- **Session Limits** — Cap daily sessions (default: 5)
- **Memory Limits** — Cap history (default: 100 sessions)

## 🧪 Testing Strategy

1. **Unit Tests** — Test individual tools
2. **Integration Tests** — Test agent loop
3. **E2E Tests** — Test full CLI workflows
4. **Manual Testing** — Test Telegram bridge, brainstorm mode

## 📈 Future Enhancements

1. **MCP Support** — Model Context Protocol integration
2. **Plugin System** — Load custom tools from git repos
3. **Voice Input** — Whisper STT integration
4. **Cloud Sync** — GitHub Gist session backup
5. **Context Compression** — Auto-summarize long conversations
6. **Proactive Mode** — Background monitoring
7. **SSJ Mode** — Power menu with workflow shortcuts

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

**Built with ❤️ using Google Gemini AI**
