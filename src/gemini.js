/**
 * gemini.js — Google Gemini AI provider
 * Handles streaming, tool calls, multi-turn conversations
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { getConfig } from './config.js';
import { getToolSchemas } from './tools.js';

let _client = null;

function getClient() {
  if (_client) return _client;
  const cfg = getConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set. Run: gemma /config gemini_api_key=YOUR_KEY or set GEMINI_API_KEY env var');
  }
  _client = new GoogleGenerativeAI(apiKey);
  return _client;
}

// Convert our tool schemas to Gemini function declarations
function toGeminiFunctionDeclarations(toolSchemas) {
  return toolSchemas.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

// Convert message history to Gemini format.
//
// Gemini rules:
//   - A 'model' turn with functionCall parts must be immediately followed by
//     a single 'user' turn that contains ALL the functionResponse parts for
//     that round — one per called function, in the same message.
//   - You cannot put a functionResponse inside a plain text 'user' message.
//
// Our internal message list looks like:
//   user        → plain text
//   assistant   → text + tool_calls[]
//   tool        → result for one call  (name, content)
//   tool        → result for another call
//   assistant   → next text turn …
//
// We collapse consecutive 'tool' messages that follow an 'assistant' turn
// into a single Gemini 'user' message with multiple functionResponse parts.
function toGeminiHistory(messages) {
  const history = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'system') {
      i++;
      continue;
    }

    if (msg.role === 'user') {
      // Plain user text — must never contain functionResponse parts
      const content = msg.content || '';
      if (content) {
        history.push({ role: 'user', parts: [{ text: content }] });
      }
      i++;
      continue;
    }

    if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Model turn: text (optional) + one functionCall part per tool call
        const parts = [];
        if (msg.content) parts.push({ text: msg.content });
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}'),
            },
          });
        }
        history.push({ role: 'model', parts });

        // Immediately consume all following 'tool' messages and merge them
        // into ONE 'user' turn with functionResponse parts.
        i++;
        const responseParts = [];
        while (i < messages.length && messages[i].role === 'tool') {
          const t = messages[i];
          let parsed;
          try { parsed = JSON.parse(t.content); } catch { parsed = t.content; }
          responseParts.push({
            functionResponse: {
              name: t.name,
              response: { output: parsed },
            },
          });
          i++;
        }
        if (responseParts.length > 0) {
          history.push({ role: 'user', parts: responseParts });
        }
      } else {
        // Plain model text turn
        history.push({ role: 'model', parts: [{ text: msg.content || '' }] });
        i++;
      }
      continue;
    }

    // Orphaned 'tool' message (shouldn't happen in normal flow, skip it)
    i++;
  }

  return history;
}

export async function* streamChat({ messages, tools = [], systemPrompt = '', model: modelOverride }) {
  const cfg = getConfig();
  const modelName = modelOverride || cfg.model || 'gemini-2.0-flash';
  const client = getClient();
  
  const toolSchemas = tools.length > 0 ? tools : getToolSchemas();
  const functionDeclarations = toGeminiFunctionDeclarations(toolSchemas);
  
  const genModel = client.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : [],
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
    generationConfig: {
      maxOutputTokens: cfg.max_tokens || 8192,
      temperature: 0.7,
    },
  });
  
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  // Split into history (passed to startChat) and the current message to send.
  //
  // Rule: the Gemini chat history must be a complete, valid sequence ending
  // with either a 'model' text turn or nothing. The current send is the next
  // user turn (text or grouped functionResponses).
  //
  // We find the last 'user' text message (not tool) — everything before it
  // goes into history, and it becomes the current send.
  // If the last messages are tool results, we group them as functionResponses
  // and the history includes everything up to (and including) the assistant
  // turn that called those tools — but toGeminiHistory will pair them up.

  let historyMessages;
  let currentParts;

  // Count trailing 'tool' messages
  let trailingToolCount = 0;
  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    if (nonSystemMessages[i].role === 'tool') trailingToolCount++;
    else break;
  }

  if (trailingToolCount > 0) {
    // The trailing tool messages are the current send (grouped functionResponses).
    // History = everything before the trailing tools, BUT toGeminiHistory will
    // see the assistant turn with functionCalls and consume the tool messages
    // that follow it — so we pass ALL messages to toGeminiHistory and let it
    // build the full history, then send an empty continuation.
    // Actually: pass all messages except the trailing tools to history,
    // and the trailing tools become currentParts.
    const toolMsgs = nonSystemMessages.slice(nonSystemMessages.length - trailingToolCount);
    historyMessages = nonSystemMessages.slice(0, nonSystemMessages.length - trailingToolCount);

    currentParts = toolMsgs.map(t => {
      let parsed;
      try { parsed = JSON.parse(t.content); } catch { parsed = t.content; }
      return {
        functionResponse: {
          name: t.name,
          response: { output: parsed },
        },
      };
    });
  } else {
    // Last message is a plain user text
    const lastMsg = nonSystemMessages[nonSystemMessages.length - 1];
    historyMessages = nonSystemMessages.slice(0, -1);
    currentParts = [{ text: lastMsg?.content || '' }];
  }

  // Build Gemini history from historyMessages.
  // IMPORTANT: historyMessages must NOT end with a model+functionCall turn
  // that has no following functionResponse — that would be invalid.
  // Since we sliced off the trailing tools above, historyMessages ends with
  // the assistant (model) turn that has functionCalls. We need to verify
  // this is valid: Gemini's startChat history must alternate user/model and
  // must end with a model turn OR be empty. A model turn with functionCalls
  // at the end of history (without responses) is invalid.
  //
  // Solution: if historyMessages ends with an assistant+tool_calls message,
  // drop it from history and prepend its functionCall info to currentParts
  // as context — actually the cleanest fix is: history = everything up to
  // but NOT including the last assistant+tool_calls turn, and prepend that
  // turn's text to the current send as a model turn via the chat history.
  //
  // Simplest correct approach: pass historyMessages through toGeminiHistory
  // which already handles pairing. If it ends with a model+functionCall turn
  // (no tool responses follow in historyMessages), that's fine for startChat
  // as long as we then send the functionResponses as the next message.

  const history = toGeminiHistory(historyMessages);
  const chat = genModel.startChat({ history });
  
  try {
    const result = await chat.sendMessageStream(currentParts);
    
    let textBuffer = '';
    let functionCalls = [];
    let usageMetadata = null;
    
    for await (const chunk of result.stream) {
      usageMetadata = chunk.usageMetadata;
      const candidates = chunk.candidates || [];
      
      for (const candidate of candidates) {
        for (const part of candidate.content?.parts || []) {
          if (part.text) {
            textBuffer += part.text;
            yield { type: 'text', text: part.text };
          }
          if (part.functionCall) {
            functionCalls.push({
              id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
              type: 'function',
              function: {
                name: part.functionCall.name,
                arguments: JSON.stringify(part.functionCall.args || {}),
              },
            });
          }
        }
      }
    }
    
    if (functionCalls.length > 0) {
      yield { type: 'tool_calls', tool_calls: functionCalls };
    }
    
    yield {
      type: 'done',
      text: textBuffer,
      tool_calls: functionCalls,
      usage: usageMetadata ? {
        input_tokens: usageMetadata.promptTokenCount || 0,
        output_tokens: usageMetadata.candidatesTokenCount || 0,
        total_tokens: usageMetadata.totalTokenCount || 0,
      } : null,
    };
  } catch (err) {
    yield { type: 'error', error: err.message };
  }
}

export async function countTokens(text, model) {
  const cfg = getConfig();
  const modelName = model || cfg.model || 'gemini-2.0-flash';
  try {
    const client = getClient();
    const genModel = client.getGenerativeModel({ model: modelName });
    const result = await genModel.countTokens(text);
    return result.totalTokens;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro',       context: '1M', notes: 'Most capable' },
  { id: 'gemini-2.0-flash',             name: 'Gemini 2.0 Flash',      context: '1M', notes: 'Fast, recommended ✓' },
  { id: 'gemini-2.0-flash-lite',        name: 'Gemini 2.0 Flash Lite', context: '1M', notes: 'Fastest, cheapest' },
  { id: 'gemini-1.5-pro',               name: 'Gemini 1.5 Pro',        context: '2M', notes: 'Largest context' },
  { id: 'gemini-1.5-flash',             name: 'Gemini 1.5 Flash',      context: '1M', notes: 'Balanced' },
];
