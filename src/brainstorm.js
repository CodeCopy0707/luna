/**
 * brainstorm.js — Multi-persona AI brainstorm mode
 * Inspired by ClawSpring's /brainstorm command
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Agent } from './agent.js';
import { getConfig } from './config.js';

const OUTPUT_DIR = path.join(process.cwd(), 'brainstorm_outputs');

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  // Add to .gitignore
  const gitignore = path.join(process.cwd(), '.gitignore');
  if (fs.existsSync(gitignore)) {
    const content = fs.readFileSync(gitignore, 'utf8');
    if (!content.includes('brainstorm_outputs')) {
      fs.appendFileSync(gitignore, '\nbrainstorm_outputs/\n');
    }
  }
}

const TOPIC_PERSONAS = {
  software: [
    { emoji: '🏗️', role: 'Software Architect', focus: 'system design & modularity' },
    { emoji: '💡', role: 'Product Innovator', focus: 'user experience & features' },
    { emoji: '🛡️', role: 'Security Engineer', focus: 'attack surface & vulnerabilities' },
    { emoji: '⚡', role: 'Performance Specialist', focus: 'latency & memory optimization' },
    { emoji: '🔧', role: 'Code Quality Lead', focus: 'maintainability & best practices' },
  ],
  business: [
    { emoji: '📈', role: 'Market Strategist', focus: 'growth & competitive positioning' },
    { emoji: '💼', role: 'Operations Lead', focus: 'efficiency & execution' },
    { emoji: '💡', role: 'Innovation Director', focus: 'new opportunities & disruption' },
    { emoji: '📊', role: 'Financial Analyst', focus: 'ROI & risk assessment' },
    { emoji: '🎯', role: 'Customer Success', focus: 'user needs & satisfaction' },
  ],
  research: [
    { emoji: '🔬', role: 'Research Scientist', focus: 'methodology & evidence' },
    { emoji: '📚', role: 'Domain Expert', focus: 'deep knowledge & context' },
    { emoji: '🧪', role: 'Experimentalist', focus: 'testing & validation' },
    { emoji: '🌐', role: 'Systems Thinker', focus: 'interconnections & emergence' },
    { emoji: '💭', role: 'Critical Analyst', focus: 'assumptions & blind spots' },
  ],
};

function detectTopicType(topic) {
  const t = topic.toLowerCase();
  if (t.match(/code|software|api|database|architecture|system|deploy|test|bug|feature/)) return 'software';
  if (t.match(/business|market|revenue|customer|product|strategy|growth/)) return 'business';
  return 'research';
}

async function generatePersonas(topic, count, agent) {
  const prompt = `Generate ${count} expert personas for a brainstorming session about: "${topic}"
  
Return a JSON array with exactly ${count} objects, each with: emoji, role, focus
Example: [{"emoji":"🏗️","role":"Software Architect","focus":"system design"}]
Only return the JSON array, nothing else.`;
  
  let personas = null;
  const result = await agent.run(prompt);
  
  try {
    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) personas = JSON.parse(match[0]);
  } catch {}
  
  if (!personas || personas.length < count) {
    const topicType = detectTopicType(topic);
    const base = TOPIC_PERSONAS[topicType] || TOPIC_PERSONAS.software;
    personas = [];
    for (let i = 0; i < count; i++) {
      personas.push(base[i % base.length]);
    }
  }
  
  return personas.slice(0, count);
}

export async function runBrainstorm(topic, agentCount = 5, { onProgress, model } = {}) {
  ensureOutputDir();
  const cfg = getConfig();
  
  // Get project context
  let context = `Topic: ${topic}\n`;
  for (const f of ['README.md', 'GEMMA.md', 'CLAUDE.md', 'package.json']) {
    const fp = path.join(process.cwd(), f);
    if (fs.existsSync(fp)) {
      context += `\n${f}:\n${fs.readFileSync(fp, 'utf8').slice(0, 500)}\n`;
    }
  }
  
  onProgress?.(`\n${chalk.cyan('🧠 Generating expert personas...')}`);
  
  const personaAgent = new Agent({ model: model || cfg.model });
  const personas = await generatePersonas(topic, agentCount, personaAgent);
  
  onProgress?.(`${chalk.green(`✓ ${agentCount} experts assembled`)}\n`);
  
  const perspectives = [];
  
  for (let i = 0; i < personas.length; i++) {
    const persona = personas[i];
    const spinner = `${persona.emoji} ${chalk.bold(persona.role)} is thinking...`;
    onProgress?.(spinner);
    
    const expertAgent = new Agent({ model: model || cfg.model });
    const prevPerspectives = perspectives.map((p, idx) => 
      `Expert ${idx + 1} (${p.role}): ${p.text}`
    ).join('\n\n');
    
    const prompt = `You are ${persona.role}, focused on ${persona.focus}.

Topic: ${topic}

Project Context:
${context}

${prevPerspectives ? `Previous perspectives:\n${prevPerspectives}\n\nBuild on these or respectfully disagree where appropriate.` : 'Provide your opening perspective.'}

Give your expert analysis in 3-5 paragraphs. Be specific and actionable.`;
    
    const result = await expertAgent.run(prompt);
    perspectives.push({ ...persona, text: result.text });
    onProgress?.(`  ${chalk.green('└─ Perspective captured.')}`);
  }
  
  // Synthesize
  onProgress?.(`\n${chalk.cyan('📝 Synthesizing Master Plan...')}`);
  
  const synthAgent = new Agent({ model: model || cfg.model });
  const allPerspectives = perspectives.map((p, i) => 
    `## Expert ${i + 1}: ${p.emoji} ${p.role} (${p.focus})\n${p.text}`
  ).join('\n\n---\n\n');
  
  const synthResult = await synthAgent.run(
    `You have received ${agentCount} expert perspectives on: "${topic}"

${allPerspectives}

Synthesize these into:
1. **Key Insights** — The most important findings across all perspectives
2. **Master Plan** — A prioritized, actionable implementation plan
3. **Risks & Mitigations** — Top risks and how to address them
4. **Quick Wins** — Things that can be done immediately

Be specific and actionable.`
  );
  
  // Save output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const outputFile = path.join(OUTPUT_DIR, `brainstorm_${timestamp}.md`);
  
  const fullOutput = `# Brainstorm: ${topic}
Generated: ${new Date().toLocaleString()}
Agents: ${agentCount}

---

${allPerspectives}

---

# Master Plan (Synthesis)

${synthResult.text}
`;
  
  fs.writeFileSync(outputFile, fullOutput, 'utf8');
  
  // Generate TODO list
  const todoAgent = new Agent({ model: model || cfg.model });
  const todoResult = await todoAgent.run(
    `Based on this brainstorm synthesis, generate a prioritized TODO list:

${synthResult.text}

Format as markdown checkboxes:
- [ ] Task description (priority: high/medium/low)

Return only the checkbox list, 5-15 items.`
  );
  
  const todoFile = path.join(OUTPUT_DIR, 'todo_list.txt');
  fs.writeFileSync(todoFile, `# TODO List — ${topic}\nGenerated: ${new Date().toLocaleString()}\n\n${todoResult.text}\n`, 'utf8');
  
  return {
    perspectives,
    synthesis: synthResult.text,
    outputFile,
    todoFile,
  };
}

export function readTodoList(filePath) {
  const fp = filePath || path.join(OUTPUT_DIR, 'todo_list.txt');
  if (!fs.existsSync(fp)) return { error: 'No todo_list.txt found. Run /brainstorm first.' };
  const content = fs.readFileSync(fp, 'utf8');
  const lines = content.split('\n');
  const tasks = [];
  let taskNum = 0;
  for (const line of lines) {
    if (line.match(/^- \[ \]/)) {
      taskNum++;
      tasks.push({ num: taskNum, text: line.replace(/^- \[ \] /, ''), done: false, line });
    } else if (line.match(/^- \[x\]/i)) {
      tasks.push({ num: null, text: line.replace(/^- \[x\] /i, ''), done: true, line });
    }
  }
  return { tasks, content, filePath: fp };
}

export function markTodoDone(taskNum, filePath) {
  const fp = filePath || path.join(OUTPUT_DIR, 'todo_list.txt');
  if (!fs.existsSync(fp)) return false;
  
  let content = fs.readFileSync(fp, 'utf8');
  let count = 0;
  content = content.replace(/^- \[ \] /gm, (match) => {
    count++;
    if (count === taskNum) return '- [x] ';
    return match;
  });
  
  fs.writeFileSync(fp, content, 'utf8');
  return true;
}
