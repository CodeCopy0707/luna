# Plan/Act Mode Quick Start Guide

## What's New?

Gemma Agent now has **two distinct modes** for smarter task execution:

1. **📋 PLAN Mode** - Research and planning (no code changes)
2. **⚡ ACT Mode** - Execute and implement (full access)

---

## Getting Started

### Step 1: Start the Agent
```bash
npm start
```

You'll see the mode tabs at the top:
```
📋 PLAN │ ⚡ ACT  Research & plan — no code changes    Tab/Click: switch mode
```

### Step 2: Use PLAN Mode (Default)

The agent starts in **PLAN mode**. Use it to:
- Research requirements
- Search the web for best practices
- Analyze your codebase
- Create detailed implementation plans

**Example:**
```
You: "How should I add authentication to my app?"

Gemma (PLAN mode):
  → Searching for authentication best practices...
  → Reading your codebase...
  → Analyzing current structure...
  
  ## Implementation Plan
  1. Add passport.js dependency
  2. Create auth middleware
  3. Add login/logout routes
  4. Update database schema
  5. Add tests
  
  Plan complete. Switch to ACT mode (press Tab) to implement.
```

### Step 3: Switch to ACT Mode

**Option A: Click the Tab**
- Click on the `⚡ ACT` tab at the top

**Option B: Press Tab Key**
- Press the Tab key to toggle between modes

The agent will automatically capture your plan and switch to execution mode.

### Step 4: Execute in ACT Mode

Now ask the agent to implement:

```
You: "Now implement the plan"

Gemma (ACT mode):
  → Spawning editor: "Add passport.js..."
  → Spawning tester: "Write auth tests..."
  [Both run in parallel]
  
  ✓ Added passport.js
  ✓ Created auth middleware
  ✓ Added login/logout routes
  ✓ Updated database schema
  ✓ Tests passing
  
  ✓ Implementation complete!
```

---

## Key Features

### 🔍 Real-Time Web Search
The agent can search the web without API keys:

```
You: "What are the latest Node.js security best practices?"

Gemma:
  → Searching web...
  → Found 8 results
  → Fetching top articles...
  
  [Provides current information from the web]
```

### 🤖 Autonomous Agent Spawning
The agent automatically spawns specialist subagents:

- **file-picker** - Find relevant files
- **planner** - Create detailed plans
- **editor** - Make code changes
- **reviewer** - Review code quality
- **researcher** - Research topics
- **tester** - Write and run tests
- **git-committer** - Create commits
- **debugger** - Debug issues

**Example:**
```
You: "Add authentication"

Gemma (automatically):
  → Spawning researcher: "Find auth patterns"
  → Spawning file-picker: "Find auth files"
  [Both run in parallel]
  
  → Spawning editor: "Implement auth"
  → Spawning tester: "Write tests"
  [Both run in parallel]
  
  → Spawning reviewer: "Review code"
```

### 🛡️ Mode-Based Tool Access

**PLAN Mode** (Read-Only):
- ✓ Read files
- ✓ Search web
- ✓ List directories
- ✓ Search code
- ✓ Create tasks
- ✓ Save findings
- ✗ Write files
- ✗ Run bash commands

**ACT Mode** (Full Access):
- ✓ All PLAN mode tools
- ✓ Write files
- ✓ Edit code
- ✓ Run bash commands
- ✓ Execute any tool

---

## Common Workflows

### Workflow 1: Add a New Feature

```
1. Start (PLAN mode)
2. Ask: "How should I add real-time notifications?"
3. Agent researches and creates plan
4. Press Tab to switch to ACT mode
5. Ask: "Implement the plan"
6. Agent executes step-by-step
```

### Workflow 2: Fix a Bug

```
1. Ask: "Debug the memory leak in the worker"
2. Agent (PLAN):
   - Researches memory leak patterns
   - Analyzes code
   - Creates debugging plan
3. Press Tab to ACT mode
4. Ask: "Fix the bug"
5. Agent:
   - Spawns debugger agent
   - Implements fix
   - Spawns tester
   - Verifies fix works
```

### Workflow 3: Refactor Code

```
1. Ask: "Refactor the auth module"
2. Agent (PLAN):
   - Researches refactoring patterns
   - Analyzes current code
   - Creates refactoring plan
3. Press Tab to ACT mode
4. Ask: "Refactor the code"
5. Agent:
   - Spawns editor for refactoring
   - Spawns tester for tests
   - Spawns reviewer for quality
   - All run in parallel
```

### Workflow 4: Research & Learn

```
1. Ask: "Research GraphQL best practices"
2. Agent (PLAN):
   - Searches web for latest articles
   - Fetches full content
   - Summarizes findings
   - Creates learning plan
3. You read and learn
4. Ask follow-up questions
5. Agent provides more details
```

---

## Tips & Tricks

### 💡 Tip 1: Use PLAN Mode for Complex Tasks
For complex tasks, spend time in PLAN mode:
- Research thoroughly
- Understand all requirements
- Create a detailed plan
- Then execute with confidence

### 💡 Tip 2: Leverage Parallel Agents
The agent automatically spawns multiple agents in parallel:
- Independent tasks run simultaneously
- Faster execution
- Better resource utilization

### 💡 Tip 3: Ask Clarifying Questions
In PLAN mode, the agent can ask you questions:
- "Should we use JWT or sessions?"
- "What's your target browser support?"
- "Do you need offline support?"

### 💡 Tip 4: Review Plans Before Executing
Always review the plan before switching to ACT mode:
- Make sure it aligns with your vision
- Ask for modifications if needed
- Then execute with confidence

### 💡 Tip 5: Use Web Search for Current Info
The agent can search the web for:
- Latest library versions
- Current best practices
- Recent security updates
- New frameworks and tools

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Toggle between PLAN and ACT modes |
| `Click` | Click the mode tabs to switch |
| `Ctrl+C` | Exit the agent |
| `Enter` | Submit your message |

---

## Mode Indicators

### PLAN Mode
```
📋 PLAN │ ⚡ ACT  Research & plan — no code changes
```
- Cyan background on PLAN tab
- Read-only operations
- Web search enabled
- No file modifications

### ACT Mode
```
📋 PLAN │ ⚡ ACT  Execute & implement — full access
```
- Green background on ACT tab
- Full tool access
- Can write files
- Can run commands

---

## Troubleshooting

### Q: How do I go back to PLAN mode?
**A:** Press Tab or click the PLAN tab. You can switch back and forth anytime.

### Q: Can I modify the plan in ACT mode?
**A:** Yes, you can ask the agent to deviate from the plan. Just tell it what to do differently.

### Q: What if the agent makes a mistake?
**A:** You can:
1. Ask it to fix the mistake
2. Use `/undo` to revert changes (if available)
3. Switch back to PLAN mode to reassess

### Q: How does web search work?
**A:** The agent uses DuckDuckGo's public API - no API key needed. It searches in real-time and fetches current information.

### Q: Can I save my plans?
**A:** Yes, use `/save [name]` to save your session. Use `/load [name]` to resume later.

---

## Advanced Usage

### Custom Agent Spawning

You can manually spawn agents:
```
/spawn researcher "Research GraphQL best practices"
/spawn editor "Add authentication middleware"
/spawn tester "Write unit tests for auth"
```

### View Agent Status
```
/agents
```
Shows all running and completed agent tasks.

### View Memory
```
/memory
```
Shows all saved findings and decisions.

### Create Tasks
```
/tasks
```
Shows all tasks and their status.

---

## Examples

### Example 1: Add Dark Mode

```
PLAN Mode:
You: "Add dark mode to the app"

Gemma:
  → Searching for dark mode patterns...
  → Reading your CSS...
  → Checking for theme system...
  
  ## Implementation Plan
  1. Add theme context provider
  2. Create dark mode CSS variables
  3. Add theme toggle component
  4. Update all components
  5. Add localStorage persistence
  6. Write tests

[Press Tab to ACT mode]

ACT Mode:
You: "Implement the plan"

Gemma:
  → Spawning editor: "Add theme context"
  → Spawning editor: "Create CSS variables"
  → Spawning editor: "Add toggle component"
  [All run in parallel]
  
  → Spawning tester: "Write theme tests"
  
  ✓ Dark mode implemented!
```

### Example 2: Fix Performance Issue

```
PLAN Mode:
You: "The app is slow on mobile. How do we fix it?"

Gemma:
  → Searching for mobile performance tips...
  → Analyzing your code...
  → Checking bundle size...
  
  ## Performance Plan
  1. Code split routes
  2. Lazy load images
  3. Minify CSS
  4. Add service worker
  5. Optimize database queries
  6. Benchmark improvements

[Press Tab to ACT mode]

ACT Mode:
You: "Implement the optimizations"

Gemma:
  → Spawning editor: "Code split routes"
  → Spawning editor: "Lazy load images"
  → Spawning tester: "Benchmark performance"
  
  ✓ Performance improved by 40%!
```

---

## Next Steps

1. **Start the agent**: `npm start`
2. **Try PLAN mode**: Ask it to research something
3. **Switch to ACT mode**: Press Tab
4. **Execute**: Ask it to implement
5. **Explore**: Try different tasks and workflows

Happy coding! 🚀
