import { app, BrowserWindow, ipcMain } from "electron";
import path$1 from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const sessions = /* @__PURE__ */ new Map();
function getOrCreateSession(request, now) {
  if (request.sessionId && sessions.has(request.sessionId)) {
    return sessions.get(request.sessionId);
  }
  const session = {
    id: request.sessionId ?? `chat-${Date.now()}`,
    projectId: request.projectId,
    title: "项目协作会话",
    modelProfileId: request.modelProfileId,
    messages: [],
    createdAt: now,
    updatedAt: now
  };
  sessions.set(session.id, session);
  return session;
}
function appendAssistantMessage(session, messages, assistantMessageId, roleLabel, content, metadata) {
  const assistantMessage = {
    id: assistantMessageId,
    sender: "assistant",
    roleLabel,
    content,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...metadata ? { metadata } : {}
  };
  const updatedSession = {
    ...session,
    messages: [...messages, assistantMessage],
    updatedAt: assistantMessage.createdAt
  };
  sessions.set(updatedSession.id, updatedSession);
  return {
    session: updatedSession,
    assistantMessage
  };
}
const ROOT_MARKERS$1 = ["pnpm-workspace.yaml", "package.json"];
function findProjectRoot$1() {
  let currentDir2 = process.cwd();
  while (true) {
    if (ROOT_MARKERS$1.every((marker) => fs.existsSync(path$1.join(currentDir2, marker)))) {
      return currentDir2;
    }
    const parentDir = path$1.dirname(currentDir2);
    if (parentDir === currentDir2) {
      return void 0;
    }
    currentDir2 = parentDir;
  }
}
function resolveProjectPath(...parts) {
  return path$1.resolve(findProjectRoot$1() ?? process.cwd(), ...parts);
}
let database;
function getDatabase() {
  if (database) {
    return database;
  }
  const dataDir = resolveProjectPath("data");
  fs.mkdirSync(dataDir, { recursive: true });
  database = new Database(path$1.join(dataDir, "agent.db"));
  database.pragma("journal_mode = WAL");
  migrate(database);
  return database;
}
function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      message_id TEXT,
      type TEXT NOT NULL,
      actor TEXT NOT NULL,
      role_label TEXT,
      content TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_session
      ON events (project_id, session_id, created_at);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_message_id
      ON events (message_id)
      WHERE message_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      source_start_message_id TEXT NOT NULL,
      source_end_message_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      decisions_json TEXT NOT NULL DEFAULT '[]',
      open_questions_json TEXT NOT NULL DEFAULT '[]',
      constraints_json TEXT NOT NULL DEFAULT '[]',
      task_progress_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_session
      ON conversation_summaries (project_id, session_id, updated_at);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL DEFAULT 0.5,
      confidence REAL NOT NULL DEFAULT 0.7,
      source_session_id TEXT,
      source_event_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memories_project
      ON memories (project_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS prompt_iterations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      target_template TEXT NOT NULL,
      trigger TEXT NOT NULL,
      reason TEXT NOT NULL,
      suggested_change TEXT NOT NULL,
      source_event_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_iterations_project
      ON prompt_iterations (project_id, status, updated_at);
  `);
}
function getLatestConversationSummary(projectId, sessionId) {
  const row = getDatabase().prepare(
    `
        SELECT *
        FROM conversation_summaries
        WHERE project_id = ? AND session_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `
  ).get(projectId, sessionId);
  return row ? toConversationSummary(row) : void 0;
}
function saveConversationSummary(input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const firstMessage = input.sourceMessages[0];
  const lastMessage = input.sourceMessages.at(-1);
  if (!firstMessage || !lastMessage) {
    throw new Error("会话压缩失败：没有可压缩的消息。");
  }
  const summary = {
    id: `summary-${Date.now()}`,
    projectId: input.projectId,
    sessionId: input.sessionId,
    sourceStartMessageId: firstMessage.id,
    sourceEndMessageId: lastMessage.id,
    summary: input.summary,
    decisions: input.decisions,
    openQuestions: input.openQuestions,
    constraints: input.constraints,
    taskProgress: input.taskProgress,
    createdAt: now,
    updatedAt: now
  };
  getDatabase().prepare(
    `
        INSERT INTO conversation_summaries (
          id,
          project_id,
          session_id,
          source_start_message_id,
          source_end_message_id,
          summary,
          decisions_json,
          open_questions_json,
          constraints_json,
          task_progress_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
  ).run(
    summary.id,
    summary.projectId,
    summary.sessionId,
    summary.sourceStartMessageId,
    summary.sourceEndMessageId,
    summary.summary,
    JSON.stringify(summary.decisions),
    JSON.stringify(summary.openQuestions),
    JSON.stringify(summary.constraints),
    JSON.stringify(summary.taskProgress),
    summary.createdAt,
    summary.updatedAt
  );
  return summary;
}
function toConversationSummary(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id,
    summary: row.summary,
    decisions: parseStringArray$1(row.decisions_json),
    openQuestions: parseStringArray$1(row.open_questions_json),
    constraints: parseStringArray$1(row.constraints_json),
    taskProgress: parseStringArray$1(row.task_progress_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function parseStringArray$1(value) {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
}
function saveChatMessageEvent(input) {
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    messageId: input.message.id,
    type: "chat_message",
    actor: input.message.sender,
    roleLabel: input.message.roleLabel,
    content: input.message.content,
    payload: {
      createdAt: input.message.createdAt,
      metadata: input.message.metadata
    },
    createdAt: input.message.createdAt
  });
}
function saveRouterResultEvent(input) {
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "router_result",
    actor: "router",
    roleLabel: "Ollama Router",
    content: input.content,
    payload: parseJsonPayload(input.content),
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function saveToolSelectionEvent(input) {
  const content = JSON.stringify(input.result, null, 2);
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "tool_selection",
    actor: "core",
    roleLabel: "Tool Selection Policy",
    content,
    payload: input.result,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function saveToolCallEvent(input) {
  const content = JSON.stringify(input.request, null, 2);
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "tool_call",
    actor: "model",
    roleLabel: input.request.type,
    content,
    payload: input.request,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function saveToolResultEvent(input) {
  const content = JSON.stringify(
    {
      decision: input.result.decision,
      status: input.result.status,
      reason: input.result.reason,
      exitCode: input.result.exitCode,
      durationMs: input.result.durationMs
    },
    null,
    2
  );
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "tool_result",
    actor: "tool",
    roleLabel: "Tool Gateway",
    content,
    payload: input.result,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function saveConversationSummaryEvent(input) {
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "conversation_summary",
    actor: "system",
    roleLabel: "Conversation Compressor",
    content: input.content,
    payload: {
      summaryId: input.summaryId,
      value: input.payload
    },
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function saveModelReturnEvent(input) {
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "model_return",
    actor: "model",
    roleLabel: "MiMo",
    payload: {
      stopReason: input.stopReason,
      usage: input.usage
    },
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function saveOutputEvaluationEvent(input) {
  const content = JSON.stringify(input.result, null, 2);
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "output_evaluation",
    actor: "evaluator",
    roleLabel: "Output Evaluator",
    content,
    payload: input.result,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function saveMemoryWriteEvent(input) {
  if (input.memories.length === 0) {
    return void 0;
  }
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "memory_write",
    actor: "memory",
    roleLabel: "Long Term Memory",
    content: input.memories.map((memory) => `- ${memory.type}: ${memory.content}`).join("\n"),
    payload: {
      memories: input.memories
    },
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function saveMemoryRecallEvent(input) {
  if (input.memories.length === 0) {
    return void 0;
  }
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "memory_recall",
    actor: "memory",
    roleLabel: "Long Term Memory Recall",
    content: input.memories.map((memory) => `- ${memory.type}: ${memory.content}`).join("\n"),
    payload: {
      memories: input.memories
    },
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function savePromptIterationEvent(input) {
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "prompt_iteration",
    actor: "prompt",
    roleLabel: "Prompt Iteration Candidate",
    content: input.record.suggestedChange,
    payload: input.record,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function saveErrorEvent(input) {
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "error",
    actor: "system",
    roleLabel: "Error",
    content: input.message,
    payload: {
      stage: input.stage
    },
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function listSessionEvents(input) {
  const rows = getDatabase().prepare(
    `
        SELECT *
        FROM events
        WHERE project_id = ? AND session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `
  ).all(input.projectId, input.sessionId, input.limit ?? 100);
  return rows.map(toEventRecord).reverse();
}
function saveEvent(input) {
  const event = {
    ...input,
    id: `event-${randomUUID()}`
  };
  getDatabase().prepare(
    `
        INSERT OR IGNORE INTO events (
          id,
          project_id,
          session_id,
          message_id,
          type,
          actor,
          role_label,
          content,
          payload_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
  ).run(
    event.id,
    event.projectId,
    event.sessionId,
    event.messageId ?? null,
    event.type,
    event.actor,
    event.roleLabel ?? null,
    event.content ?? null,
    JSON.stringify(event.payload ?? {}),
    event.createdAt
  );
  return event;
}
function toEventRecord(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    messageId: row.message_id ?? void 0,
    type: row.type,
    actor: row.actor,
    roleLabel: row.role_label ?? void 0,
    content: row.content ?? void 0,
    payload: parseJsonPayload(row.payload_json),
    createdAt: row.created_at
  };
}
function parseJsonPayload(content) {
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}
const MIMO_OPENAI_BASE_URL = "https://api.xiaomimimo.com/v1";
const MIMO_MODEL = "mimo-v2.5-pro";
const MIMO_MAX_TOKENS = 8192;
const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const OLLAMA_INTENT_MODEL = "qwen2.5:1.5b";
const DEFAULT_SYSTEM_PROMPT = "你是一个专注于个人 AI Agent 项目搭建的工作协作助手。请用中文优先回答，帮助用户通过对话完成需求澄清、技术选型、开发实现、测试验证和本地记忆沉淀。";
function getMimoApiKey() {
  return readLocalSecrets().mimoApiKey || process.env.MIMO_API_KEY;
}
function readLocalSecrets() {
  const secretsPath = findSecretsPath();
  if (!fs.existsSync(secretsPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(secretsPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function findSecretsPath() {
  let currentDir2 = process.cwd();
  while (true) {
    const candidate = path$1.join(currentDir2, "config", "secrets.local.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parentDir = path$1.dirname(currentDir2);
    if (parentDir === currentDir2) {
      return path$1.resolve(process.cwd(), "config", "secrets.local.json");
    }
    currentDir2 = parentDir;
  }
}
const CONFIG_PATH = resolveProjectPath("config", "model-runtime.local.json");
function getModelRuntimeSettings() {
  return normalizeSettings(readModelRuntimeSettings());
}
function saveModelRuntimeSettings(settings) {
  const normalized = normalizeSettings(settings);
  fs.mkdirSync(path$1.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}
`, "utf8");
  return normalized;
}
function getModelRuntimeConfig(role) {
  return getModelRuntimeSettings()[role];
}
function readModelRuntimeSettings() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}
function normalizeSettings(settings) {
  return {
    router: normalizeConfig(settings.router, defaultRouterConfig()),
    main: normalizeConfig(settings.main, defaultMainConfig()),
    compression: normalizeConfig(settings.compression, defaultCompressionConfig())
  };
}
function normalizeConfig(value, fallback) {
  const providerKind = (value == null ? void 0 : value.providerKind) === "openai-compatible" || (value == null ? void 0 : value.providerKind) === "anthropic-compatible" || (value == null ? void 0 : value.providerKind) === "ollama" ? value.providerKind : fallback.providerKind;
  const requestedToolMode = (value == null ? void 0 : value.toolCallingMode) === "native-openai" || (value == null ? void 0 : value.toolCallingMode) === "text-json" ? value.toolCallingMode : fallback.toolCallingMode;
  const toolCallingMode = providerKind === "openai-compatible" ? requestedToolMode : "text-json";
  return {
    role: fallback.role,
    label: stringOr(value == null ? void 0 : value.label, fallback.label),
    providerKind,
    baseURL: stringOr(value == null ? void 0 : value.baseURL, fallback.baseURL),
    model: stringOr(value == null ? void 0 : value.model, fallback.model),
    apiKey: stringOr(value == null ? void 0 : value.apiKey, fallback.apiKey),
    temperature: numberOr(value == null ? void 0 : value.temperature, fallback.temperature),
    maxTokens: numberOr(value == null ? void 0 : value.maxTokens, fallback.maxTokens),
    toolCallingMode,
    thinkingEnabled: toolCallingMode === "native-openai" ? true : providerKind === "openai-compatible" && typeof (value == null ? void 0 : value.thinkingEnabled) === "boolean" ? value.thinkingEnabled : false
  };
}
function defaultRouterConfig() {
  return {
    role: "router",
    label: "Local Qwen Router",
    providerKind: "ollama",
    baseURL: OLLAMA_BASE_URL,
    model: OLLAMA_INTENT_MODEL,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 768,
    toolCallingMode: "text-json",
    thinkingEnabled: false
  };
}
function defaultMainConfig() {
  return {
    role: "main",
    label: "MiMo Native Main",
    providerKind: "openai-compatible",
    baseURL: MIMO_OPENAI_BASE_URL,
    model: MIMO_MODEL,
    apiKey: getMimoApiKey() ?? "",
    temperature: 1,
    maxTokens: MIMO_MAX_TOKENS,
    toolCallingMode: "native-openai",
    thinkingEnabled: true
  };
}
function defaultCompressionConfig() {
  return {
    role: "compression",
    label: "Local Qwen Compression",
    providerKind: "ollama",
    baseURL: OLLAMA_BASE_URL,
    model: OLLAMA_INTENT_MODEL,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 1024,
    toolCallingMode: "text-json",
    thinkingEnabled: false
  };
}
function stringOr(value, fallback) {
  return typeof value === "string" ? value : fallback;
}
function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
const logs = [];
function addProviderDebugLog(log) {
  logs.unshift(log);
  logs.splice(50);
}
function listProviderDebugLogs() {
  return logs;
}
function createDebugLogBase(input) {
  return {
    ...input,
    id: `provider-log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "pending",
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
const ROOT_MARKERS = ["pnpm-workspace.yaml", "package.json"];
function readMarkdown(filePath, fallback = "") {
  const markdownPath = resolveMarkdownPath(filePath);
  if (!markdownPath) {
    return fallback;
  }
  try {
    return fs.readFileSync(markdownPath, "utf8");
  } catch {
    return fallback;
  }
}
function readMarkdownFiles(filePaths, fallback = "") {
  const content = filePaths.map((filePath) => readMarkdown(filePath)).filter((item) => item.trim().length > 0).join("\n\n");
  return content || fallback;
}
function resolveMarkdownPath(filePath) {
  if (path$1.isAbsolute(filePath)) {
    return fs.existsSync(filePath) ? filePath : void 0;
  }
  const rootDir = findProjectRoot();
  const normalizedPath = normalizeRelativePath(filePath);
  const candidatePaths = /* @__PURE__ */ new Set();
  candidatePaths.add(path$1.resolve(process.cwd(), filePath));
  if (rootDir) {
    candidatePaths.add(path$1.resolve(rootDir, filePath));
    candidatePaths.add(path$1.resolve(rootDir, normalizedPath));
    candidatePaths.add(path$1.resolve(rootDir, "packages", normalizedPath));
  }
  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }
  return void 0;
}
function normalizeRelativePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "").replace(/^(\.\/)+/, "");
}
function findProjectRoot() {
  let currentDir2 = process.cwd();
  while (true) {
    if (ROOT_MARKERS.every((marker) => fs.existsSync(path$1.join(currentDir2, marker)))) {
      return currentDir2;
    }
    const parentDir = path$1.dirname(currentDir2);
    if (parentDir === currentDir2) {
      return void 0;
    }
    currentDir2 = parentDir;
  }
}
const SYSTEM_PROMPT_MODULES = [
  "packages/memorizes/system/01-role.md",
  "packages/memorizes/system/02-goals.md",
  "packages/memorizes/system/03-style.md"
];
const INTENT_PROMPT_MODULES = [
  "packages/memorizes/intent/01-parser.md"
];
const INTENT_USER_MODULES = [
  "packages/memorizes/intent/02-input.md"
];
const INTENT_CONTEXT_TEMPLATE = "packages/memorizes/context/intent-result.md";
const COMPRESSION_PROMPT_MODULES = [
  "packages/memorizes/compression/01-system.md"
];
const COMPRESSION_USER_MODULES = [
  "packages/memorizes/compression/02-input.md"
];
const EVALUATOR_PROMPT_MODULES = [
  "packages/memorizes/evaluator/01-system.md"
];
const EVALUATOR_USER_MODULES = [
  "packages/memorizes/evaluator/02-input.md"
];
function buildIntentSystemPrompt() {
  return readMarkdownFiles(INTENT_PROMPT_MODULES);
}
function buildIntentUserPrompt(messages, latestUserMessage) {
  return renderTemplate(readMarkdownFiles(INTENT_USER_MODULES), {
    recent_messages: formatRecentMessages(messages),
    input: latestUserMessage
  });
}
function buildSystemPrompt() {
  return readMarkdownFiles(SYSTEM_PROMPT_MODULES, DEFAULT_SYSTEM_PROMPT);
}
function buildIntentContextMessage(intentSummary) {
  return renderTemplate(readMarkdown(INTENT_CONTEXT_TEMPLATE), {
    intent_result: intentSummary
  });
}
function buildCompressionSystemPrompt() {
  return readMarkdownFiles(COMPRESSION_PROMPT_MODULES);
}
function buildCompressionUserPrompt(input) {
  return renderTemplate(readMarkdownFiles(COMPRESSION_USER_MODULES), {
    previous_summary: input.previousSummary || "无",
    messages: formatMessages(input.messages)
  });
}
function buildEvaluatorSystemPrompt() {
  return readMarkdownFiles(EVALUATOR_PROMPT_MODULES);
}
function buildEvaluatorUserPrompt(input) {
  return renderTemplate(readMarkdownFiles(EVALUATOR_USER_MODULES), {
    user_input: input.userInput,
    router_result: input.routerResult,
    assistant_answer: input.assistantAnswer
  });
}
function formatRecentMessages(messages) {
  return messages.slice(-8).map((message) => `${message.roleLabel}: ${message.content}`).join("\n\n") || "无";
}
function formatMessages(messages) {
  return messages.map((message) => {
    return [
      `id: ${message.id}`,
      `role: ${message.sender}`,
      `label: ${message.roleLabel}`,
      `time: ${message.createdAt}`,
      `content: ${message.content}`
    ].join("\n");
  }).join("\n\n---\n\n") || "无";
}
function renderTemplate(template, values) {
  return Object.entries(values).reduce((content, [key, value]) => {
    return content.replaceAll(`{{${key}}}`, value);
  }, template);
}
async function createOpenAiJsonChat(input) {
  var _a2, _b, _c, _d, _e, _f;
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    messages: input.messages,
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    response_format: {
      type: "json_object"
    },
    stream: false
  };
  const endpoint = `${trimTrailingSlash(input.config.baseURL)}/chat/completions`;
  const debugLog = createDebugLogBase({
    providerId: input.providerId,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint,
      headers: buildDebugHeaders(input.config),
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders$1(input.config),
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) {
    const message = `${response.status}: ${await response.text()}`;
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(`OpenAI-compatible 调用失败：${message}`);
  }
  const data = await response.json();
  const content = ((_d = (_c = (_b = (_a2 = data.choices) == null ? void 0 : _a2[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content) == null ? void 0 : _d.trim()) ?? "";
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content,
      stopReason: (_f = (_e = data.choices) == null ? void 0 : _e[0]) == null ? void 0 : _f.finish_reason,
      usage: data.usage
    }
  });
  return content;
}
async function streamOpenAiChat(input) {
  var _a2, _b;
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    messages: buildOpenAiMessages(input),
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    stream: true
  };
  const endpoint = `${trimTrailingSlash(input.config.baseURL)}/chat/completions`;
  const debugLog = createDebugLogBase({
    providerId: `${input.config.role}-${input.config.providerKind}`,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint,
      headers: buildDebugHeaders(input.config),
      body: requestBody,
      messageCount: requestBody.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders$1(input.config),
    body: JSON.stringify(requestBody)
  });
  if (!response.ok || !response.body) {
    const message = `${response.status}: ${await response.text()}`;
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(`OpenAI-compatible 流式调用失败：${message}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let stopReason;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice("data:".length).trim();
      if (data === "[DONE]") {
        continue;
      }
      try {
        const parsed = JSON.parse(data);
        const choice = (_a2 = parsed.choices) == null ? void 0 : _a2[0];
        const delta = ((_b = choice == null ? void 0 : choice.delta) == null ? void 0 : _b.content) ?? "";
        if (delta) {
          content += delta;
          input.onDelta(delta);
        }
        if (choice == null ? void 0 : choice.finish_reason) {
          stopReason = choice.finish_reason;
        }
      } catch {
      }
    }
  }
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content,
      stopReason
    }
  });
  return {
    content,
    stopReason
  };
}
async function streamOpenAiChatWithNativeTools(input) {
  const baseMessages = buildOpenAiMessages(input);
  const tools = buildOpenAiTools(input.toolSelection.selected_tools);
  if (tools.length === 0) {
    return streamOpenAiChat(input);
  }
  const messages = [...baseMessages];
  const nativeMessages = [];
  const nativeToolResults = [];
  let content = "";
  let stopReason;
  let usage;
  let toolRequestCount = 0;
  for (let requestIndex = 0; requestIndex < 8; requestIndex += 1) {
    const response = await createOpenAiNativeToolChat({
      config: input.config,
      messages,
      tools,
      latestUserMessage: input.latestUserMessage
    });
    const assistantMessage = normalizeAssistantMessage(response.message);
    messages.push(assistantMessage);
    nativeMessages.push(assistantMessage);
    stopReason = response.stopReason;
    usage = response.usage;
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      content = assistantMessage.content ?? "";
      if (content) {
        input.onDelta(content);
      }
      break;
    }
    for (const toolCall of assistantMessage.tool_calls) {
      if (toolRequestCount >= 8) {
        break;
      }
      toolRequestCount += 1;
      const request = toolRequestToLocalRequest(toolCall);
      const result = request ? await input.executeToolRequest(request) : unsupportedNativeToolResult(toolCall);
      const toolMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: formatNativeToolResult(result)
      };
      messages.push(toolMessage);
      nativeMessages.push(toolMessage);
      nativeToolResults.push(result);
    }
    if (toolRequestCount >= 8) {
      break;
    }
  }
  if (!content && toolRequestCount >= 8) {
    content = "[系统提示：本轮原生工具调用已达到 8 次上限，已停止继续请求工具。]";
    input.onDelta(content);
  }
  return {
    content,
    stopReason,
    usage,
    nativeMessages,
    nativeToolResults
  };
}
async function createOpenAiNativeToolChat(input) {
  var _a2;
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    messages: input.messages,
    tools: input.tools,
    tool_choice: "auto",
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    stream: false,
    ...input.config.thinkingEnabled ? { thinking: { type: "enabled" } } : {}
  };
  const endpoint = `${trimTrailingSlash(input.config.baseURL)}/chat/completions`;
  const debugLog = createDebugLogBase({
    providerId: `${input.config.role}-${input.config.providerKind}-native-tools`,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint,
      headers: buildDebugHeaders(input.config),
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders$1(input.config),
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) {
    const message2 = `${response.status}: ${await response.text()}`;
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message2
    });
    throw new Error(`OpenAI-compatible 原生工具调用失败：${message2}`);
  }
  const data = await response.json();
  const choice = (_a2 = data.choices) == null ? void 0 : _a2[0];
  const message = choice == null ? void 0 : choice.message;
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content: JSON.stringify({
        reasoning_content: message == null ? void 0 : message.reasoning_content,
        content: message == null ? void 0 : message.content,
        tool_calls: message == null ? void 0 : message.tool_calls
      }, null, 2),
      stopReason: choice == null ? void 0 : choice.finish_reason,
      usage: data.usage
    }
  });
  return {
    message,
    stopReason: choice == null ? void 0 : choice.finish_reason,
    usage: data.usage
  };
}
function buildOpenAiMessages(input) {
  const conversationMessages = input.messages.filter((message) => message.sender === "user" || message.sender === "assistant").flatMap((message) => {
    if (message.sender === "assistant") {
      const nativeMessages = extractNativeOpenAiMessages(message);
      if (nativeMessages.length > 0) {
        return nativeMessages;
      }
      return [{
        role: "assistant",
        content: message.content
      }];
    }
    return [{
      role: "user",
      content: message.content
    }];
  });
  const latestUserMessage = conversationMessages.at(-1);
  const historyMessages = latestUserMessage ? conversationMessages.slice(0, -1) : conversationMessages;
  return [
    {
      role: "system",
      content: input.system
    },
    ...historyMessages,
    {
      role: "user",
      content: input.runtimeContext
    },
    ...latestUserMessage ? [latestUserMessage] : []
  ];
}
function buildOpenAiTools(selectedTools) {
  const selected = new Set(selectedTools);
  const tools = [];
  if (selected.has("file.read")) {
    tools.push({
      type: "function",
      function: {
        name: "file_read",
        description: "Read a text file inside the current workspace.",
        parameters: objectSchema({
          reason: stringSchema("Why this file needs to be read."),
          path: stringSchema("Workspace-relative or absolute path inside the workspace."),
          maxBytes: numberSchema("Maximum number of bytes to read.")
        }, ["path"])
      }
    });
  }
  if (selected.has("file.list")) {
    tools.push({
      type: "function",
      function: {
        name: "file_list",
        description: "List files or directories inside the current workspace.",
        parameters: objectSchema({
          reason: stringSchema("Why this directory needs to be listed."),
          path: stringSchema("Workspace-relative or absolute directory path inside the workspace."),
          recursive: { type: "boolean", description: "Whether to list recursively." },
          maxEntries: numberSchema("Maximum number of entries to return.")
        }, ["path"])
      }
    });
  }
  if (selected.has("file.search")) {
    tools.push({
      type: "function",
      function: {
        name: "file_search",
        description: "Search text in files inside the current workspace.",
        parameters: objectSchema({
          reason: stringSchema("Why this search is needed."),
          path: stringSchema("Workspace-relative search root. Optional."),
          query: stringSchema("Text to search for."),
          glob: stringSchema("Optional simple file suffix or glob hint."),
          maxResults: numberSchema("Maximum number of results to return.")
        }, ["query"])
      }
    });
  }
  if (selected.has("file.write")) {
    tools.push({
      type: "function",
      function: {
        name: "file_write",
        description: "Write a text file inside the current workspace.",
        parameters: objectSchema({
          reason: stringSchema("Why this file needs to be written."),
          path: stringSchema("Workspace-relative or absolute path inside the workspace."),
          content: stringSchema("Full file content to write.")
        }, ["path", "content"])
      }
    });
  }
  if (selected.has("memory.save")) {
    tools.push({
      type: "function",
      function: {
        name: "memory_save",
        description: "Save a durable memory for future agent turns.",
        parameters: objectSchema({
          reason: stringSchema("Why this memory should be saved."),
          content: stringSchema("Memory content."),
          memoryType: {
            type: "string",
            enum: ["fact", "preference", "decision", "plan", "constraint"],
            description: "Memory category."
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Short tags."
          },
          importance: numberSchema("Importance between 0 and 1.")
        }, ["content"])
      }
    });
  }
  if (selected.has("command.run")) {
    tools.push({
      type: "function",
      function: {
        name: "command_run",
        description: "Run a PowerShell command in the current workspace when semantic tools are not enough.",
        parameters: objectSchema({
          reason: stringSchema("Why this command is needed."),
          cwd: stringSchema("Working directory inside the workspace."),
          command: stringSchema("PowerShell command to execute.")
        }, ["command"])
      }
    });
  }
  return tools;
}
function toolRequestToLocalRequest(toolCall) {
  const args = parseArguments(toolCall.function.arguments);
  const reason = typeof args.reason === "string" ? args.reason : "";
  if (toolCall.function.name === "file_read" && typeof args.path === "string") {
    return {
      type: "file.read",
      reason,
      path: args.path,
      maxBytes: typeof args.maxBytes === "number" ? args.maxBytes : void 0
    };
  }
  if (toolCall.function.name === "file_list" && typeof args.path === "string") {
    return {
      type: "file.list",
      reason,
      path: args.path,
      recursive: args.recursive === true,
      maxEntries: typeof args.maxEntries === "number" ? args.maxEntries : void 0
    };
  }
  if (toolCall.function.name === "file_search" && typeof args.query === "string") {
    return {
      type: "file.search",
      reason,
      path: typeof args.path === "string" ? args.path : void 0,
      query: args.query,
      glob: typeof args.glob === "string" ? args.glob : void 0,
      maxResults: typeof args.maxResults === "number" ? args.maxResults : void 0
    };
  }
  if (toolCall.function.name === "file_write" && typeof args.path === "string" && typeof args.content === "string") {
    return {
      type: "file.write",
      reason,
      path: args.path,
      content: args.content
    };
  }
  if (toolCall.function.name === "memory_save" && typeof args.content === "string") {
    return {
      type: "memory.save",
      reason,
      content: args.content,
      memoryType: toMemoryType$1(args.memoryType),
      tags: Array.isArray(args.tags) ? args.tags.filter((item) => typeof item === "string") : void 0,
      importance: typeof args.importance === "number" ? args.importance : void 0
    };
  }
  if (toolCall.function.name === "command_run" && typeof args.command === "string") {
    return {
      type: "command.run",
      reason,
      shell: "powershell",
      cwd: typeof args.cwd === "string" ? args.cwd : "",
      command: args.command
    };
  }
  return void 0;
}
function normalizeAssistantMessage(message) {
  return {
    role: "assistant",
    content: (message == null ? void 0 : message.content) ?? "",
    ...(message == null ? void 0 : message.reasoning_content) ? { reasoning_content: message.reasoning_content } : {},
    ...(message == null ? void 0 : message.tool_calls) && message.tool_calls.length > 0 ? { tool_calls: message.tool_calls } : {}
  };
}
function unsupportedNativeToolResult(toolCall) {
  return {
    request: {
      type: "memory.save",
      reason: "unsupported native tool call",
      content: `Unsupported tool call: ${toolCall.function.name}`
    },
    decision: "deny",
    status: "skipped",
    reason: `不支持的原生工具：${toolCall.function.name}`,
    stderr: toolCall.function.arguments
  };
}
function formatNativeToolResult(result) {
  return JSON.stringify({
    type: result.request.type,
    decision: result.decision,
    status: result.status,
    reason: result.reason,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.output,
    data: result.data
  }, null, 2);
}
function extractNativeOpenAiMessages(message) {
  var _a2;
  const value = (_a2 = message.metadata) == null ? void 0 : _a2.openaiNativeMessages;
  return Array.isArray(value) ? value.filter(isOpenAiMessage) : [];
}
function isOpenAiMessage(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const role = value.role;
  return role === "assistant" || role === "tool" || role === "user" || role === "system";
}
function parseArguments(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
function toMemoryType$1(value) {
  const allowed = ["fact", "preference", "decision", "plan", "constraint"];
  return typeof value === "string" && allowed.includes(value) ? value : void 0;
}
function objectSchema(properties, required) {
  return {
    type: "object",
    properties,
    required
  };
}
function stringSchema(description) {
  return {
    type: "string",
    description
  };
}
function numberSchema(description) {
  return {
    type: "number",
    description
  };
}
function buildHeaders$1(config) {
  return {
    "content-type": "application/json",
    ...config.apiKey ? { authorization: `Bearer ${config.apiKey.trim()}` } : {}
  };
}
function buildDebugHeaders(config) {
  return {
    "content-type": "application/json",
    authorization: config.apiKey ? "Bearer [redacted]" : ""
  };
}
function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}
async function compressConversationWithOllama(input) {
  var _a2, _b, _c;
  const startedAtMs = Date.now();
  const config = getModelRuntimeConfig("compression");
  const compressionMessages = [
    {
      role: "system",
      content: buildCompressionSystemPrompt()
    },
    {
      role: "user",
      content: buildCompressionUserPrompt({
        previousSummary: input.previousSummary ?? "",
        messages: input.messages
      })
    }
  ];
  if (config.providerKind === "openai-compatible") {
    const content2 = await createOpenAiJsonChat({
      config,
      providerId: "compression-openai-compatible",
      latestUserMessage: (_a2 = input.messages.at(-1)) == null ? void 0 : _a2.content,
      messages: compressionMessages
    });
    return parseCompressionResult(content2);
  }
  if (config.providerKind !== "ollama") {
    throw new Error(`会话压缩当前只支持 ollama 或 openai-compatible，实际配置为：${config.providerKind}`);
  }
  const requestBody = {
    model: config.model,
    stream: false,
    format: "json",
    messages: compressionMessages,
    options: {
      temperature: config.temperature,
      num_predict: config.maxTokens
    }
  };
  const latestUserMessage = (_b = input.messages.at(-1)) == null ? void 0 : _b.content;
  const debugLog = createDebugLogBase({
    providerId: "ollama-compression",
    model: config.model,
    baseURL: config.baseURL,
    request: {
      method: "POST",
      endpoint: `${config.baseURL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage
    }
  });
  const response = await fetch(`${config.baseURL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) {
    throw new Error(`Ollama 会话压缩 HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const content = (((_c = data.message) == null ? void 0 : _c.content) ?? data.response ?? "").trim();
  const result = parseCompressionResult(content);
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content
    }
  });
  return result;
}
function parseCompressionResult(content) {
  const parsed = JSON.parse(content);
  if (!parsed.summary || typeof parsed.summary !== "string") {
    throw new Error(`会话压缩结果无效：summary 不能为空。实际返回：${content}`);
  }
  return {
    summary: parsed.summary,
    decisions: toStringArray$2(parsed.decisions),
    openQuestions: toStringArray$2(parsed.open_questions),
    constraints: toStringArray$2(parsed.constraints),
    taskProgress: toStringArray$2(parsed.task_progress)
  };
}
function toStringArray$2(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
const MIN_MESSAGES_BEFORE_COMPRESSION = 24;
const RECENT_MESSAGES_TO_KEEP = 10;
const MIN_NEW_MESSAGES_TO_COMPRESS = 6;
async function maybeCompressConversation(input) {
  const latestSummary = getLatestConversationSummary(input.projectId, input.sessionId);
  if (input.messages.length < MIN_MESSAGES_BEFORE_COMPRESSION) {
    return latestSummary;
  }
  const compressionEndIndex = input.messages.length - RECENT_MESSAGES_TO_KEEP - 1;
  if (compressionEndIndex < 0) {
    return latestSummary;
  }
  const compressionEndMessage = input.messages[compressionEndIndex];
  if (!compressionEndMessage || (latestSummary == null ? void 0 : latestSummary.sourceEndMessageId) === compressionEndMessage.id) {
    return latestSummary;
  }
  const sourceMessages = selectSourceMessages(input.messages, latestSummary, compressionEndIndex);
  if (sourceMessages.length < MIN_NEW_MESSAGES_TO_COMPRESS) {
    return latestSummary;
  }
  const compressed = await compressConversationWithOllama({
    messages: sourceMessages,
    previousSummary: latestSummary == null ? void 0 : latestSummary.summary
  });
  const summary = saveConversationSummary({
    projectId: input.projectId,
    sessionId: input.sessionId,
    sourceMessages,
    summary: compressed.summary,
    decisions: compressed.decisions,
    openQuestions: compressed.openQuestions,
    constraints: compressed.constraints,
    taskProgress: compressed.taskProgress
  });
  saveConversationSummaryEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    summaryId: summary.id,
    content: summary.summary,
    payload: {
      sourceStartMessageId: summary.sourceStartMessageId,
      sourceEndMessageId: summary.sourceEndMessageId,
      decisions: summary.decisions,
      openQuestions: summary.openQuestions,
      constraints: summary.constraints,
      taskProgress: summary.taskProgress
    }
  });
  return summary;
}
function selectSourceMessages(messages, latestSummary, compressionEndIndex) {
  const afterPreviousSummaryIndex = latestSummary ? messages.findIndex((message) => message.id === latestSummary.sourceEndMessageId) + 1 : 0;
  const startIndex = afterPreviousSummaryIndex > 0 ? afterPreviousSummaryIndex : 0;
  return messages.slice(startIndex, compressionEndIndex + 1);
}
function captureLongTermMemories(input) {
  if (!shouldCaptureMemory(input.userContent, input.routerResult)) {
    return [];
  }
  return [
    saveMemory({
      projectId: input.projectId,
      type: inferMemoryType(input.userContent),
      content: input.userContent,
      tags: input.routerResult.keywords,
      importance: inferImportance(input.userContent),
      confidence: input.routerResult.confidence || 0.7,
      sourceSessionId: input.sessionId,
      sourceEventIds: [input.userMessageId]
    })
  ];
}
function saveMemory(input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const memory = {
    id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: input.projectId,
    type: input.type,
    content: input.content.trim(),
    tags: [...new Set(input.tags.filter((tag) => tag.trim().length > 0))],
    importance: clamp01(input.importance),
    confidence: clamp01(input.confidence),
    sourceSessionId: input.sourceSessionId,
    sourceEventIds: input.sourceEventIds,
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  getDatabase().prepare(
    `
        INSERT INTO memories (
          id,
          project_id,
          type,
          content,
          tags_json,
          importance,
          confidence,
          source_session_id,
          source_event_ids_json,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
  ).run(
    memory.id,
    memory.projectId,
    memory.type,
    memory.content,
    JSON.stringify(memory.tags),
    memory.importance,
    memory.confidence,
    memory.sourceSessionId ?? null,
    JSON.stringify(memory.sourceEventIds),
    memory.status,
    memory.createdAt,
    memory.updatedAt
  );
  return memory;
}
function listRelevantMemories(input) {
  const rows = getDatabase().prepare(
    `
        SELECT *
        FROM memories
        WHERE project_id = ? AND status = 'active'
        ORDER BY importance DESC, updated_at DESC
        LIMIT 80
      `
  ).all(input.projectId);
  const queryTerms = terms(input.query);
  return rows.map(toMemoryRecord).map((memory) => ({
    memory,
    score: scoreMemory(memory, queryTerms)
  })).filter((item) => item.score > 0 || item.memory.importance >= 0.8).sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance).slice(0, input.limit ?? 6).map((item) => item.memory);
}
function shouldCaptureMemory(content, routerResult) {
  const normalized = content.toLowerCase();
  const explicitSignals = [
    "记住",
    "记录",
    "长期",
    "以后",
    "后续",
    "我希望",
    "我偏好",
    "我不希望",
    "不要",
    "需要记录",
    "规则",
    "系统规则",
    "决定",
    "确认"
  ];
  return explicitSignals.some((signal) => normalized.includes(signal.toLowerCase())) || routerResult.task_type === "design" && routerResult.keywords.some((keyword) => ["记忆", "提示词", "架构", "规则"].includes(keyword));
}
function inferMemoryType(content) {
  if (content.includes("不要") || content.includes("我希望") || content.includes("偏好")) {
    return "preference";
  }
  if (content.includes("决定") || content.includes("确认")) {
    return "decision";
  }
  if (content.includes("后续") || content.includes("规划") || content.includes("目标")) {
    return "plan";
  }
  if (content.includes("规则") || content.includes("必须")) {
    return "constraint";
  }
  return "fact";
}
function inferImportance(content) {
  if (content.includes("系统规则") || content.includes("必须") || content.includes("长期")) {
    return 0.9;
  }
  if (content.includes("我希望") || content.includes("决定") || content.includes("确认")) {
    return 0.8;
  }
  return 0.65;
}
function scoreMemory(memory, queryTerms) {
  const haystack = `${memory.content} ${memory.tags.join(" ")}`.toLowerCase();
  const termScore = queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
  return termScore + memory.importance * 0.5 + memory.confidence * 0.25;
}
function terms(value) {
  return value.toLowerCase().split(/[\s,，。！？、:：;；"'`]+/).map((item) => item.trim()).filter((item) => item.length >= 2);
}
function toMemoryRecord(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    content: row.content,
    tags: parseStringArray(row.tags_json),
    importance: row.importance,
    confidence: row.confidence,
    sourceSessionId: row.source_session_id,
    sourceEventIds: parseStringArray(row.source_event_ids_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function parseStringArray(value) {
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
}
function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
const execFileAsync = promisify(execFile);
const MAX_OUTPUT_LENGTH = 2e4;
const DEFAULT_TIMEOUT_MS = 3e4;
const BUILD_TIMEOUT_MS = 12e4;
async function runCommandThroughGateway(input) {
  const startedAt = Date.now();
  const policy = decideCommand(input.request);
  if (policy.decision !== "allow") {
    return {
      request: input.request,
      decision: policy.decision,
      status: "skipped",
      reason: policy.reason,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    const result = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", input.request.command],
      {
        cwd: path$1.resolve(input.request.cwd),
        timeout: getTimeout(input.request.command),
        windowsHide: true,
        maxBuffer: MAX_OUTPUT_LENGTH * 2
      }
    );
    return {
      request: input.request,
      decision: "allow",
      status: "executed",
      reason: policy.reason,
      exitCode: 0,
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const execError = error;
    return {
      request: input.request,
      decision: "allow",
      status: "failed",
      reason: policy.reason,
      exitCode: typeof execError.code === "number" ? execError.code : void 0,
      stdout: truncateOutput(execError.stdout ?? ""),
      stderr: truncateOutput(execError.stderr ?? execError.message ?? ""),
      durationMs: Date.now() - startedAt
    };
  }
}
function decideCommand(request, _toolSelection) {
  if (request.shell !== "powershell") {
    return {
      decision: "deny",
      reason: "当前命令执行器只支持 PowerShell。"
    };
  }
  const command = request.command.trim();
  const deletionWarning = getDeletionWarning(command);
  if (deletionWarning) {
    return {
      decision: "confirm",
      reason: deletionWarning
    };
  }
  return {
    decision: "allow",
    reason: "管理员 Agent 模式：PowerShell 命令默认放行。"
  };
}
function isVerifyCommand(command) {
  const normalized = command.trim().toLowerCase();
  const verifyCommands = [
    "corepack pnpm build",
    "corepack pnpm test",
    "pnpm build",
    "pnpm test",
    "npm run build",
    "npm test"
  ];
  return verifyCommands.some((prefix) => normalized.startsWith(prefix));
}
function getDeletionWarning(command) {
  const normalized = command.trim().toLowerCase();
  const deletionPatterns = [
    "remove-item",
    " rm ",
    "rm ",
    "del ",
    "erase ",
    "rmdir ",
    "rd ",
    "git clean",
    "rimraf"
  ];
  return deletionPatterns.some((pattern) => normalized.includes(pattern)) ? "删除确认：该 PowerShell 命令看起来包含删除/清理操作，需要用户确认后才能执行。" : void 0;
}
function getTimeout(command) {
  return isVerifyCommand(command) ? BUILD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}
function truncateOutput(output) {
  return output.length > MAX_OUTPUT_LENGTH ? `${output.slice(0, MAX_OUTPUT_LENGTH)}
[output truncated]` : output;
}
const DEFAULT_MAX_READ_BYTES = 8e4;
const DEFAULT_MAX_LIST_ENTRIES = 200;
const DEFAULT_MAX_SEARCH_RESULTS = 80;
const MAX_WRITE_BYTES = 3e5;
const SKIPPED_DIRECTORIES = /* @__PURE__ */ new Set([".git", "node_modules", "dist", "dist-electron", ".vite"]);
const PROTECTED_WRITE_FILE_NAMES = /* @__PURE__ */ new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "secrets.local.json",
  "model-runtime.local.json",
  "agent.db",
  "agent.db-shm",
  "agent.db-wal"
]);
const PROTECTED_WRITE_EXTENSIONS = /* @__PURE__ */ new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".sqlite", ".db"]);
const PROTECTED_WRITE_PATH_PARTS = /* @__PURE__ */ new Set([".ssh"]);
async function runLocalToolThroughGateway(input) {
  if (input.request.type === "command.run") {
    return runCommandThroughGateway({
      request: input.request,
      toolSelection: input.toolSelection
    });
  }
  const startedAt = Date.now();
  const policy = decideLocalTool(input.request, input.toolSelection);
  if (policy.decision !== "allow") {
    return {
      request: input.request,
      decision: policy.decision,
      status: "skipped",
      reason: policy.reason,
      durationMs: Date.now() - startedAt
    };
  }
  try {
    const result = await executeLocalTool({
      request: input.request,
      projectId: input.projectId,
      sessionId: input.sessionId
    });
    return {
      request: input.request,
      decision: "allow",
      status: "executed",
      reason: policy.reason,
      ...result,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      request: input.request,
      decision: "allow",
      status: "failed",
      reason: policy.reason,
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}
function decideLocalTool(request, toolSelection) {
  if (isReadTool(request)) {
    return {
      decision: "allow",
      reason: `${request.type} 在管理员 Agent 模式下默认放行，包含敏感文件读取。`
    };
  }
  return {
    decision: "allow",
    reason: `${request.type} 在管理员 Agent 模式下默认放行。`
  };
}
async function executeLocalTool(input) {
  if (input.request.type === "file.read") {
    return readFileTool(input.request);
  }
  if (input.request.type === "file.list") {
    return listFileTool(input.request);
  }
  if (input.request.type === "file.search") {
    return searchFileTool(input.request);
  }
  if (input.request.type === "file.write") {
    return writeFileTool(input.request);
  }
  return saveMemoryTool(input.request, input.projectId, input.sessionId);
}
function readFileTool(request) {
  const filePath = resolveWorkspacePath(request.path);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`不是文件：${filePath}`);
  }
  const maxBytes = request.maxBytes ?? DEFAULT_MAX_READ_BYTES;
  const content = fs.readFileSync(filePath, "utf8");
  const truncated = Buffer.byteLength(content, "utf8") > maxBytes;
  const output = truncated ? content.slice(0, maxBytes) : content;
  return {
    output,
    data: {
      path: filePath,
      bytes: stat.size,
      truncated
    }
  };
}
function listFileTool(request) {
  const dirPath = resolveWorkspacePath(request.path);
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) {
    throw new Error(`不是目录：${dirPath}`);
  }
  const maxEntries = request.maxEntries ?? DEFAULT_MAX_LIST_ENTRIES;
  const entries = request.recursive ? listRecursive(dirPath, maxEntries) : fs.readdirSync(dirPath, { withFileTypes: true }).slice(0, maxEntries).map((entry) => {
    return {
      path: path$1.join(dirPath, entry.name),
      type: entry.isDirectory() ? "directory" : "file"
    };
  });
  return {
    output: entries.map((entry) => `${entry.type === "directory" ? "[dir]" : "[file]"} ${relativeWorkspacePath(entry.path)}`).join("\n"),
    data: {
      path: dirPath,
      entries,
      truncated: entries.length >= maxEntries
    }
  };
}
function searchFileTool(request) {
  const rootPath = resolveWorkspacePath(request.path ?? ".");
  const stat = fs.statSync(rootPath);
  const maxResults = request.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS;
  const files = stat.isDirectory() ? collectFiles(rootPath, maxResults * 20) : [rootPath];
  const results = [];
  const query = request.query.toLowerCase();
  for (const filePath of files) {
    if (results.length >= maxResults) {
      break;
    }
    if (request.glob && !filePath.endsWith(request.glob.replace("*", ""))) {
      continue;
    }
    const content = readTextFileIfPossible(filePath);
    if (content === void 0) {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
      if (lines[index].toLowerCase().includes(query)) {
        results.push({
          path: filePath,
          line: index + 1,
          text: lines[index].trim()
        });
      }
    }
  }
  return {
    output: results.map((item) => `${relativeWorkspacePath(item.path)}:${item.line}: ${item.text}`).join("\n"),
    data: {
      query: request.query,
      results,
      truncated: results.length >= maxResults
    }
  };
}
function writeFileTool(request) {
  const filePath = resolveWorkspacePath(request.path);
  assertNotProtectedWritePath(filePath);
  const bytes = Buffer.byteLength(request.content, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`写入内容过大：${bytes} bytes`);
  }
  fs.mkdirSync(path$1.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, request.content, "utf8");
  return {
    output: `已写入 ${relativeWorkspacePath(filePath)} (${bytes} bytes)`,
    data: {
      path: filePath,
      bytes
    }
  };
}
function saveMemoryTool(request, projectId, sessionId) {
  const memory = saveMemory({
    projectId,
    type: request.memoryType ?? "fact",
    content: request.content,
    tags: request.tags ?? [],
    importance: request.importance ?? 0.75,
    confidence: 0.8,
    sourceSessionId: sessionId,
    sourceEventIds: []
  });
  return {
    output: `已保存长期记忆：${memory.content}`,
    data: memory
  };
}
function resolveWorkspacePath(inputPath) {
  const workspaceRoot = path$1.resolve(resolveProjectPath());
  const resolved = path$1.isAbsolute(inputPath) ? path$1.resolve(inputPath) : path$1.resolve(workspaceRoot, inputPath);
  const relative = path$1.relative(workspaceRoot, resolved);
  if (relative.startsWith("..") || path$1.isAbsolute(relative)) {
    throw new Error(`路径不在工作区内：${resolved}`);
  }
  return resolved;
}
function relativeWorkspacePath(inputPath) {
  return path$1.relative(resolveProjectPath(), inputPath) || ".";
}
function isReadTool(request) {
  return request.type === "file.read" || request.type === "file.list" || request.type === "file.search";
}
function assertNotProtectedWritePath(inputPath) {
  if (isProtectedWritePath(inputPath)) {
    throw new Error(`敏感文件写入受保护，已拒绝写入：${relativeWorkspacePath(inputPath)}`);
  }
}
function isProtectedWritePath(inputPath) {
  const workspaceRoot = path$1.resolve(resolveProjectPath());
  const relative = path$1.relative(workspaceRoot, path$1.resolve(inputPath));
  const normalizedParts = relative.split(path$1.sep).map((part) => part.toLowerCase());
  const fileName = normalizedParts.at(-1) ?? "";
  const ext = path$1.extname(fileName);
  return normalizedParts.some((part) => PROTECTED_WRITE_PATH_PARTS.has(part)) || PROTECTED_WRITE_FILE_NAMES.has(fileName) || PROTECTED_WRITE_EXTENSIONS.has(ext) || fileName.includes("secret") || fileName.includes("token") || fileName.includes("apikey") || fileName.includes("api-key") || fileName.includes("credential");
}
function listRecursive(rootPath, maxEntries) {
  const results = [];
  const pending = [rootPath];
  while (pending.length > 0 && results.length < maxEntries) {
    const current = pending.shift() ?? rootPath;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (results.length >= maxEntries) {
        break;
      }
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const entryPath = path$1.join(current, entry.name);
      const type = entry.isDirectory() ? "directory" : "file";
      results.push({ path: entryPath, type });
      if (entry.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
  return results;
}
function collectFiles(rootPath, maxFiles) {
  const files = [];
  const pending = [rootPath];
  while (pending.length > 0 && files.length < maxFiles) {
    const current = pending.shift() ?? rootPath;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (files.length >= maxFiles) {
        break;
      }
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const entryPath = path$1.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else {
        files.push(entryPath);
      }
    }
  }
  return files;
}
function readTextFileIfPossible(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > DEFAULT_MAX_READ_BYTES) {
      return void 0;
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return void 0;
  }
}
function savePromptIteration(input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const record = {
    id: `prompt-iteration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: input.projectId,
    sessionId: input.sessionId,
    targetTemplate: input.targetTemplate,
    trigger: input.trigger,
    reason: input.reason,
    suggestedChange: input.suggestedChange,
    sourceEventIds: input.sourceEventIds,
    status: "proposed",
    createdAt: now,
    updatedAt: now
  };
  getDatabase().prepare(
    `
        INSERT INTO prompt_iterations (
          id,
          project_id,
          session_id,
          target_template,
          trigger,
          reason,
          suggested_change,
          source_event_ids_json,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
  ).run(
    record.id,
    record.projectId,
    record.sessionId,
    record.targetTemplate,
    record.trigger,
    record.reason,
    record.suggestedChange,
    JSON.stringify(record.sourceEventIds),
    record.status,
    record.createdAt,
    record.updatedAt
  );
  return record;
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (typeof state === "function" ? receiver !== state || true : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return state.set(receiver, value), value;
}
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
let uuid4 = function() {
  const { crypto } = globalThis;
  if (crypto == null ? void 0 : crypto.randomUUID) {
    uuid4 = crypto.randomUUID.bind(crypto);
    return crypto.randomUUID();
  }
  const u8 = new Uint8Array(1);
  const randomByte = crypto ? () => crypto.getRandomValues(u8)[0] : () => Math.random() * 255 & 255;
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ randomByte() & 15 >> +c / 4).toString(16));
};
function isAbortError(err) {
  return typeof err === "object" && err !== null && // Spec-compliant fetch implementations
  ("name" in err && err.name === "AbortError" || // Expo fetch
  "message" in err && String(err.message).includes("FetchRequestCanceledException"));
}
const castToError = (err) => {
  if (err instanceof Error)
    return err;
  if (typeof err === "object" && err !== null) {
    try {
      if (Object.prototype.toString.call(err) === "[object Error]") {
        const error = new Error(err.message, err.cause ? { cause: err.cause } : {});
        if (err.stack)
          error.stack = err.stack;
        if (err.cause && !error.cause)
          error.cause = err.cause;
        if (err.name)
          error.name = err.name;
        return error;
      }
    } catch {
    }
    try {
      return new Error(JSON.stringify(err));
    } catch {
    }
  }
  return new Error(err);
};
class AnthropicError extends Error {
}
class APIError extends AnthropicError {
  constructor(status, error, message, headers, type) {
    super(`${APIError.makeMessage(status, error, message)}`);
    this.status = status;
    this.headers = headers;
    this.requestID = headers == null ? void 0 : headers.get("request-id");
    this.error = error;
    this.type = type ?? null;
  }
  static makeMessage(status, error, message) {
    const msg = (error == null ? void 0 : error.message) ? typeof error.message === "string" ? error.message : JSON.stringify(error.message) : error ? JSON.stringify(error) : message;
    if (status && msg) {
      return `${status} ${msg}`;
    }
    if (status) {
      return `${status} status code (no body)`;
    }
    if (msg) {
      return msg;
    }
    return "(no status code or body)";
  }
  static generate(status, errorResponse, message, headers) {
    var _a2;
    if (!status || !headers) {
      return new APIConnectionError({ message, cause: castToError(errorResponse) });
    }
    const error = errorResponse;
    const type = (_a2 = error == null ? void 0 : error["error"]) == null ? void 0 : _a2["type"];
    if (status === 400) {
      return new BadRequestError(status, error, message, headers, type);
    }
    if (status === 401) {
      return new AuthenticationError(status, error, message, headers, type);
    }
    if (status === 403) {
      return new PermissionDeniedError(status, error, message, headers, type);
    }
    if (status === 404) {
      return new NotFoundError(status, error, message, headers, type);
    }
    if (status === 409) {
      return new ConflictError(status, error, message, headers, type);
    }
    if (status === 422) {
      return new UnprocessableEntityError(status, error, message, headers, type);
    }
    if (status === 429) {
      return new RateLimitError(status, error, message, headers, type);
    }
    if (status >= 500) {
      return new InternalServerError(status, error, message, headers, type);
    }
    return new APIError(status, error, message, headers, type);
  }
}
class APIUserAbortError extends APIError {
  constructor({ message } = {}) {
    super(void 0, void 0, message || "Request was aborted.", void 0);
  }
}
class APIConnectionError extends APIError {
  constructor({ message, cause }) {
    super(void 0, void 0, message || "Connection error.", void 0);
    if (cause)
      this.cause = cause;
  }
}
class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message } = {}) {
    super({ message: message ?? "Request timed out." });
  }
}
class BadRequestError extends APIError {
}
class AuthenticationError extends APIError {
}
class PermissionDeniedError extends APIError {
}
class NotFoundError extends APIError {
}
class ConflictError extends APIError {
}
class UnprocessableEntityError extends APIError {
}
class RateLimitError extends APIError {
}
class InternalServerError extends APIError {
}
const startsWithSchemeRegexp = /^[a-z][a-z0-9+.-]*:/i;
const isAbsoluteURL = (url) => {
  return startsWithSchemeRegexp.test(url);
};
let isArray = (val) => (isArray = Array.isArray, isArray(val));
let isReadonlyArray = isArray;
function maybeObj(x) {
  if (typeof x !== "object") {
    return {};
  }
  return x ?? {};
}
function isEmptyObj(obj) {
  if (!obj)
    return true;
  for (const _k in obj)
    return false;
  return true;
}
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
const validatePositiveInteger = (name, n) => {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new AnthropicError(`${name} must be an integer`);
  }
  if (n < 0) {
    throw new AnthropicError(`${name} must be a positive integer`);
  }
  return n;
};
const safeJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return void 0;
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const VERSION = "0.92.0";
const isRunningInBrowser = () => {
  return (
    // @ts-ignore
    typeof window !== "undefined" && // @ts-ignore
    typeof window.document !== "undefined" && // @ts-ignore
    typeof navigator !== "undefined"
  );
};
function getDetectedPlatform() {
  if (typeof Deno !== "undefined" && Deno.build != null) {
    return "deno";
  }
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }
  if (Object.prototype.toString.call(typeof globalThis.process !== "undefined" ? globalThis.process : 0) === "[object process]") {
    return "node";
  }
  return "unknown";
}
const getPlatformProperties = () => {
  var _a2;
  const detectedPlatform = getDetectedPlatform();
  if (detectedPlatform === "deno") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(Deno.build.os),
      "X-Stainless-Arch": normalizeArch(Deno.build.arch),
      "X-Stainless-Runtime": "deno",
      "X-Stainless-Runtime-Version": typeof Deno.version === "string" ? Deno.version : ((_a2 = Deno.version) == null ? void 0 : _a2.deno) ?? "unknown"
    };
  }
  if (typeof EdgeRuntime !== "undefined") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": `other:${EdgeRuntime}`,
      "X-Stainless-Runtime": "edge",
      "X-Stainless-Runtime-Version": globalThis.process.version
    };
  }
  if (detectedPlatform === "node") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(globalThis.process.platform ?? "unknown"),
      "X-Stainless-Arch": normalizeArch(globalThis.process.arch ?? "unknown"),
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown"
    };
  }
  const browserInfo = getBrowserInfo();
  if (browserInfo) {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": "unknown",
      "X-Stainless-Runtime": `browser:${browserInfo.browser}`,
      "X-Stainless-Runtime-Version": browserInfo.version
    };
  }
  return {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": VERSION,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": "unknown",
    "X-Stainless-Runtime-Version": "unknown"
  };
};
function getBrowserInfo() {
  if (typeof navigator === "undefined" || !navigator) {
    return null;
  }
  const browserPatterns = [
    { key: "edge", pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "chrome", pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "firefox", pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "safari", pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ }
  ];
  for (const { key, pattern } of browserPatterns) {
    const match = pattern.exec(navigator.userAgent);
    if (match) {
      const major = match[1] || 0;
      const minor = match[2] || 0;
      const patch = match[3] || 0;
      return { browser: key, version: `${major}.${minor}.${patch}` };
    }
  }
  return null;
}
const normalizeArch = (arch) => {
  if (arch === "x32")
    return "x32";
  if (arch === "x86_64" || arch === "x64")
    return "x64";
  if (arch === "arm")
    return "arm";
  if (arch === "aarch64" || arch === "arm64")
    return "arm64";
  if (arch)
    return `other:${arch}`;
  return "unknown";
};
const normalizePlatform = (platform) => {
  platform = platform.toLowerCase();
  if (platform.includes("ios"))
    return "iOS";
  if (platform === "android")
    return "Android";
  if (platform === "darwin")
    return "MacOS";
  if (platform === "win32")
    return "Windows";
  if (platform === "freebsd")
    return "FreeBSD";
  if (platform === "openbsd")
    return "OpenBSD";
  if (platform === "linux")
    return "Linux";
  if (platform)
    return `Other:${platform}`;
  return "Unknown";
};
let _platformHeaders;
const getPlatformHeaders = () => {
  return _platformHeaders ?? (_platformHeaders = getPlatformProperties());
};
function getDefaultFetch() {
  if (typeof fetch !== "undefined") {
    return fetch;
  }
  throw new Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new Anthropic({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function makeReadableStream(...args) {
  const ReadableStream = globalThis.ReadableStream;
  if (typeof ReadableStream === "undefined") {
    throw new Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
  }
  return new ReadableStream(...args);
}
function ReadableStreamFrom(iterable) {
  let iter = Symbol.asyncIterator in iterable ? iterable[Symbol.asyncIterator]() : iterable[Symbol.iterator]();
  return makeReadableStream({
    start() {
    },
    async pull(controller) {
      const { done, value } = await iter.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    async cancel() {
      var _a2;
      await ((_a2 = iter.return) == null ? void 0 : _a2.call(iter));
    }
  });
}
function ReadableStreamToAsyncIterable(stream) {
  if (stream[Symbol.asyncIterator])
    return stream;
  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result == null ? void 0 : result.done)
          reader.releaseLock();
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: void 0 };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}
async function CancelReadableStream(stream) {
  var _a2, _b;
  if (stream === null || typeof stream !== "object")
    return;
  if (stream[Symbol.asyncIterator]) {
    await ((_b = (_a2 = stream[Symbol.asyncIterator]()).return) == null ? void 0 : _b.call(_a2));
    return;
  }
  const reader = stream.getReader();
  const cancelPromise = reader.cancel();
  reader.releaseLock();
  await cancelPromise;
}
const FallbackEncoder = ({ headers, body }) => {
  return {
    bodyHeaders: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
};
function stringifyQuery(query) {
  return Object.entries(query).filter(([_, value]) => typeof value !== "undefined").map(([key, value]) => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    }
    if (value === null) {
      return `${encodeURIComponent(key)}=`;
    }
    throw new AnthropicError(`Cannot stringify type ${typeof value}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`);
  }).join("&");
}
function concatBytes(buffers) {
  let length = 0;
  for (const buffer of buffers) {
    length += buffer.length;
  }
  const output = new Uint8Array(length);
  let index = 0;
  for (const buffer of buffers) {
    output.set(buffer, index);
    index += buffer.length;
  }
  return output;
}
let encodeUTF8_;
function encodeUTF8(str) {
  let encoder;
  return (encodeUTF8_ ?? (encoder = new globalThis.TextEncoder(), encodeUTF8_ = encoder.encode.bind(encoder)))(str);
}
let decodeUTF8_;
function decodeUTF8(bytes) {
  let decoder;
  return (decodeUTF8_ ?? (decoder = new globalThis.TextDecoder(), decodeUTF8_ = decoder.decode.bind(decoder)))(bytes);
}
var _LineDecoder_buffer, _LineDecoder_carriageReturnIndex;
class LineDecoder {
  constructor() {
    _LineDecoder_buffer.set(this, void 0);
    _LineDecoder_carriageReturnIndex.set(this, void 0);
    __classPrivateFieldSet(this, _LineDecoder_buffer, new Uint8Array());
    __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null);
  }
  decode(chunk) {
    if (chunk == null) {
      return [];
    }
    const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : typeof chunk === "string" ? encodeUTF8(chunk) : chunk;
    __classPrivateFieldSet(this, _LineDecoder_buffer, concatBytes([__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), binaryChunk]));
    const lines = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f"))) != null) {
      if (patternIndex.carriage && __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") == null) {
        __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, patternIndex.index);
        continue;
      }
      if (__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") != null && (patternIndex.index !== __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") + 1 || patternIndex.carriage)) {
        lines.push(decodeUTF8(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") - 1)));
        __classPrivateFieldSet(this, _LineDecoder_buffer, __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")));
        __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null);
        continue;
      }
      const endIndex = __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") !== null ? patternIndex.preceding - 1 : patternIndex.preceding;
      const line = decodeUTF8(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, endIndex));
      lines.push(line);
      __classPrivateFieldSet(this, _LineDecoder_buffer, __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(patternIndex.index));
      __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null);
    }
    return lines;
  }
  flush() {
    if (!__classPrivateFieldGet(this, _LineDecoder_buffer, "f").length) {
      return [];
    }
    return this.decode("\n");
  }
}
_LineDecoder_buffer = /* @__PURE__ */ new WeakMap(), _LineDecoder_carriageReturnIndex = /* @__PURE__ */ new WeakMap();
LineDecoder.NEWLINE_CHARS = /* @__PURE__ */ new Set(["\n", "\r"]);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
function findNewlineIndex(buffer, startIndex) {
  const newline = 10;
  const carriage = 13;
  for (let i = startIndex ?? 0; i < buffer.length; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }
    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }
  return null;
}
function findDoubleNewlineIndex(buffer) {
  const newline = 10;
  const carriage = 13;
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === newline && buffer[i + 1] === newline) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === carriage) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === newline && i + 3 < buffer.length && buffer[i + 2] === carriage && buffer[i + 3] === newline) {
      return i + 4;
    }
  }
  return -1;
}
const levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500
};
const parseLogLevel = (maybeLevel, sourceName, client) => {
  if (!maybeLevel) {
    return void 0;
  }
  if (hasOwn(levelNumbers, maybeLevel)) {
    return maybeLevel;
  }
  loggerFor(client).warn(`${sourceName} was set to ${JSON.stringify(maybeLevel)}, expected one of ${JSON.stringify(Object.keys(levelNumbers))}`);
  return void 0;
};
function noop() {
}
function makeLogFn(fnLevel, logger, logLevel) {
  if (!logger || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
    return noop;
  } else {
    return logger[fnLevel].bind(logger);
  }
}
const noopLogger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop
};
let cachedLoggers = /* @__PURE__ */ new WeakMap();
function loggerFor(client) {
  const logger = client.logger;
  const logLevel = client.logLevel ?? "off";
  if (!logger) {
    return noopLogger;
  }
  const cachedLogger = cachedLoggers.get(logger);
  if (cachedLogger && cachedLogger[0] === logLevel) {
    return cachedLogger[1];
  }
  const levelLogger = {
    error: makeLogFn("error", logger, logLevel),
    warn: makeLogFn("warn", logger, logLevel),
    info: makeLogFn("info", logger, logLevel),
    debug: makeLogFn("debug", logger, logLevel)
  };
  cachedLoggers.set(logger, [logLevel, levelLogger]);
  return levelLogger;
}
const formatRequestDetails = (details) => {
  if (details.options) {
    details.options = { ...details.options };
    delete details.options["headers"];
  }
  if (details.headers) {
    details.headers = Object.fromEntries((details.headers instanceof Headers ? [...details.headers] : Object.entries(details.headers)).map(([name, value]) => [
      name,
      name.toLowerCase() === "x-api-key" || name.toLowerCase() === "authorization" || name.toLowerCase() === "cookie" || name.toLowerCase() === "set-cookie" ? "***" : value
    ]));
  }
  if ("retryOfRequestLogID" in details) {
    if (details.retryOfRequestLogID) {
      details.retryOf = details.retryOfRequestLogID;
    }
    delete details.retryOfRequestLogID;
  }
  return details;
};
var _Stream_client;
class Stream {
  constructor(iterator, controller, client) {
    this.iterator = iterator;
    _Stream_client.set(this, void 0);
    this.controller = controller;
    __classPrivateFieldSet(this, _Stream_client, client);
  }
  static fromSSEResponse(response, controller, client) {
    let consumed = false;
    const logger = client ? loggerFor(client) : console;
    async function* iterator() {
      var _a2;
      if (consumed) {
        throw new AnthropicError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (sse.event === "completion") {
            try {
              yield JSON.parse(sse.data);
            } catch (e) {
              logger.error(`Could not parse message into JSON:`, sse.data);
              logger.error(`From chunk:`, sse.raw);
              throw e;
            }
          }
          if (sse.event === "message_start" || sse.event === "message_delta" || sse.event === "message_stop" || sse.event === "content_block_start" || sse.event === "content_block_delta" || sse.event === "content_block_stop" || sse.event === "message" || sse.event === "user.message" || sse.event === "user.interrupt" || sse.event === "user.tool_confirmation" || sse.event === "user.custom_tool_result" || sse.event === "agent.message" || sse.event === "agent.thinking" || sse.event === "agent.tool_use" || sse.event === "agent.tool_result" || sse.event === "agent.mcp_tool_use" || sse.event === "agent.mcp_tool_result" || sse.event === "agent.custom_tool_use" || sse.event === "agent.thread_context_compacted" || sse.event === "session.status_running" || sse.event === "session.status_idle" || sse.event === "session.status_rescheduled" || sse.event === "session.status_terminated" || sse.event === "session.error" || sse.event === "session.deleted" || sse.event === "span.model_request_start" || sse.event === "span.model_request_end") {
            try {
              yield JSON.parse(sse.data);
            } catch (e) {
              logger.error(`Could not parse message into JSON:`, sse.data);
              logger.error(`From chunk:`, sse.raw);
              throw e;
            }
          }
          if (sse.event === "ping") {
            continue;
          }
          if (sse.event === "error") {
            const body = safeJSON(sse.data) ?? sse.data;
            const type = (_a2 = body == null ? void 0 : body.error) == null ? void 0 : _a2.type;
            throw new APIError(void 0, body, void 0, response.headers, type);
          }
        }
        done = true;
      } catch (e) {
        if (isAbortError(e))
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new Stream(iterator, controller, client);
  }
  /**
   * Generates a Stream from a newline-separated ReadableStream
   * where each item is a JSON value.
   */
  static fromReadableStream(readableStream, controller, client) {
    let consumed = false;
    async function* iterLines() {
      const lineDecoder = new LineDecoder();
      const iter = ReadableStreamToAsyncIterable(readableStream);
      for await (const chunk of iter) {
        for (const line of lineDecoder.decode(chunk)) {
          yield line;
        }
      }
      for (const line of lineDecoder.flush()) {
        yield line;
      }
    }
    async function* iterator() {
      if (consumed) {
        throw new AnthropicError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const line of iterLines()) {
          if (done)
            continue;
          if (line)
            yield JSON.parse(line);
        }
        done = true;
      } catch (e) {
        if (isAbortError(e))
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new Stream(iterator, controller, client);
  }
  [(_Stream_client = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    return this.iterator();
  }
  /**
   * Splits the stream into two streams which can be
   * independently read from at different speeds.
   */
  tee() {
    const left = [];
    const right = [];
    const iterator = this.iterator();
    const teeIterator = (queue) => {
      return {
        next: () => {
          if (queue.length === 0) {
            const result = iterator.next();
            left.push(result);
            right.push(result);
          }
          return queue.shift();
        }
      };
    };
    return [
      new Stream(() => teeIterator(left), this.controller, __classPrivateFieldGet(this, _Stream_client, "f")),
      new Stream(() => teeIterator(right), this.controller, __classPrivateFieldGet(this, _Stream_client, "f"))
    ];
  }
  /**
   * Converts this stream to a newline-separated ReadableStream of
   * JSON stringified values in the stream
   * which can be turned back into a Stream with `Stream.fromReadableStream()`.
   */
  toReadableStream() {
    const self = this;
    let iter;
    return makeReadableStream({
      async start() {
        iter = self[Symbol.asyncIterator]();
      },
      async pull(ctrl) {
        try {
          const { value, done } = await iter.next();
          if (done)
            return ctrl.close();
          const bytes = encodeUTF8(JSON.stringify(value) + "\n");
          ctrl.enqueue(bytes);
        } catch (err) {
          ctrl.error(err);
        }
      },
      async cancel() {
        var _a2;
        await ((_a2 = iter.return) == null ? void 0 : _a2.call(iter));
      }
    });
  }
}
async function* _iterSSEMessages(response, controller) {
  if (!response.body) {
    controller.abort();
    if (typeof globalThis.navigator !== "undefined" && globalThis.navigator.product === "ReactNative") {
      throw new AnthropicError(`The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`);
    }
    throw new AnthropicError(`Attempted to iterate over a response with no body`);
  }
  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const iter = ReadableStreamToAsyncIterable(response.body);
  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse = sseDecoder.decode(line);
      if (sse)
        yield sse;
    }
  }
  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse)
      yield sse;
  }
}
async function* iterSSEChunks(iterator) {
  let data = new Uint8Array();
  for await (const chunk of iterator) {
    if (chunk == null) {
      continue;
    }
    const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : typeof chunk === "string" ? encodeUTF8(chunk) : chunk;
    let newData = new Uint8Array(data.length + binaryChunk.length);
    newData.set(data);
    newData.set(binaryChunk, data.length);
    data = newData;
    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
      yield data.slice(0, patternIndex);
      data = data.slice(patternIndex);
    }
  }
  if (data.length > 0) {
    yield data;
  }
}
class SSEDecoder {
  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }
  decode(line) {
    if (line.endsWith("\r")) {
      line = line.substring(0, line.length - 1);
    }
    if (!line) {
      if (!this.event && !this.data.length)
        return null;
      const sse = {
        event: this.event,
        data: this.data.join("\n"),
        raw: this.chunks
      };
      this.event = null;
      this.data = [];
      this.chunks = [];
      return sse;
    }
    this.chunks.push(line);
    if (line.startsWith(":")) {
      return null;
    }
    let [fieldname, _, value] = partition(line, ":");
    if (value.startsWith(" ")) {
      value = value.substring(1);
    }
    if (fieldname === "event") {
      this.event = value;
    } else if (fieldname === "data") {
      this.data.push(value);
    }
    return null;
  }
}
function partition(str, delimiter) {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
  }
  return [str, "", ""];
}
async function defaultParseResponse(client, props) {
  const { response, requestLogID, retryOfRequestLogID, startTime } = props;
  const body = await (async () => {
    var _a2;
    if (props.options.stream) {
      loggerFor(client).debug("response", response.status, response.url, response.headers, response.body);
      if (props.options.__streamClass) {
        return props.options.__streamClass.fromSSEResponse(response, props.controller);
      }
      return Stream.fromSSEResponse(response, props.controller);
    }
    if (response.status === 204) {
      return null;
    }
    if (props.options.__binaryResponse) {
      return response;
    }
    const contentType = response.headers.get("content-type");
    const mediaType = (_a2 = contentType == null ? void 0 : contentType.split(";")[0]) == null ? void 0 : _a2.trim();
    const isJSON = (mediaType == null ? void 0 : mediaType.includes("application/json")) || (mediaType == null ? void 0 : mediaType.endsWith("+json"));
    if (isJSON) {
      const contentLength = response.headers.get("content-length");
      if (contentLength === "0") {
        return void 0;
      }
      const json = await response.json();
      return addRequestID(json, response);
    }
    const text = await response.text();
    return text;
  })();
  loggerFor(client).debug(`[${requestLogID}] response parsed`, formatRequestDetails({
    retryOfRequestLogID,
    url: response.url,
    status: response.status,
    body,
    durationMs: Date.now() - startTime
  }));
  return body;
}
function addRequestID(value, response) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.defineProperty(value, "_request_id", {
    value: response.headers.get("request-id"),
    enumerable: false
  });
}
var _APIPromise_client;
class APIPromise extends Promise {
  constructor(client, responsePromise, parseResponse = defaultParseResponse) {
    super((resolve) => {
      resolve(null);
    });
    this.responsePromise = responsePromise;
    this.parseResponse = parseResponse;
    _APIPromise_client.set(this, void 0);
    __classPrivateFieldSet(this, _APIPromise_client, client);
  }
  _thenUnwrap(transform) {
    return new APIPromise(__classPrivateFieldGet(this, _APIPromise_client, "f"), this.responsePromise, async (client, props) => addRequestID(transform(await this.parseResponse(client, props), props), props.response));
  }
  /**
   * Gets the raw `Response` instance instead of parsing the response
   * data.
   *
   * If you want to parse the response body but still get the `Response`
   * instance, you can use {@link withResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  asResponse() {
    return this.responsePromise.then((p) => p.response);
  }
  /**
   * Gets the parsed response data, the raw `Response` instance and the ID of the request,
   * returned via the `request-id` header which is useful for debugging requests and resporting
   * issues to Anthropic.
   *
   * If you just want to get the raw `Response` instance without parsing it,
   * you can use {@link asResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  async withResponse() {
    const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
    return { data, response, request_id: response.headers.get("request-id") };
  }
  parse() {
    if (!this.parsedPromise) {
      this.parsedPromise = this.responsePromise.then((data) => this.parseResponse(__classPrivateFieldGet(this, _APIPromise_client, "f"), data));
    }
    return this.parsedPromise;
  }
  then(onfulfilled, onrejected) {
    return this.parse().then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.parse().catch(onrejected);
  }
  finally(onfinally) {
    return this.parse().finally(onfinally);
  }
}
_APIPromise_client = /* @__PURE__ */ new WeakMap();
var _AbstractPage_client;
class AbstractPage {
  constructor(client, response, body, options) {
    _AbstractPage_client.set(this, void 0);
    __classPrivateFieldSet(this, _AbstractPage_client, client);
    this.options = options;
    this.response = response;
    this.body = body;
  }
  hasNextPage() {
    const items = this.getPaginatedItems();
    if (!items.length)
      return false;
    return this.nextPageRequestOptions() != null;
  }
  async getNextPage() {
    const nextOptions = this.nextPageRequestOptions();
    if (!nextOptions) {
      throw new AnthropicError("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");
    }
    return await __classPrivateFieldGet(this, _AbstractPage_client, "f").requestAPIList(this.constructor, nextOptions);
  }
  async *iterPages() {
    let page = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }
  async *[(_AbstractPage_client = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    for await (const page of this.iterPages()) {
      for (const item of page.getPaginatedItems()) {
        yield item;
      }
    }
  }
}
class PagePromise extends APIPromise {
  constructor(client, request, Page2) {
    super(client, request, async (client2, props) => new Page2(client2, props.response, await defaultParseResponse(client2, props), props.options));
  }
  /**
   * Allow auto-paginating iteration on an unawaited list call, eg:
   *
   *    for await (const item of client.items.list()) {
   *      console.log(item)
   *    }
   */
  async *[Symbol.asyncIterator]() {
    const page = await this;
    for await (const item of page) {
      yield item;
    }
  }
}
class Page extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
    this.first_id = body.first_id || null;
    this.last_id = body.last_id || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    var _a2;
    if ((_a2 = this.options.query) == null ? void 0 : _a2["before_id"]) {
      const first_id = this.first_id;
      if (!first_id) {
        return null;
      }
      return {
        ...this.options,
        query: {
          ...maybeObj(this.options.query),
          before_id: first_id
        }
      };
    }
    const cursor = this.last_id;
    if (!cursor) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        after_id: cursor
      }
    };
  }
}
class PageCursor extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.next_page = body.next_page || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  nextPageRequestOptions() {
    const cursor = this.next_page;
    if (!cursor) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        page: cursor
      }
    };
  }
}
const checkFileSupport = () => {
  var _a2;
  if (typeof File === "undefined") {
    const { process: process2 } = globalThis;
    const isOldNode = typeof ((_a2 = process2 == null ? void 0 : process2.versions) == null ? void 0 : _a2.node) === "string" && parseInt(process2.versions.node.split(".")) < 20;
    throw new Error("`File` is not defined as a global, which is required for file uploads." + (isOldNode ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`." : ""));
  }
};
function makeFile(fileBits, fileName, options) {
  checkFileSupport();
  return new File(fileBits, fileName ?? "unknown_file", options);
}
function getName(value, stripPath) {
  const val = typeof value === "object" && value !== null && ("name" in value && value.name && String(value.name) || "url" in value && value.url && String(value.url) || "filename" in value && value.filename && String(value.filename) || "path" in value && value.path && String(value.path)) || "";
  return stripPath ? val.split(/[\\/]/).pop() || void 0 : val;
}
const isAsyncIterable = (value) => value != null && typeof value === "object" && typeof value[Symbol.asyncIterator] === "function";
const multipartFormRequestOptions = async (opts, fetch2, stripFilenames = true) => {
  return { ...opts, body: await createForm(opts.body, fetch2, stripFilenames) };
};
const supportsFormDataMap = /* @__PURE__ */ new WeakMap();
function supportsFormData(fetchObject) {
  const fetch2 = typeof fetchObject === "function" ? fetchObject : fetchObject.fetch;
  const cached = supportsFormDataMap.get(fetch2);
  if (cached)
    return cached;
  const promise = (async () => {
    try {
      const FetchResponse = "Response" in fetch2 ? fetch2.Response : (await fetch2("data:,")).constructor;
      const data = new FormData();
      if (data.toString() === await new FetchResponse(data).text()) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  })();
  supportsFormDataMap.set(fetch2, promise);
  return promise;
}
const createForm = async (body, fetch2, stripFilenames = true) => {
  if (!await supportsFormData(fetch2)) {
    throw new TypeError("The provided fetch function does not support file uploads with the current global FormData class.");
  }
  const form = new FormData();
  await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value, stripFilenames)));
  return form;
};
const isNamedBlob = (value) => value instanceof Blob && "name" in value;
const addFormValue = async (form, key, value, stripFilenames) => {
  if (value === void 0)
    return;
  if (value == null) {
    throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    form.append(key, String(value));
  } else if (value instanceof Response) {
    let options = {};
    const contentType = value.headers.get("Content-Type");
    if (contentType) {
      options = { type: contentType };
    }
    form.append(key, makeFile([await value.blob()], getName(value, stripFilenames), options));
  } else if (isAsyncIterable(value)) {
    form.append(key, makeFile([await new Response(ReadableStreamFrom(value)).blob()], getName(value, stripFilenames)));
  } else if (isNamedBlob(value)) {
    form.append(key, makeFile([value], getName(value, stripFilenames), { type: value.type }));
  } else if (Array.isArray(value)) {
    await Promise.all(value.map((entry) => addFormValue(form, key + "[]", entry, stripFilenames)));
  } else if (typeof value === "object") {
    await Promise.all(Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop, stripFilenames)));
  } else {
    throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
  }
};
const isBlobLike = (value) => value != null && typeof value === "object" && typeof value.size === "number" && typeof value.type === "string" && typeof value.text === "function" && typeof value.slice === "function" && typeof value.arrayBuffer === "function";
const isFileLike = (value) => value != null && typeof value === "object" && typeof value.name === "string" && typeof value.lastModified === "number" && isBlobLike(value);
const isResponseLike = (value) => value != null && typeof value === "object" && typeof value.url === "string" && typeof value.blob === "function";
async function toFile(value, name, options) {
  checkFileSupport();
  value = await value;
  name || (name = getName(value, true));
  if (isFileLike(value)) {
    if (value instanceof File && name == null && options == null) {
      return value;
    }
    return makeFile([await value.arrayBuffer()], name ?? value.name, {
      type: value.type,
      lastModified: value.lastModified,
      ...options
    });
  }
  if (isResponseLike(value)) {
    const blob = await value.blob();
    name || (name = new URL(value.url).pathname.split(/[\\/]/).pop());
    return makeFile(await getBytes(blob), name, options);
  }
  const parts = await getBytes(value);
  if (!(options == null ? void 0 : options.type)) {
    const type = parts.find((part) => typeof part === "object" && "type" in part && part.type);
    if (typeof type === "string") {
      options = { ...options, type };
    }
  }
  return makeFile(parts, name, options);
}
async function getBytes(value) {
  var _a2;
  let parts = [];
  if (typeof value === "string" || ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
  value instanceof ArrayBuffer) {
    parts.push(value);
  } else if (isBlobLike(value)) {
    parts.push(value instanceof Blob ? value : await value.arrayBuffer());
  } else if (isAsyncIterable(value)) {
    for await (const chunk of value) {
      parts.push(...await getBytes(chunk));
    }
  } else {
    const constructor = (_a2 = value == null ? void 0 : value.constructor) == null ? void 0 : _a2.name;
    throw new Error(`Unexpected data type: ${typeof value}${constructor ? `; constructor: ${constructor}` : ""}${propsForError(value)}`);
  }
  return parts;
}
function propsForError(value) {
  if (typeof value !== "object" || value === null)
    return "";
  const props = Object.getOwnPropertyNames(value);
  return `; props: [${props.map((p) => `"${p}"`).join(", ")}]`;
}
class APIResource {
  constructor(client) {
    this._client = client;
  }
}
const brand_privateNullableHeaders = Symbol.for("brand.privateNullableHeaders");
function* iterateHeaders(headers) {
  if (!headers)
    return;
  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }
  let shouldClear = false;
  let iter;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = Object.entries(headers ?? {});
  }
  for (let row of iter) {
    const name = row[0];
    if (typeof name !== "string")
      throw new TypeError("expected header name to be a string");
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === void 0)
        continue;
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}
const buildHeaders = (newHeaders) => {
  const targetHeaders = new Headers();
  const nullHeaders = /* @__PURE__ */ new Set();
  for (const headers of newHeaders) {
    const seenHeaders = /* @__PURE__ */ new Set();
    for (const [name, value] of iterateHeaders(headers)) {
      const lowerName = name.toLowerCase();
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(name);
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(name);
        nullHeaders.add(lowerName);
      } else {
        targetHeaders.append(name, value);
        nullHeaders.delete(lowerName);
      }
    }
  }
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};
function encodeURIPath(str) {
  return str.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
const EMPTY = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null));
const createPathTagFunction = (pathEncoder = encodeURIPath) => function path2(statics, ...params) {
  if (statics.length === 1)
    return statics[0];
  let postPath = false;
  const invalidSegments = [];
  const path3 = statics.reduce((previousValue, currentValue, index) => {
    var _a2;
    if (/[?#]/.test(currentValue)) {
      postPath = true;
    }
    const value = params[index];
    let encoded = (postPath ? encodeURIComponent : pathEncoder)("" + value);
    if (index !== params.length && (value == null || typeof value === "object" && // handle values from other realms
    value.toString === ((_a2 = Object.getPrototypeOf(Object.getPrototypeOf(value.hasOwnProperty ?? EMPTY) ?? EMPTY)) == null ? void 0 : _a2.toString))) {
      encoded = value + "";
      invalidSegments.push({
        start: previousValue.length + currentValue.length,
        length: encoded.length,
        error: `Value of type ${Object.prototype.toString.call(value).slice(8, -1)} is not a valid path parameter`
      });
    }
    return previousValue + currentValue + (index === params.length ? "" : encoded);
  }, "");
  const pathOnly = path3.split(/[?#]/, 1)[0];
  const invalidSegmentPattern = new RegExp("(?<=^|\\/)(?:\\.|%2e){1,2}(?=\\/|$)", "gi");
  let match;
  while ((match = invalidSegmentPattern.exec(pathOnly)) !== null) {
    invalidSegments.push({
      start: match.index,
      length: match[0].length,
      error: `Value "${match[0]}" can't be safely passed as a path parameter`
    });
  }
  invalidSegments.sort((a, b) => a.start - b.start);
  if (invalidSegments.length > 0) {
    let lastEnd = 0;
    const underline = invalidSegments.reduce((acc, segment) => {
      const spaces = " ".repeat(segment.start - lastEnd);
      const arrows = "^".repeat(segment.length);
      lastEnd = segment.start + segment.length;
      return acc + spaces + arrows;
    }, "");
    throw new AnthropicError(`Path parameters result in path with invalid segments:
${invalidSegments.map((e) => e.error).join("\n")}
${path3}
${underline}`);
  }
  return path3;
};
const path = /* @__PURE__ */ createPathTagFunction(encodeURIPath);
class Environments extends APIResource {
  /**
   * Create a new environment with the specified configuration.
   *
   * @example
   * ```ts
   * const betaEnvironment =
   *   await client.beta.environments.create({
   *     name: 'python-data-analysis',
   *   });
   * ```
   */
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/environments?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Retrieve a specific environment by ID.
   *
   * @example
   * ```ts
   * const betaEnvironment =
   *   await client.beta.environments.retrieve(
   *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
   *   );
   * ```
   */
  retrieve(environmentID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/environments/${environmentID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Update an existing environment's configuration.
   *
   * @example
   * ```ts
   * const betaEnvironment =
   *   await client.beta.environments.update(
   *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
   *   );
   * ```
   */
  update(environmentID, params, options) {
    const { betas, ...body } = params;
    return this._client.post(path`/v1/environments/${environmentID}?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List environments with pagination support.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaEnvironment of client.beta.environments.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/environments?beta=true", PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete an environment by ID. Returns a confirmation of the deletion.
   *
   * @example
   * ```ts
   * const betaEnvironmentDeleteResponse =
   *   await client.beta.environments.delete(
   *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
   *   );
   * ```
   */
  delete(environmentID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/v1/environments/${environmentID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Archive an environment by ID. Archived environments cannot be used to create new
   * sessions.
   *
   * @example
   * ```ts
   * const betaEnvironment =
   *   await client.beta.environments.archive(
   *     'env_011CZkZ9X2dpNyB7HsEFoRfW',
   *   );
   * ```
   */
  archive(environmentID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.post(path`/v1/environments/${environmentID}/archive?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
const SDK_HELPER_SYMBOL = Symbol("anthropic.sdk.stainlessHelper");
function wasCreatedByStainlessHelper(value) {
  return typeof value === "object" && value !== null && SDK_HELPER_SYMBOL in value;
}
function collectStainlessHelpers(tools, messages) {
  const helpers = /* @__PURE__ */ new Set();
  if (tools) {
    for (const tool of tools) {
      if (wasCreatedByStainlessHelper(tool)) {
        helpers.add(tool[SDK_HELPER_SYMBOL]);
      }
    }
  }
  if (messages) {
    for (const message of messages) {
      if (wasCreatedByStainlessHelper(message)) {
        helpers.add(message[SDK_HELPER_SYMBOL]);
      }
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (wasCreatedByStainlessHelper(block)) {
            helpers.add(block[SDK_HELPER_SYMBOL]);
          }
        }
      }
    }
  }
  return Array.from(helpers);
}
function stainlessHelperHeader(tools, messages) {
  const helpers = collectStainlessHelpers(tools, messages);
  if (helpers.length === 0)
    return {};
  return { "x-stainless-helper": helpers.join(", ") };
}
function stainlessHelperHeaderFromFile(file) {
  if (wasCreatedByStainlessHelper(file)) {
    return { "x-stainless-helper": file[SDK_HELPER_SYMBOL] };
  }
  return {};
}
class Files extends APIResource {
  /**
   * List Files
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fileMetadata of client.beta.files.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/files?beta=true", Page, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "files-api-2025-04-14"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete File
   *
   * @example
   * ```ts
   * const deletedFile = await client.beta.files.delete(
   *   'file_id',
   * );
   * ```
   */
  delete(fileID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/v1/files/${fileID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "files-api-2025-04-14"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Download File
   *
   * @example
   * ```ts
   * const response = await client.beta.files.download(
   *   'file_id',
   * );
   *
   * const content = await response.blob();
   * console.log(content);
   * ```
   */
  download(fileID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/files/${fileID}/content?beta=true`, {
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [...betas ?? [], "files-api-2025-04-14"].toString(),
          Accept: "application/binary"
        },
        options == null ? void 0 : options.headers
      ]),
      __binaryResponse: true
    });
  }
  /**
   * Get File Metadata
   *
   * @example
   * ```ts
   * const fileMetadata =
   *   await client.beta.files.retrieveMetadata('file_id');
   * ```
   */
  retrieveMetadata(fileID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/files/${fileID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "files-api-2025-04-14"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Upload File
   *
   * @example
   * ```ts
   * const fileMetadata = await client.beta.files.upload({
   *   file: fs.createReadStream('path/to/file'),
   * });
   * ```
   */
  upload(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/files?beta=true", multipartFormRequestOptions({
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "files-api-2025-04-14"].toString() },
        stainlessHelperHeaderFromFile(body.file),
        options == null ? void 0 : options.headers
      ])
    }, this._client));
  }
}
let Models$1 = class Models extends APIResource {
  /**
   * Get a specific model.
   *
   * The Models API response can be used to determine information about a specific
   * model or resolve a model alias to a model ID.
   *
   * @example
   * ```ts
   * const betaModelInfo = await client.beta.models.retrieve(
   *   'model_id',
   * );
   * ```
   */
  retrieve(modelID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/models/${modelID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { ...(betas == null ? void 0 : betas.toString()) != null ? { "anthropic-beta": betas == null ? void 0 : betas.toString() } : void 0 },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List available models.
   *
   * The Models API response can be used to determine which models are available for
   * use in the API. More recently released models are listed first.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaModelInfo of client.beta.models.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/models?beta=true", Page, {
      query,
      ...options,
      headers: buildHeaders([
        { ...(betas == null ? void 0 : betas.toString()) != null ? { "anthropic-beta": betas == null ? void 0 : betas.toString() } : void 0 },
        options == null ? void 0 : options.headers
      ])
    });
  }
};
class UserProfiles extends APIResource {
  /**
   * Create User Profile
   *
   * @example
   * ```ts
   * const betaUserProfile =
   *   await client.beta.userProfiles.create();
   * ```
   */
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/user_profiles?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "user-profiles-2026-03-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Get User Profile
   *
   * @example
   * ```ts
   * const betaUserProfile =
   *   await client.beta.userProfiles.retrieve(
   *     'uprof_011CZkZCu8hGbp5mYRQgUmz9',
   *   );
   * ```
   */
  retrieve(userProfileID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/user_profiles/${userProfileID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "user-profiles-2026-03-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Update User Profile
   *
   * @example
   * ```ts
   * const betaUserProfile =
   *   await client.beta.userProfiles.update(
   *     'uprof_011CZkZCu8hGbp5mYRQgUmz9',
   *   );
   * ```
   */
  update(userProfileID, params, options) {
    const { betas, ...body } = params;
    return this._client.post(path`/v1/user_profiles/${userProfileID}?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "user-profiles-2026-03-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List User Profiles
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaUserProfile of client.beta.userProfiles.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/user_profiles?beta=true", PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "user-profiles-2026-03-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Create Enrollment URL
   *
   * @example
   * ```ts
   * const betaUserProfileEnrollmentURL =
   *   await client.beta.userProfiles.createEnrollmentURL(
   *     'uprof_011CZkZCu8hGbp5mYRQgUmz9',
   *   );
   * ```
   */
  createEnrollmentURL(userProfileID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.post(path`/v1/user_profiles/${userProfileID}/enrollment_url?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "user-profiles-2026-03-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
let Versions$1 = class Versions extends APIResource {
  /**
   * List Agent Versions
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsAgent of client.beta.agents.versions.list(
   *   'agent_011CZkYpogX7uDKUyvBTophP',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(agentID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList(path`/v1/agents/${agentID}/versions?beta=true`, PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
};
class Agents extends APIResource {
  constructor() {
    super(...arguments);
    this.versions = new Versions$1(this._client);
  }
  /**
   * Create Agent
   *
   * @example
   * ```ts
   * const betaManagedAgentsAgent =
   *   await client.beta.agents.create({
   *     model: 'claude-sonnet-4-6',
   *     name: 'My First Agent',
   *   });
   * ```
   */
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/agents?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Get Agent
   *
   * @example
   * ```ts
   * const betaManagedAgentsAgent =
   *   await client.beta.agents.retrieve(
   *     'agent_011CZkYpogX7uDKUyvBTophP',
   *   );
   * ```
   */
  retrieve(agentID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.get(path`/v1/agents/${agentID}?beta=true`, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Update Agent
   *
   * @example
   * ```ts
   * const betaManagedAgentsAgent =
   *   await client.beta.agents.update(
   *     'agent_011CZkYpogX7uDKUyvBTophP',
   *     { version: 1 },
   *   );
   * ```
   */
  update(agentID, params, options) {
    const { betas, ...body } = params;
    return this._client.post(path`/v1/agents/${agentID}?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List Agents
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsAgent of client.beta.agents.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/agents?beta=true", PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Archive Agent
   *
   * @example
   * ```ts
   * const betaManagedAgentsAgent =
   *   await client.beta.agents.archive(
   *     'agent_011CZkYpogX7uDKUyvBTophP',
   *   );
   * ```
   */
  archive(agentID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.post(path`/v1/agents/${agentID}/archive?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
Agents.Versions = Versions$1;
class Memories extends APIResource {
  /**
   * Create a memory
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemory =
   *   await client.beta.memoryStores.memories.create(
   *     'memory_store_id',
   *     { content: 'content', path: 'xx' },
   *   );
   * ```
   */
  create(memoryStoreID, params, options) {
    const { view, betas, ...body } = params;
    return this._client.post(path`/v1/memory_stores/${memoryStoreID}/memories?beta=true`, {
      query: { view },
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Retrieve a memory
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemory =
   *   await client.beta.memoryStores.memories.retrieve(
   *     'memory_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  retrieve(memoryID, params, options) {
    const { memory_store_id, betas, ...query } = params;
    return this._client.get(path`/v1/memory_stores/${memory_store_id}/memories/${memoryID}?beta=true`, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Update a memory
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemory =
   *   await client.beta.memoryStores.memories.update(
   *     'memory_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  update(memoryID, params, options) {
    const { memory_store_id, view, betas, ...body } = params;
    return this._client.post(path`/v1/memory_stores/${memory_store_id}/memories/${memoryID}?beta=true`, {
      query: { view },
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List memories
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsMemoryListItem of client.beta.memoryStores.memories.list(
   *   'memory_store_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(memoryStoreID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList(path`/v1/memory_stores/${memoryStoreID}/memories?beta=true`, PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete a memory
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeletedMemory =
   *   await client.beta.memoryStores.memories.delete(
   *     'memory_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  delete(memoryID, params, options) {
    const { memory_store_id, expected_content_sha256, betas } = params;
    return this._client.delete(path`/v1/memory_stores/${memory_store_id}/memories/${memoryID}?beta=true`, {
      query: { expected_content_sha256 },
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
class MemoryVersions extends APIResource {
  /**
   * Retrieve a memory version
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemoryVersion =
   *   await client.beta.memoryStores.memoryVersions.retrieve(
   *     'memory_version_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  retrieve(memoryVersionID, params, options) {
    const { memory_store_id, betas, ...query } = params;
    return this._client.get(path`/v1/memory_stores/${memory_store_id}/memory_versions/${memoryVersionID}?beta=true`, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List memory versions
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsMemoryVersion of client.beta.memoryStores.memoryVersions.list(
   *   'memory_store_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(memoryStoreID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList(path`/v1/memory_stores/${memoryStoreID}/memory_versions?beta=true`, PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Redact a memory version
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemoryVersion =
   *   await client.beta.memoryStores.memoryVersions.redact(
   *     'memory_version_id',
   *     { memory_store_id: 'memory_store_id' },
   *   );
   * ```
   */
  redact(memoryVersionID, params, options) {
    const { memory_store_id, betas } = params;
    return this._client.post(path`/v1/memory_stores/${memory_store_id}/memory_versions/${memoryVersionID}/redact?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
class MemoryStores extends APIResource {
  constructor() {
    super(...arguments);
    this.memories = new Memories(this._client);
    this.memoryVersions = new MemoryVersions(this._client);
  }
  /**
   * Create a memory store
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemoryStore =
   *   await client.beta.memoryStores.create({ name: 'x' });
   * ```
   */
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/memory_stores?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Retrieve a memory store
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemoryStore =
   *   await client.beta.memoryStores.retrieve(
   *     'memory_store_id',
   *   );
   * ```
   */
  retrieve(memoryStoreID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/memory_stores/${memoryStoreID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Update a memory store
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemoryStore =
   *   await client.beta.memoryStores.update('memory_store_id');
   * ```
   */
  update(memoryStoreID, params, options) {
    const { betas, ...body } = params;
    return this._client.post(path`/v1/memory_stores/${memoryStoreID}?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List memory stores
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsMemoryStore of client.beta.memoryStores.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/memory_stores?beta=true", PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete a memory store
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeletedMemoryStore =
   *   await client.beta.memoryStores.delete('memory_store_id');
   * ```
   */
  delete(memoryStoreID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/v1/memory_stores/${memoryStoreID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Archive a memory store
   *
   * @example
   * ```ts
   * const betaManagedAgentsMemoryStore =
   *   await client.beta.memoryStores.archive('memory_store_id');
   * ```
   */
  archive(memoryStoreID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.post(path`/v1/memory_stores/${memoryStoreID}/archive?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
MemoryStores.Memories = Memories;
MemoryStores.MemoryVersions = MemoryVersions;
class JSONLDecoder {
  constructor(iterator, controller) {
    this.iterator = iterator;
    this.controller = controller;
  }
  async *decoder() {
    const lineDecoder = new LineDecoder();
    for await (const chunk of this.iterator) {
      for (const line of lineDecoder.decode(chunk)) {
        yield JSON.parse(line);
      }
    }
    for (const line of lineDecoder.flush()) {
      yield JSON.parse(line);
    }
  }
  [Symbol.asyncIterator]() {
    return this.decoder();
  }
  static fromResponse(response, controller) {
    if (!response.body) {
      controller.abort();
      if (typeof globalThis.navigator !== "undefined" && globalThis.navigator.product === "ReactNative") {
        throw new AnthropicError(`The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`);
      }
      throw new AnthropicError(`Attempted to iterate over a response with no body`);
    }
    return new JSONLDecoder(ReadableStreamToAsyncIterable(response.body), controller);
  }
}
let Batches$1 = class Batches extends APIResource {
  /**
   * Send a batch of Message creation requests.
   *
   * The Message Batches API can be used to process multiple Messages API requests at
   * once. Once a Message Batch is created, it begins processing immediately. Batches
   * can take up to 24 hours to complete.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatch =
   *   await client.beta.messages.batches.create({
   *     requests: [
   *       {
   *         custom_id: 'my-custom-id-1',
   *         params: {
   *           max_tokens: 1024,
   *           messages: [
   *             { content: 'Hello, world', role: 'user' },
   *           ],
   *           model: 'claude-opus-4-6',
   *         },
   *       },
   *     ],
   *   });
   * ```
   */
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/messages/batches?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * This endpoint is idempotent and can be used to poll for Message Batch
   * completion. To access the results of a Message Batch, make a request to the
   * `results_url` field in the response.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatch =
   *   await client.beta.messages.batches.retrieve(
   *     'message_batch_id',
   *   );
   * ```
   */
  retrieve(messageBatchID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/messages/batches/${messageBatchID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List all Message Batches within a Workspace. Most recently created batches are
   * returned first.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaMessageBatch of client.beta.messages.batches.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/messages/batches?beta=true", Page, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete a Message Batch.
   *
   * Message Batches can only be deleted once they've finished processing. If you'd
   * like to delete an in-progress batch, you must first cancel it.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaDeletedMessageBatch =
   *   await client.beta.messages.batches.delete(
   *     'message_batch_id',
   *   );
   * ```
   */
  delete(messageBatchID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/v1/messages/batches/${messageBatchID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Batches may be canceled any time before processing ends. Once cancellation is
   * initiated, the batch enters a `canceling` state, at which time the system may
   * complete any in-progress, non-interruptible requests before finalizing
   * cancellation.
   *
   * The number of canceled requests is specified in `request_counts`. To determine
   * which requests were canceled, check the individual results within the batch.
   * Note that cancellation may not result in any canceled requests if they were
   * non-interruptible.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatch =
   *   await client.beta.messages.batches.cancel(
   *     'message_batch_id',
   *   );
   * ```
   */
  cancel(messageBatchID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.post(path`/v1/messages/batches/${messageBatchID}/cancel?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Streams the results of a Message Batch as a `.jsonl` file.
   *
   * Each line in the file is a JSON object containing the result of a single request
   * in the Message Batch. Results are not guaranteed to be in the same order as
   * requests. Use the `custom_id` field to match results to requests.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const betaMessageBatchIndividualResponse =
   *   await client.beta.messages.batches.results(
   *     'message_batch_id',
   *   );
   * ```
   */
  async results(messageBatchID, params = {}, options) {
    const batch = await this.retrieve(messageBatchID);
    if (!batch.results_url) {
      throw new AnthropicError(`No batch \`results_url\`; Has it finished processing? ${batch.processing_status} - ${batch.id}`);
    }
    const { betas } = params ?? {};
    return this._client.get(batch.results_url, {
      ...options,
      headers: buildHeaders([
        {
          "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString(),
          Accept: "application/binary"
        },
        options == null ? void 0 : options.headers
      ]),
      stream: true,
      __binaryResponse: true
    })._thenUnwrap((_, props) => JSONLDecoder.fromResponse(props.response, props.controller));
  }
};
const MODEL_NONSTREAMING_TOKENS = {
  "claude-opus-4-20250514": 8192,
  "claude-opus-4-0": 8192,
  "claude-4-opus-20250514": 8192,
  "anthropic.claude-opus-4-20250514-v1:0": 8192,
  "claude-opus-4@20250514": 8192,
  "claude-opus-4-1-20250805": 8192,
  "anthropic.claude-opus-4-1-20250805-v1:0": 8192,
  "claude-opus-4-1@20250805": 8192
};
function getOutputFormat$1(params) {
  var _a2;
  return (params == null ? void 0 : params.output_format) ?? ((_a2 = params == null ? void 0 : params.output_config) == null ? void 0 : _a2.format);
}
function maybeParseBetaMessage(message, params, opts) {
  const outputFormat = getOutputFormat$1(params);
  if (!params || !("parse" in (outputFormat ?? {}))) {
    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type === "text") {
          const parsedBlock = Object.defineProperty({ ...block }, "parsed_output", {
            value: null,
            enumerable: false
          });
          return Object.defineProperty(parsedBlock, "parsed", {
            get() {
              opts.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead.");
              return null;
            },
            enumerable: false
          });
        }
        return block;
      }),
      parsed_output: null
    };
  }
  return parseBetaMessage(message, params, opts);
}
function parseBetaMessage(message, params, opts) {
  let firstParsedOutput = null;
  const content = message.content.map((block) => {
    if (block.type === "text") {
      const parsedOutput = parseBetaOutputFormat(params, block.text);
      if (firstParsedOutput === null) {
        firstParsedOutput = parsedOutput;
      }
      const parsedBlock = Object.defineProperty({ ...block }, "parsed_output", {
        value: parsedOutput,
        enumerable: false
      });
      return Object.defineProperty(parsedBlock, "parsed", {
        get() {
          opts.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead.");
          return parsedOutput;
        },
        enumerable: false
      });
    }
    return block;
  });
  return {
    ...message,
    content,
    parsed_output: firstParsedOutput
  };
}
function parseBetaOutputFormat(params, content) {
  const outputFormat = getOutputFormat$1(params);
  if ((outputFormat == null ? void 0 : outputFormat.type) !== "json_schema") {
    return null;
  }
  try {
    if ("parse" in outputFormat) {
      return outputFormat.parse(content);
    }
    return JSON.parse(content);
  } catch (error) {
    throw new AnthropicError(`Failed to parse structured output: ${error}`);
  }
}
const tokenize = (input) => {
  let current = 0;
  let tokens = [];
  while (current < input.length) {
    let char = input[current];
    if (char === "\\") {
      current++;
      continue;
    }
    if (char === "{") {
      tokens.push({
        type: "brace",
        value: "{"
      });
      current++;
      continue;
    }
    if (char === "}") {
      tokens.push({
        type: "brace",
        value: "}"
      });
      current++;
      continue;
    }
    if (char === "[") {
      tokens.push({
        type: "paren",
        value: "["
      });
      current++;
      continue;
    }
    if (char === "]") {
      tokens.push({
        type: "paren",
        value: "]"
      });
      current++;
      continue;
    }
    if (char === ":") {
      tokens.push({
        type: "separator",
        value: ":"
      });
      current++;
      continue;
    }
    if (char === ",") {
      tokens.push({
        type: "delimiter",
        value: ","
      });
      current++;
      continue;
    }
    if (char === '"') {
      let value = "";
      let danglingQuote = false;
      char = input[++current];
      while (char !== '"') {
        if (current === input.length) {
          danglingQuote = true;
          break;
        }
        if (char === "\\") {
          current++;
          if (current === input.length) {
            danglingQuote = true;
            break;
          }
          value += char + input[current];
          char = input[++current];
        } else {
          value += char;
          char = input[++current];
        }
      }
      char = input[++current];
      if (!danglingQuote) {
        tokens.push({
          type: "string",
          value
        });
      }
      continue;
    }
    let WHITESPACE = /\s/;
    if (char && WHITESPACE.test(char)) {
      current++;
      continue;
    }
    let NUMBERS = /[0-9]/;
    if (char && NUMBERS.test(char) || char === "-" || char === ".") {
      let value = "";
      if (char === "-") {
        value += char;
        char = input[++current];
      }
      while (char && NUMBERS.test(char) || char === ".") {
        value += char;
        char = input[++current];
      }
      tokens.push({
        type: "number",
        value
      });
      continue;
    }
    let LETTERS = /[a-z]/i;
    if (char && LETTERS.test(char)) {
      let value = "";
      while (char && LETTERS.test(char)) {
        if (current === input.length) {
          break;
        }
        value += char;
        char = input[++current];
      }
      if (value == "true" || value == "false" || value === "null") {
        tokens.push({
          type: "name",
          value
        });
      } else {
        current++;
        continue;
      }
      continue;
    }
    current++;
  }
  return tokens;
}, strip = (tokens) => {
  if (tokens.length === 0) {
    return tokens;
  }
  let lastToken = tokens[tokens.length - 1];
  switch (lastToken.type) {
    case "separator":
      tokens = tokens.slice(0, tokens.length - 1);
      return strip(tokens);
    case "number":
      let lastCharacterOfLastToken = lastToken.value[lastToken.value.length - 1];
      if (lastCharacterOfLastToken === "." || lastCharacterOfLastToken === "-") {
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      }
    case "string":
      let tokenBeforeTheLastToken = tokens[tokens.length - 2];
      if ((tokenBeforeTheLastToken == null ? void 0 : tokenBeforeTheLastToken.type) === "delimiter") {
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      } else if ((tokenBeforeTheLastToken == null ? void 0 : tokenBeforeTheLastToken.type) === "brace" && tokenBeforeTheLastToken.value === "{") {
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      }
      break;
    case "delimiter":
      tokens = tokens.slice(0, tokens.length - 1);
      return strip(tokens);
  }
  return tokens;
}, unstrip = (tokens) => {
  let tail = [];
  tokens.map((token) => {
    if (token.type === "brace") {
      if (token.value === "{") {
        tail.push("}");
      } else {
        tail.splice(tail.lastIndexOf("}"), 1);
      }
    }
    if (token.type === "paren") {
      if (token.value === "[") {
        tail.push("]");
      } else {
        tail.splice(tail.lastIndexOf("]"), 1);
      }
    }
  });
  if (tail.length > 0) {
    tail.reverse().map((item) => {
      if (item === "}") {
        tokens.push({
          type: "brace",
          value: "}"
        });
      } else if (item === "]") {
        tokens.push({
          type: "paren",
          value: "]"
        });
      }
    });
  }
  return tokens;
}, generate = (tokens) => {
  let output = "";
  tokens.map((token) => {
    switch (token.type) {
      case "string":
        output += '"' + token.value + '"';
        break;
      default:
        output += token.value;
        break;
    }
  });
  return output;
}, partialParse = (input) => JSON.parse(generate(unstrip(strip(tokenize(input)))));
var _BetaMessageStream_instances, _BetaMessageStream_currentMessageSnapshot, _BetaMessageStream_params, _BetaMessageStream_connectedPromise, _BetaMessageStream_resolveConnectedPromise, _BetaMessageStream_rejectConnectedPromise, _BetaMessageStream_endPromise, _BetaMessageStream_resolveEndPromise, _BetaMessageStream_rejectEndPromise, _BetaMessageStream_listeners, _BetaMessageStream_ended, _BetaMessageStream_errored, _BetaMessageStream_aborted, _BetaMessageStream_catchingPromiseCreated, _BetaMessageStream_response, _BetaMessageStream_request_id, _BetaMessageStream_logger, _BetaMessageStream_getFinalMessage, _BetaMessageStream_getFinalText, _BetaMessageStream_handleError, _BetaMessageStream_beginRequest, _BetaMessageStream_addStreamEvent, _BetaMessageStream_endRequest, _BetaMessageStream_accumulateMessage;
const JSON_BUF_PROPERTY$1 = "__json_buf";
function tracksToolInput$1(content) {
  return content.type === "tool_use" || content.type === "server_tool_use" || content.type === "mcp_tool_use";
}
class BetaMessageStream {
  constructor(params, opts) {
    _BetaMessageStream_instances.add(this);
    this.messages = [];
    this.receivedMessages = [];
    _BetaMessageStream_currentMessageSnapshot.set(this, void 0);
    _BetaMessageStream_params.set(this, null);
    this.controller = new AbortController();
    _BetaMessageStream_connectedPromise.set(this, void 0);
    _BetaMessageStream_resolveConnectedPromise.set(this, () => {
    });
    _BetaMessageStream_rejectConnectedPromise.set(this, () => {
    });
    _BetaMessageStream_endPromise.set(this, void 0);
    _BetaMessageStream_resolveEndPromise.set(this, () => {
    });
    _BetaMessageStream_rejectEndPromise.set(this, () => {
    });
    _BetaMessageStream_listeners.set(this, {});
    _BetaMessageStream_ended.set(this, false);
    _BetaMessageStream_errored.set(this, false);
    _BetaMessageStream_aborted.set(this, false);
    _BetaMessageStream_catchingPromiseCreated.set(this, false);
    _BetaMessageStream_response.set(this, void 0);
    _BetaMessageStream_request_id.set(this, void 0);
    _BetaMessageStream_logger.set(this, void 0);
    _BetaMessageStream_handleError.set(this, (error) => {
      __classPrivateFieldSet(this, _BetaMessageStream_errored, true);
      if (isAbortError(error)) {
        error = new APIUserAbortError();
      }
      if (error instanceof APIUserAbortError) {
        __classPrivateFieldSet(this, _BetaMessageStream_aborted, true);
        return this._emit("abort", error);
      }
      if (error instanceof AnthropicError) {
        return this._emit("error", error);
      }
      if (error instanceof Error) {
        const anthropicError = new AnthropicError(error.message);
        anthropicError.cause = error;
        return this._emit("error", anthropicError);
      }
      return this._emit("error", new AnthropicError(String(error)));
    });
    __classPrivateFieldSet(this, _BetaMessageStream_connectedPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _BetaMessageStream_resolveConnectedPromise, resolve, "f");
      __classPrivateFieldSet(this, _BetaMessageStream_rejectConnectedPromise, reject, "f");
    }));
    __classPrivateFieldSet(this, _BetaMessageStream_endPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _BetaMessageStream_resolveEndPromise, resolve, "f");
      __classPrivateFieldSet(this, _BetaMessageStream_rejectEndPromise, reject, "f");
    }));
    __classPrivateFieldGet(this, _BetaMessageStream_connectedPromise, "f").catch(() => {
    });
    __classPrivateFieldGet(this, _BetaMessageStream_endPromise, "f").catch(() => {
    });
    __classPrivateFieldSet(this, _BetaMessageStream_params, params);
    __classPrivateFieldSet(this, _BetaMessageStream_logger, (opts == null ? void 0 : opts.logger) ?? console);
  }
  get response() {
    return __classPrivateFieldGet(this, _BetaMessageStream_response, "f");
  }
  get request_id() {
    return __classPrivateFieldGet(this, _BetaMessageStream_request_id, "f");
  }
  /**
   * Returns the `MessageStream` data, the raw `Response` instance and the ID of the request,
   * returned vie the `request-id` header which is useful for debugging requests and resporting
   * issues to Anthropic.
   *
   * This is the same as the `APIPromise.withResponse()` method.
   *
   * This method will raise an error if you created the stream using `MessageStream.fromReadableStream`
   * as no `Response` is available.
   */
  async withResponse() {
    __classPrivateFieldSet(this, _BetaMessageStream_catchingPromiseCreated, true);
    const response = await __classPrivateFieldGet(this, _BetaMessageStream_connectedPromise, "f");
    if (!response) {
      throw new Error("Could not resolve a `Response` object");
    }
    return {
      data: this,
      response,
      request_id: response.headers.get("request-id")
    };
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(stream) {
    const runner = new BetaMessageStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static createMessage(messages, params, options, { logger } = {}) {
    const runner = new BetaMessageStream(params, { logger });
    for (const message of params.messages) {
      runner._addMessageParam(message);
    }
    __classPrivateFieldSet(runner, _BetaMessageStream_params, { ...params, stream: true });
    runner._run(() => runner._createMessage(messages, { ...params, stream: true }, { ...options, headers: { ...options == null ? void 0 : options.headers, "X-Stainless-Helper-Method": "stream" } }));
    return runner;
  }
  _run(executor) {
    executor().then(() => {
      this._emitFinal();
      this._emit("end");
    }, __classPrivateFieldGet(this, _BetaMessageStream_handleError, "f"));
  }
  _addMessageParam(message) {
    this.messages.push(message);
  }
  _addMessage(message, emit = true) {
    this.receivedMessages.push(message);
    if (emit) {
      this._emit("message", message);
    }
  }
  async _createMessage(messages, params, options) {
    var _a2;
    const signal = options == null ? void 0 : options.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_beginRequest).call(this);
      const { response, data: stream } = await messages.create({ ...params, stream: true }, { ...options, signal: this.controller.signal }).withResponse();
      this._connected(response);
      for await (const event of stream) {
        __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_addStreamEvent).call(this, event);
      }
      if ((_a2 = stream.controller.signal) == null ? void 0 : _a2.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_endRequest).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  _connected(response) {
    if (this.ended)
      return;
    __classPrivateFieldSet(this, _BetaMessageStream_response, response);
    __classPrivateFieldSet(this, _BetaMessageStream_request_id, response == null ? void 0 : response.headers.get("request-id"));
    __classPrivateFieldGet(this, _BetaMessageStream_resolveConnectedPromise, "f").call(this, response);
    this._emit("connect");
  }
  get ended() {
    return __classPrivateFieldGet(this, _BetaMessageStream_ended, "f");
  }
  get errored() {
    return __classPrivateFieldGet(this, _BetaMessageStream_errored, "f");
  }
  get aborted() {
    return __classPrivateFieldGet(this, _BetaMessageStream_aborted, "f");
  }
  abort() {
    this.controller.abort();
  }
  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns this MessageStream, so that calls can be chained
   */
  on(event, listener) {
    const listeners = __classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] || (__classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] = []);
    listeners.push({ listener });
    return this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this MessageStream, so that calls can be chained
   */
  off(event, listener) {
    const listeners = __classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event];
    if (!listeners)
      return this;
    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0)
      listeners.splice(index, 1);
    return this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this MessageStream, so that calls can be chained
   */
  once(event, listener) {
    const listeners = __classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] || (__classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }
  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * @returns a Promise that resolves the next time given event is triggered,
   * or rejects if an error is emitted.  (If you request the 'error' event,
   * returns a promise that resolves with the error).
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted(event) {
    return new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _BetaMessageStream_catchingPromiseCreated, true);
      if (event !== "error")
        this.once("error", reject);
      this.once(event, resolve);
    });
  }
  async done() {
    __classPrivateFieldSet(this, _BetaMessageStream_catchingPromiseCreated, true);
    await __classPrivateFieldGet(this, _BetaMessageStream_endPromise, "f");
  }
  get currentMessage() {
    return __classPrivateFieldGet(this, _BetaMessageStream_currentMessageSnapshot, "f");
  }
  /**
   * @returns a promise that resolves with the the final assistant Message response,
   * or rejects if an error occurred or the stream ended prematurely without producing a Message.
   * If structured outputs were used, this will be a ParsedMessage with a `parsed` field.
   */
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_getFinalMessage).call(this);
  }
  /**
   * @returns a promise that resolves with the the final assistant Message's text response, concatenated
   * together if there are more than one text blocks.
   * Rejects if an error occurred or the stream ended prematurely without producing a Message.
   */
  async finalText() {
    await this.done();
    return __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_getFinalText).call(this);
  }
  _emit(event, ...args) {
    if (__classPrivateFieldGet(this, _BetaMessageStream_ended, "f"))
      return;
    if (event === "end") {
      __classPrivateFieldSet(this, _BetaMessageStream_ended, true);
      __classPrivateFieldGet(this, _BetaMessageStream_resolveEndPromise, "f").call(this);
    }
    const listeners = __classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event];
    if (listeners) {
      __classPrivateFieldGet(this, _BetaMessageStream_listeners, "f")[event] = listeners.filter((l) => !l.once);
      listeners.forEach(({ listener }) => listener(...args));
    }
    if (event === "abort") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _BetaMessageStream_catchingPromiseCreated, "f") && !(listeners == null ? void 0 : listeners.length)) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _BetaMessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _BetaMessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _BetaMessageStream_catchingPromiseCreated, "f") && !(listeners == null ? void 0 : listeners.length)) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _BetaMessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _BetaMessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
    }
  }
  _emitFinal() {
    const finalMessage = this.receivedMessages.at(-1);
    if (finalMessage) {
      this._emit("finalMessage", __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_getFinalMessage).call(this));
    }
  }
  async _fromReadableStream(readableStream, options) {
    var _a2;
    const signal = options == null ? void 0 : options.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_beginRequest).call(this);
      this._connected(null);
      const stream = Stream.fromReadableStream(readableStream, this.controller);
      for await (const event of stream) {
        __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_addStreamEvent).call(this, event);
      }
      if ((_a2 = stream.controller.signal) == null ? void 0 : _a2.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_endRequest).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  [(_BetaMessageStream_currentMessageSnapshot = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_params = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_connectedPromise = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_resolveConnectedPromise = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_rejectConnectedPromise = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_endPromise = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_resolveEndPromise = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_rejectEndPromise = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_listeners = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_ended = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_errored = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_aborted = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_catchingPromiseCreated = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_response = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_request_id = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_logger = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_handleError = /* @__PURE__ */ new WeakMap(), _BetaMessageStream_instances = /* @__PURE__ */ new WeakSet(), _BetaMessageStream_getFinalMessage = function _BetaMessageStream_getFinalMessage2() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a Message with role=assistant");
    }
    return this.receivedMessages.at(-1);
  }, _BetaMessageStream_getFinalText = function _BetaMessageStream_getFinalText2() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a Message with role=assistant");
    }
    const textBlocks = this.receivedMessages.at(-1).content.filter((block) => block.type === "text").map((block) => block.text);
    if (textBlocks.length === 0) {
      throw new AnthropicError("stream ended without producing a content block with type=text");
    }
    return textBlocks.join(" ");
  }, _BetaMessageStream_beginRequest = function _BetaMessageStream_beginRequest2() {
    if (this.ended)
      return;
    __classPrivateFieldSet(this, _BetaMessageStream_currentMessageSnapshot, void 0);
  }, _BetaMessageStream_addStreamEvent = function _BetaMessageStream_addStreamEvent2(event) {
    if (this.ended)
      return;
    const messageSnapshot = __classPrivateFieldGet(this, _BetaMessageStream_instances, "m", _BetaMessageStream_accumulateMessage).call(this, event);
    this._emit("streamEvent", event, messageSnapshot);
    switch (event.type) {
      case "content_block_delta": {
        const content = messageSnapshot.content.at(-1);
        switch (event.delta.type) {
          case "text_delta": {
            if (content.type === "text") {
              this._emit("text", event.delta.text, content.text || "");
            }
            break;
          }
          case "citations_delta": {
            if (content.type === "text") {
              this._emit("citation", event.delta.citation, content.citations ?? []);
            }
            break;
          }
          case "input_json_delta": {
            if (tracksToolInput$1(content) && content.input) {
              this._emit("inputJson", event.delta.partial_json, content.input);
            }
            break;
          }
          case "thinking_delta": {
            if (content.type === "thinking") {
              this._emit("thinking", event.delta.thinking, content.thinking);
            }
            break;
          }
          case "signature_delta": {
            if (content.type === "thinking") {
              this._emit("signature", content.signature);
            }
            break;
          }
          case "compaction_delta": {
            if (content.type === "compaction" && content.content) {
              this._emit("compaction", content.content);
            }
            break;
          }
          default:
            checkNever$1(event.delta);
        }
        break;
      }
      case "message_stop": {
        this._addMessageParam(messageSnapshot);
        this._addMessage(maybeParseBetaMessage(messageSnapshot, __classPrivateFieldGet(this, _BetaMessageStream_params, "f"), { logger: __classPrivateFieldGet(this, _BetaMessageStream_logger, "f") }), true);
        break;
      }
      case "content_block_stop": {
        this._emit("contentBlock", messageSnapshot.content.at(-1));
        break;
      }
      case "message_start": {
        __classPrivateFieldSet(this, _BetaMessageStream_currentMessageSnapshot, messageSnapshot);
        break;
      }
    }
  }, _BetaMessageStream_endRequest = function _BetaMessageStream_endRequest2() {
    if (this.ended) {
      throw new AnthropicError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet(this, _BetaMessageStream_currentMessageSnapshot, "f");
    if (!snapshot) {
      throw new AnthropicError(`request ended without sending any chunks`);
    }
    __classPrivateFieldSet(this, _BetaMessageStream_currentMessageSnapshot, void 0);
    return maybeParseBetaMessage(snapshot, __classPrivateFieldGet(this, _BetaMessageStream_params, "f"), { logger: __classPrivateFieldGet(this, _BetaMessageStream_logger, "f") });
  }, _BetaMessageStream_accumulateMessage = function _BetaMessageStream_accumulateMessage2(event) {
    let snapshot = __classPrivateFieldGet(this, _BetaMessageStream_currentMessageSnapshot, "f");
    if (event.type === "message_start") {
      if (snapshot) {
        throw new AnthropicError(`Unexpected event order, got ${event.type} before receiving "message_stop"`);
      }
      return event.message;
    }
    if (!snapshot) {
      throw new AnthropicError(`Unexpected event order, got ${event.type} before "message_start"`);
    }
    switch (event.type) {
      case "message_stop":
        return snapshot;
      case "message_delta":
        snapshot.container = event.delta.container;
        snapshot.stop_reason = event.delta.stop_reason;
        snapshot.stop_sequence = event.delta.stop_sequence;
        snapshot.usage.output_tokens = event.usage.output_tokens;
        snapshot.context_management = event.context_management;
        if (event.usage.input_tokens != null) {
          snapshot.usage.input_tokens = event.usage.input_tokens;
        }
        if (event.usage.cache_creation_input_tokens != null) {
          snapshot.usage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
        }
        if (event.usage.cache_read_input_tokens != null) {
          snapshot.usage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
        }
        if (event.usage.server_tool_use != null) {
          snapshot.usage.server_tool_use = event.usage.server_tool_use;
        }
        if (event.usage.iterations != null) {
          snapshot.usage.iterations = event.usage.iterations;
        }
        return snapshot;
      case "content_block_start":
        snapshot.content.push(event.content_block);
        return snapshot;
      case "content_block_delta": {
        const snapshotContent = snapshot.content.at(event.index);
        switch (event.delta.type) {
          case "text_delta": {
            if ((snapshotContent == null ? void 0 : snapshotContent.type) === "text") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                text: (snapshotContent.text || "") + event.delta.text
              };
            }
            break;
          }
          case "citations_delta": {
            if ((snapshotContent == null ? void 0 : snapshotContent.type) === "text") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                citations: [...snapshotContent.citations ?? [], event.delta.citation]
              };
            }
            break;
          }
          case "input_json_delta": {
            if (snapshotContent && tracksToolInput$1(snapshotContent)) {
              let jsonBuf = snapshotContent[JSON_BUF_PROPERTY$1] || "";
              jsonBuf += event.delta.partial_json;
              const newContent = { ...snapshotContent };
              Object.defineProperty(newContent, JSON_BUF_PROPERTY$1, {
                value: jsonBuf,
                enumerable: false,
                writable: true
              });
              if (jsonBuf) {
                try {
                  newContent.input = partialParse(jsonBuf);
                } catch (err) {
                  const error = new AnthropicError(`Unable to parse tool parameter JSON from model. Please retry your request or adjust your prompt. Error: ${err}. JSON: ${jsonBuf}`);
                  __classPrivateFieldGet(this, _BetaMessageStream_handleError, "f").call(this, error);
                }
              }
              snapshot.content[event.index] = newContent;
            }
            break;
          }
          case "thinking_delta": {
            if ((snapshotContent == null ? void 0 : snapshotContent.type) === "thinking") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                thinking: snapshotContent.thinking + event.delta.thinking
              };
            }
            break;
          }
          case "signature_delta": {
            if ((snapshotContent == null ? void 0 : snapshotContent.type) === "thinking") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                signature: event.delta.signature
              };
            }
            break;
          }
          case "compaction_delta": {
            if ((snapshotContent == null ? void 0 : snapshotContent.type) === "compaction") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                content: (snapshotContent.content || "") + event.delta.content
              };
            }
            break;
          }
          default:
            checkNever$1(event.delta);
        }
        return snapshot;
      }
      case "content_block_stop":
        return snapshot;
    }
  }, Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("streamEvent", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk2) => chunk2 ? { value: chunk2, done: false } : { value: void 0, done: true });
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      }
    };
  }
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
}
function checkNever$1(x) {
}
class ToolError extends Error {
  constructor(content) {
    const message = typeof content === "string" ? content : content.map((block) => {
      if (block.type === "text")
        return block.text;
      return `[${block.type}]`;
    }).join(" ");
    super(message);
    this.name = "ToolError";
    this.content = content;
  }
}
const DEFAULT_TOKEN_THRESHOLD = 1e5;
const DEFAULT_SUMMARY_PROMPT = `You have been working on the task described above but have not yet completed it. Write a continuation summary that will allow you (or another instance of yourself) to resume work efficiently in a future context window where the conversation history will be replaced with this summary. Your summary should be structured, concise, and actionable. Include:
1. Task Overview
The user's core request and success criteria
Any clarifications or constraints they specified
2. Current State
What has been completed so far
Files created, modified, or analyzed (with paths if relevant)
Key outputs or artifacts produced
3. Important Discoveries
Technical constraints or requirements uncovered
Decisions made and their rationale
Errors encountered and how they were resolved
What approaches were tried that didn't work (and why)
4. Next Steps
Specific actions needed to complete the task
Any blockers or open questions to resolve
Priority order if multiple steps remain
5. Context to Preserve
User preferences or style requirements
Domain-specific details that aren't obvious
Any promises made to the user
Be concise but complete—err on the side of including information that would prevent duplicate work or repeated mistakes. Write in a way that enables immediate resumption of the task.
Wrap your summary in <summary></summary> tags.`;
var _BetaToolRunner_instances, _BetaToolRunner_consumed, _BetaToolRunner_mutated, _BetaToolRunner_state, _BetaToolRunner_options, _BetaToolRunner_message, _BetaToolRunner_toolResponse, _BetaToolRunner_completion, _BetaToolRunner_iterationCount, _BetaToolRunner_checkAndCompact, _BetaToolRunner_generateToolResponse;
function promiseWithResolvers() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
class BetaToolRunner {
  constructor(client, params, options) {
    var _a2;
    _BetaToolRunner_instances.add(this);
    this.client = client;
    _BetaToolRunner_consumed.set(this, false);
    _BetaToolRunner_mutated.set(this, false);
    _BetaToolRunner_state.set(this, void 0);
    _BetaToolRunner_options.set(this, void 0);
    _BetaToolRunner_message.set(this, void 0);
    _BetaToolRunner_toolResponse.set(this, void 0);
    _BetaToolRunner_completion.set(this, void 0);
    _BetaToolRunner_iterationCount.set(this, 0);
    __classPrivateFieldSet(this, _BetaToolRunner_state, {
      params: {
        // You can't clone the entire params since there are functions as handlers.
        // You also don't really need to clone params.messages, but it probably will prevent a foot gun
        // somewhere.
        ...params,
        messages: structuredClone(params.messages)
      }
    });
    const helpers = collectStainlessHelpers(params.tools, params.messages);
    const helperValue = ["BetaToolRunner", ...helpers].join(", ");
    __classPrivateFieldSet(this, _BetaToolRunner_options, {
      ...options,
      headers: buildHeaders([{ "x-stainless-helper": helperValue }, options == null ? void 0 : options.headers])
    });
    __classPrivateFieldSet(this, _BetaToolRunner_completion, promiseWithResolvers());
    if ((_a2 = params.compactionControl) == null ? void 0 : _a2.enabled) {
      console.warn('Anthropic: The `compactionControl` parameter is deprecated and will be removed in a future version. Use server-side compaction instead by passing `edits: [{ type: "compact_20260112" }]` in the params passed to `toolRunner()`. See https://platform.claude.com/docs/en/build-with-claude/compaction');
    }
  }
  async *[(_BetaToolRunner_consumed = /* @__PURE__ */ new WeakMap(), _BetaToolRunner_mutated = /* @__PURE__ */ new WeakMap(), _BetaToolRunner_state = /* @__PURE__ */ new WeakMap(), _BetaToolRunner_options = /* @__PURE__ */ new WeakMap(), _BetaToolRunner_message = /* @__PURE__ */ new WeakMap(), _BetaToolRunner_toolResponse = /* @__PURE__ */ new WeakMap(), _BetaToolRunner_completion = /* @__PURE__ */ new WeakMap(), _BetaToolRunner_iterationCount = /* @__PURE__ */ new WeakMap(), _BetaToolRunner_instances = /* @__PURE__ */ new WeakSet(), _BetaToolRunner_checkAndCompact = async function _BetaToolRunner_checkAndCompact2() {
    var _a2;
    const compactionControl = __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.compactionControl;
    if (!compactionControl || !compactionControl.enabled) {
      return false;
    }
    let tokensUsed = 0;
    if (__classPrivateFieldGet(this, _BetaToolRunner_message, "f") !== void 0) {
      try {
        const message = await __classPrivateFieldGet(this, _BetaToolRunner_message, "f");
        const totalInputTokens = message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
        tokensUsed = totalInputTokens + message.usage.output_tokens;
      } catch {
        return false;
      }
    }
    const threshold = compactionControl.contextTokenThreshold ?? DEFAULT_TOKEN_THRESHOLD;
    if (tokensUsed < threshold) {
      return false;
    }
    const model = compactionControl.model ?? __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.model;
    const summaryPrompt = compactionControl.summaryPrompt ?? DEFAULT_SUMMARY_PROMPT;
    const messages = __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.messages;
    if (messages[messages.length - 1].role === "assistant") {
      const lastMessage = messages[messages.length - 1];
      if (Array.isArray(lastMessage.content)) {
        const nonToolBlocks = lastMessage.content.filter((block) => block.type !== "tool_use");
        if (nonToolBlocks.length === 0) {
          messages.pop();
        } else {
          lastMessage.content = nonToolBlocks;
        }
      }
    }
    const response = await this.client.beta.messages.create({
      model,
      messages: [
        ...messages,
        {
          role: "user",
          content: [
            {
              type: "text",
              text: summaryPrompt
            }
          ]
        }
      ],
      max_tokens: __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.max_tokens
    }, {
      signal: __classPrivateFieldGet(this, _BetaToolRunner_options, "f").signal,
      headers: buildHeaders([__classPrivateFieldGet(this, _BetaToolRunner_options, "f").headers, { "x-stainless-helper": "compaction" }])
    });
    if (((_a2 = response.content[0]) == null ? void 0 : _a2.type) !== "text") {
      throw new AnthropicError("Expected text response for compaction");
    }
    __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.messages = [
      {
        role: "user",
        content: response.content
      }
    ];
    return true;
  }, Symbol.asyncIterator)]() {
    var _a2;
    if (__classPrivateFieldGet(this, _BetaToolRunner_consumed, "f")) {
      throw new AnthropicError("Cannot iterate over a consumed stream");
    }
    __classPrivateFieldSet(this, _BetaToolRunner_consumed, true);
    __classPrivateFieldSet(this, _BetaToolRunner_mutated, true);
    __classPrivateFieldSet(this, _BetaToolRunner_toolResponse, void 0);
    try {
      while (true) {
        let stream;
        try {
          if (__classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.max_iterations && __classPrivateFieldGet(this, _BetaToolRunner_iterationCount, "f") >= __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.max_iterations) {
            break;
          }
          __classPrivateFieldSet(this, _BetaToolRunner_mutated, false, "f");
          __classPrivateFieldSet(this, _BetaToolRunner_toolResponse, void 0, "f");
          __classPrivateFieldSet(this, _BetaToolRunner_iterationCount, (_a2 = __classPrivateFieldGet(this, _BetaToolRunner_iterationCount, "f"), _a2++, _a2), "f");
          __classPrivateFieldSet(this, _BetaToolRunner_message, void 0, "f");
          const { max_iterations, compactionControl, ...params } = __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params;
          if (params.stream) {
            stream = this.client.beta.messages.stream({ ...params }, __classPrivateFieldGet(this, _BetaToolRunner_options, "f"));
            __classPrivateFieldSet(this, _BetaToolRunner_message, stream.finalMessage(), "f");
            __classPrivateFieldGet(this, _BetaToolRunner_message, "f").catch(() => {
            });
            yield stream;
          } else {
            __classPrivateFieldSet(this, _BetaToolRunner_message, this.client.beta.messages.create({ ...params, stream: false }, __classPrivateFieldGet(this, _BetaToolRunner_options, "f")), "f");
            yield __classPrivateFieldGet(this, _BetaToolRunner_message, "f");
          }
          const isCompacted = await __classPrivateFieldGet(this, _BetaToolRunner_instances, "m", _BetaToolRunner_checkAndCompact).call(this);
          if (!isCompacted) {
            if (!__classPrivateFieldGet(this, _BetaToolRunner_mutated, "f")) {
              const { role, content } = await __classPrivateFieldGet(this, _BetaToolRunner_message, "f");
              __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.messages.push({ role, content });
            }
            const toolMessage = await __classPrivateFieldGet(this, _BetaToolRunner_instances, "m", _BetaToolRunner_generateToolResponse).call(this, __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.messages.at(-1));
            if (toolMessage) {
              __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params.messages.push(toolMessage);
            } else if (!__classPrivateFieldGet(this, _BetaToolRunner_mutated, "f")) {
              break;
            }
          }
        } finally {
          if (stream) {
            stream.abort();
          }
        }
      }
      if (!__classPrivateFieldGet(this, _BetaToolRunner_message, "f")) {
        throw new AnthropicError("ToolRunner concluded without a message from the server");
      }
      __classPrivateFieldGet(this, _BetaToolRunner_completion, "f").resolve(await __classPrivateFieldGet(this, _BetaToolRunner_message, "f"));
    } catch (error) {
      __classPrivateFieldSet(this, _BetaToolRunner_consumed, false);
      __classPrivateFieldGet(this, _BetaToolRunner_completion, "f").promise.catch(() => {
      });
      __classPrivateFieldGet(this, _BetaToolRunner_completion, "f").reject(error);
      __classPrivateFieldSet(this, _BetaToolRunner_completion, promiseWithResolvers());
      throw error;
    }
  }
  setMessagesParams(paramsOrMutator) {
    if (typeof paramsOrMutator === "function") {
      __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params = paramsOrMutator(__classPrivateFieldGet(this, _BetaToolRunner_state, "f").params);
    } else {
      __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params = paramsOrMutator;
    }
    __classPrivateFieldSet(this, _BetaToolRunner_mutated, true);
    __classPrivateFieldSet(this, _BetaToolRunner_toolResponse, void 0);
  }
  setRequestOptions(optionsOrMutator) {
    if (typeof optionsOrMutator === "function") {
      __classPrivateFieldSet(this, _BetaToolRunner_options, optionsOrMutator(__classPrivateFieldGet(this, _BetaToolRunner_options, "f")));
    } else {
      __classPrivateFieldSet(this, _BetaToolRunner_options, { ...__classPrivateFieldGet(this, _BetaToolRunner_options, "f"), ...optionsOrMutator });
    }
  }
  /**
   * Get the tool response for the last message from the assistant.
   * Avoids redundant tool executions by caching results.
   *
   * @returns A promise that resolves to a BetaMessageParam containing tool results, or null if no tools need to be executed
   *
   * @example
   * const toolResponse = await runner.generateToolResponse();
   * if (toolResponse) {
   *   console.log('Tool results:', toolResponse.content);
   * }
   */
  async generateToolResponse(signal = __classPrivateFieldGet(this, _BetaToolRunner_options, "f").signal) {
    const message = await __classPrivateFieldGet(this, _BetaToolRunner_message, "f") ?? this.params.messages.at(-1);
    if (!message) {
      return null;
    }
    return __classPrivateFieldGet(this, _BetaToolRunner_instances, "m", _BetaToolRunner_generateToolResponse).call(this, message, signal);
  }
  /**
   * Wait for the async iterator to complete. This works even if the async iterator hasn't yet started, and
   * will wait for an instance to start and go to completion.
   *
   * @returns A promise that resolves to the final BetaMessage when the iterator completes
   *
   * @example
   * // Start consuming the iterator
   * for await (const message of runner) {
   *   console.log('Message:', message.content);
   * }
   *
   * // Meanwhile, wait for completion from another part of the code
   * const finalMessage = await runner.done();
   * console.log('Final response:', finalMessage.content);
   */
  done() {
    return __classPrivateFieldGet(this, _BetaToolRunner_completion, "f").promise;
  }
  /**
   * Returns a promise indicating that the stream is done. Unlike .done(), this will eagerly read the stream:
   * * If the iterator has not been consumed, consume the entire iterator and return the final message from the
   * assistant.
   * * If the iterator has been consumed, waits for it to complete and returns the final message.
   *
   * @returns A promise that resolves to the final BetaMessage from the conversation
   * @throws {AnthropicError} If no messages were processed during the conversation
   *
   * @example
   * const finalMessage = await runner.runUntilDone();
   * console.log('Final response:', finalMessage.content);
   */
  async runUntilDone() {
    if (!__classPrivateFieldGet(this, _BetaToolRunner_consumed, "f")) {
      for await (const _ of this) {
      }
    }
    return this.done();
  }
  /**
   * Get the current parameters being used by the ToolRunner.
   *
   * @returns A readonly view of the current ToolRunnerParams
   *
   * @example
   * const currentParams = runner.params;
   * console.log('Current model:', currentParams.model);
   * console.log('Message count:', currentParams.messages.length);
   */
  get params() {
    return __classPrivateFieldGet(this, _BetaToolRunner_state, "f").params;
  }
  /**
   * Add one or more messages to the conversation history.
   *
   * @param messages - One or more BetaMessageParam objects to add to the conversation
   *
   * @example
   * runner.pushMessages(
   *   { role: 'user', content: 'Also, what about the weather in NYC?' }
   * );
   *
   * @example
   * // Adding multiple messages
   * runner.pushMessages(
   *   { role: 'user', content: 'What about NYC?' },
   *   { role: 'user', content: 'And Boston?' }
   * );
   */
  pushMessages(...messages) {
    this.setMessagesParams((params) => ({
      ...params,
      messages: [...params.messages, ...messages]
    }));
  }
  /**
   * Makes the ToolRunner directly awaitable, equivalent to calling .runUntilDone()
   * This allows using `await runner` instead of `await runner.runUntilDone()`
   */
  then(onfulfilled, onrejected) {
    return this.runUntilDone().then(onfulfilled, onrejected);
  }
}
_BetaToolRunner_generateToolResponse = async function _BetaToolRunner_generateToolResponse2(lastMessage, signal = __classPrivateFieldGet(this, _BetaToolRunner_options, "f").signal) {
  if (__classPrivateFieldGet(this, _BetaToolRunner_toolResponse, "f") !== void 0) {
    return __classPrivateFieldGet(this, _BetaToolRunner_toolResponse, "f");
  }
  __classPrivateFieldSet(this, _BetaToolRunner_toolResponse, generateToolResponse(__classPrivateFieldGet(this, _BetaToolRunner_state, "f").params, lastMessage, {
    ...__classPrivateFieldGet(this, _BetaToolRunner_options, "f"),
    signal
  }));
  return __classPrivateFieldGet(this, _BetaToolRunner_toolResponse, "f");
};
async function generateToolResponse(params, lastMessage = params.messages.at(-1), requestOptions) {
  if (!lastMessage || lastMessage.role !== "assistant" || !lastMessage.content || typeof lastMessage.content === "string") {
    return null;
  }
  const toolUseBlocks = lastMessage.content.filter((content) => content.type === "tool_use");
  if (toolUseBlocks.length === 0) {
    return null;
  }
  const toolResults = await Promise.all(toolUseBlocks.map(async (toolUse) => {
    const tool = params.tools.find((t) => ("name" in t ? t.name : t.mcp_server_name) === toolUse.name);
    if (!tool || !("run" in tool)) {
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: `Error: Tool '${toolUse.name}' not found`,
        is_error: true
      };
    }
    try {
      let input = toolUse.input;
      if ("parse" in tool && tool.parse) {
        input = tool.parse(input);
      }
      const result = await tool.run(input, {
        toolUseBlock: toolUse,
        signal: requestOptions == null ? void 0 : requestOptions.signal
      });
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result
      };
    } catch (error) {
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: error instanceof ToolError ? error.content : `Error: ${error instanceof Error ? error.message : String(error)}`,
        is_error: true
      };
    }
  }));
  return {
    role: "user",
    content: toolResults
  };
}
const DEPRECATED_MODELS$1 = {
  "claude-1.3": "November 6th, 2024",
  "claude-1.3-100k": "November 6th, 2024",
  "claude-instant-1.1": "November 6th, 2024",
  "claude-instant-1.1-100k": "November 6th, 2024",
  "claude-instant-1.2": "November 6th, 2024",
  "claude-3-sonnet-20240229": "July 21st, 2025",
  "claude-3-opus-20240229": "January 5th, 2026",
  "claude-2.1": "July 21st, 2025",
  "claude-2.0": "July 21st, 2025",
  "claude-3-7-sonnet-latest": "February 19th, 2026",
  "claude-3-7-sonnet-20250219": "February 19th, 2026"
};
const MODELS_TO_WARN_WITH_THINKING_ENABLED$1 = ["claude-mythos-preview", "claude-opus-4-6"];
let Messages$1 = class Messages extends APIResource {
  constructor() {
    super(...arguments);
    this.batches = new Batches$1(this._client);
  }
  create(params, options) {
    const modifiedParams = transformOutputFormat(params);
    const { betas, ...body } = modifiedParams;
    if (body.model in DEPRECATED_MODELS$1) {
      console.warn(`The model '${body.model}' is deprecated and will reach end-of-life on ${DEPRECATED_MODELS$1[body.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`);
    }
    if (MODELS_TO_WARN_WITH_THINKING_ENABLED$1.includes(body.model) && body.thinking && body.thinking.type === "enabled") {
      console.warn(`Using Claude with ${body.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);
    }
    let timeout = this._client._options.timeout;
    if (!body.stream && timeout == null) {
      const maxNonstreamingTokens = MODEL_NONSTREAMING_TOKENS[body.model] ?? void 0;
      timeout = this._client.calculateNonstreamingTimeout(body.max_tokens, maxNonstreamingTokens);
    }
    const helperHeader = stainlessHelperHeader(body.tools, body.messages);
    return this._client.post("/v1/messages?beta=true", {
      body,
      timeout: timeout ?? 6e5,
      ...options,
      headers: buildHeaders([
        { ...(betas == null ? void 0 : betas.toString()) != null ? { "anthropic-beta": betas == null ? void 0 : betas.toString() } : void 0 },
        helperHeader,
        options == null ? void 0 : options.headers
      ]),
      stream: modifiedParams.stream ?? false
    });
  }
  /**
   * Send a structured list of input messages with text and/or image content, along with an expected `output_format` and
   * the response will be automatically parsed and available in the `parsed_output` property of the message.
   *
   * @example
   * ```ts
   * const message = await client.beta.messages.parse({
   *   model: 'claude-3-5-sonnet-20241022',
   *   max_tokens: 1024,
   *   messages: [{ role: 'user', content: 'What is 2+2?' }],
   *   output_format: zodOutputFormat(z.object({ answer: z.number() }), 'math'),
   * });
   *
   * console.log(message.parsed_output?.answer); // 4
   * ```
   */
  parse(params, options) {
    options = {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...params.betas ?? [], "structured-outputs-2025-12-15"].toString() },
        options == null ? void 0 : options.headers
      ])
    };
    return this.create(params, options).then((message) => parseBetaMessage(message, params, { logger: this._client.logger ?? console }));
  }
  /**
   * Create a Message stream
   */
  stream(body, options) {
    return BetaMessageStream.createMessage(this, body, options);
  }
  /**
   * Count the number of tokens in a Message.
   *
   * The Token Count API can be used to count the number of tokens in a Message,
   * including tools, images, and documents, without creating it.
   *
   * Learn more about token counting in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/token-counting)
   *
   * @example
   * ```ts
   * const betaMessageTokensCount =
   *   await client.beta.messages.countTokens({
   *     messages: [{ content: 'Hello, world', role: 'user' }],
   *     model: 'claude-opus-4-6',
   *   });
   * ```
   */
  countTokens(params, options) {
    const modifiedParams = transformOutputFormat(params);
    const { betas, ...body } = modifiedParams;
    return this._client.post("/v1/messages/count_tokens?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "token-counting-2024-11-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  toolRunner(body, options) {
    return new BetaToolRunner(this._client, body, options);
  }
};
function transformOutputFormat(params) {
  var _a2;
  if (!params.output_format) {
    return params;
  }
  if ((_a2 = params.output_config) == null ? void 0 : _a2.format) {
    throw new AnthropicError("Both output_format and output_config.format were provided. Please use only output_config.format (output_format is deprecated).");
  }
  const { output_format, ...rest } = params;
  return {
    ...rest,
    output_config: {
      ...params.output_config,
      format: output_format
    }
  };
}
Messages$1.Batches = Batches$1;
Messages$1.BetaToolRunner = BetaToolRunner;
Messages$1.ToolError = ToolError;
class Events extends APIResource {
  /**
   * List Events
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsSessionEvent of client.beta.sessions.events.list(
   *   'sesn_011CZkZAtmR3yMPDzynEDxu7',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(sessionID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList(path`/v1/sessions/${sessionID}/events?beta=true`, PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Send Events
   *
   * @example
   * ```ts
   * const betaManagedAgentsSendSessionEvents =
   *   await client.beta.sessions.events.send(
   *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *     {
   *       events: [
   *         {
   *           content: [
   *             {
   *               text: 'Where is my order #1234?',
   *               type: 'text',
   *             },
   *           ],
   *           type: 'user.message',
   *         },
   *       ],
   *     },
   *   );
   * ```
   */
  send(sessionID, params, options) {
    const { betas, ...body } = params;
    return this._client.post(path`/v1/sessions/${sessionID}/events?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Stream Events
   *
   * @example
   * ```ts
   * const betaManagedAgentsStreamSessionEvents =
   *   await client.beta.sessions.events.stream(
   *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *   );
   * ```
   */
  stream(sessionID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/sessions/${sessionID}/events/stream?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ]),
      stream: true
    });
  }
}
class Resources extends APIResource {
  /**
   * Get Session Resource
   *
   * @example
   * ```ts
   * const resource =
   *   await client.beta.sessions.resources.retrieve(
   *     'sesrsc_011CZkZBJq5dWxk9fVLNcPht',
   *     { session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7' },
   *   );
   * ```
   */
  retrieve(resourceID, params, options) {
    const { session_id, betas } = params;
    return this._client.get(path`/v1/sessions/${session_id}/resources/${resourceID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Update Session Resource
   *
   * @example
   * ```ts
   * const resource =
   *   await client.beta.sessions.resources.update(
   *     'sesrsc_011CZkZBJq5dWxk9fVLNcPht',
   *     {
   *       session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *       authorization_token: 'ghp_exampletoken',
   *     },
   *   );
   * ```
   */
  update(resourceID, params, options) {
    const { session_id, betas, ...body } = params;
    return this._client.post(path`/v1/sessions/${session_id}/resources/${resourceID}?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List Session Resources
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsSessionResource of client.beta.sessions.resources.list(
   *   'sesn_011CZkZAtmR3yMPDzynEDxu7',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(sessionID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList(path`/v1/sessions/${sessionID}/resources?beta=true`, PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete Session Resource
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeleteSessionResource =
   *   await client.beta.sessions.resources.delete(
   *     'sesrsc_011CZkZBJq5dWxk9fVLNcPht',
   *     { session_id: 'sesn_011CZkZAtmR3yMPDzynEDxu7' },
   *   );
   * ```
   */
  delete(resourceID, params, options) {
    const { session_id, betas } = params;
    return this._client.delete(path`/v1/sessions/${session_id}/resources/${resourceID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Add Session Resource
   *
   * @example
   * ```ts
   * const betaManagedAgentsFileResource =
   *   await client.beta.sessions.resources.add(
   *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *     {
   *       file_id: 'file_011CNha8iCJcU1wXNR6q4V8w',
   *       type: 'file',
   *     },
   *   );
   * ```
   */
  add(sessionID, params, options) {
    const { betas, ...body } = params;
    return this._client.post(path`/v1/sessions/${sessionID}/resources?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
class Sessions extends APIResource {
  constructor() {
    super(...arguments);
    this.events = new Events(this._client);
    this.resources = new Resources(this._client);
  }
  /**
   * Create Session
   *
   * @example
   * ```ts
   * const betaManagedAgentsSession =
   *   await client.beta.sessions.create({
   *     agent: 'agent_011CZkYpogX7uDKUyvBTophP',
   *     environment_id: 'env_011CZkZ9X2dpNyB7HsEFoRfW',
   *   });
   * ```
   */
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/sessions?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Get Session
   *
   * @example
   * ```ts
   * const betaManagedAgentsSession =
   *   await client.beta.sessions.retrieve(
   *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *   );
   * ```
   */
  retrieve(sessionID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/sessions/${sessionID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Update Session
   *
   * @example
   * ```ts
   * const betaManagedAgentsSession =
   *   await client.beta.sessions.update(
   *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *   );
   * ```
   */
  update(sessionID, params, options) {
    const { betas, ...body } = params;
    return this._client.post(path`/v1/sessions/${sessionID}?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List Sessions
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsSession of client.beta.sessions.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/sessions?beta=true", PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete Session
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeletedSession =
   *   await client.beta.sessions.delete(
   *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *   );
   * ```
   */
  delete(sessionID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/v1/sessions/${sessionID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Archive Session
   *
   * @example
   * ```ts
   * const betaManagedAgentsSession =
   *   await client.beta.sessions.archive(
   *     'sesn_011CZkZAtmR3yMPDzynEDxu7',
   *   );
   * ```
   */
  archive(sessionID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.post(path`/v1/sessions/${sessionID}/archive?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
Sessions.Events = Events;
Sessions.Resources = Resources;
class Versions2 extends APIResource {
  /**
   * Create Skill Version
   *
   * @example
   * ```ts
   * const version = await client.beta.skills.versions.create(
   *   'skill_id',
   * );
   * ```
   */
  create(skillID, params = {}, options) {
    const { betas, ...body } = params ?? {};
    return this._client.post(path`/v1/skills/${skillID}/versions?beta=true`, multipartFormRequestOptions({
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "skills-2025-10-02"].toString() },
        options == null ? void 0 : options.headers
      ])
    }, this._client));
  }
  /**
   * Get Skill Version
   *
   * @example
   * ```ts
   * const version = await client.beta.skills.versions.retrieve(
   *   'version',
   *   { skill_id: 'skill_id' },
   * );
   * ```
   */
  retrieve(version, params, options) {
    const { skill_id, betas } = params;
    return this._client.get(path`/v1/skills/${skill_id}/versions/${version}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "skills-2025-10-02"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List Skill Versions
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const versionListResponse of client.beta.skills.versions.list(
   *   'skill_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(skillID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList(path`/v1/skills/${skillID}/versions?beta=true`, PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "skills-2025-10-02"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete Skill Version
   *
   * @example
   * ```ts
   * const version = await client.beta.skills.versions.delete(
   *   'version',
   *   { skill_id: 'skill_id' },
   * );
   * ```
   */
  delete(version, params, options) {
    const { skill_id, betas } = params;
    return this._client.delete(path`/v1/skills/${skill_id}/versions/${version}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "skills-2025-10-02"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
class Skills extends APIResource {
  constructor() {
    super(...arguments);
    this.versions = new Versions2(this._client);
  }
  /**
   * Create Skill
   *
   * @example
   * ```ts
   * const skill = await client.beta.skills.create();
   * ```
   */
  create(params = {}, options) {
    const { betas, ...body } = params ?? {};
    return this._client.post("/v1/skills?beta=true", multipartFormRequestOptions({
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "skills-2025-10-02"].toString() },
        options == null ? void 0 : options.headers
      ])
    }, this._client, false));
  }
  /**
   * Get Skill
   *
   * @example
   * ```ts
   * const skill = await client.beta.skills.retrieve('skill_id');
   * ```
   */
  retrieve(skillID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/skills/${skillID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "skills-2025-10-02"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List Skills
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const skillListResponse of client.beta.skills.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/skills?beta=true", PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "skills-2025-10-02"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete Skill
   *
   * @example
   * ```ts
   * const skill = await client.beta.skills.delete('skill_id');
   * ```
   */
  delete(skillID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/v1/skills/${skillID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "skills-2025-10-02"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
Skills.Versions = Versions2;
class Credentials extends APIResource {
  /**
   * Create Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsCredential =
   *   await client.beta.vaults.credentials.create(
   *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
   *     {
   *       auth: {
   *         token: 'bearer_exampletoken',
   *         mcp_server_url:
   *           'https://example-server.modelcontextprotocol.io/sse',
   *         type: 'static_bearer',
   *       },
   *     },
   *   );
   * ```
   */
  create(vaultID, params, options) {
    const { betas, ...body } = params;
    return this._client.post(path`/v1/vaults/${vaultID}/credentials?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Get Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsCredential =
   *   await client.beta.vaults.credentials.retrieve(
   *     'vcrd_011CZkZEMt8gZan2iYOQfSkw',
   *     { vault_id: 'vlt_011CZkZDLs7fYzm1hXNPeRjv' },
   *   );
   * ```
   */
  retrieve(credentialID, params, options) {
    const { vault_id, betas } = params;
    return this._client.get(path`/v1/vaults/${vault_id}/credentials/${credentialID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Update Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsCredential =
   *   await client.beta.vaults.credentials.update(
   *     'vcrd_011CZkZEMt8gZan2iYOQfSkw',
   *     { vault_id: 'vlt_011CZkZDLs7fYzm1hXNPeRjv' },
   *   );
   * ```
   */
  update(credentialID, params, options) {
    const { vault_id, betas, ...body } = params;
    return this._client.post(path`/v1/vaults/${vault_id}/credentials/${credentialID}?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List Credentials
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsCredential of client.beta.vaults.credentials.list(
   *   'vlt_011CZkZDLs7fYzm1hXNPeRjv',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(vaultID, params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList(path`/v1/vaults/${vaultID}/credentials?beta=true`, PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeletedCredential =
   *   await client.beta.vaults.credentials.delete(
   *     'vcrd_011CZkZEMt8gZan2iYOQfSkw',
   *     { vault_id: 'vlt_011CZkZDLs7fYzm1hXNPeRjv' },
   *   );
   * ```
   */
  delete(credentialID, params, options) {
    const { vault_id, betas } = params;
    return this._client.delete(path`/v1/vaults/${vault_id}/credentials/${credentialID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Archive Credential
   *
   * @example
   * ```ts
   * const betaManagedAgentsCredential =
   *   await client.beta.vaults.credentials.archive(
   *     'vcrd_011CZkZEMt8gZan2iYOQfSkw',
   *     { vault_id: 'vlt_011CZkZDLs7fYzm1hXNPeRjv' },
   *   );
   * ```
   */
  archive(credentialID, params, options) {
    const { vault_id, betas } = params;
    return this._client.post(path`/v1/vaults/${vault_id}/credentials/${credentialID}/archive?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
class Vaults extends APIResource {
  constructor() {
    super(...arguments);
    this.credentials = new Credentials(this._client);
  }
  /**
   * Create Vault
   *
   * @example
   * ```ts
   * const betaManagedAgentsVault =
   *   await client.beta.vaults.create({
   *     display_name: 'Example vault',
   *   });
   * ```
   */
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/vaults?beta=true", {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Get Vault
   *
   * @example
   * ```ts
   * const betaManagedAgentsVault =
   *   await client.beta.vaults.retrieve(
   *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
   *   );
   * ```
   */
  retrieve(vaultID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/vaults/${vaultID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Update Vault
   *
   * @example
   * ```ts
   * const betaManagedAgentsVault =
   *   await client.beta.vaults.update(
   *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
   *   );
   * ```
   */
  update(vaultID, params, options) {
    const { betas, ...body } = params;
    return this._client.post(path`/v1/vaults/${vaultID}?beta=true`, {
      body,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List Vaults
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const betaManagedAgentsVault of client.beta.vaults.list()) {
   *   // ...
   * }
   * ```
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/vaults?beta=true", PageCursor, {
      query,
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Delete Vault
   *
   * @example
   * ```ts
   * const betaManagedAgentsDeletedVault =
   *   await client.beta.vaults.delete(
   *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
   *   );
   * ```
   */
  delete(vaultID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.delete(path`/v1/vaults/${vaultID}?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * Archive Vault
   *
   * @example
   * ```ts
   * const betaManagedAgentsVault =
   *   await client.beta.vaults.archive(
   *     'vlt_011CZkZDLs7fYzm1hXNPeRjv',
   *   );
   * ```
   */
  archive(vaultID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.post(path`/v1/vaults/${vaultID}/archive?beta=true`, {
      ...options,
      headers: buildHeaders([
        { "anthropic-beta": [...betas ?? [], "managed-agents-2026-04-01"].toString() },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
Vaults.Credentials = Credentials;
class Beta extends APIResource {
  constructor() {
    super(...arguments);
    this.models = new Models$1(this._client);
    this.messages = new Messages$1(this._client);
    this.agents = new Agents(this._client);
    this.environments = new Environments(this._client);
    this.sessions = new Sessions(this._client);
    this.vaults = new Vaults(this._client);
    this.memoryStores = new MemoryStores(this._client);
    this.files = new Files(this._client);
    this.skills = new Skills(this._client);
    this.userProfiles = new UserProfiles(this._client);
  }
}
Beta.Models = Models$1;
Beta.Messages = Messages$1;
Beta.Agents = Agents;
Beta.Environments = Environments;
Beta.Sessions = Sessions;
Beta.Vaults = Vaults;
Beta.MemoryStores = MemoryStores;
Beta.Files = Files;
Beta.Skills = Skills;
Beta.UserProfiles = UserProfiles;
class Completions extends APIResource {
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/complete", {
      body,
      timeout: this._client._options.timeout ?? 6e5,
      ...options,
      headers: buildHeaders([
        { ...(betas == null ? void 0 : betas.toString()) != null ? { "anthropic-beta": betas == null ? void 0 : betas.toString() } : void 0 },
        options == null ? void 0 : options.headers
      ]),
      stream: params.stream ?? false
    });
  }
}
function getOutputFormat(params) {
  var _a2;
  return (_a2 = params == null ? void 0 : params.output_config) == null ? void 0 : _a2.format;
}
function maybeParseMessage(message, params, opts) {
  const outputFormat = getOutputFormat(params);
  if (!params || !("parse" in (outputFormat ?? {}))) {
    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type === "text") {
          const parsedBlock = Object.defineProperty({ ...block }, "parsed_output", {
            value: null,
            enumerable: false
          });
          return parsedBlock;
        }
        return block;
      }),
      parsed_output: null
    };
  }
  return parseMessage(message, params);
}
function parseMessage(message, params, opts) {
  let firstParsedOutput = null;
  const content = message.content.map((block) => {
    if (block.type === "text") {
      const parsedOutput = parseOutputFormat(params, block.text);
      if (firstParsedOutput === null) {
        firstParsedOutput = parsedOutput;
      }
      const parsedBlock = Object.defineProperty({ ...block }, "parsed_output", {
        value: parsedOutput,
        enumerable: false
      });
      return parsedBlock;
    }
    return block;
  });
  return {
    ...message,
    content,
    parsed_output: firstParsedOutput
  };
}
function parseOutputFormat(params, content) {
  const outputFormat = getOutputFormat(params);
  if ((outputFormat == null ? void 0 : outputFormat.type) !== "json_schema") {
    return null;
  }
  try {
    if ("parse" in outputFormat) {
      return outputFormat.parse(content);
    }
    return JSON.parse(content);
  } catch (error) {
    throw new AnthropicError(`Failed to parse structured output: ${error}`);
  }
}
var _MessageStream_instances, _MessageStream_currentMessageSnapshot, _MessageStream_params, _MessageStream_connectedPromise, _MessageStream_resolveConnectedPromise, _MessageStream_rejectConnectedPromise, _MessageStream_endPromise, _MessageStream_resolveEndPromise, _MessageStream_rejectEndPromise, _MessageStream_listeners, _MessageStream_ended, _MessageStream_errored, _MessageStream_aborted, _MessageStream_catchingPromiseCreated, _MessageStream_response, _MessageStream_request_id, _MessageStream_logger, _MessageStream_getFinalMessage, _MessageStream_getFinalText, _MessageStream_handleError, _MessageStream_beginRequest, _MessageStream_addStreamEvent, _MessageStream_endRequest, _MessageStream_accumulateMessage;
const JSON_BUF_PROPERTY = "__json_buf";
function tracksToolInput(content) {
  return content.type === "tool_use" || content.type === "server_tool_use";
}
class MessageStream {
  constructor(params, opts) {
    _MessageStream_instances.add(this);
    this.messages = [];
    this.receivedMessages = [];
    _MessageStream_currentMessageSnapshot.set(this, void 0);
    _MessageStream_params.set(this, null);
    this.controller = new AbortController();
    _MessageStream_connectedPromise.set(this, void 0);
    _MessageStream_resolveConnectedPromise.set(this, () => {
    });
    _MessageStream_rejectConnectedPromise.set(this, () => {
    });
    _MessageStream_endPromise.set(this, void 0);
    _MessageStream_resolveEndPromise.set(this, () => {
    });
    _MessageStream_rejectEndPromise.set(this, () => {
    });
    _MessageStream_listeners.set(this, {});
    _MessageStream_ended.set(this, false);
    _MessageStream_errored.set(this, false);
    _MessageStream_aborted.set(this, false);
    _MessageStream_catchingPromiseCreated.set(this, false);
    _MessageStream_response.set(this, void 0);
    _MessageStream_request_id.set(this, void 0);
    _MessageStream_logger.set(this, void 0);
    _MessageStream_handleError.set(this, (error) => {
      __classPrivateFieldSet(this, _MessageStream_errored, true);
      if (isAbortError(error)) {
        error = new APIUserAbortError();
      }
      if (error instanceof APIUserAbortError) {
        __classPrivateFieldSet(this, _MessageStream_aborted, true);
        return this._emit("abort", error);
      }
      if (error instanceof AnthropicError) {
        return this._emit("error", error);
      }
      if (error instanceof Error) {
        const anthropicError = new AnthropicError(error.message);
        anthropicError.cause = error;
        return this._emit("error", anthropicError);
      }
      return this._emit("error", new AnthropicError(String(error)));
    });
    __classPrivateFieldSet(this, _MessageStream_connectedPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _MessageStream_resolveConnectedPromise, resolve, "f");
      __classPrivateFieldSet(this, _MessageStream_rejectConnectedPromise, reject, "f");
    }));
    __classPrivateFieldSet(this, _MessageStream_endPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _MessageStream_resolveEndPromise, resolve, "f");
      __classPrivateFieldSet(this, _MessageStream_rejectEndPromise, reject, "f");
    }));
    __classPrivateFieldGet(this, _MessageStream_connectedPromise, "f").catch(() => {
    });
    __classPrivateFieldGet(this, _MessageStream_endPromise, "f").catch(() => {
    });
    __classPrivateFieldSet(this, _MessageStream_params, params);
    __classPrivateFieldSet(this, _MessageStream_logger, (opts == null ? void 0 : opts.logger) ?? console);
  }
  get response() {
    return __classPrivateFieldGet(this, _MessageStream_response, "f");
  }
  get request_id() {
    return __classPrivateFieldGet(this, _MessageStream_request_id, "f");
  }
  /**
   * Returns the `MessageStream` data, the raw `Response` instance and the ID of the request,
   * returned vie the `request-id` header which is useful for debugging requests and resporting
   * issues to Anthropic.
   *
   * This is the same as the `APIPromise.withResponse()` method.
   *
   * This method will raise an error if you created the stream using `MessageStream.fromReadableStream`
   * as no `Response` is available.
   */
  async withResponse() {
    __classPrivateFieldSet(this, _MessageStream_catchingPromiseCreated, true);
    const response = await __classPrivateFieldGet(this, _MessageStream_connectedPromise, "f");
    if (!response) {
      throw new Error("Could not resolve a `Response` object");
    }
    return {
      data: this,
      response,
      request_id: response.headers.get("request-id")
    };
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(stream) {
    const runner = new MessageStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static createMessage(messages, params, options, { logger } = {}) {
    const runner = new MessageStream(params, { logger });
    for (const message of params.messages) {
      runner._addMessageParam(message);
    }
    __classPrivateFieldSet(runner, _MessageStream_params, { ...params, stream: true });
    runner._run(() => runner._createMessage(messages, { ...params, stream: true }, { ...options, headers: { ...options == null ? void 0 : options.headers, "X-Stainless-Helper-Method": "stream" } }));
    return runner;
  }
  _run(executor) {
    executor().then(() => {
      this._emitFinal();
      this._emit("end");
    }, __classPrivateFieldGet(this, _MessageStream_handleError, "f"));
  }
  _addMessageParam(message) {
    this.messages.push(message);
  }
  _addMessage(message, emit = true) {
    this.receivedMessages.push(message);
    if (emit) {
      this._emit("message", message);
    }
  }
  async _createMessage(messages, params, options) {
    var _a2;
    const signal = options == null ? void 0 : options.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_beginRequest).call(this);
      const { response, data: stream } = await messages.create({ ...params, stream: true }, { ...options, signal: this.controller.signal }).withResponse();
      this._connected(response);
      for await (const event of stream) {
        __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_addStreamEvent).call(this, event);
      }
      if ((_a2 = stream.controller.signal) == null ? void 0 : _a2.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_endRequest).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  _connected(response) {
    if (this.ended)
      return;
    __classPrivateFieldSet(this, _MessageStream_response, response);
    __classPrivateFieldSet(this, _MessageStream_request_id, response == null ? void 0 : response.headers.get("request-id"));
    __classPrivateFieldGet(this, _MessageStream_resolveConnectedPromise, "f").call(this, response);
    this._emit("connect");
  }
  get ended() {
    return __classPrivateFieldGet(this, _MessageStream_ended, "f");
  }
  get errored() {
    return __classPrivateFieldGet(this, _MessageStream_errored, "f");
  }
  get aborted() {
    return __classPrivateFieldGet(this, _MessageStream_aborted, "f");
  }
  abort() {
    this.controller.abort();
  }
  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns this MessageStream, so that calls can be chained
   */
  on(event, listener) {
    const listeners = __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] || (__classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] = []);
    listeners.push({ listener });
    return this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this MessageStream, so that calls can be chained
   */
  off(event, listener) {
    const listeners = __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event];
    if (!listeners)
      return this;
    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0)
      listeners.splice(index, 1);
    return this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this MessageStream, so that calls can be chained
   */
  once(event, listener) {
    const listeners = __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] || (__classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }
  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * @returns a Promise that resolves the next time given event is triggered,
   * or rejects if an error is emitted.  (If you request the 'error' event,
   * returns a promise that resolves with the error).
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted(event) {
    return new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _MessageStream_catchingPromiseCreated, true);
      if (event !== "error")
        this.once("error", reject);
      this.once(event, resolve);
    });
  }
  async done() {
    __classPrivateFieldSet(this, _MessageStream_catchingPromiseCreated, true);
    await __classPrivateFieldGet(this, _MessageStream_endPromise, "f");
  }
  get currentMessage() {
    return __classPrivateFieldGet(this, _MessageStream_currentMessageSnapshot, "f");
  }
  /**
   * @returns a promise that resolves with the the final assistant Message response,
   * or rejects if an error occurred or the stream ended prematurely without producing a Message.
   * If structured outputs were used, this will be a ParsedMessage with a `parsed_output` field.
   */
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_getFinalMessage).call(this);
  }
  /**
   * @returns a promise that resolves with the the final assistant Message's text response, concatenated
   * together if there are more than one text blocks.
   * Rejects if an error occurred or the stream ended prematurely without producing a Message.
   */
  async finalText() {
    await this.done();
    return __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_getFinalText).call(this);
  }
  _emit(event, ...args) {
    if (__classPrivateFieldGet(this, _MessageStream_ended, "f"))
      return;
    if (event === "end") {
      __classPrivateFieldSet(this, _MessageStream_ended, true);
      __classPrivateFieldGet(this, _MessageStream_resolveEndPromise, "f").call(this);
    }
    const listeners = __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event];
    if (listeners) {
      __classPrivateFieldGet(this, _MessageStream_listeners, "f")[event] = listeners.filter((l) => !l.once);
      listeners.forEach(({ listener }) => listener(...args));
    }
    if (event === "abort") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _MessageStream_catchingPromiseCreated, "f") && !(listeners == null ? void 0 : listeners.length)) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _MessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _MessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _MessageStream_catchingPromiseCreated, "f") && !(listeners == null ? void 0 : listeners.length)) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _MessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _MessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
    }
  }
  _emitFinal() {
    const finalMessage = this.receivedMessages.at(-1);
    if (finalMessage) {
      this._emit("finalMessage", __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_getFinalMessage).call(this));
    }
  }
  async _fromReadableStream(readableStream, options) {
    var _a2;
    const signal = options == null ? void 0 : options.signal;
    let abortHandler;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      abortHandler = this.controller.abort.bind(this.controller);
      signal.addEventListener("abort", abortHandler);
    }
    try {
      __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_beginRequest).call(this);
      this._connected(null);
      const stream = Stream.fromReadableStream(readableStream, this.controller);
      for await (const event of stream) {
        __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_addStreamEvent).call(this, event);
      }
      if ((_a2 = stream.controller.signal) == null ? void 0 : _a2.aborted) {
        throw new APIUserAbortError();
      }
      __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_endRequest).call(this);
    } finally {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }
  [(_MessageStream_currentMessageSnapshot = /* @__PURE__ */ new WeakMap(), _MessageStream_params = /* @__PURE__ */ new WeakMap(), _MessageStream_connectedPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_resolveConnectedPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_rejectConnectedPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_endPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_resolveEndPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_rejectEndPromise = /* @__PURE__ */ new WeakMap(), _MessageStream_listeners = /* @__PURE__ */ new WeakMap(), _MessageStream_ended = /* @__PURE__ */ new WeakMap(), _MessageStream_errored = /* @__PURE__ */ new WeakMap(), _MessageStream_aborted = /* @__PURE__ */ new WeakMap(), _MessageStream_catchingPromiseCreated = /* @__PURE__ */ new WeakMap(), _MessageStream_response = /* @__PURE__ */ new WeakMap(), _MessageStream_request_id = /* @__PURE__ */ new WeakMap(), _MessageStream_logger = /* @__PURE__ */ new WeakMap(), _MessageStream_handleError = /* @__PURE__ */ new WeakMap(), _MessageStream_instances = /* @__PURE__ */ new WeakSet(), _MessageStream_getFinalMessage = function _MessageStream_getFinalMessage2() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a Message with role=assistant");
    }
    return this.receivedMessages.at(-1);
  }, _MessageStream_getFinalText = function _MessageStream_getFinalText2() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a Message with role=assistant");
    }
    const textBlocks = this.receivedMessages.at(-1).content.filter((block) => block.type === "text").map((block) => block.text);
    if (textBlocks.length === 0) {
      throw new AnthropicError("stream ended without producing a content block with type=text");
    }
    return textBlocks.join(" ");
  }, _MessageStream_beginRequest = function _MessageStream_beginRequest2() {
    if (this.ended)
      return;
    __classPrivateFieldSet(this, _MessageStream_currentMessageSnapshot, void 0);
  }, _MessageStream_addStreamEvent = function _MessageStream_addStreamEvent2(event) {
    if (this.ended)
      return;
    const messageSnapshot = __classPrivateFieldGet(this, _MessageStream_instances, "m", _MessageStream_accumulateMessage).call(this, event);
    this._emit("streamEvent", event, messageSnapshot);
    switch (event.type) {
      case "content_block_delta": {
        const content = messageSnapshot.content.at(-1);
        switch (event.delta.type) {
          case "text_delta": {
            if (content.type === "text") {
              this._emit("text", event.delta.text, content.text || "");
            }
            break;
          }
          case "citations_delta": {
            if (content.type === "text") {
              this._emit("citation", event.delta.citation, content.citations ?? []);
            }
            break;
          }
          case "input_json_delta": {
            if (tracksToolInput(content) && content.input) {
              this._emit("inputJson", event.delta.partial_json, content.input);
            }
            break;
          }
          case "thinking_delta": {
            if (content.type === "thinking") {
              this._emit("thinking", event.delta.thinking, content.thinking);
            }
            break;
          }
          case "signature_delta": {
            if (content.type === "thinking") {
              this._emit("signature", content.signature);
            }
            break;
          }
          default:
            checkNever(event.delta);
        }
        break;
      }
      case "message_stop": {
        this._addMessageParam(messageSnapshot);
        this._addMessage(maybeParseMessage(messageSnapshot, __classPrivateFieldGet(this, _MessageStream_params, "f"), { logger: __classPrivateFieldGet(this, _MessageStream_logger, "f") }), true);
        break;
      }
      case "content_block_stop": {
        this._emit("contentBlock", messageSnapshot.content.at(-1));
        break;
      }
      case "message_start": {
        __classPrivateFieldSet(this, _MessageStream_currentMessageSnapshot, messageSnapshot);
        break;
      }
    }
  }, _MessageStream_endRequest = function _MessageStream_endRequest2() {
    if (this.ended) {
      throw new AnthropicError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet(this, _MessageStream_currentMessageSnapshot, "f");
    if (!snapshot) {
      throw new AnthropicError(`request ended without sending any chunks`);
    }
    __classPrivateFieldSet(this, _MessageStream_currentMessageSnapshot, void 0);
    return maybeParseMessage(snapshot, __classPrivateFieldGet(this, _MessageStream_params, "f"), { logger: __classPrivateFieldGet(this, _MessageStream_logger, "f") });
  }, _MessageStream_accumulateMessage = function _MessageStream_accumulateMessage2(event) {
    let snapshot = __classPrivateFieldGet(this, _MessageStream_currentMessageSnapshot, "f");
    if (event.type === "message_start") {
      if (snapshot) {
        throw new AnthropicError(`Unexpected event order, got ${event.type} before receiving "message_stop"`);
      }
      return event.message;
    }
    if (!snapshot) {
      throw new AnthropicError(`Unexpected event order, got ${event.type} before "message_start"`);
    }
    switch (event.type) {
      case "message_stop":
        return snapshot;
      case "message_delta":
        snapshot.stop_reason = event.delta.stop_reason;
        snapshot.stop_sequence = event.delta.stop_sequence;
        snapshot.usage.output_tokens = event.usage.output_tokens;
        if (event.usage.input_tokens != null) {
          snapshot.usage.input_tokens = event.usage.input_tokens;
        }
        if (event.usage.cache_creation_input_tokens != null) {
          snapshot.usage.cache_creation_input_tokens = event.usage.cache_creation_input_tokens;
        }
        if (event.usage.cache_read_input_tokens != null) {
          snapshot.usage.cache_read_input_tokens = event.usage.cache_read_input_tokens;
        }
        if (event.usage.server_tool_use != null) {
          snapshot.usage.server_tool_use = event.usage.server_tool_use;
        }
        return snapshot;
      case "content_block_start":
        snapshot.content.push({ ...event.content_block });
        return snapshot;
      case "content_block_delta": {
        const snapshotContent = snapshot.content.at(event.index);
        switch (event.delta.type) {
          case "text_delta": {
            if ((snapshotContent == null ? void 0 : snapshotContent.type) === "text") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                text: (snapshotContent.text || "") + event.delta.text
              };
            }
            break;
          }
          case "citations_delta": {
            if ((snapshotContent == null ? void 0 : snapshotContent.type) === "text") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                citations: [...snapshotContent.citations ?? [], event.delta.citation]
              };
            }
            break;
          }
          case "input_json_delta": {
            if (snapshotContent && tracksToolInput(snapshotContent)) {
              let jsonBuf = snapshotContent[JSON_BUF_PROPERTY] || "";
              jsonBuf += event.delta.partial_json;
              const newContent = { ...snapshotContent };
              Object.defineProperty(newContent, JSON_BUF_PROPERTY, {
                value: jsonBuf,
                enumerable: false,
                writable: true
              });
              if (jsonBuf) {
                newContent.input = partialParse(jsonBuf);
              }
              snapshot.content[event.index] = newContent;
            }
            break;
          }
          case "thinking_delta": {
            if ((snapshotContent == null ? void 0 : snapshotContent.type) === "thinking") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                thinking: snapshotContent.thinking + event.delta.thinking
              };
            }
            break;
          }
          case "signature_delta": {
            if ((snapshotContent == null ? void 0 : snapshotContent.type) === "thinking") {
              snapshot.content[event.index] = {
                ...snapshotContent,
                signature: event.delta.signature
              };
            }
            break;
          }
          default:
            checkNever(event.delta);
        }
        return snapshot;
      }
      case "content_block_stop":
        return snapshot;
    }
  }, Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("streamEvent", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk2) => chunk2 ? { value: chunk2, done: false } : { value: void 0, done: true });
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      }
    };
  }
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
}
function checkNever(x) {
}
class Batches2 extends APIResource {
  /**
   * Send a batch of Message creation requests.
   *
   * The Message Batches API can be used to process multiple Messages API requests at
   * once. Once a Message Batch is created, it begins processing immediately. Batches
   * can take up to 24 hours to complete.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatch = await client.messages.batches.create({
   *   requests: [
   *     {
   *       custom_id: 'my-custom-id-1',
   *       params: {
   *         max_tokens: 1024,
   *         messages: [
   *           { content: 'Hello, world', role: 'user' },
   *         ],
   *         model: 'claude-opus-4-6',
   *       },
   *     },
   *   ],
   * });
   * ```
   */
  create(body, options) {
    return this._client.post("/v1/messages/batches", { body, ...options });
  }
  /**
   * This endpoint is idempotent and can be used to poll for Message Batch
   * completion. To access the results of a Message Batch, make a request to the
   * `results_url` field in the response.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatch = await client.messages.batches.retrieve(
   *   'message_batch_id',
   * );
   * ```
   */
  retrieve(messageBatchID, options) {
    return this._client.get(path`/v1/messages/batches/${messageBatchID}`, options);
  }
  /**
   * List all Message Batches within a Workspace. Most recently created batches are
   * returned first.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const messageBatch of client.messages.batches.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/v1/messages/batches", Page, { query, ...options });
  }
  /**
   * Delete a Message Batch.
   *
   * Message Batches can only be deleted once they've finished processing. If you'd
   * like to delete an in-progress batch, you must first cancel it.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const deletedMessageBatch =
   *   await client.messages.batches.delete('message_batch_id');
   * ```
   */
  delete(messageBatchID, options) {
    return this._client.delete(path`/v1/messages/batches/${messageBatchID}`, options);
  }
  /**
   * Batches may be canceled any time before processing ends. Once cancellation is
   * initiated, the batch enters a `canceling` state, at which time the system may
   * complete any in-progress, non-interruptible requests before finalizing
   * cancellation.
   *
   * The number of canceled requests is specified in `request_counts`. To determine
   * which requests were canceled, check the individual results within the batch.
   * Note that cancellation may not result in any canceled requests if they were
   * non-interruptible.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatch = await client.messages.batches.cancel(
   *   'message_batch_id',
   * );
   * ```
   */
  cancel(messageBatchID, options) {
    return this._client.post(path`/v1/messages/batches/${messageBatchID}/cancel`, options);
  }
  /**
   * Streams the results of a Message Batch as a `.jsonl` file.
   *
   * Each line in the file is a JSON object containing the result of a single request
   * in the Message Batch. Results are not guaranteed to be in the same order as
   * requests. Use the `custom_id` field to match results to requests.
   *
   * Learn more about the Message Batches API in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/batch-processing)
   *
   * @example
   * ```ts
   * const messageBatchIndividualResponse =
   *   await client.messages.batches.results('message_batch_id');
   * ```
   */
  async results(messageBatchID, options) {
    const batch = await this.retrieve(messageBatchID);
    if (!batch.results_url) {
      throw new AnthropicError(`No batch \`results_url\`; Has it finished processing? ${batch.processing_status} - ${batch.id}`);
    }
    return this._client.get(batch.results_url, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options == null ? void 0 : options.headers]),
      stream: true,
      __binaryResponse: true
    })._thenUnwrap((_, props) => JSONLDecoder.fromResponse(props.response, props.controller));
  }
}
class Messages2 extends APIResource {
  constructor() {
    super(...arguments);
    this.batches = new Batches2(this._client);
  }
  create(body, options) {
    if (body.model in DEPRECATED_MODELS) {
      console.warn(`The model '${body.model}' is deprecated and will reach end-of-life on ${DEPRECATED_MODELS[body.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`);
    }
    if (MODELS_TO_WARN_WITH_THINKING_ENABLED.includes(body.model) && body.thinking && body.thinking.type === "enabled") {
      console.warn(`Using Claude with ${body.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);
    }
    let timeout = this._client._options.timeout;
    if (!body.stream && timeout == null) {
      const maxNonstreamingTokens = MODEL_NONSTREAMING_TOKENS[body.model] ?? void 0;
      timeout = this._client.calculateNonstreamingTimeout(body.max_tokens, maxNonstreamingTokens);
    }
    const helperHeader = stainlessHelperHeader(body.tools, body.messages);
    return this._client.post("/v1/messages", {
      body,
      timeout: timeout ?? 6e5,
      ...options,
      headers: buildHeaders([helperHeader, options == null ? void 0 : options.headers]),
      stream: body.stream ?? false
    });
  }
  /**
   * Send a structured list of input messages with text and/or image content, along with an expected `output_config.format` and
   * the response will be automatically parsed and available in the `parsed_output` property of the message.
   *
   * @example
   * ```ts
   * const message = await client.messages.parse({
   *   model: 'claude-sonnet-4-5-20250929',
   *   max_tokens: 1024,
   *   messages: [{ role: 'user', content: 'What is 2+2?' }],
   *   output_config: {
   *     format: zodOutputFormat(z.object({ answer: z.number() })),
   *   },
   * });
   *
   * console.log(message.parsed_output?.answer); // 4
   * ```
   */
  parse(params, options) {
    return this.create(params, options).then((message) => parseMessage(message, params, { logger: this._client.logger ?? console }));
  }
  /**
   * Create a Message stream.
   *
   * If `output_config.format` is provided with a parseable format (like `zodOutputFormat()`),
   * the final message will include a `parsed_output` property with the parsed content.
   *
   * @example
   * ```ts
   * const stream = client.messages.stream({
   *   model: 'claude-sonnet-4-5-20250929',
   *   max_tokens: 1024,
   *   messages: [{ role: 'user', content: 'What is 2+2?' }],
   *   output_config: {
   *     format: zodOutputFormat(z.object({ answer: z.number() })),
   *   },
   * });
   *
   * const message = await stream.finalMessage();
   * console.log(message.parsed_output?.answer); // 4
   * ```
   */
  stream(body, options) {
    return MessageStream.createMessage(this, body, options, { logger: this._client.logger ?? console });
  }
  /**
   * Count the number of tokens in a Message.
   *
   * The Token Count API can be used to count the number of tokens in a Message,
   * including tools, images, and documents, without creating it.
   *
   * Learn more about token counting in our
   * [user guide](https://docs.claude.com/en/docs/build-with-claude/token-counting)
   *
   * @example
   * ```ts
   * const messageTokensCount =
   *   await client.messages.countTokens({
   *     messages: [{ content: 'Hello, world', role: 'user' }],
   *     model: 'claude-opus-4-6',
   *   });
   * ```
   */
  countTokens(body, options) {
    return this._client.post("/v1/messages/count_tokens", { body, ...options });
  }
}
const DEPRECATED_MODELS = {
  "claude-1.3": "November 6th, 2024",
  "claude-1.3-100k": "November 6th, 2024",
  "claude-instant-1.1": "November 6th, 2024",
  "claude-instant-1.1-100k": "November 6th, 2024",
  "claude-instant-1.2": "November 6th, 2024",
  "claude-3-sonnet-20240229": "July 21st, 2025",
  "claude-3-opus-20240229": "January 5th, 2026",
  "claude-2.1": "July 21st, 2025",
  "claude-2.0": "July 21st, 2025",
  "claude-3-7-sonnet-latest": "February 19th, 2026",
  "claude-3-7-sonnet-20250219": "February 19th, 2026",
  "claude-3-5-haiku-latest": "February 19th, 2026",
  "claude-3-5-haiku-20241022": "February 19th, 2026",
  "claude-opus-4-0": "June 15th, 2026",
  "claude-opus-4-20250514": "June 15th, 2026",
  "claude-sonnet-4-0": "June 15th, 2026",
  "claude-sonnet-4-20250514": "June 15th, 2026"
};
const MODELS_TO_WARN_WITH_THINKING_ENABLED = ["claude-mythos-preview", "claude-opus-4-6"];
Messages2.Batches = Batches2;
class Models2 extends APIResource {
  /**
   * Get a specific model.
   *
   * The Models API response can be used to determine information about a specific
   * model or resolve a model alias to a model ID.
   */
  retrieve(modelID, params = {}, options) {
    const { betas } = params ?? {};
    return this._client.get(path`/v1/models/${modelID}`, {
      ...options,
      headers: buildHeaders([
        { ...(betas == null ? void 0 : betas.toString()) != null ? { "anthropic-beta": betas == null ? void 0 : betas.toString() } : void 0 },
        options == null ? void 0 : options.headers
      ])
    });
  }
  /**
   * List available models.
   *
   * The Models API response can be used to determine which models are available for
   * use in the API. More recently released models are listed first.
   */
  list(params = {}, options) {
    const { betas, ...query } = params ?? {};
    return this._client.getAPIList("/v1/models", Page, {
      query,
      ...options,
      headers: buildHeaders([
        { ...(betas == null ? void 0 : betas.toString()) != null ? { "anthropic-beta": betas == null ? void 0 : betas.toString() } : void 0 },
        options == null ? void 0 : options.headers
      ])
    });
  }
}
const readEnv = (env) => {
  var _a2, _b, _c, _d, _e;
  if (typeof globalThis.process !== "undefined") {
    return ((_b = (_a2 = globalThis.process.env) == null ? void 0 : _a2[env]) == null ? void 0 : _b.trim()) || void 0;
  }
  if (typeof globalThis.Deno !== "undefined") {
    return ((_e = (_d = (_c = globalThis.Deno.env) == null ? void 0 : _c.get) == null ? void 0 : _d.call(_c, env)) == null ? void 0 : _e.trim()) || void 0;
  }
  return void 0;
};
var _BaseAnthropic_instances, _a, _BaseAnthropic_encoder, _BaseAnthropic_baseURLOverridden;
const HUMAN_PROMPT = "\\n\\nHuman:";
const AI_PROMPT = "\\n\\nAssistant:";
class BaseAnthropic {
  /**
   * API Client for interfacing with the Anthropic API.
   *
   * @param {string | null | undefined} [opts.apiKey=process.env['ANTHROPIC_API_KEY'] ?? null]
   * @param {string | null | undefined} [opts.authToken=process.env['ANTHROPIC_AUTH_TOKEN'] ?? null]
   * @param {string} [opts.baseURL=process.env['ANTHROPIC_BASE_URL'] ?? https://api.anthropic.com] - Override the default base URL for the API.
   * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   */
  constructor({ baseURL = readEnv("ANTHROPIC_BASE_URL"), apiKey = readEnv("ANTHROPIC_API_KEY") ?? null, authToken = readEnv("ANTHROPIC_AUTH_TOKEN") ?? null, ...opts } = {}) {
    _BaseAnthropic_instances.add(this);
    _BaseAnthropic_encoder.set(this, void 0);
    const options = {
      apiKey,
      authToken,
      ...opts,
      baseURL: baseURL || `https://api.anthropic.com`
    };
    if (!options.dangerouslyAllowBrowser && isRunningInBrowser()) {
      throw new AnthropicError("It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew Anthropic({ apiKey, dangerouslyAllowBrowser: true });\n");
    }
    this.baseURL = options.baseURL;
    this.timeout = options.timeout ?? _a.DEFAULT_TIMEOUT;
    this.logger = options.logger ?? console;
    const defaultLogLevel = "warn";
    this.logLevel = defaultLogLevel;
    this.logLevel = parseLogLevel(options.logLevel, "ClientOptions.logLevel", this) ?? parseLogLevel(readEnv("ANTHROPIC_LOG"), "process.env['ANTHROPIC_LOG']", this) ?? defaultLogLevel;
    this.fetchOptions = options.fetchOptions;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetch ?? getDefaultFetch();
    __classPrivateFieldSet(this, _BaseAnthropic_encoder, FallbackEncoder);
    const customHeadersEnv = readEnv("ANTHROPIC_CUSTOM_HEADERS");
    if (customHeadersEnv) {
      const parsed = {};
      for (const line of customHeadersEnv.split("\n")) {
        const colon = line.indexOf(":");
        if (colon >= 0) {
          parsed[line.substring(0, colon).trim()] = line.substring(colon + 1).trim();
        }
      }
      options.defaultHeaders = { ...parsed, ...options.defaultHeaders };
    }
    this._options = options;
    this.apiKey = typeof apiKey === "string" ? apiKey : null;
    this.authToken = authToken;
  }
  /**
   * Create a new client instance re-using the same options given to the current client with optional overriding.
   */
  withOptions(options) {
    const client = new this.constructor({
      ...this._options,
      baseURL: this.baseURL,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
      logger: this.logger,
      logLevel: this.logLevel,
      fetch: this.fetch,
      fetchOptions: this.fetchOptions,
      apiKey: this.apiKey,
      authToken: this.authToken,
      ...options
    });
    return client;
  }
  defaultQuery() {
    return this._options.defaultQuery;
  }
  validateHeaders({ values, nulls }) {
    if (values.get("x-api-key") || values.get("authorization")) {
      return;
    }
    if (this.apiKey && values.get("x-api-key")) {
      return;
    }
    if (nulls.has("x-api-key")) {
      return;
    }
    if (this.authToken && values.get("authorization")) {
      return;
    }
    if (nulls.has("authorization")) {
      return;
    }
    throw new Error('Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted');
  }
  async authHeaders(opts) {
    return buildHeaders([await this.apiKeyAuth(opts), await this.bearerAuth(opts)]);
  }
  async apiKeyAuth(opts) {
    if (this.apiKey == null) {
      return void 0;
    }
    return buildHeaders([{ "X-Api-Key": this.apiKey }]);
  }
  async bearerAuth(opts) {
    if (this.authToken == null) {
      return void 0;
    }
    return buildHeaders([{ Authorization: `Bearer ${this.authToken}` }]);
  }
  /**
   * Basic re-implementation of `qs.stringify` for primitive types.
   */
  stringifyQuery(query) {
    return stringifyQuery(query);
  }
  getUserAgent() {
    return `${this.constructor.name}/JS ${VERSION}`;
  }
  defaultIdempotencyKey() {
    return `stainless-node-retry-${uuid4()}`;
  }
  makeStatusError(status, error, message, headers) {
    return APIError.generate(status, error, message, headers);
  }
  buildURL(path2, query, defaultBaseURL) {
    const baseURL = !__classPrivateFieldGet(this, _BaseAnthropic_instances, "m", _BaseAnthropic_baseURLOverridden).call(this) && defaultBaseURL || this.baseURL;
    const url = isAbsoluteURL(path2) ? new URL(path2) : new URL(baseURL + (baseURL.endsWith("/") && path2.startsWith("/") ? path2.slice(1) : path2));
    const defaultQuery = this.defaultQuery();
    const pathQuery = Object.fromEntries(url.searchParams);
    if (!isEmptyObj(defaultQuery) || !isEmptyObj(pathQuery)) {
      query = { ...pathQuery, ...defaultQuery, ...query };
    }
    if (typeof query === "object" && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query);
    }
    return url.toString();
  }
  _calculateNonstreamingTimeout(maxTokens) {
    const defaultTimeout = 10 * 60;
    const expectedTimeout = 60 * 60 * maxTokens / 128e3;
    if (expectedTimeout > defaultTimeout) {
      throw new AnthropicError("Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#streaming-responses for more details");
    }
    return defaultTimeout * 1e3;
  }
  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
   */
  async prepareOptions(options) {
  }
  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  async prepareRequest(request, { url, options }) {
  }
  get(path2, opts) {
    return this.methodRequest("get", path2, opts);
  }
  post(path2, opts) {
    return this.methodRequest("post", path2, opts);
  }
  patch(path2, opts) {
    return this.methodRequest("patch", path2, opts);
  }
  put(path2, opts) {
    return this.methodRequest("put", path2, opts);
  }
  delete(path2, opts) {
    return this.methodRequest("delete", path2, opts);
  }
  methodRequest(method, path2, opts) {
    return this.request(Promise.resolve(opts).then((opts2) => {
      return { method, path: path2, ...opts2 };
    }));
  }
  request(options, remainingRetries = null) {
    return new APIPromise(this, this.makeRequest(options, remainingRetries, void 0));
  }
  async makeRequest(optionsInput, retriesRemaining, retryOfRequestLogID) {
    var _a2, _b;
    const options = await optionsInput;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    if (retriesRemaining == null) {
      retriesRemaining = maxRetries;
    }
    await this.prepareOptions(options);
    const { req, url, timeout } = await this.buildRequest(options, {
      retryCount: maxRetries - retriesRemaining
    });
    await this.prepareRequest(req, { url, options });
    const requestLogID = "log_" + (Math.random() * (1 << 24) | 0).toString(16).padStart(6, "0");
    const retryLogStr = retryOfRequestLogID === void 0 ? "" : `, retryOf: ${retryOfRequestLogID}`;
    const startTime = Date.now();
    loggerFor(this).debug(`[${requestLogID}] sending request`, formatRequestDetails({
      retryOfRequestLogID,
      method: options.method,
      url,
      options,
      headers: req.headers
    }));
    if ((_a2 = options.signal) == null ? void 0 : _a2.aborted) {
      throw new APIUserAbortError();
    }
    const controller = new AbortController();
    const response = await this.fetchWithTimeout(url, req, timeout, controller).catch(castToError);
    const headersTime = Date.now();
    if (response instanceof globalThis.Error) {
      const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
      if ((_b = options.signal) == null ? void 0 : _b.aborted) {
        throw new APIUserAbortError();
      }
      const isTimeout = isAbortError(response) || /timed? ?out/i.test(String(response) + ("cause" in response ? String(response.cause) : ""));
      if (retriesRemaining) {
        loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - ${retryMessage}`);
        loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (${retryMessage})`, formatRequestDetails({
          retryOfRequestLogID,
          url,
          durationMs: headersTime - startTime,
          message: response.message
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID);
      }
      loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - error; no more retries left`);
      loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (error; no more retries left)`, formatRequestDetails({
        retryOfRequestLogID,
        url,
        durationMs: headersTime - startTime,
        message: response.message
      }));
      if (isTimeout) {
        throw new APIConnectionTimeoutError();
      }
      throw new APIConnectionError({ cause: response });
    }
    const specialHeaders = [...response.headers.entries()].filter(([name]) => name === "request-id").map(([name, value]) => ", " + name + ": " + JSON.stringify(value)).join("");
    const responseInfo = `[${requestLogID}${retryLogStr}${specialHeaders}] ${req.method} ${url} ${response.ok ? "succeeded" : "failed"} with status ${response.status} in ${headersTime - startTime}ms`;
    if (!response.ok) {
      const shouldRetry = await this.shouldRetry(response);
      if (retriesRemaining && shouldRetry) {
        const retryMessage2 = `retrying, ${retriesRemaining} attempts remaining`;
        await CancelReadableStream(response.body);
        loggerFor(this).info(`${responseInfo} - ${retryMessage2}`);
        loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage2})`, formatRequestDetails({
          retryOfRequestLogID,
          url: response.url,
          status: response.status,
          headers: response.headers,
          durationMs: headersTime - startTime
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID, response.headers);
      }
      const retryMessage = shouldRetry ? `error; no more retries left` : `error; not retryable`;
      loggerFor(this).info(`${responseInfo} - ${retryMessage}`);
      const errText = await response.text().catch((err2) => castToError(err2).message);
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? void 0 : errText;
      loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage})`, formatRequestDetails({
        retryOfRequestLogID,
        url: response.url,
        status: response.status,
        headers: response.headers,
        message: errMessage,
        durationMs: Date.now() - startTime
      }));
      const err = this.makeStatusError(response.status, errJSON, errMessage, response.headers);
      throw err;
    }
    loggerFor(this).info(responseInfo);
    loggerFor(this).debug(`[${requestLogID}] response start`, formatRequestDetails({
      retryOfRequestLogID,
      url: response.url,
      status: response.status,
      headers: response.headers,
      durationMs: headersTime - startTime
    }));
    return { response, options, controller, requestLogID, retryOfRequestLogID, startTime };
  }
  getAPIList(path2, Page2, opts) {
    return this.requestAPIList(Page2, opts && "then" in opts ? opts.then((opts2) => ({ method: "get", path: path2, ...opts2 })) : { method: "get", path: path2, ...opts });
  }
  requestAPIList(Page2, options) {
    const request = this.makeRequest(options, null, void 0);
    return new PagePromise(this, request, Page2);
  }
  async fetchWithTimeout(url, init, ms, controller) {
    const { signal, method, ...options } = init || {};
    const abort = this._makeAbort(controller);
    if (signal)
      signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, ms);
    const isReadableBody = globalThis.ReadableStream && options.body instanceof globalThis.ReadableStream || typeof options.body === "object" && options.body !== null && Symbol.asyncIterator in options.body;
    const fetchOptions = {
      signal: controller.signal,
      ...isReadableBody ? { duplex: "half" } : {},
      method: "GET",
      ...options
    };
    if (method) {
      fetchOptions.method = method.toUpperCase();
    }
    try {
      return await this.fetch.call(void 0, url, fetchOptions);
    } finally {
      clearTimeout(timeout);
    }
  }
  async shouldRetry(response) {
    const shouldRetryHeader = response.headers.get("x-should-retry");
    if (shouldRetryHeader === "true")
      return true;
    if (shouldRetryHeader === "false")
      return false;
    if (response.status === 408)
      return true;
    if (response.status === 409)
      return true;
    if (response.status === 429)
      return true;
    if (response.status >= 500)
      return true;
    return false;
  }
  async retryRequest(options, retriesRemaining, requestLogID, responseHeaders) {
    let timeoutMillis;
    const retryAfterMillisHeader = responseHeaders == null ? void 0 : responseHeaders.get("retry-after-ms");
    if (retryAfterMillisHeader) {
      const timeoutMs = parseFloat(retryAfterMillisHeader);
      if (!Number.isNaN(timeoutMs)) {
        timeoutMillis = timeoutMs;
      }
    }
    const retryAfterHeader = responseHeaders == null ? void 0 : responseHeaders.get("retry-after");
    if (retryAfterHeader && !timeoutMillis) {
      const timeoutSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(timeoutSeconds)) {
        timeoutMillis = timeoutSeconds * 1e3;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }
    if (timeoutMillis === void 0) {
      const maxRetries = options.maxRetries ?? this.maxRetries;
      timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
    }
    await sleep(timeoutMillis);
    return this.makeRequest(options, retriesRemaining - 1, requestLogID);
  }
  calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries) {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 8;
    const numRetries = maxRetries - retriesRemaining;
    const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);
    const jitter = 1 - Math.random() * 0.25;
    return sleepSeconds * jitter * 1e3;
  }
  calculateNonstreamingTimeout(maxTokens, maxNonstreamingTokens) {
    const maxTime = 60 * 60 * 1e3;
    const defaultTime = 60 * 10 * 1e3;
    const expectedTime = maxTime * maxTokens / 128e3;
    if (expectedTime > defaultTime || maxNonstreamingTokens != null && maxTokens > maxNonstreamingTokens) {
      throw new AnthropicError("Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details");
    }
    return defaultTime;
  }
  async buildRequest(inputOptions, { retryCount = 0 } = {}) {
    const options = { ...inputOptions };
    const { method, path: path2, query, defaultBaseURL } = options;
    const url = this.buildURL(path2, query, defaultBaseURL);
    if ("timeout" in options)
      validatePositiveInteger("timeout", options.timeout);
    options.timeout = options.timeout ?? this.timeout;
    const { bodyHeaders, body } = this.buildBody({ options });
    const reqHeaders = await this.buildHeaders({ options: inputOptions, method, bodyHeaders, retryCount });
    const req = {
      method,
      headers: reqHeaders,
      ...options.signal && { signal: options.signal },
      ...globalThis.ReadableStream && body instanceof globalThis.ReadableStream && { duplex: "half" },
      ...body && { body },
      ...this.fetchOptions ?? {},
      ...options.fetchOptions ?? {}
    };
    return { req, url, timeout: options.timeout };
  }
  async buildHeaders({ options, method, bodyHeaders, retryCount }) {
    let idempotencyHeaders = {};
    if (this.idempotencyHeader && method !== "get") {
      if (!options.idempotencyKey)
        options.idempotencyKey = this.defaultIdempotencyKey();
      idempotencyHeaders[this.idempotencyHeader] = options.idempotencyKey;
    }
    const headers = buildHeaders([
      idempotencyHeaders,
      {
        Accept: "application/json",
        "User-Agent": this.getUserAgent(),
        "X-Stainless-Retry-Count": String(retryCount),
        ...options.timeout ? { "X-Stainless-Timeout": String(Math.trunc(options.timeout / 1e3)) } : {},
        ...getPlatformHeaders(),
        ...this._options.dangerouslyAllowBrowser ? { "anthropic-dangerous-direct-browser-access": "true" } : void 0,
        "anthropic-version": "2023-06-01"
      },
      await this.authHeaders(options),
      this._options.defaultHeaders,
      bodyHeaders,
      options.headers
    ]);
    this.validateHeaders(headers);
    return headers.values;
  }
  _makeAbort(controller) {
    return () => controller.abort();
  }
  buildBody({ options: { body, headers: rawHeaders } }) {
    if (!body) {
      return { bodyHeaders: void 0, body: void 0 };
    }
    const headers = buildHeaders([rawHeaders]);
    if (
      // Pass raw type verbatim
      ArrayBuffer.isView(body) || body instanceof ArrayBuffer || body instanceof DataView || typeof body === "string" && // Preserve legacy string encoding behavior for now
      headers.values.has("content-type") || // `Blob` is superset of `File`
      globalThis.Blob && body instanceof globalThis.Blob || // `FormData` -> `multipart/form-data`
      body instanceof FormData || // `URLSearchParams` -> `application/x-www-form-urlencoded`
      body instanceof URLSearchParams || // Send chunked stream (each chunk has own `length`)
      globalThis.ReadableStream && body instanceof globalThis.ReadableStream
    ) {
      return { bodyHeaders: void 0, body };
    } else if (typeof body === "object" && (Symbol.asyncIterator in body || Symbol.iterator in body && "next" in body && typeof body.next === "function")) {
      return { bodyHeaders: void 0, body: ReadableStreamFrom(body) };
    } else if (typeof body === "object" && headers.values.get("content-type") === "application/x-www-form-urlencoded") {
      return {
        bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
        body: this.stringifyQuery(body)
      };
    } else {
      return __classPrivateFieldGet(this, _BaseAnthropic_encoder, "f").call(this, { body, headers });
    }
  }
}
_a = BaseAnthropic, _BaseAnthropic_encoder = /* @__PURE__ */ new WeakMap(), _BaseAnthropic_instances = /* @__PURE__ */ new WeakSet(), _BaseAnthropic_baseURLOverridden = function _BaseAnthropic_baseURLOverridden2() {
  return this.baseURL !== "https://api.anthropic.com";
};
BaseAnthropic.Anthropic = _a;
BaseAnthropic.HUMAN_PROMPT = HUMAN_PROMPT;
BaseAnthropic.AI_PROMPT = AI_PROMPT;
BaseAnthropic.DEFAULT_TIMEOUT = 6e5;
BaseAnthropic.AnthropicError = AnthropicError;
BaseAnthropic.APIError = APIError;
BaseAnthropic.APIConnectionError = APIConnectionError;
BaseAnthropic.APIConnectionTimeoutError = APIConnectionTimeoutError;
BaseAnthropic.APIUserAbortError = APIUserAbortError;
BaseAnthropic.NotFoundError = NotFoundError;
BaseAnthropic.ConflictError = ConflictError;
BaseAnthropic.RateLimitError = RateLimitError;
BaseAnthropic.BadRequestError = BadRequestError;
BaseAnthropic.AuthenticationError = AuthenticationError;
BaseAnthropic.InternalServerError = InternalServerError;
BaseAnthropic.PermissionDeniedError = PermissionDeniedError;
BaseAnthropic.UnprocessableEntityError = UnprocessableEntityError;
BaseAnthropic.toFile = toFile;
class Anthropic extends BaseAnthropic {
  constructor() {
    super(...arguments);
    this.completions = new Completions(this);
    this.messages = new Messages2(this);
    this.models = new Models2(this);
    this.beta = new Beta(this);
  }
}
Anthropic.Completions = Completions;
Anthropic.Messages = Messages2;
Anthropic.Models = Models2;
Anthropic.Beta = Beta;
async function streamMimoChat(input) {
  const config = getModelRuntimeConfig("main");
  const systemPrompt = buildSystemPrompt();
  if (config.providerKind === "openai-compatible") {
    const runtimeContext = [
      input.conversationSummary ? formatConversationSummary(input.conversationSummary) : "",
      input.memories && input.memories.length > 0 ? formatLongTermMemories(input.memories) : "",
      buildIntentContextMessage(input.intentSummary)
    ].filter((item) => item.trim().length > 0).join("\n\n---\n\n");
    const openAiInput = {
      config,
      system: systemPrompt,
      messages: trimCompressedMessages(input.messages, input.conversationSummary),
      runtimeContext,
      latestUserMessage: input.latestUserMessage,
      onDelta: input.onDelta
    };
    if (config.toolCallingMode === "native-openai" && input.toolSelection && input.executeToolRequest) {
      return streamOpenAiChatWithNativeTools({
        ...openAiInput,
        toolSelection: input.toolSelection,
        executeToolRequest: input.executeToolRequest
      });
    }
    return streamOpenAiChat(openAiInput);
  }
  if (config.providerKind !== "anthropic-compatible") {
    throw new Error(`主模型当前只支持 anthropic-compatible 或 openai-compatible，实际配置为：${config.providerKind}`);
  }
  const startedAtMs = Date.now();
  const requestBody = {
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemPrompt,
    messages: buildMimoMessages(input.messages, input.intentSummary, input.conversationSummary, input.memories),
    top_p: 0.95,
    stream: true,
    temperature: config.temperature
  };
  const debugLog = createDebugLogBase({
    providerId: "main-anthropic-compatible",
    model: config.model,
    baseURL: config.baseURL,
    request: {
      method: "POST",
      endpoint: `${config.baseURL}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": "[redacted]",
        "anthropic-version": "sdk-managed"
      },
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });
  const apiKey = config.apiKey;
  if (!apiKey) {
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: "未检测到主模型 API Key。"
    });
    return {
      content: "未检测到主模型 API Key。请打开模型配置，填写 main 模型的 API Key 后重新发送。",
      stopReason: "missing_api_key"
    };
  }
  const client = new Anthropic({
    apiKey: apiKey.trim(),
    baseURL: config.baseURL
  });
  try {
    let content = "";
    const stream = client.messages.stream(requestBody);
    stream.on("text", (delta) => {
      content += delta;
      input.onDelta(delta);
    });
    const finalMessage = await stream.finalMessage();
    addProviderDebugLog({
      ...debugLog,
      status: "succeeded",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - startedAtMs,
      response: {
        content,
        stopReason: finalMessage.stop_reason ?? void 0,
        usage: finalMessage.usage
      }
    });
    return {
      content,
      stopReason: finalMessage.stop_reason ?? void 0,
      usage: finalMessage.usage
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(toMimoErrorMessage(message));
  }
}
function buildMimoMessages(messages, intentSummary, conversationSummary, memories) {
  const activeMessages = trimCompressedMessages(messages, conversationSummary);
  const conversationMessages = toAnthropicMessages(activeMessages);
  const latestUserMessage = conversationMessages.at(-1);
  const historyMessages = latestUserMessage ? conversationMessages.slice(0, -1) : conversationMessages;
  const summaryContextMessage = conversationSummary ? {
    role: "user",
    content: [
      {
        type: "text",
        text: formatConversationSummary(conversationSummary)
      }
    ]
  } : void 0;
  const runtimeContextMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: buildIntentContextMessage(intentSummary)
      }
    ]
  };
  const memoryContextMessage = memories && memories.length > 0 ? {
    role: "user",
    content: [
      {
        type: "text",
        text: formatLongTermMemories(memories)
      }
    ]
  } : void 0;
  const stableContextMessages = [
    ...summaryContextMessage ? [summaryContextMessage] : [],
    ...memoryContextMessage ? [memoryContextMessage] : []
  ];
  if (!latestUserMessage) {
    return [...stableContextMessages, runtimeContextMessage];
  }
  return [...stableContextMessages, ...historyMessages, runtimeContextMessage, latestUserMessage];
}
function trimCompressedMessages(messages, conversationSummary) {
  if (!conversationSummary) {
    return messages;
  }
  const sourceEndIndex = messages.findIndex((message) => message.id === conversationSummary.sourceEndMessageId);
  return sourceEndIndex >= 0 ? messages.slice(sourceEndIndex + 1) : messages;
}
function formatConversationSummary(summary) {
  return [
    "【会话压缩摘要】",
    "",
    "以下内容是系统根据较早真实对话生成的会话摘要，不是用户本轮输入。它用于替代已从上下文中裁剪的早期对话。",
    "",
    `覆盖范围：${summary.sourceStartMessageId} -> ${summary.sourceEndMessageId}`,
    "",
    "摘要：",
    summary.summary,
    "",
    formatList("已确认决策", summary.decisions),
    formatList("未确认问题", summary.openQuestions),
    formatList("约束与偏好", summary.constraints),
    formatList("任务进度", summary.taskProgress)
  ].filter((item) => item.trim().length > 0).join("\n");
}
function formatLongTermMemories(memories) {
  return [
    "【长期记忆召回】",
    "",
    "以下内容是系统从本地长期记忆数据库召回的用户偏好、项目决策、约束或规划，不是用户本轮新输入。请优先遵守其中的高重要性规则，但不要原样复述。",
    "",
    ...memories.map((memory) => {
      return [
        `- id: ${memory.id}`,
        `  type: ${memory.type}`,
        `  importance: ${memory.importance}`,
        `  confidence: ${memory.confidence}`,
        `  content: ${memory.content}`,
        memory.tags.length > 0 ? `  tags: ${memory.tags.join(", ")}` : ""
      ].filter((item) => item.length > 0).join("\n");
    })
  ].join("\n");
}
function formatList(label, items) {
  if (items.length === 0) {
    return "";
  }
  return [`${label}：`, ...items.map((item) => `- ${item}`)].join("\n");
}
function toAnthropicMessages(messages) {
  return messages.filter((message) => message.sender === "user" || message.sender === "assistant").map((message) => ({
    role: message.sender === "assistant" ? "assistant" : "user",
    content: [
      {
        type: "text",
        text: message.content
      }
    ]
  }));
}
function toMimoErrorMessage(message) {
  if (message.includes("401") || message.toLowerCase().includes("invalid api key")) {
    return "主模型服务返回 401：API Key 无效。请确认模型配置中的 API Key、Base URL 和模型名正确。";
  }
  return `主模型调用失败：${message}`;
}
async function recognizeIntent(messages, latestUserMessage) {
  var _a2;
  const startedAtMs = Date.now();
  const config = getModelRuntimeConfig("router");
  if (config.providerKind === "openai-compatible") {
    const content2 = await createOpenAiJsonChat({
      config,
      providerId: "router-openai-compatible",
      latestUserMessage,
      messages: [
        {
          role: "system",
          content: buildIntentSystemPrompt()
        },
        {
          role: "user",
          content: buildIntentUserPrompt(messages, latestUserMessage)
        }
      ]
    });
    return parseRouterResult(content2);
  }
  if (config.providerKind !== "ollama") {
    throw new Error(`Router 当前只支持 ollama 或 openai-compatible，实际配置为：${config.providerKind}`);
  }
  const requestBody = {
    model: config.model,
    stream: false,
    messages: [
      {
        role: "system",
        content: buildIntentSystemPrompt()
      },
      {
        role: "user",
        content: buildIntentUserPrompt(messages, latestUserMessage)
      }
    ],
    options: {
      temperature: config.temperature,
      num_predict: config.maxTokens
    }
  };
  const debugLog = createDebugLogBase({
    providerId: "ollama-intent",
    model: config.model,
    baseURL: config.baseURL,
    request: {
      method: "POST",
      endpoint: `${config.baseURL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: requestBody,
      messageCount: messages.length,
      latestUserMessage
    }
  });
  const response = await fetch(`${config.baseURL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const content = (((_a2 = data.message) == null ? void 0 : _a2.content) ?? data.response ?? "").trim();
  const routerResult = parseRouterResult(content);
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content
    }
  });
  return routerResult;
}
function parseRouterResult(content) {
  const parsed = JSON.parse(content);
  const allowedIntents = ["code", "chat", "search", "debug", "analysis"];
  const intent = normalizeIntent(parsed.intent, allowedIntents);
  if (!intent) {
    throw new Error(`意图识别结果无效：intent 必须是 ${allowedIntents.join(" | ")} 之一。实际返回：${content}`);
  }
  const taskType = normalizeTaskType(parsed.task_type) ?? defaultTaskTypeForIntent(intent);
  const needsTools = toBoolean$1(parsed.needs_tools);
  const suggestedTools = normalizeSuggestedTools(parsed.suggested_tools, needsTools);
  return {
    intent,
    rewritten_input: toStringValue$1(parsed.rewritten_input),
    keywords: toStringArray$1(parsed.keywords),
    is_task: toBoolean$1(parsed.is_task),
    task_goal: toStringValue$1(parsed.task_goal),
    task_type: taskType,
    reasoning_brief: toStringValue$1(parsed.reasoning_brief),
    planned_steps: toStringArray$1(parsed.planned_steps),
    expected_output: toStringValue$1(parsed.expected_output),
    verification_question: toStringValue$1(parsed.verification_question),
    success_criteria: toStringArray$1(parsed.success_criteria),
    needs_user_clarification: toBoolean$1(parsed.needs_user_clarification),
    clarifying_questions: toStringArray$1(parsed.clarifying_questions),
    requires_project_context: toBoolean$1(parsed.requires_project_context),
    needs_tools: needsTools,
    suggested_tools: suggestedTools,
    tool_reason: toStringValue$1(parsed.tool_reason),
    confidence: clampConfidence$1(parsed.confidence)
  };
}
function normalizeIntent(intent, allowedIntents) {
  if (typeof intent !== "string") {
    return void 0;
  }
  const exactIntent = intent.trim();
  if (allowedIntents.includes(exactIntent)) {
    return exactIntent;
  }
  const candidates = exactIntent.split("|").map((item) => item.trim());
  const firstAllowedIntent = candidates.find((item) => allowedIntents.includes(item));
  return firstAllowedIntent;
}
function normalizeTaskType(taskType) {
  const allowedTaskTypes = [
    "chat",
    "analysis",
    "design",
    "implementation",
    "debugging",
    "verification"
  ];
  if (typeof taskType !== "string") {
    return void 0;
  }
  const exactTaskType = taskType.trim();
  if (allowedTaskTypes.includes(exactTaskType)) {
    return exactTaskType;
  }
  const candidates = exactTaskType.split("|").map((item) => item.trim());
  return candidates.find((item) => allowedTaskTypes.includes(item));
}
function defaultTaskTypeForIntent(intent) {
  if (intent === "code") {
    return "implementation";
  }
  if (intent === "debug") {
    return "debugging";
  }
  if (intent === "chat") {
    return "chat";
  }
  return "analysis";
}
function toBoolean$1(value) {
  return value === true;
}
function toStringValue$1(value) {
  return typeof value === "string" ? value : "";
}
function toStringArray$1(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function normalizeSuggestedTools(value, needsTools) {
  const allowed = /* @__PURE__ */ new Set(["command.run", "file.read", "file.list", "file.search", "file.write", "memory.save"]);
  const tools = toStringArray$1(value).filter((tool) => allowed.has(tool));
  if (needsTools && tools.length === 0) {
    return ["file.read", "file.search", "command.run"];
  }
  return tools;
}
function clampConfidence$1(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
async function evaluateOutput(input) {
  var _a2;
  const config = getModelRuntimeConfig("router");
  const routerResultText = JSON.stringify(input.routerResult, null, 2);
  const userPrompt = buildEvaluatorUserPrompt({
    userInput: input.userInput,
    routerResult: routerResultText,
    assistantAnswer: input.assistantAnswer
  });
  if (config.providerKind === "openai-compatible") {
    const content2 = await createOpenAiJsonChat({
      config,
      providerId: "output-evaluator-openai-compatible",
      latestUserMessage: input.userInput,
      messages: [
        {
          role: "system",
          content: buildEvaluatorSystemPrompt()
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    });
    return parseEvaluationResult(content2, input.routerResult);
  }
  if (config.providerKind !== "ollama") {
    return defaultPassedEvaluation(input.routerResult, "Router Provider 不支持输出验收，跳过 evaluator。");
  }
  const startedAtMs = Date.now();
  const requestBody = {
    model: config.model,
    stream: false,
    messages: [
      {
        role: "system",
        content: buildEvaluatorSystemPrompt()
      },
      {
        role: "user",
        content: userPrompt
      }
    ],
    options: {
      temperature: Math.min(config.temperature, 0.2),
      num_predict: config.maxTokens
    }
  };
  const debugLog = createDebugLogBase({
    providerId: "output-evaluator-ollama",
    model: config.model,
    baseURL: config.baseURL,
    request: {
      method: "POST",
      endpoint: `${config.baseURL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage: input.userInput
    }
  });
  const response = await fetch(`${config.baseURL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  if (!response.ok) {
    throw new Error(`Ollama Evaluator HTTP ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const content = (((_a2 = data.message) == null ? void 0 : _a2.content) ?? data.response ?? "").trim();
  const evaluation = parseEvaluationResult(content, input.routerResult);
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content
    }
  });
  return evaluation;
}
function parseEvaluationResult(content, routerResult) {
  const parsed = JSON.parse(content);
  const nextAction = normalizeNextAction(parsed.next_action);
  const shouldEvaluate = toBoolean(parsed.should_evaluate);
  const missingCriteria = toStringArray(parsed.missing_criteria);
  const passed = toBoolean(parsed.passed) && missingCriteria.length === 0;
  return {
    should_evaluate: shouldEvaluate,
    passed,
    verification_question: toStringValue(parsed.verification_question) || routerResult.verification_question,
    satisfied_criteria: toStringArray(parsed.satisfied_criteria),
    missing_criteria: missingCriteria,
    issues: toStringArray(parsed.issues),
    check_steps: toStringArray(parsed.check_steps),
    decision_reason: toStringValue(parsed.decision_reason),
    next_action: passed ? "final" : nextAction,
    revision_instruction: toStringValue(parsed.revision_instruction),
    confidence: clampConfidence(parsed.confidence)
  };
}
function defaultPassedEvaluation(routerResult, reason) {
  return {
    should_evaluate: false,
    passed: true,
    verification_question: routerResult.verification_question,
    satisfied_criteria: [],
    missing_criteria: [],
    issues: [reason],
    check_steps: [],
    decision_reason: reason,
    next_action: "final",
    revision_instruction: "",
    confidence: 1
  };
}
function normalizeNextAction(value) {
  const allowed = ["final", "revise_answer", "ask_user", "use_tools"];
  if (typeof value !== "string") {
    return "revise_answer";
  }
  const nextAction = value.trim();
  return allowed.includes(nextAction) ? nextAction : "revise_answer";
}
function toBoolean(value) {
  return value === true;
}
function toStringValue(value) {
  return typeof value === "string" ? value : "";
}
function toStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function clampConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
const JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/gi;
const TOOL_TYPES = /* @__PURE__ */ new Set([
  "command.run",
  "file.read",
  "file.list",
  "file.search",
  "file.write",
  "memory.save"
]);
function parseLocalToolRequests(content) {
  const candidates = collectJsonCandidates(content);
  const requests = [];
  for (const candidate of candidates) {
    const parsed = parseJson(candidate);
    collectRequests(parsed, requests);
  }
  return requests.slice(0, 8);
}
function removeLocalToolRequestBlocks(content) {
  const withoutFencedRequests = content.replace(JSON_FENCE_PATTERN, (block, jsonContent) => {
    const parsed2 = parseJson((jsonContent ?? "").trim());
    const requests2 = [];
    collectRequests(parsed2, requests2);
    return requests2.length > 0 ? "" : block;
  });
  const trimmed = withoutFencedRequests.trim();
  const parsed = parseJson(trimmed);
  const requests = [];
  collectRequests(parsed, requests);
  if (requests.length > 0) {
    return "";
  }
  return withoutFencedRequests.trim();
}
function collectJsonCandidates(content) {
  var _a2;
  const candidates = [];
  let match;
  while (match = JSON_FENCE_PATTERN.exec(content)) {
    candidates.push(((_a2 = match[1]) == null ? void 0 : _a2.trim()) ?? "");
  }
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.push(trimmed);
  }
  return candidates.filter((candidate) => candidate.length > 0);
}
function parseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    return void 0;
  }
}
function collectRequests(value, requests) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRequests(item, requests));
    return;
  }
  if (!isObject(value)) {
    return;
  }
  if (typeof value.type === "string" && TOOL_TYPES.has(value.type)) {
    const request = toToolRequest(value);
    if (request) {
      requests.push(request);
    }
  }
  for (const item of Object.values(value)) {
    collectRequests(item, requests);
  }
}
function toToolRequest(value) {
  if (value.type === "command.run") {
    return toCommandRunRequest(value);
  }
  if (value.type === "file.read") {
    return toFileReadRequest(value);
  }
  if (value.type === "file.list") {
    return toFileListRequest(value);
  }
  if (value.type === "file.search") {
    return toFileSearchRequest(value);
  }
  if (value.type === "file.write") {
    return toFileWriteRequest(value);
  }
  if (value.type === "memory.save") {
    return toMemorySaveRequest(value);
  }
  return void 0;
}
function toCommandRunRequest(value) {
  if (typeof value.command !== "string" || value.command.trim().length === 0) {
    return void 0;
  }
  return {
    type: "command.run",
    reason: typeof value.reason === "string" ? value.reason : "",
    shell: "powershell",
    cwd: typeof value.cwd === "string" && value.cwd.trim().length > 0 ? value.cwd : resolveProjectPath(),
    command: value.command
  };
}
function toFileReadRequest(value) {
  if (typeof value.path !== "string" || value.path.trim().length === 0) {
    return void 0;
  }
  return {
    type: "file.read",
    reason: toReason(value),
    path: value.path,
    maxBytes: toPositiveInteger(value.maxBytes)
  };
}
function toFileListRequest(value) {
  if (typeof value.path !== "string" || value.path.trim().length === 0) {
    return void 0;
  }
  return {
    type: "file.list",
    reason: toReason(value),
    path: value.path,
    recursive: value.recursive === true,
    maxEntries: toPositiveInteger(value.maxEntries)
  };
}
function toFileSearchRequest(value) {
  if (typeof value.query !== "string" || value.query.trim().length === 0) {
    return void 0;
  }
  return {
    type: "file.search",
    reason: toReason(value),
    path: typeof value.path === "string" && value.path.trim().length > 0 ? value.path : void 0,
    query: value.query,
    glob: typeof value.glob === "string" && value.glob.trim().length > 0 ? value.glob : void 0,
    maxResults: toPositiveInteger(value.maxResults)
  };
}
function toFileWriteRequest(value) {
  if (typeof value.path !== "string" || value.path.trim().length === 0 || typeof value.content !== "string") {
    return void 0;
  }
  return {
    type: "file.write",
    reason: toReason(value),
    path: value.path,
    content: value.content
  };
}
function toMemorySaveRequest(value) {
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    return void 0;
  }
  return {
    type: "memory.save",
    reason: toReason(value),
    content: value.content,
    memoryType: toMemoryType(value.memoryType),
    tags: Array.isArray(value.tags) ? value.tags.filter((item) => typeof item === "string") : void 0,
    importance: typeof value.importance === "number" ? value.importance : void 0
  };
}
function toReason(value) {
  return typeof value.reason === "string" ? value.reason : "";
}
function toPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
function toMemoryType(value) {
  const allowed = ["fact", "preference", "decision", "plan", "constraint"];
  return typeof value === "string" && allowed.includes(value) ? value : void 0;
}
function isObject(value) {
  return typeof value === "object" && value !== null;
}
const ROUTER_CONFIDENCE_THRESHOLD = 0.7;
const COMMAND_RUN = "command.run";
const READ_TOOLS = ["file.read", "file.list", "file.search"];
const WRITE_TOOLS = ["file.write"];
const MEMORY_TOOLS = ["memory.save"];
function selectToolsForRouter(routerResult) {
  const routerConfidence = routerResult.confidence;
  return {
    selected_tools: allTools(),
    access_mode: "project_write",
    reason: buildReason(routerResult),
    confidence_threshold: ROUTER_CONFIDENCE_THRESHOLD,
    router_confidence: routerConfidence,
    auto_allowed: true
  };
}
function allTools() {
  return [...READ_TOOLS, ...WRITE_TOOLS, COMMAND_RUN, ...MEMORY_TOOLS];
}
function buildReason(routerResult) {
  if (routerResult.tool_reason) {
    return routerResult.tool_reason;
  }
  if (routerResult.intent === "code") {
    return "管理员 Agent 模式：默认开放读取、写入、记忆和命令工具；删除类命令会在结果中提醒。";
  }
  if (routerResult.intent === "debug") {
    return "管理员 Agent 模式：默认开放读取、写入、记忆和命令工具；删除类命令会在结果中提醒。";
  }
  return "管理员 Agent 模式：默认开放读取、写入、记忆和命令工具；删除类命令会在结果中提醒。";
}
function listModelProfiles() {
  const mainConfig = getModelRuntimeConfig("main");
  return [
    {
      id: "mimo-v2-5-pro",
      providerId: mainConfig.providerKind,
      label: mainConfig.label || "Main Model",
      model: mainConfig.model || MIMO_MODEL,
      status: mainConfig.providerKind === "ollama" || mainConfig.apiKey ? "configured" : "missing-config",
      capabilities: {
        chat: true,
        streamChat: true,
        structuredOutput: false,
        toolCalling: mainConfig.toolCallingMode === "native-openai"
      }
    }
  ];
}
async function sendChatMessage(request) {
  let response = null;
  await streamChatMessage(request, (event) => {
    if (event.type === "done") {
      response = {
        session: event.session,
        assistantMessage: event.assistantMessage
      };
    }
    if (event.type === "error") {
      throw new Error(event.error);
    }
  });
  if (!response) {
    throw new Error("MiMo 未返回内容。");
  }
  return response;
}
async function streamChatMessage(request, onEvent) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const session = getOrCreateSession(request, now);
  let currentStage = "会话压缩";
  try {
    onEvent({
      type: "stage",
      label: "会话压缩",
      detail: "正在检查是否需要压缩较早对话"
    });
    const conversationSummary = await maybeCompressConversation({
      projectId: session.projectId,
      sessionId: session.id,
      messages: session.messages
    });
    const userMessage = createUserMessage(request.message, now);
    const messages = [...session.messages, userMessage];
    const assistantMessageId = `msg-assistant-${Date.now()}`;
    const routerConfig = getModelRuntimeConfig("router");
    saveChatMessageEvent({
      projectId: session.projectId,
      sessionId: session.id,
      message: userMessage
    });
    currentStage = "意图识别";
    onEvent({
      type: "stage",
      label: currentStage,
      detail: `正在调用 ${routerConfig.label} (${routerConfig.model})`
    });
    const routerResult = await recognizeIntent(messages, request.message);
    saveRouterResultEvent({
      projectId: session.projectId,
      sessionId: session.id,
      content: JSON.stringify(routerResult, null, 2)
    });
    const capturedMemories = captureLongTermMemories({
      projectId: session.projectId,
      sessionId: session.id,
      userMessageId: userMessage.id,
      userContent: request.message,
      routerResult
    });
    saveMemoryWriteEvent({
      projectId: session.projectId,
      sessionId: session.id,
      memories: capturedMemories
    });
    const recalledMemories = listRelevantMemories({
      projectId: session.projectId,
      query: [
        request.message,
        routerResult.rewritten_input,
        routerResult.keywords.join(" "),
        routerResult.task_goal
      ].join(" "),
      limit: 6
    });
    saveMemoryRecallEvent({
      projectId: session.projectId,
      sessionId: session.id,
      memories: recalledMemories
    });
    const toolSelection = selectToolsForRouter(routerResult);
    saveToolSelectionEvent({
      projectId: session.projectId,
      sessionId: session.id,
      result: toolSelection
    });
    const runtimeContext = JSON.stringify(
      {
        router: routerResult,
        tool_selection: toolSelection
      },
      null,
      2
    );
    currentStage = "大模型对话";
    onEvent({
      type: "stage",
      label: currentStage,
      detail: `Router: ${routerResult.intent} / ${routerResult.task_type} / tools ${toolSelection.selected_tools.join(", ") || "none"}`
    });
    onEvent({
      type: "start",
      sessionId: session.id,
      messageId: assistantMessageId,
      roleLabel: "MiMo"
    });
    const modelResponse = await streamMimoChat({
      messages,
      latestUserMessage: request.message,
      intentSummary: runtimeContext,
      conversationSummary,
      memories: recalledMemories,
      toolSelection,
      executeToolRequest: async (toolRequest) => {
        onEvent({
          type: "stage",
          label: "原生工具执行",
          detail: `正在执行 ${toolRequest.type}`
        });
        saveToolCallEvent({
          projectId: session.projectId,
          sessionId: session.id,
          request: toolRequest
        });
        const result2 = await runLocalToolThroughGateway({
          request: toolRequest,
          toolSelection,
          projectId: session.projectId,
          sessionId: session.id
        });
        saveToolResultEvent({
          projectId: session.projectId,
          sessionId: session.id,
          result: result2
        });
        return result2;
      },
      onDelta: (delta) => {
        onEvent({
          type: "delta",
          sessionId: session.id,
          messageId: assistantMessageId,
          delta
        });
      }
    });
    saveModelReturnEvent({
      projectId: session.projectId,
      sessionId: session.id,
      stopReason: modelResponse.stopReason,
      usage: modelResponse.usage
    });
    const visibleModelContent = removeLocalToolRequestBlocks(modelResponse.content);
    const shouldReplaceVisibleContent = visibleModelContent !== modelResponse.content;
    if (shouldReplaceVisibleContent) {
      onEvent({
        type: "replace",
        sessionId: session.id,
        messageId: assistantMessageId,
        content: visibleModelContent
      });
    }
    const toolResults = await runRequestedTools({
      content: modelResponse.content,
      projectId: session.projectId,
      sessionId: session.id,
      toolSelection,
      onEvent,
      assistantMessageId
    });
    const followupResponse = toolResults.length > 0 ? await streamToolResultFollowup({
      baseMessages: messages,
      assistantMessageId,
      firstAssistantContent: visibleModelContent,
      projectId: session.projectId,
      sessionId: session.id,
      runtimeContext,
      toolResults,
      onEvent
    }) : void 0;
    const followupContent = followupResponse ? `

【工具结果整理】
${followupResponse.content}` : "";
    const contentBeforeEvaluation = `${visibleModelContent}${followupContent}`;
    const evaluationResult = await maybeEvaluateAndRevise({
      messages,
      userInput: request.message,
      routerResult,
      assistantMessageId,
      projectId: session.projectId,
      sessionId: session.id,
      content: contentBeforeEvaluation,
      runtimeContext,
      onEvent
    });
    const content = appendModelReturnNotice(
      evaluationResult.content,
      (followupResponse == null ? void 0 : followupResponse.stopReason) ?? modelResponse.stopReason
    );
    const result = appendAssistantMessage(
      session,
      messages,
      assistantMessageId,
      "MiMo",
      content,
      buildAssistantMetadata(modelResponse)
    );
    saveChatMessageEvent({
      projectId: session.projectId,
      sessionId: session.id,
      message: result.assistantMessage
    });
    onEvent({
      type: "done",
      session: result.session,
      assistantMessage: result.assistantMessage
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    saveErrorEvent({
      projectId: session.projectId,
      sessionId: session.id,
      message,
      stage: currentStage
    });
    onEvent({
      type: "error",
      error: message
    });
  }
}
function buildAssistantMetadata(modelResponse) {
  if (!modelResponse.nativeMessages || modelResponse.nativeMessages.length === 0) {
    return void 0;
  }
  return {
    openaiNativeMessages: modelResponse.nativeMessages,
    nativeToolResults: modelResponse.nativeToolResults ?? []
  };
}
async function maybeEvaluateAndRevise(input) {
  if (!shouldEvaluateOutput(input.routerResult)) {
    return {
      content: input.content
    };
  }
  input.onEvent({
    type: "stage",
    label: "输出验收",
    detail: "正在检查大模型回复是否满足本轮成功条件"
  });
  let evaluation;
  try {
    evaluation = await evaluateOutput({
      messages: input.messages,
      userInput: input.userInput,
      routerResult: input.routerResult,
      assistantAnswer: input.content
    });
    saveOutputEvaluationEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      result: evaluation
    });
    const promptIteration = maybeCreatePromptIteration({
      projectId: input.projectId,
      sessionId: input.sessionId,
      evaluation,
      routerResult: input.routerResult
    });
    if (promptIteration) {
      savePromptIterationEvent({
        projectId: input.projectId,
        sessionId: input.sessionId,
        record: promptIteration
      });
    }
  } catch (error) {
    saveErrorEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      message: error instanceof Error ? error.message : String(error),
      stage: "输出验收"
    });
    return {
      content: input.content
    };
  }
  if (evaluation.passed || evaluation.next_action === "final") {
    return {
      content: input.content,
      evaluation
    };
  }
  if (evaluation.next_action !== "revise_answer") {
    return {
      content: [
        input.content.trimEnd(),
        "",
        formatEvaluationNotice(evaluation)
      ].join("\n"),
      evaluation
    };
  }
  const revision = await streamEvaluationRevision({
    baseMessages: input.messages,
    assistantMessageId: input.assistantMessageId,
    firstAssistantContent: input.content,
    userInput: input.userInput,
    projectId: input.projectId,
    sessionId: input.sessionId,
    runtimeContext: input.runtimeContext,
    evaluation,
    onEvent: input.onEvent
  });
  return {
    content: `${input.content}

【补充修正】
${revision.content}`,
    evaluation
  };
}
function maybeCreatePromptIteration(input) {
  if (input.evaluation.passed || input.evaluation.next_action === "final") {
    return void 0;
  }
  const targetTemplate = input.evaluation.next_action === "use_tools" ? "main.agent.v1" : "output.evaluator.v1";
  const reason = [
    `Evaluator next_action=${input.evaluation.next_action}`,
    input.evaluation.decision_reason,
    input.evaluation.missing_criteria.length > 0 ? `missing=${input.evaluation.missing_criteria.join("；")}` : "",
    input.evaluation.issues.length > 0 ? `issues=${input.evaluation.issues.join("；")}` : ""
  ].filter((item) => item.trim().length > 0).join("；");
  const suggestedChange = [
    `建议检查模板 ${targetTemplate}。`,
    `任务类型：${input.routerResult.task_type}，意图：${input.routerResult.intent}。`,
    input.routerResult.expected_output ? `期望产出：${input.routerResult.expected_output}。` : "",
    input.evaluation.revision_instruction ? `修正指令：${input.evaluation.revision_instruction}` : "",
    input.evaluation.missing_criteria.length > 0 ? `需要补强的验收项：${input.evaluation.missing_criteria.join("；")}` : ""
  ].filter((item) => item.trim().length > 0).join("\n");
  return savePromptIteration({
    projectId: input.projectId,
    sessionId: input.sessionId,
    targetTemplate,
    trigger: "evaluation_gap",
    reason: reason || "输出验收认为当前回复仍需后续动作。",
    suggestedChange,
    sourceEventIds: []
  });
}
function shouldEvaluateOutput(routerResult) {
  if (!routerResult.is_task || routerResult.intent === "chat") {
    return false;
  }
  return routerResult.verification_question.trim().length > 0 || routerResult.success_criteria.length > 0;
}
function formatEvaluationNotice(evaluation) {
  if (evaluation.next_action === "ask_user") {
    return [
      "[系统提示：本轮输出验收认为还需要用户补充信息。]",
      evaluation.revision_instruction || evaluation.issues.join("；")
    ].filter((item) => item.trim().length > 0).join("\n");
  }
  if (evaluation.next_action === "use_tools") {
    return [
      "[系统提示：本轮输出验收认为还需要工具或项目上下文才能继续。]",
      evaluation.revision_instruction || evaluation.issues.join("；")
    ].filter((item) => item.trim().length > 0).join("\n");
  }
  return "";
}
function appendModelReturnNotice(content, stopReason) {
  if (stopReason !== "max_tokens") {
    return content;
  }
  return [
    content.trimEnd(),
    "",
    "[系统提示：本次回复达到 max_tokens 输出上限，内容可能被截断。可以输入“继续”让我接着补完。]"
  ].join("\n");
}
async function streamToolResultFollowup(input) {
  const toolReport = formatToolResults(input.toolResults);
  const followupMessages = [
    ...input.baseMessages,
    {
      id: `msg-tool-request-${Date.now()}`,
      sender: "assistant",
      roleLabel: "MiMo",
      content: input.firstAssistantContent,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      id: `msg-tool-result-${Date.now()}`,
      sender: "user",
      roleLabel: "系统工具结果",
      content: [
        "以下是本轮工具执行结果。这不是用户的新输入，而是本地 Tool Gateway 返回的观察结果。",
        "",
        "请基于这些结果给用户一个简洁的最终回应。",
        "不要继续请求工具，不要重复前面的工具 JSON。",
        "",
        toolReport
      ].join("\n"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  ];
  input.onEvent({
    type: "stage",
    label: "工具结果整理",
    detail: "正在让 MiMo 基于工具结果生成最终回应"
  });
  input.onEvent({
    type: "delta",
    sessionId: input.sessionId,
    messageId: input.assistantMessageId,
    delta: "\n\n【工具结果整理】\n"
  });
  const response = await streamMimoChat({
    messages: followupMessages,
    latestUserMessage: "系统工具结果",
    intentSummary: JSON.stringify(
      {
        phase: "tool_result_followup",
        previous_runtime_context: JSON.parse(input.runtimeContext),
        tool_results: input.toolResults
      },
      null,
      2
    ),
    onDelta: (delta) => {
      input.onEvent({
        type: "delta",
        sessionId: input.sessionId,
        messageId: input.assistantMessageId,
        delta
      });
    }
  });
  saveModelReturnEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    stopReason: response.stopReason,
    usage: response.usage
  });
  return response;
}
async function streamEvaluationRevision(input) {
  const revisionMessages = [
    ...input.baseMessages,
    {
      id: `msg-eval-answer-${Date.now()}`,
      sender: "assistant",
      roleLabel: "MiMo",
      content: input.firstAssistantContent,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    {
      id: `msg-eval-result-${Date.now()}`,
      sender: "user",
      roleLabel: "系统输出验收",
      content: [
        "以下是本轮输出验收结果。这不是用户的新输入，而是系统 evaluator 对上一条助手回复的检查结果。",
        "",
        "请只补充或修正缺失部分，不要重复已有内容，不要请求工具。",
        "",
        JSON.stringify(input.evaluation, null, 2)
      ].join("\n"),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  ];
  input.onEvent({
    type: "stage",
    label: "补充修正",
    detail: "输出验收未通过，正在让大模型补充缺失内容"
  });
  input.onEvent({
    type: "delta",
    sessionId: input.sessionId,
    messageId: input.assistantMessageId,
    delta: "\n\n【补充修正】\n"
  });
  const response = await streamMimoChat({
    messages: revisionMessages,
    latestUserMessage: "系统输出验收",
    intentSummary: JSON.stringify(
      {
        phase: "output_evaluation_revision",
        previous_runtime_context: input.runtimeContext,
        original_user_input: input.userInput,
        output_evaluation: input.evaluation
      },
      null,
      2
    ),
    onDelta: (delta) => {
      input.onEvent({
        type: "delta",
        sessionId: input.sessionId,
        messageId: input.assistantMessageId,
        delta
      });
    }
  });
  saveModelReturnEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    stopReason: response.stopReason,
    usage: response.usage
  });
  return response;
}
async function runRequestedTools(input) {
  const requests = parseLocalToolRequests(input.content);
  const results = [];
  if (requests.length === 0) {
    return results;
  }
  input.onEvent({
    type: "stage",
    label: "工具执行",
    detail: `检测到 ${requests.length} 个本地工具请求，正在交给 Tool Gateway`
  });
  for (const request of requests) {
    saveToolCallEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      request
    });
    const result = await runLocalToolThroughGateway({
      request,
      toolSelection: input.toolSelection,
      projectId: input.projectId,
      sessionId: input.sessionId
    });
    saveToolResultEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      result
    });
    results.push(result);
  }
  return results;
}
function formatToolResults(results) {
  if (results.length === 0) {
    return "";
  }
  return [
    "",
    "",
    "【系统工具执行结果】",
    ...results.map((result, index) => {
      return [
        "",
        `#${index + 1} ${formatToolTitle(result)}`,
        `decision: ${result.decision}`,
        `status: ${result.status}`,
        `reason: ${result.reason}`,
        typeof result.exitCode === "number" ? `exitCode: ${result.exitCode}` : "",
        result.output ? `output:
${result.output}` : "",
        result.stdout ? `stdout:
${result.stdout}` : "",
        result.stderr ? `stderr:
${result.stderr}` : "",
        result.data ? `data:
${JSON.stringify(result.data, null, 2)}` : ""
      ].filter((line) => line.length > 0).join("\n");
    })
  ].join("\n");
}
function formatToolTitle(result) {
  if (result.request.type === "command.run") {
    return `command.run ${result.request.command}`;
  }
  if (result.request.type === "file.read" || result.request.type === "file.list" || result.request.type === "file.write") {
    return `${result.request.type} ${result.request.path}`;
  }
  if (result.request.type === "file.search") {
    return `${result.request.type} ${result.request.query}`;
  }
  return `${result.request.type} ${result.request.content.slice(0, 60)}`;
}
function createUserMessage(content, createdAt) {
  return {
    id: `msg-user-${Date.now()}`,
    sender: "user",
    roleLabel: "你",
    content,
    createdAt
  };
}
const currentFile = fileURLToPath(import.meta.url);
const currentDir = path$1.dirname(currentFile);
process.env.APP_ROOT = path$1.join(currentDir, "..");
const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL;
const rendererDist = path$1.join(process.env.APP_ROOT, "dist");
const preloadPath = path$1.join(currentDir, "preload.cjs");
let mainWindow = null;
async function createWindow() {
  mainWindow = new BrowserWindow({
    title: "XiaoMi Agent Workbench",
    width: 1380,
    height: 880,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#0f1316",
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });
  if (viteDevServerUrl) {
    await mainWindow.loadURL(viteDevServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path$1.join(rendererDist, "index.html"));
  }
}
app.whenReady().then(async () => {
  registerIpcHandlers();
  await createWindow();
  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
function registerIpcHandlers() {
  ipcMain.handle("workbench:get-initial-state", () => ({
    modelProfiles: listModelProfiles()
  }));
  ipcMain.handle("workbench:send-chat-message", async (_event, request) => {
    return sendChatMessage(request);
  });
  ipcMain.handle("workbench:stream-chat-message", async (event, request) => {
    await streamChatMessage(request, (streamEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("workbench:chat-stream-event", streamEvent);
      }
    });
    return { ok: true };
  });
  ipcMain.handle("workbench:list-provider-debug-logs", () => {
    return listProviderDebugLogs();
  });
  ipcMain.handle("workbench:list-session-events", (_event, request) => {
    return listSessionEvents({
      projectId: request.projectId,
      sessionId: request.sessionId,
      limit: 100
    });
  });
  ipcMain.handle("workbench:get-model-runtime-settings", () => {
    return getModelRuntimeSettings();
  });
  ipcMain.handle("workbench:save-model-runtime-settings", (_event, settings) => {
    return saveModelRuntimeSettings(settings);
  });
}
