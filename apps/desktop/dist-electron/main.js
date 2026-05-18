import { app as Lt, BrowserWindow as gr, ipcMain as de } from "electron";
import y from "node:path";
import { fileURLToPath as Cn } from "node:url";
import I from "node:fs";
import Dn from "better-sqlite3";
import { randomUUID as qn } from "node:crypto";
import { execFile as Bn } from "node:child_process";
import { promisify as Fn } from "node:util";
const xt = /* @__PURE__ */ new Map();
function Wn(e, t) {
  if (e.sessionId && xt.has(e.sessionId))
    return xt.get(e.sessionId);
  const s = {
    id: e.sessionId ?? `chat-${Date.now()}`,
    projectId: e.projectId,
    title: "项目协作会话",
    modelProfileId: e.modelProfileId,
    messages: [],
    createdAt: t,
    updatedAt: t
  };
  return xt.set(s.id, s), s;
}
function Kn(e, t, s, r, n, o) {
  const a = {
    id: s,
    sender: "assistant",
    roleLabel: r,
    content: n,
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...o ? { metadata: o } : {}
  }, i = {
    ...e,
    messages: [...t, a],
    updatedAt: a.createdAt
  };
  return xt.set(i.id, i), {
    session: i,
    assistantMessage: a
  };
}
const Xn = ["pnpm-workspace.yaml", "package.json"];
function Jn() {
  let e = process.cwd();
  for (; ; ) {
    if (Xn.every((s) => I.existsSync(y.join(e, s))))
      return e;
    const t = y.dirname(e);
    if (t === e)
      return;
    e = t;
  }
}
function Re(...e) {
  return y.resolve(Jn() ?? process.cwd(), ...e);
}
let ye;
function ge() {
  if (ye)
    return ye;
  const e = Re("data");
  return I.mkdirSync(e, { recursive: !0 }), ye = new Dn(y.join(e, "agent.db")), ye.pragma("journal_mode = WAL"), Hn(ye), ye;
}
function Hn(e) {
  e.exec(`
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
function zn(e, t) {
  const s = ge().prepare(
    `
        SELECT *
        FROM conversation_summaries
        WHERE project_id = ? AND session_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `
  ).get(e, t);
  return s ? Qn(s) : void 0;
}
function Vn(e) {
  const t = (/* @__PURE__ */ new Date()).toISOString(), s = e.sourceMessages[0], r = e.sourceMessages.at(-1);
  if (!s || !r)
    throw new Error("会话压缩失败：没有可压缩的消息。");
  const n = {
    id: `summary-${Date.now()}`,
    projectId: e.projectId,
    sessionId: e.sessionId,
    sourceStartMessageId: s.id,
    sourceEndMessageId: r.id,
    summary: e.summary,
    decisions: e.decisions,
    openQuestions: e.openQuestions,
    constraints: e.constraints,
    taskProgress: e.taskProgress,
    createdAt: t,
    updatedAt: t
  };
  return ge().prepare(
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
    n.id,
    n.projectId,
    n.sessionId,
    n.sourceStartMessageId,
    n.sourceEndMessageId,
    n.summary,
    JSON.stringify(n.decisions),
    JSON.stringify(n.openQuestions),
    JSON.stringify(n.constraints),
    JSON.stringify(n.taskProgress),
    n.createdAt,
    n.updatedAt
  ), n;
}
function Qn(e) {
  return {
    id: e.id,
    projectId: e.project_id,
    sessionId: e.session_id,
    sourceStartMessageId: e.source_start_message_id,
    sourceEndMessageId: e.source_end_message_id,
    summary: e.summary,
    decisions: ot(e.decisions_json),
    openQuestions: ot(e.open_questions_json),
    constraints: ot(e.constraints_json),
    taskProgress: ot(e.task_progress_json),
    createdAt: e.created_at,
    updatedAt: e.updated_at
  };
}
function ot(e) {
  const t = JSON.parse(e);
  return Array.isArray(t) ? t.filter((s) => typeof s == "string") : [];
}
function $s(e) {
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    messageId: e.message.id,
    type: "chat_message",
    actor: e.message.sender,
    roleLabel: e.message.roleLabel,
    content: e.message.content,
    payload: {
      createdAt: e.message.createdAt,
      metadata: e.message.metadata
    },
    createdAt: e.message.createdAt
  });
}
function Yn(e) {
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "router_result",
    actor: "router",
    roleLabel: "Ollama Router",
    content: e.content,
    payload: br(e.content),
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function Gn(e) {
  const t = JSON.stringify(e.result, null, 2);
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "tool_selection",
    actor: "core",
    roleLabel: "Tool Selection Policy",
    content: t,
    payload: e.result,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function Zn(e) {
  const t = JSON.stringify(e.result, null, 2);
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "planning_result",
    actor: "planner",
    roleLabel: "Planning Model",
    content: t,
    payload: e.result,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function pr(e) {
  const t = JSON.stringify(e.request, null, 2);
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "tool_call",
    actor: "model",
    roleLabel: e.request.type,
    content: t,
    payload: e.request,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function _r(e) {
  const t = JSON.stringify(
    {
      decision: e.result.decision,
      status: e.result.status,
      reason: e.result.reason,
      exitCode: e.result.exitCode,
      durationMs: e.result.durationMs
    },
    null,
    2
  );
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "tool_result",
    actor: "tool",
    roleLabel: "Tool Gateway",
    content: t,
    payload: e.result,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function eo(e) {
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "conversation_summary",
    actor: "system",
    roleLabel: "Conversation Compressor",
    content: e.content,
    payload: {
      summaryId: e.summaryId,
      value: e.payload
    },
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function ps(e) {
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "model_return",
    actor: "model",
    roleLabel: "MiMo",
    payload: {
      stopReason: e.stopReason,
      usage: e.usage
    },
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function to(e) {
  const t = JSON.stringify(e.result, null, 2);
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "output_evaluation",
    actor: "evaluator",
    roleLabel: "Output Evaluator",
    content: t,
    payload: e.result,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function so(e) {
  if (e.memories.length !== 0)
    return F({
      projectId: e.projectId,
      sessionId: e.sessionId,
      type: "memory_write",
      actor: "memory",
      roleLabel: "Long Term Memory",
      content: e.memories.map((t) => `- ${t.type}: ${t.content}`).join(`
`),
      payload: {
        memories: e.memories
      },
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
}
function ro(e) {
  if (e.memories.length !== 0)
    return F({
      projectId: e.projectId,
      sessionId: e.sessionId,
      type: "memory_recall",
      actor: "memory",
      roleLabel: "Long Term Memory Recall",
      content: e.memories.map((t) => `- ${t.type}: ${t.content}`).join(`
`),
      payload: {
        memories: e.memories
      },
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
}
function no(e) {
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "prompt_iteration",
    actor: "prompt",
    roleLabel: "Prompt Iteration Candidate",
    content: e.record.suggestedChange,
    payload: e.record,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function yr(e) {
  return F({
    projectId: e.projectId,
    sessionId: e.sessionId,
    type: "error",
    actor: "system",
    roleLabel: "Error",
    content: e.message,
    payload: {
      stage: e.stage
    },
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function oo(e) {
  return ge().prepare(
    `
        SELECT *
        FROM events
        WHERE project_id = ? AND session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `
  ).all(e.projectId, e.sessionId, e.limit ?? 100).map(ao).reverse();
}
function F(e) {
  const t = {
    ...e,
    id: `event-${qn()}`
  };
  return ge().prepare(
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
    t.id,
    t.projectId,
    t.sessionId,
    t.messageId ?? null,
    t.type,
    t.actor,
    t.roleLabel ?? null,
    t.content ?? null,
    JSON.stringify(t.payload ?? {}),
    t.createdAt
  ), t;
}
function ao(e) {
  return {
    id: e.id,
    projectId: e.project_id,
    sessionId: e.session_id,
    messageId: e.message_id ?? void 0,
    type: e.type,
    actor: e.actor,
    roleLabel: e.role_label ?? void 0,
    content: e.content ?? void 0,
    payload: br(e.payload_json),
    createdAt: e.created_at
  };
}
function br(e) {
  try {
    return JSON.parse(e);
  } catch {
    return {};
  }
}
const wr = "https://api.xiaomimimo.com/v1", Pt = "mimo-v2.5-pro", vt = 8192, qt = "http://127.0.0.1:11434", Bt = "qwen2.5:1.5b", io = "你是一个专注于个人 AI Agent 项目搭建的工作协作助手。请用中文优先回答，帮助用户通过对话完成需求澄清、技术选型、开发实现、测试验证和本地记忆沉淀。";
function Sr() {
  return co().mimoApiKey || process.env.MIMO_API_KEY;
}
function co() {
  const e = lo();
  if (!I.existsSync(e))
    return {};
  try {
    const t = I.readFileSync(e, "utf8");
    return JSON.parse(t);
  } catch {
    return {};
  }
}
function lo() {
  let e = process.cwd();
  for (; ; ) {
    const t = y.join(e, "config", "secrets.local.json");
    if (I.existsSync(t))
      return t;
    const s = y.dirname(e);
    if (s === e)
      return y.resolve(process.cwd(), "config", "secrets.local.json");
    e = s;
  }
}
const $t = Re("config", "model-runtime.local.json");
function Ir() {
  return Mr(ho());
}
function uo(e) {
  const t = Mr(e);
  return I.mkdirSync(y.dirname($t), { recursive: !0 }), I.writeFileSync($t, `${JSON.stringify(t, null, 2)}
`, "utf8"), t;
}
function ie(e) {
  return Ir()[e];
}
function ho() {
  if (!I.existsSync($t))
    return {};
  try {
    return JSON.parse(I.readFileSync($t, "utf8"));
  } catch {
    return {};
  }
}
function Mr(e) {
  const t = fo(e.modelBlocks);
  return {
    modelBlocks: t,
    router: Oe(e.router, po(), t),
    planner: Oe(e.planner, yo(), t),
    main: Oe(e.main, _o(), t),
    evaluator: Oe(e.evaluator ?? e.router, wo(), t),
    compression: Oe(e.compression, bo(), t)
  };
}
function fo(e) {
  const t = Array.isArray(e) ? e.map(So) : [];
  return go().map((r) => mo(
    t.find((n) => n.id === r.id),
    r
  ));
}
function mo(e, t) {
  return {
    id: z(e == null ? void 0 : e.id, t.id),
    label: z(e == null ? void 0 : e.label, t.label),
    provider: z(e == null ? void 0 : e.provider, t.provider),
    description: z(e == null ? void 0 : e.description, t.description),
    providerKind: Tr(e == null ? void 0 : e.providerKind) ? e.providerKind : t.providerKind,
    baseURL: z(e == null ? void 0 : e.baseURL, t.baseURL),
    model: z(e == null ? void 0 : e.model, t.model),
    apiKey: z(e == null ? void 0 : e.apiKey, t.apiKey),
    temperature: Nt(e == null ? void 0 : e.temperature, t.temperature),
    maxTokens: Nt(e == null ? void 0 : e.maxTokens, t.maxTokens),
    toolCallingMode: (e == null ? void 0 : e.toolCallingMode) === "native-openai" || (e == null ? void 0 : e.toolCallingMode) === "text-json" ? e.toolCallingMode : t.toolCallingMode,
    thinkingEnabled: typeof (e == null ? void 0 : e.thinkingEnabled) == "boolean" ? e.thinkingEnabled : t.thinkingEnabled
  };
}
function Oe(e, t, s) {
  const r = Ns(e, t), n = s.find((o) => o.id === r.modelBlockId);
  return n ? Ns({
    ...r,
    modelBlockId: n.id,
    label: n.label,
    providerKind: n.providerKind,
    baseURL: n.baseURL,
    model: n.model,
    apiKey: n.apiKey,
    temperature: n.temperature,
    maxTokens: n.maxTokens,
    toolCallingMode: n.toolCallingMode,
    thinkingEnabled: n.thinkingEnabled
  }, t) : r;
}
function Ns(e, t) {
  const s = Tr(e == null ? void 0 : e.providerKind) ? e.providerKind : t.providerKind, r = (e == null ? void 0 : e.toolCallingMode) === "native-openai" || (e == null ? void 0 : e.toolCallingMode) === "text-json" ? e.toolCallingMode : t.toolCallingMode, n = s === "openai-compatible" ? r : "text-json";
  return {
    role: t.role,
    modelBlockId: typeof (e == null ? void 0 : e.modelBlockId) == "string" ? e.modelBlockId : t.modelBlockId,
    label: z(e == null ? void 0 : e.label, t.label),
    providerKind: s,
    baseURL: z(e == null ? void 0 : e.baseURL, t.baseURL),
    model: z(e == null ? void 0 : e.model, t.model),
    apiKey: z(e == null ? void 0 : e.apiKey, t.apiKey),
    temperature: Nt(e == null ? void 0 : e.temperature, t.temperature),
    maxTokens: Nt(e == null ? void 0 : e.maxTokens, t.maxTokens),
    toolCallingMode: n,
    thinkingEnabled: n === "native-openai" ? !0 : s === "openai-compatible" && typeof (e == null ? void 0 : e.thinkingEnabled) == "boolean" ? e.thinkingEnabled : !1
  };
}
function go() {
  return [
    {
      id: "deepseek-flash",
      label: "DeepSeek Flash",
      provider: "DeepSeek",
      description: "适合 Router、Evaluator、压缩和轻量执行。",
      providerKind: "openai-compatible",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "",
      temperature: 0.2,
      maxTokens: 1024,
      toolCallingMode: "text-json",
      thinkingEnabled: !1
    },
    {
      id: "deepseek-pro",
      label: "DeepSeek Pro",
      provider: "DeepSeek",
      description: "适合主模型和复杂任务规划。",
      providerKind: "openai-compatible",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      apiKey: "",
      temperature: 0.7,
      maxTokens: vt,
      toolCallingMode: "text-json",
      thinkingEnabled: !1
    },
    {
      id: "mimo-anthropic-pro",
      label: "MiMo Pro Anthropic",
      provider: "MiMo",
      description: "当前稳定主模型路径，走 Anthropic-compatible。",
      providerKind: "anthropic-compatible",
      baseURL: "https://token-plan-cn.xiaomimimo.com/anthropic",
      model: Pt,
      apiKey: Sr() ?? "",
      temperature: 1,
      maxTokens: vt,
      toolCallingMode: "text-json",
      thinkingEnabled: !1
    },
    {
      id: "mimo-openai-native",
      label: "MiMo Native Tools",
      provider: "MiMo",
      description: "原生 OpenAI tools/thinking 路径，需要 /v1 Key 可用。",
      providerKind: "openai-compatible",
      baseURL: wr,
      model: Pt,
      apiKey: "",
      temperature: 1,
      maxTokens: vt,
      toolCallingMode: "native-openai",
      thinkingEnabled: !0
    },
    {
      id: "local-qwen",
      label: "Local Qwen",
      provider: "Ollama",
      description: "本地小模型，适合离线 Router 和压缩。",
      providerKind: "ollama",
      baseURL: qt,
      model: Bt,
      apiKey: "",
      temperature: 0.2,
      maxTokens: 1024,
      toolCallingMode: "text-json",
      thinkingEnabled: !1
    }
  ];
}
function po() {
  return {
    role: "router",
    modelBlockId: "local-qwen",
    label: "Local Qwen Router",
    providerKind: "ollama",
    baseURL: qt,
    model: Bt,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 768,
    toolCallingMode: "text-json",
    thinkingEnabled: !1
  };
}
function _o() {
  return {
    role: "main",
    modelBlockId: "mimo-openai-native",
    label: "MiMo Native Main",
    providerKind: "openai-compatible",
    baseURL: wr,
    model: Pt,
    apiKey: Sr() ?? "",
    temperature: 1,
    maxTokens: vt,
    toolCallingMode: "native-openai",
    thinkingEnabled: !0
  };
}
function yo() {
  return {
    role: "planner",
    modelBlockId: "deepseek-pro",
    label: "DeepSeek Pro Planner",
    providerKind: "openai-compatible",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: "",
    temperature: 0.3,
    maxTokens: 4096,
    toolCallingMode: "text-json",
    thinkingEnabled: !1
  };
}
function bo() {
  return {
    role: "compression",
    modelBlockId: "local-qwen",
    label: "Local Qwen Compression",
    providerKind: "ollama",
    baseURL: qt,
    model: Bt,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 1024,
    toolCallingMode: "text-json",
    thinkingEnabled: !1
  };
}
function wo() {
  return {
    role: "evaluator",
    modelBlockId: "local-qwen",
    label: "Local Qwen Evaluator",
    providerKind: "ollama",
    baseURL: qt,
    model: Bt,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 768,
    toolCallingMode: "text-json",
    thinkingEnabled: !1
  };
}
function Tr(e) {
  return e === "openai-compatible" || e === "anthropic-compatible" || e === "ollama";
}
function So(e) {
  return e && typeof e == "object" && !Array.isArray(e) ? e : {};
}
function z(e, t) {
  return typeof e == "string" ? e : t;
}
function Nt(e, t) {
  return typeof e == "number" && Number.isFinite(e) ? e : t;
}
const Io = ["pnpm-workspace.yaml", "package.json"];
function kr(e, t = "") {
  const s = Mo(e);
  if (!s)
    return t;
  try {
    return I.readFileSync(s, "utf8");
  } catch {
    return t;
  }
}
function se(e, t = "") {
  return e.map((r) => kr(r)).filter((r) => r.trim().length > 0).join(`

`) || t;
}
function Mo(e) {
  if (y.isAbsolute(e))
    return I.existsSync(e) ? e : void 0;
  const t = ko(), s = To(e), r = /* @__PURE__ */ new Set();
  r.add(y.resolve(process.cwd(), e)), t && (r.add(y.resolve(t, e)), r.add(y.resolve(t, s)), r.add(y.resolve(t, "packages", s)));
  for (const n of r)
    if (I.existsSync(n))
      return n;
}
function To(e) {
  return e.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "").replace(/^(\.\/)+/, "");
}
function ko() {
  let e = process.cwd();
  for (; ; ) {
    if (Io.every((s) => I.existsSync(y.join(e, s))))
      return e;
    const t = y.dirname(e);
    if (t === e)
      return;
    e = t;
  }
}
const Eo = [
  "packages/memorizes/system/01-role.md",
  "packages/memorizes/system/02-goals.md",
  "packages/memorizes/system/03-style.md"
], Ro = [
  "packages/memorizes/router/01-system.md"
], xo = [
  "packages/memorizes/router/02-input.md"
], vo = "packages/memorizes/context/router-runtime.md", Ao = [
  "packages/memorizes/planning/01-system.md"
], Oo = [
  "packages/memorizes/planning/02-input.md"
], jo = [
  "packages/memorizes/compression/01-system.md"
], Lo = [
  "packages/memorizes/compression/02-input.md"
], Po = [
  "packages/memorizes/evaluator/01-system.md"
], $o = [
  "packages/memorizes/evaluator/02-input.md"
];
function No() {
  return se(Ro);
}
function Uo(e, t) {
  return Ze(se(xo), {
    recent_messages: Er(e),
    input: t
  });
}
function Co() {
  return se(Eo, io);
}
function _s(e) {
  return Ze(kr(vo), {
    router_context: e
  });
}
function Do() {
  return se(Ao);
}
function qo(e) {
  return Ze(se(Oo), {
    user_input: e.userInput,
    router_result: e.routerResult,
    tool_selection: e.toolSelection,
    memories: e.memories || "无",
    conversation_summary: e.conversationSummary || "无",
    recent_messages: Er(e.recentMessages)
  });
}
function Bo() {
  return se(jo);
}
function Fo(e) {
  return Ze(se(Lo), {
    previous_summary: e.previousSummary || "无",
    messages: Xo(e.messages)
  });
}
function Wo() {
  return se(Po);
}
function Ko(e) {
  return Ze(se($o), {
    user_input: e.userInput,
    router_result: e.routerResult,
    assistant_answer: e.assistantAnswer
  });
}
function Er(e) {
  return e.slice(-8).map((t) => `${t.roleLabel}: ${t.content}`).join(`

`) || "无";
}
function Xo(e) {
  return e.map((t) => [
    `id: ${t.id}`,
    `role: ${t.sender}`,
    `label: ${t.roleLabel}`,
    `time: ${t.createdAt}`,
    `content: ${t.content}`
  ].join(`
`)).join(`

---

`) || "无";
}
function Ze(e, t) {
  return Object.entries(t).reduce((s, [r, n]) => s.replaceAll(`{{${r}}}`, n), e);
}
function f(e, t, s, r, n) {
  if (typeof t == "function" ? e !== t || !0 : !t.has(e))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return t.set(e, s), s;
}
function c(e, t, s, r) {
  if (s === "a" && !r)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof t == "function" ? e !== t || !r : !t.has(e))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return s === "m" ? r : s === "a" ? r.call(e) : r ? r.value : t.get(e);
}
let Rr = function() {
  const { crypto: e } = globalThis;
  if (e != null && e.randomUUID)
    return Rr = e.randomUUID.bind(e), e.randomUUID();
  const t = new Uint8Array(1), s = e ? () => e.getRandomValues(t)[0] : () => Math.random() * 255 & 255;
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (r) => (+r ^ s() & 15 >> +r / 4).toString(16));
};
function Ye(e) {
  return typeof e == "object" && e !== null && // Spec-compliant fetch implementations
  ("name" in e && e.name === "AbortError" || // Expo fetch
  "message" in e && String(e.message).includes("FetchRequestCanceledException"));
}
const as = (e) => {
  if (e instanceof Error)
    return e;
  if (typeof e == "object" && e !== null) {
    try {
      if (Object.prototype.toString.call(e) === "[object Error]") {
        const t = new Error(e.message, e.cause ? { cause: e.cause } : {});
        return e.stack && (t.stack = e.stack), e.cause && !t.cause && (t.cause = e.cause), e.name && (t.name = e.name), t;
      }
    } catch {
    }
    try {
      return new Error(JSON.stringify(e));
    } catch {
    }
  }
  return new Error(e);
};
class _ extends Error {
}
class P extends _ {
  constructor(t, s, r, n, o) {
    super(`${P.makeMessage(t, s, r)}`), this.status = t, this.headers = n, this.requestID = n == null ? void 0 : n.get("request-id"), this.error = s, this.type = o ?? null;
  }
  static makeMessage(t, s, r) {
    const n = s != null && s.message ? typeof s.message == "string" ? s.message : JSON.stringify(s.message) : s ? JSON.stringify(s) : r;
    return t && n ? `${t} ${n}` : t ? `${t} status code (no body)` : n || "(no status code or body)";
  }
  static generate(t, s, r, n) {
    var i;
    if (!t || !n)
      return new Ft({ message: r, cause: as(s) });
    const o = s, a = (i = o == null ? void 0 : o.error) == null ? void 0 : i.type;
    return t === 400 ? new vr(t, o, r, n, a) : t === 401 ? new Ar(t, o, r, n, a) : t === 403 ? new Or(t, o, r, n, a) : t === 404 ? new jr(t, o, r, n, a) : t === 409 ? new Lr(t, o, r, n, a) : t === 422 ? new Pr(t, o, r, n, a) : t === 429 ? new $r(t, o, r, n, a) : t >= 500 ? new Nr(t, o, r, n, a) : new P(t, o, r, n, a);
  }
}
class V extends P {
  constructor({ message: t } = {}) {
    super(void 0, void 0, t || "Request was aborted.", void 0);
  }
}
class Ft extends P {
  constructor({ message: t, cause: s }) {
    super(void 0, void 0, t || "Connection error.", void 0), s && (this.cause = s);
  }
}
class xr extends Ft {
  constructor({ message: t } = {}) {
    super({ message: t ?? "Request timed out." });
  }
}
class vr extends P {
}
class Ar extends P {
}
class Or extends P {
}
class jr extends P {
}
class Lr extends P {
}
class Pr extends P {
}
class $r extends P {
}
class Nr extends P {
}
const Jo = /^[a-z][a-z0-9+.-]*:/i, Ho = (e) => Jo.test(e);
let is = (e) => (is = Array.isArray, is(e)), Us = is;
function cs(e) {
  return typeof e != "object" ? {} : e ?? {};
}
function Cs(e) {
  if (!e)
    return !0;
  for (const t in e)
    return !1;
  return !0;
}
function zo(e, t) {
  return Object.prototype.hasOwnProperty.call(e, t);
}
const Vo = (e, t) => {
  if (typeof t != "number" || !Number.isInteger(t))
    throw new _(`${e} must be an integer`);
  if (t < 0)
    throw new _(`${e} must be a positive integer`);
  return t;
}, Ur = (e) => {
  try {
    return JSON.parse(e);
  } catch {
    return;
  }
}, Qo = (e) => new Promise((t) => setTimeout(t, e)), Me = "0.92.0", Yo = () => (
  // @ts-ignore
  typeof window < "u" && // @ts-ignore
  typeof window.document < "u" && // @ts-ignore
  typeof navigator < "u"
);
function Go() {
  return typeof Deno < "u" && Deno.build != null ? "deno" : typeof EdgeRuntime < "u" ? "edge" : Object.prototype.toString.call(typeof globalThis.process < "u" ? globalThis.process : 0) === "[object process]" ? "node" : "unknown";
}
const Zo = () => {
  var s;
  const e = Go();
  if (e === "deno")
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": Me,
      "X-Stainless-OS": qs(Deno.build.os),
      "X-Stainless-Arch": Ds(Deno.build.arch),
      "X-Stainless-Runtime": "deno",
      "X-Stainless-Runtime-Version": typeof Deno.version == "string" ? Deno.version : ((s = Deno.version) == null ? void 0 : s.deno) ?? "unknown"
    };
  if (typeof EdgeRuntime < "u")
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": Me,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": `other:${EdgeRuntime}`,
      "X-Stainless-Runtime": "edge",
      "X-Stainless-Runtime-Version": globalThis.process.version
    };
  if (e === "node")
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": Me,
      "X-Stainless-OS": qs(globalThis.process.platform ?? "unknown"),
      "X-Stainless-Arch": Ds(globalThis.process.arch ?? "unknown"),
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown"
    };
  const t = ea();
  return t ? {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": Me,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": `browser:${t.browser}`,
    "X-Stainless-Runtime-Version": t.version
  } : {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": Me,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": "unknown",
    "X-Stainless-Runtime-Version": "unknown"
  };
};
function ea() {
  if (typeof navigator > "u" || !navigator)
    return null;
  const e = [
    { key: "edge", pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "chrome", pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "firefox", pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "safari", pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ }
  ];
  for (const { key: t, pattern: s } of e) {
    const r = s.exec(navigator.userAgent);
    if (r) {
      const n = r[1] || 0, o = r[2] || 0, a = r[3] || 0;
      return { browser: t, version: `${n}.${o}.${a}` };
    }
  }
  return null;
}
const Ds = (e) => e === "x32" ? "x32" : e === "x86_64" || e === "x64" ? "x64" : e === "arm" ? "arm" : e === "aarch64" || e === "arm64" ? "arm64" : e ? `other:${e}` : "unknown", qs = (e) => (e = e.toLowerCase(), e.includes("ios") ? "iOS" : e === "android" ? "Android" : e === "darwin" ? "MacOS" : e === "win32" ? "Windows" : e === "freebsd" ? "FreeBSD" : e === "openbsd" ? "OpenBSD" : e === "linux" ? "Linux" : e ? `Other:${e}` : "Unknown");
let Bs;
const ta = () => Bs ?? (Bs = Zo());
function sa() {
  if (typeof fetch < "u")
    return fetch;
  throw new Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new Anthropic({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function Cr(...e) {
  const t = globalThis.ReadableStream;
  if (typeof t > "u")
    throw new Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
  return new t(...e);
}
function Dr(e) {
  let t = Symbol.asyncIterator in e ? e[Symbol.asyncIterator]() : e[Symbol.iterator]();
  return Cr({
    start() {
    },
    async pull(s) {
      const { done: r, value: n } = await t.next();
      r ? s.close() : s.enqueue(n);
    },
    async cancel() {
      var s;
      await ((s = t.return) == null ? void 0 : s.call(t));
    }
  });
}
function ys(e) {
  if (e[Symbol.asyncIterator])
    return e;
  const t = e.getReader();
  return {
    async next() {
      try {
        const s = await t.read();
        return s != null && s.done && t.releaseLock(), s;
      } catch (s) {
        throw t.releaseLock(), s;
      }
    },
    async return() {
      const s = t.cancel();
      return t.releaseLock(), await s, { done: !0, value: void 0 };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}
async function ra(e) {
  var r, n;
  if (e === null || typeof e != "object")
    return;
  if (e[Symbol.asyncIterator]) {
    await ((n = (r = e[Symbol.asyncIterator]()).return) == null ? void 0 : n.call(r));
    return;
  }
  const t = e.getReader(), s = t.cancel();
  t.releaseLock(), await s;
}
const na = ({ headers: e, body: t }) => ({
  bodyHeaders: {
    "content-type": "application/json"
  },
  body: JSON.stringify(t)
});
function oa(e) {
  return Object.entries(e).filter(([t, s]) => typeof s < "u").map(([t, s]) => {
    if (typeof s == "string" || typeof s == "number" || typeof s == "boolean")
      return `${encodeURIComponent(t)}=${encodeURIComponent(s)}`;
    if (s === null)
      return `${encodeURIComponent(t)}=`;
    throw new _(`Cannot stringify type ${typeof s}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`);
  }).join("&");
}
function aa(e) {
  let t = 0;
  for (const n of e)
    t += n.length;
  const s = new Uint8Array(t);
  let r = 0;
  for (const n of e)
    s.set(n, r), r += n.length;
  return s;
}
let Fs;
function bs(e) {
  let t;
  return (Fs ?? (t = new globalThis.TextEncoder(), Fs = t.encode.bind(t)))(e);
}
let Ws;
function Ks(e) {
  let t;
  return (Ws ?? (t = new globalThis.TextDecoder(), Ws = t.decode.bind(t)))(e);
}
var D, q;
class et {
  constructor() {
    D.set(this, void 0), q.set(this, void 0), f(this, D, new Uint8Array()), f(this, q, null);
  }
  decode(t) {
    if (t == null)
      return [];
    const s = t instanceof ArrayBuffer ? new Uint8Array(t) : typeof t == "string" ? bs(t) : t;
    f(this, D, aa([c(this, D, "f"), s]));
    const r = [];
    let n;
    for (; (n = ia(c(this, D, "f"), c(this, q, "f"))) != null; ) {
      if (n.carriage && c(this, q, "f") == null) {
        f(this, q, n.index);
        continue;
      }
      if (c(this, q, "f") != null && (n.index !== c(this, q, "f") + 1 || n.carriage)) {
        r.push(Ks(c(this, D, "f").subarray(0, c(this, q, "f") - 1))), f(this, D, c(this, D, "f").subarray(c(this, q, "f"))), f(this, q, null);
        continue;
      }
      const o = c(this, q, "f") !== null ? n.preceding - 1 : n.preceding, a = Ks(c(this, D, "f").subarray(0, o));
      r.push(a), f(this, D, c(this, D, "f").subarray(n.index)), f(this, q, null);
    }
    return r;
  }
  flush() {
    return c(this, D, "f").length ? this.decode(`
`) : [];
  }
}
D = /* @__PURE__ */ new WeakMap(), q = /* @__PURE__ */ new WeakMap();
et.NEWLINE_CHARS = /* @__PURE__ */ new Set([`
`, "\r"]);
et.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
function ia(e, t) {
  for (let n = t ?? 0; n < e.length; n++) {
    if (e[n] === 10)
      return { preceding: n, index: n + 1, carriage: !1 };
    if (e[n] === 13)
      return { preceding: n, index: n + 1, carriage: !0 };
  }
  return null;
}
function ca(e) {
  for (let r = 0; r < e.length - 1; r++) {
    if (e[r] === 10 && e[r + 1] === 10 || e[r] === 13 && e[r + 1] === 13)
      return r + 2;
    if (e[r] === 13 && e[r + 1] === 10 && r + 3 < e.length && e[r + 2] === 13 && e[r + 3] === 10)
      return r + 4;
  }
  return -1;
}
const Ut = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500
}, Xs = (e, t, s) => {
  if (e) {
    if (zo(Ut, e))
      return e;
    $(s).warn(`${t} was set to ${JSON.stringify(e)}, expected one of ${JSON.stringify(Object.keys(Ut))}`);
  }
};
function ze() {
}
function at(e, t, s) {
  return !t || Ut[e] > Ut[s] ? ze : t[e].bind(t);
}
const da = {
  error: ze,
  warn: ze,
  info: ze,
  debug: ze
};
let Js = /* @__PURE__ */ new WeakMap();
function $(e) {
  const t = e.logger, s = e.logLevel ?? "off";
  if (!t)
    return da;
  const r = Js.get(t);
  if (r && r[0] === s)
    return r[1];
  const n = {
    error: at("error", t, s),
    warn: at("warn", t, s),
    info: at("info", t, s),
    debug: at("debug", t, s)
  };
  return Js.set(t, [s, n]), n;
}
const fe = (e) => (e.options && (e.options = { ...e.options }, delete e.options.headers), e.headers && (e.headers = Object.fromEntries((e.headers instanceof Headers ? [...e.headers] : Object.entries(e.headers)).map(([t, s]) => [
  t,
  t.toLowerCase() === "x-api-key" || t.toLowerCase() === "authorization" || t.toLowerCase() === "cookie" || t.toLowerCase() === "set-cookie" ? "***" : s
]))), "retryOfRequestLogID" in e && (e.retryOfRequestLogID && (e.retryOf = e.retryOfRequestLogID), delete e.retryOfRequestLogID), e);
var je;
class Y {
  constructor(t, s, r) {
    this.iterator = t, je.set(this, void 0), this.controller = s, f(this, je, r);
  }
  static fromSSEResponse(t, s, r) {
    let n = !1;
    const o = r ? $(r) : console;
    async function* a() {
      var l;
      if (n)
        throw new _("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      n = !0;
      let i = !1;
      try {
        for await (const d of la(t, s)) {
          if (d.event === "completion")
            try {
              yield JSON.parse(d.data);
            } catch (h) {
              throw o.error("Could not parse message into JSON:", d.data), o.error("From chunk:", d.raw), h;
            }
          if (d.event === "message_start" || d.event === "message_delta" || d.event === "message_stop" || d.event === "content_block_start" || d.event === "content_block_delta" || d.event === "content_block_stop" || d.event === "message" || d.event === "user.message" || d.event === "user.interrupt" || d.event === "user.tool_confirmation" || d.event === "user.custom_tool_result" || d.event === "agent.message" || d.event === "agent.thinking" || d.event === "agent.tool_use" || d.event === "agent.tool_result" || d.event === "agent.mcp_tool_use" || d.event === "agent.mcp_tool_result" || d.event === "agent.custom_tool_use" || d.event === "agent.thread_context_compacted" || d.event === "session.status_running" || d.event === "session.status_idle" || d.event === "session.status_rescheduled" || d.event === "session.status_terminated" || d.event === "session.error" || d.event === "session.deleted" || d.event === "span.model_request_start" || d.event === "span.model_request_end")
            try {
              yield JSON.parse(d.data);
            } catch (h) {
              throw o.error("Could not parse message into JSON:", d.data), o.error("From chunk:", d.raw), h;
            }
          if (d.event !== "ping" && d.event === "error") {
            const h = Ur(d.data) ?? d.data, p = (l = h == null ? void 0 : h.error) == null ? void 0 : l.type;
            throw new P(void 0, h, void 0, t.headers, p);
          }
        }
        i = !0;
      } catch (d) {
        if (Ye(d))
          return;
        throw d;
      } finally {
        i || s.abort();
      }
    }
    return new Y(a, s, r);
  }
  /**
   * Generates a Stream from a newline-separated ReadableStream
   * where each item is a JSON value.
   */
  static fromReadableStream(t, s, r) {
    let n = !1;
    async function* o() {
      const i = new et(), l = ys(t);
      for await (const d of l)
        for (const h of i.decode(d))
          yield h;
      for (const d of i.flush())
        yield d;
    }
    async function* a() {
      if (n)
        throw new _("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      n = !0;
      let i = !1;
      try {
        for await (const l of o())
          i || l && (yield JSON.parse(l));
        i = !0;
      } catch (l) {
        if (Ye(l))
          return;
        throw l;
      } finally {
        i || s.abort();
      }
    }
    return new Y(a, s, r);
  }
  [(je = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    return this.iterator();
  }
  /**
   * Splits the stream into two streams which can be
   * independently read from at different speeds.
   */
  tee() {
    const t = [], s = [], r = this.iterator(), n = (o) => ({
      next: () => {
        if (o.length === 0) {
          const a = r.next();
          t.push(a), s.push(a);
        }
        return o.shift();
      }
    });
    return [
      new Y(() => n(t), this.controller, c(this, je, "f")),
      new Y(() => n(s), this.controller, c(this, je, "f"))
    ];
  }
  /**
   * Converts this stream to a newline-separated ReadableStream of
   * JSON stringified values in the stream
   * which can be turned back into a Stream with `Stream.fromReadableStream()`.
   */
  toReadableStream() {
    const t = this;
    let s;
    return Cr({
      async start() {
        s = t[Symbol.asyncIterator]();
      },
      async pull(r) {
        try {
          const { value: n, done: o } = await s.next();
          if (o)
            return r.close();
          const a = bs(JSON.stringify(n) + `
`);
          r.enqueue(a);
        } catch (n) {
          r.error(n);
        }
      },
      async cancel() {
        var r;
        await ((r = s.return) == null ? void 0 : r.call(s));
      }
    });
  }
}
async function* la(e, t) {
  if (!e.body)
    throw t.abort(), typeof globalThis.navigator < "u" && globalThis.navigator.product === "ReactNative" ? new _("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api") : new _("Attempted to iterate over a response with no body");
  const s = new ha(), r = new et(), n = ys(e.body);
  for await (const o of ua(n))
    for (const a of r.decode(o)) {
      const i = s.decode(a);
      i && (yield i);
    }
  for (const o of r.flush()) {
    const a = s.decode(o);
    a && (yield a);
  }
}
async function* ua(e) {
  let t = new Uint8Array();
  for await (const s of e) {
    if (s == null)
      continue;
    const r = s instanceof ArrayBuffer ? new Uint8Array(s) : typeof s == "string" ? bs(s) : s;
    let n = new Uint8Array(t.length + r.length);
    n.set(t), n.set(r, t.length), t = n;
    let o;
    for (; (o = ca(t)) !== -1; )
      yield t.slice(0, o), t = t.slice(o);
  }
  t.length > 0 && (yield t);
}
class ha {
  constructor() {
    this.event = null, this.data = [], this.chunks = [];
  }
  decode(t) {
    if (t.endsWith("\r") && (t = t.substring(0, t.length - 1)), !t) {
      if (!this.event && !this.data.length)
        return null;
      const o = {
        event: this.event,
        data: this.data.join(`
`),
        raw: this.chunks
      };
      return this.event = null, this.data = [], this.chunks = [], o;
    }
    if (this.chunks.push(t), t.startsWith(":"))
      return null;
    let [s, r, n] = fa(t, ":");
    return n.startsWith(" ") && (n = n.substring(1)), s === "event" ? this.event = n : s === "data" && this.data.push(n), null;
  }
}
function fa(e, t) {
  const s = e.indexOf(t);
  return s !== -1 ? [e.substring(0, s), t, e.substring(s + t.length)] : [e, "", ""];
}
async function qr(e, t) {
  const { response: s, requestLogID: r, retryOfRequestLogID: n, startTime: o } = t, a = await (async () => {
    var p;
    if (t.options.stream)
      return $(e).debug("response", s.status, s.url, s.headers, s.body), t.options.__streamClass ? t.options.__streamClass.fromSSEResponse(s, t.controller) : Y.fromSSEResponse(s, t.controller);
    if (s.status === 204)
      return null;
    if (t.options.__binaryResponse)
      return s;
    const i = s.headers.get("content-type"), l = (p = i == null ? void 0 : i.split(";")[0]) == null ? void 0 : p.trim();
    if ((l == null ? void 0 : l.includes("application/json")) || (l == null ? void 0 : l.endsWith("+json"))) {
      if (s.headers.get("content-length") === "0")
        return;
      const m = await s.json();
      return Br(m, s);
    }
    return await s.text();
  })();
  return $(e).debug(`[${r}] response parsed`, fe({
    retryOfRequestLogID: n,
    url: s.url,
    status: s.status,
    body: a,
    durationMs: Date.now() - o
  })), a;
}
function Br(e, t) {
  return !e || typeof e != "object" || Array.isArray(e) ? e : Object.defineProperty(e, "_request_id", {
    value: t.headers.get("request-id"),
    enumerable: !1
  });
}
var Ve;
class Wt extends Promise {
  constructor(t, s, r = qr) {
    super((n) => {
      n(null);
    }), this.responsePromise = s, this.parseResponse = r, Ve.set(this, void 0), f(this, Ve, t);
  }
  _thenUnwrap(t) {
    return new Wt(c(this, Ve, "f"), this.responsePromise, async (s, r) => Br(t(await this.parseResponse(s, r), r), r.response));
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
    return this.responsePromise.then((t) => t.response);
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
    const [t, s] = await Promise.all([this.parse(), this.asResponse()]);
    return { data: t, response: s, request_id: s.headers.get("request-id") };
  }
  parse() {
    return this.parsedPromise || (this.parsedPromise = this.responsePromise.then((t) => this.parseResponse(c(this, Ve, "f"), t))), this.parsedPromise;
  }
  then(t, s) {
    return this.parse().then(t, s);
  }
  catch(t) {
    return this.parse().catch(t);
  }
  finally(t) {
    return this.parse().finally(t);
  }
}
Ve = /* @__PURE__ */ new WeakMap();
var it;
class Fr {
  constructor(t, s, r, n) {
    it.set(this, void 0), f(this, it, t), this.options = n, this.response = s, this.body = r;
  }
  hasNextPage() {
    return this.getPaginatedItems().length ? this.nextPageRequestOptions() != null : !1;
  }
  async getNextPage() {
    const t = this.nextPageRequestOptions();
    if (!t)
      throw new _("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");
    return await c(this, it, "f").requestAPIList(this.constructor, t);
  }
  async *iterPages() {
    let t = this;
    for (yield t; t.hasNextPage(); )
      t = await t.getNextPage(), yield t;
  }
  async *[(it = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    for await (const t of this.iterPages())
      for (const s of t.getPaginatedItems())
        yield s;
  }
}
class ma extends Wt {
  constructor(t, s, r) {
    super(t, s, async (n, o) => new r(n, o.response, await qr(n, o), o.options));
  }
  /**
   * Allow auto-paginating iteration on an unawaited list call, eg:
   *
   *    for await (const item of client.items.list()) {
   *      console.log(item)
   *    }
   */
  async *[Symbol.asyncIterator]() {
    const t = await this;
    for await (const s of t)
      yield s;
  }
}
class tt extends Fr {
  constructor(t, s, r, n) {
    super(t, s, r, n), this.data = r.data || [], this.has_more = r.has_more || !1, this.first_id = r.first_id || null, this.last_id = r.last_id || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    return this.has_more === !1 ? !1 : super.hasNextPage();
  }
  nextPageRequestOptions() {
    var s;
    if ((s = this.options.query) != null && s.before_id) {
      const r = this.first_id;
      return r ? {
        ...this.options,
        query: {
          ...cs(this.options.query),
          before_id: r
        }
      } : null;
    }
    const t = this.last_id;
    return t ? {
      ...this.options,
      query: {
        ...cs(this.options.query),
        after_id: t
      }
    } : null;
  }
}
class U extends Fr {
  constructor(t, s, r, n) {
    super(t, s, r, n), this.data = r.data || [], this.next_page = r.next_page || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  nextPageRequestOptions() {
    const t = this.next_page;
    return t ? {
      ...this.options,
      query: {
        ...cs(this.options.query),
        page: t
      }
    } : null;
  }
}
const Wr = () => {
  var e;
  if (typeof File > "u") {
    const { process: t } = globalThis, s = typeof ((e = t == null ? void 0 : t.versions) == null ? void 0 : e.node) == "string" && parseInt(t.versions.node.split(".")) < 20;
    throw new Error("`File` is not defined as a global, which is required for file uploads." + (s ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`." : ""));
  }
};
function Ee(e, t, s) {
  return Wr(), new File(e, t ?? "unknown_file", s);
}
function At(e, t) {
  const s = typeof e == "object" && e !== null && ("name" in e && e.name && String(e.name) || "url" in e && e.url && String(e.url) || "filename" in e && e.filename && String(e.filename) || "path" in e && e.path && String(e.path)) || "";
  return t ? s.split(/[\\/]/).pop() || void 0 : s;
}
const Kr = (e) => e != null && typeof e == "object" && typeof e[Symbol.asyncIterator] == "function", ws = async (e, t, s = !0) => ({ ...e, body: await pa(e.body, t, s) }), Hs = /* @__PURE__ */ new WeakMap();
function ga(e) {
  const t = typeof e == "function" ? e : e.fetch, s = Hs.get(t);
  if (s)
    return s;
  const r = (async () => {
    try {
      const n = "Response" in t ? t.Response : (await t("data:,")).constructor, o = new FormData();
      return o.toString() !== await new n(o).text();
    } catch {
      return !0;
    }
  })();
  return Hs.set(t, r), r;
}
const pa = async (e, t, s = !0) => {
  if (!await ga(t))
    throw new TypeError("The provided fetch function does not support file uploads with the current global FormData class.");
  const r = new FormData();
  return await Promise.all(Object.entries(e || {}).map(([n, o]) => ds(r, n, o, s))), r;
}, _a = (e) => e instanceof Blob && "name" in e, ds = async (e, t, s, r) => {
  if (s !== void 0) {
    if (s == null)
      throw new TypeError(`Received null for "${t}"; to pass null in FormData, you must use the string 'null'`);
    if (typeof s == "string" || typeof s == "number" || typeof s == "boolean")
      e.append(t, String(s));
    else if (s instanceof Response) {
      let n = {};
      const o = s.headers.get("Content-Type");
      o && (n = { type: o }), e.append(t, Ee([await s.blob()], At(s, r), n));
    } else if (Kr(s))
      e.append(t, Ee([await new Response(Dr(s)).blob()], At(s, r)));
    else if (_a(s))
      e.append(t, Ee([s], At(s, r), { type: s.type }));
    else if (Array.isArray(s))
      await Promise.all(s.map((n) => ds(e, t + "[]", n, r)));
    else if (typeof s == "object")
      await Promise.all(Object.entries(s).map(([n, o]) => ds(e, `${t}[${n}]`, o, r)));
    else
      throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${s} instead`);
  }
}, Xr = (e) => e != null && typeof e == "object" && typeof e.size == "number" && typeof e.type == "string" && typeof e.text == "function" && typeof e.slice == "function" && typeof e.arrayBuffer == "function", ya = (e) => e != null && typeof e == "object" && typeof e.name == "string" && typeof e.lastModified == "number" && Xr(e), ba = (e) => e != null && typeof e == "object" && typeof e.url == "string" && typeof e.blob == "function";
async function wa(e, t, s) {
  if (Wr(), e = await e, t || (t = At(e, !0)), ya(e))
    return e instanceof File && t == null && s == null ? e : Ee([await e.arrayBuffer()], t ?? e.name, {
      type: e.type,
      lastModified: e.lastModified,
      ...s
    });
  if (ba(e)) {
    const n = await e.blob();
    return t || (t = new URL(e.url).pathname.split(/[\\/]/).pop()), Ee(await ls(n), t, s);
  }
  const r = await ls(e);
  if (!(s != null && s.type)) {
    const n = r.find((o) => typeof o == "object" && "type" in o && o.type);
    typeof n == "string" && (s = { ...s, type: n });
  }
  return Ee(r, t, s);
}
async function ls(e) {
  var s;
  let t = [];
  if (typeof e == "string" || ArrayBuffer.isView(e) || // includes Uint8Array, Buffer, etc.
  e instanceof ArrayBuffer)
    t.push(e);
  else if (Xr(e))
    t.push(e instanceof Blob ? e : await e.arrayBuffer());
  else if (Kr(e))
    for await (const r of e)
      t.push(...await ls(r));
  else {
    const r = (s = e == null ? void 0 : e.constructor) == null ? void 0 : s.name;
    throw new Error(`Unexpected data type: ${typeof e}${r ? `; constructor: ${r}` : ""}${Sa(e)}`);
  }
  return t;
}
function Sa(e) {
  return typeof e != "object" || e === null ? "" : `; props: [${Object.getOwnPropertyNames(e).map((s) => `"${s}"`).join(", ")}]`;
}
class M {
  constructor(t) {
    this._client = t;
  }
}
const Jr = Symbol.for("brand.privateNullableHeaders");
function* Ia(e) {
  if (!e)
    return;
  if (Jr in e) {
    const { values: r, nulls: n } = e;
    yield* r.entries();
    for (const o of n)
      yield [o, null];
    return;
  }
  let t = !1, s;
  e instanceof Headers ? s = e.entries() : Us(e) ? s = e : (t = !0, s = Object.entries(e ?? {}));
  for (let r of s) {
    const n = r[0];
    if (typeof n != "string")
      throw new TypeError("expected header name to be a string");
    const o = Us(r[1]) ? r[1] : [r[1]];
    let a = !1;
    for (const i of o)
      i !== void 0 && (t && !a && (a = !0, yield [n, null]), yield [n, i]);
  }
}
const u = (e) => {
  const t = new Headers(), s = /* @__PURE__ */ new Set();
  for (const r of e) {
    const n = /* @__PURE__ */ new Set();
    for (const [o, a] of Ia(r)) {
      const i = o.toLowerCase();
      n.has(i) || (t.delete(o), n.add(i)), a === null ? (t.delete(o), s.add(i)) : (t.append(o, a), s.delete(i));
    }
  }
  return { [Jr]: !0, values: t, nulls: s };
};
function Hr(e) {
  return e.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
const zs = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null)), Ma = (e = Hr) => function(s, ...r) {
  if (s.length === 1)
    return s[0];
  let n = !1;
  const o = [], a = s.reduce((h, p, b) => {
    var S;
    /[?#]/.test(p) && (n = !0);
    const m = r[b];
    let w = (n ? encodeURIComponent : e)("" + m);
    return b !== r.length && (m == null || typeof m == "object" && // handle values from other realms
    m.toString === ((S = Object.getPrototypeOf(Object.getPrototypeOf(m.hasOwnProperty ?? zs) ?? zs)) == null ? void 0 : S.toString)) && (w = m + "", o.push({
      start: h.length + p.length,
      length: w.length,
      error: `Value of type ${Object.prototype.toString.call(m).slice(8, -1)} is not a valid path parameter`
    })), h + p + (b === r.length ? "" : w);
  }, ""), i = a.split(/[?#]/, 1)[0], l = new RegExp("(?<=^|\\/)(?:\\.|%2e){1,2}(?=\\/|$)", "gi");
  let d;
  for (; (d = l.exec(i)) !== null; )
    o.push({
      start: d.index,
      length: d[0].length,
      error: `Value "${d[0]}" can't be safely passed as a path parameter`
    });
  if (o.sort((h, p) => h.start - p.start), o.length > 0) {
    let h = 0;
    const p = o.reduce((b, m) => {
      const w = " ".repeat(m.start - h), S = "^".repeat(m.length);
      return h = m.start + m.length, b + w + S;
    }, "");
    throw new _(`Path parameters result in path with invalid segments:
${o.map((b) => b.error).join(`
`)}
${a}
${p}`);
  }
  return a;
}, g = /* @__PURE__ */ Ma(Hr);
class zr extends M {
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
  create(t, s) {
    const { betas: r, ...n } = t;
    return this._client.post("/v1/environments?beta=true", {
      body: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  retrieve(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/environments/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  update(t, s, r) {
    const { betas: n, ...o } = s;
    return this._client.post(g`/v1/environments/${t}?beta=true`, {
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/environments?beta=true", U, {
      query: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  delete(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.delete(g`/v1/environments/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  archive(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.post(g`/v1/environments/${t}/archive?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
const Qe = Symbol("anthropic.sdk.stainlessHelper");
function Ot(e) {
  return typeof e == "object" && e !== null && Qe in e;
}
function Vr(e, t) {
  const s = /* @__PURE__ */ new Set();
  if (e)
    for (const r of e)
      Ot(r) && s.add(r[Qe]);
  if (t) {
    for (const r of t)
      if (Ot(r) && s.add(r[Qe]), Array.isArray(r.content))
        for (const n of r.content)
          Ot(n) && s.add(n[Qe]);
  }
  return Array.from(s);
}
function Qr(e, t) {
  const s = Vr(e, t);
  return s.length === 0 ? {} : { "x-stainless-helper": s.join(", ") };
}
function Ta(e) {
  return Ot(e) ? { "x-stainless-helper": e[Qe] } : {};
}
class Yr extends M {
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/files?beta=true", tt, {
      query: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "files-api-2025-04-14"].toString() },
        s == null ? void 0 : s.headers
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
  delete(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.delete(g`/v1/files/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "files-api-2025-04-14"].toString() },
        r == null ? void 0 : r.headers
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
  download(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/files/${t}/content?beta=true`, {
      ...r,
      headers: u([
        {
          "anthropic-beta": [...n ?? [], "files-api-2025-04-14"].toString(),
          Accept: "application/binary"
        },
        r == null ? void 0 : r.headers
      ]),
      __binaryResponse: !0
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
  retrieveMetadata(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/files/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "files-api-2025-04-14"].toString() },
        r == null ? void 0 : r.headers
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
  upload(t, s) {
    const { betas: r, ...n } = t;
    return this._client.post("/v1/files?beta=true", ws({
      body: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "files-api-2025-04-14"].toString() },
        Ta(n.file),
        s == null ? void 0 : s.headers
      ])
    }, this._client));
  }
}
let Gr = class extends M {
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
  retrieve(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/models/${t}?beta=true`, {
      ...r,
      headers: u([
        { ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0 },
        r == null ? void 0 : r.headers
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/models?beta=true", tt, {
      query: n,
      ...s,
      headers: u([
        { ...(r == null ? void 0 : r.toString()) != null ? { "anthropic-beta": r == null ? void 0 : r.toString() } : void 0 },
        s == null ? void 0 : s.headers
      ])
    });
  }
};
class Zr extends M {
  /**
   * Create User Profile
   *
   * @example
   * ```ts
   * const betaUserProfile =
   *   await client.beta.userProfiles.create();
   * ```
   */
  create(t, s) {
    const { betas: r, ...n } = t;
    return this._client.post("/v1/user_profiles?beta=true", {
      body: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "user-profiles-2026-03-24"].toString() },
        s == null ? void 0 : s.headers
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
  retrieve(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/user_profiles/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "user-profiles-2026-03-24"].toString() },
        r == null ? void 0 : r.headers
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
  update(t, s, r) {
    const { betas: n, ...o } = s;
    return this._client.post(g`/v1/user_profiles/${t}?beta=true`, {
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "user-profiles-2026-03-24"].toString() },
        r == null ? void 0 : r.headers
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/user_profiles?beta=true", U, {
      query: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "user-profiles-2026-03-24"].toString() },
        s == null ? void 0 : s.headers
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
  createEnrollmentURL(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.post(g`/v1/user_profiles/${t}/enrollment_url?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "user-profiles-2026-03-24"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
let en = class extends M {
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
  list(t, s = {}, r) {
    const { betas: n, ...o } = s ?? {};
    return this._client.getAPIList(g`/v1/agents/${t}/versions?beta=true`, U, {
      query: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
};
class Ss extends M {
  constructor() {
    super(...arguments), this.versions = new en(this._client);
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
  create(t, s) {
    const { betas: r, ...n } = t;
    return this._client.post("/v1/agents?beta=true", {
      body: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  retrieve(t, s = {}, r) {
    const { betas: n, ...o } = s ?? {};
    return this._client.get(g`/v1/agents/${t}?beta=true`, {
      query: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  update(t, s, r) {
    const { betas: n, ...o } = s;
    return this._client.post(g`/v1/agents/${t}?beta=true`, {
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/agents?beta=true", U, {
      query: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  archive(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.post(g`/v1/agents/${t}/archive?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
Ss.Versions = en;
class tn extends M {
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
  create(t, s, r) {
    const { view: n, betas: o, ...a } = s;
    return this._client.post(g`/v1/memory_stores/${t}/memories?beta=true`, {
      query: { view: n },
      body: a,
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  retrieve(t, s, r) {
    const { memory_store_id: n, betas: o, ...a } = s;
    return this._client.get(g`/v1/memory_stores/${n}/memories/${t}?beta=true`, {
      query: a,
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  update(t, s, r) {
    const { memory_store_id: n, view: o, betas: a, ...i } = s;
    return this._client.post(g`/v1/memory_stores/${n}/memories/${t}?beta=true`, {
      query: { view: o },
      body: i,
      ...r,
      headers: u([
        { "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  list(t, s = {}, r) {
    const { betas: n, ...o } = s ?? {};
    return this._client.getAPIList(g`/v1/memory_stores/${t}/memories?beta=true`, U, {
      query: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  delete(t, s, r) {
    const { memory_store_id: n, expected_content_sha256: o, betas: a } = s;
    return this._client.delete(g`/v1/memory_stores/${n}/memories/${t}?beta=true`, {
      query: { expected_content_sha256: o },
      ...r,
      headers: u([
        { "anthropic-beta": [...a ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
class sn extends M {
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
  retrieve(t, s, r) {
    const { memory_store_id: n, betas: o, ...a } = s;
    return this._client.get(g`/v1/memory_stores/${n}/memory_versions/${t}?beta=true`, {
      query: a,
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  list(t, s = {}, r) {
    const { betas: n, ...o } = s ?? {};
    return this._client.getAPIList(g`/v1/memory_stores/${t}/memory_versions?beta=true`, U, {
      query: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  redact(t, s, r) {
    const { memory_store_id: n, betas: o } = s;
    return this._client.post(g`/v1/memory_stores/${n}/memory_versions/${t}/redact?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
class Kt extends M {
  constructor() {
    super(...arguments), this.memories = new tn(this._client), this.memoryVersions = new sn(this._client);
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
  create(t, s) {
    const { betas: r, ...n } = t;
    return this._client.post("/v1/memory_stores?beta=true", {
      body: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  retrieve(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/memory_stores/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  update(t, s, r) {
    const { betas: n, ...o } = s;
    return this._client.post(g`/v1/memory_stores/${t}?beta=true`, {
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/memory_stores?beta=true", U, {
      query: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  delete(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.delete(g`/v1/memory_stores/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  archive(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.post(g`/v1/memory_stores/${t}/archive?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
Kt.Memories = tn;
Kt.MemoryVersions = sn;
class Xt {
  constructor(t, s) {
    this.iterator = t, this.controller = s;
  }
  async *decoder() {
    const t = new et();
    for await (const s of this.iterator)
      for (const r of t.decode(s))
        yield JSON.parse(r);
    for (const s of t.flush())
      yield JSON.parse(s);
  }
  [Symbol.asyncIterator]() {
    return this.decoder();
  }
  static fromResponse(t, s) {
    if (!t.body)
      throw s.abort(), typeof globalThis.navigator < "u" && globalThis.navigator.product === "ReactNative" ? new _("The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api") : new _("Attempted to iterate over a response with no body");
    return new Xt(ys(t.body), s);
  }
}
let rn = class extends M {
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
  create(t, s) {
    const { betas: r, ...n } = t;
    return this._client.post("/v1/messages/batches?beta=true", {
      body: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "message-batches-2024-09-24"].toString() },
        s == null ? void 0 : s.headers
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
  retrieve(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/messages/batches/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "message-batches-2024-09-24"].toString() },
        r == null ? void 0 : r.headers
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/messages/batches?beta=true", tt, {
      query: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "message-batches-2024-09-24"].toString() },
        s == null ? void 0 : s.headers
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
  delete(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.delete(g`/v1/messages/batches/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "message-batches-2024-09-24"].toString() },
        r == null ? void 0 : r.headers
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
  cancel(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.post(g`/v1/messages/batches/${t}/cancel?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "message-batches-2024-09-24"].toString() },
        r == null ? void 0 : r.headers
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
  async results(t, s = {}, r) {
    const n = await this.retrieve(t);
    if (!n.results_url)
      throw new _(`No batch \`results_url\`; Has it finished processing? ${n.processing_status} - ${n.id}`);
    const { betas: o } = s ?? {};
    return this._client.get(n.results_url, {
      ...r,
      headers: u([
        {
          "anthropic-beta": [...o ?? [], "message-batches-2024-09-24"].toString(),
          Accept: "application/binary"
        },
        r == null ? void 0 : r.headers
      ]),
      stream: !0,
      __binaryResponse: !0
    })._thenUnwrap((a, i) => Xt.fromResponse(i.response, i.controller));
  }
};
const nn = {
  "claude-opus-4-20250514": 8192,
  "claude-opus-4-0": 8192,
  "claude-4-opus-20250514": 8192,
  "anthropic.claude-opus-4-20250514-v1:0": 8192,
  "claude-opus-4@20250514": 8192,
  "claude-opus-4-1-20250805": 8192,
  "anthropic.claude-opus-4-1-20250805-v1:0": 8192,
  "claude-opus-4-1@20250805": 8192
};
function on(e) {
  var t;
  return (e == null ? void 0 : e.output_format) ?? ((t = e == null ? void 0 : e.output_config) == null ? void 0 : t.format);
}
function Vs(e, t, s) {
  const r = on(t);
  return !t || !("parse" in (r ?? {})) ? {
    ...e,
    content: e.content.map((n) => {
      if (n.type === "text") {
        const o = Object.defineProperty({ ...n }, "parsed_output", {
          value: null,
          enumerable: !1
        });
        return Object.defineProperty(o, "parsed", {
          get() {
            return s.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead."), null;
          },
          enumerable: !1
        });
      }
      return n;
    }),
    parsed_output: null
  } : an(e, t, s);
}
function an(e, t, s) {
  let r = null;
  const n = e.content.map((o) => {
    if (o.type === "text") {
      const a = ka(t, o.text);
      r === null && (r = a);
      const i = Object.defineProperty({ ...o }, "parsed_output", {
        value: a,
        enumerable: !1
      });
      return Object.defineProperty(i, "parsed", {
        get() {
          return s.logger.warn("The `parsed` property on `text` blocks is deprecated, please use `parsed_output` instead."), a;
        },
        enumerable: !1
      });
    }
    return o;
  });
  return {
    ...e,
    content: n,
    parsed_output: r
  };
}
function ka(e, t) {
  const s = on(e);
  if ((s == null ? void 0 : s.type) !== "json_schema")
    return null;
  try {
    return "parse" in s ? s.parse(t) : JSON.parse(t);
  } catch (r) {
    throw new _(`Failed to parse structured output: ${r}`);
  }
}
const Ea = (e) => {
  let t = 0, s = [];
  for (; t < e.length; ) {
    let r = e[t];
    if (r === "\\") {
      t++;
      continue;
    }
    if (r === "{") {
      s.push({
        type: "brace",
        value: "{"
      }), t++;
      continue;
    }
    if (r === "}") {
      s.push({
        type: "brace",
        value: "}"
      }), t++;
      continue;
    }
    if (r === "[") {
      s.push({
        type: "paren",
        value: "["
      }), t++;
      continue;
    }
    if (r === "]") {
      s.push({
        type: "paren",
        value: "]"
      }), t++;
      continue;
    }
    if (r === ":") {
      s.push({
        type: "separator",
        value: ":"
      }), t++;
      continue;
    }
    if (r === ",") {
      s.push({
        type: "delimiter",
        value: ","
      }), t++;
      continue;
    }
    if (r === '"') {
      let i = "", l = !1;
      for (r = e[++t]; r !== '"'; ) {
        if (t === e.length) {
          l = !0;
          break;
        }
        if (r === "\\") {
          if (t++, t === e.length) {
            l = !0;
            break;
          }
          i += r + e[t], r = e[++t];
        } else
          i += r, r = e[++t];
      }
      r = e[++t], l || s.push({
        type: "string",
        value: i
      });
      continue;
    }
    if (r && /\s/.test(r)) {
      t++;
      continue;
    }
    let o = /[0-9]/;
    if (r && o.test(r) || r === "-" || r === ".") {
      let i = "";
      for (r === "-" && (i += r, r = e[++t]); r && o.test(r) || r === "."; )
        i += r, r = e[++t];
      s.push({
        type: "number",
        value: i
      });
      continue;
    }
    let a = /[a-z]/i;
    if (r && a.test(r)) {
      let i = "";
      for (; r && a.test(r) && t !== e.length; )
        i += r, r = e[++t];
      if (i == "true" || i == "false" || i === "null")
        s.push({
          type: "name",
          value: i
        });
      else {
        t++;
        continue;
      }
      continue;
    }
    t++;
  }
  return s;
}, Te = (e) => {
  if (e.length === 0)
    return e;
  let t = e[e.length - 1];
  switch (t.type) {
    case "separator":
      return e = e.slice(0, e.length - 1), Te(e);
    case "number":
      let s = t.value[t.value.length - 1];
      if (s === "." || s === "-")
        return e = e.slice(0, e.length - 1), Te(e);
    case "string":
      let r = e[e.length - 2];
      if ((r == null ? void 0 : r.type) === "delimiter")
        return e = e.slice(0, e.length - 1), Te(e);
      if ((r == null ? void 0 : r.type) === "brace" && r.value === "{")
        return e = e.slice(0, e.length - 1), Te(e);
      break;
    case "delimiter":
      return e = e.slice(0, e.length - 1), Te(e);
  }
  return e;
}, Ra = (e) => {
  let t = [];
  return e.map((s) => {
    s.type === "brace" && (s.value === "{" ? t.push("}") : t.splice(t.lastIndexOf("}"), 1)), s.type === "paren" && (s.value === "[" ? t.push("]") : t.splice(t.lastIndexOf("]"), 1));
  }), t.length > 0 && t.reverse().map((s) => {
    s === "}" ? e.push({
      type: "brace",
      value: "}"
    }) : s === "]" && e.push({
      type: "paren",
      value: "]"
    });
  }), e;
}, xa = (e) => {
  let t = "";
  return e.map((s) => {
    switch (s.type) {
      case "string":
        t += '"' + s.value + '"';
        break;
      default:
        t += s.value;
        break;
    }
  }), t;
}, cn = (e) => JSON.parse(xa(Ra(Te(Ea(e)))));
var K, re, be, Le, ct, Pe, $e, dt, Ne, Z, Ue, lt, ut, le, ht, ft, Ce, Qt, Qs, mt, Yt, Gt, Zt, Ys;
const Gs = "__json_buf";
function Zs(e) {
  return e.type === "tool_use" || e.type === "server_tool_use" || e.type === "mcp_tool_use";
}
class Ct {
  constructor(t, s) {
    K.add(this), this.messages = [], this.receivedMessages = [], re.set(this, void 0), be.set(this, null), this.controller = new AbortController(), Le.set(this, void 0), ct.set(this, () => {
    }), Pe.set(this, () => {
    }), $e.set(this, void 0), dt.set(this, () => {
    }), Ne.set(this, () => {
    }), Z.set(this, {}), Ue.set(this, !1), lt.set(this, !1), ut.set(this, !1), le.set(this, !1), ht.set(this, void 0), ft.set(this, void 0), Ce.set(this, void 0), mt.set(this, (r) => {
      if (f(this, lt, !0), Ye(r) && (r = new V()), r instanceof V)
        return f(this, ut, !0), this._emit("abort", r);
      if (r instanceof _)
        return this._emit("error", r);
      if (r instanceof Error) {
        const n = new _(r.message);
        return n.cause = r, this._emit("error", n);
      }
      return this._emit("error", new _(String(r)));
    }), f(this, Le, new Promise((r, n) => {
      f(this, ct, r, "f"), f(this, Pe, n, "f");
    })), f(this, $e, new Promise((r, n) => {
      f(this, dt, r, "f"), f(this, Ne, n, "f");
    })), c(this, Le, "f").catch(() => {
    }), c(this, $e, "f").catch(() => {
    }), f(this, be, t), f(this, Ce, (s == null ? void 0 : s.logger) ?? console);
  }
  get response() {
    return c(this, ht, "f");
  }
  get request_id() {
    return c(this, ft, "f");
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
    f(this, le, !0);
    const t = await c(this, Le, "f");
    if (!t)
      throw new Error("Could not resolve a `Response` object");
    return {
      data: this,
      response: t,
      request_id: t.headers.get("request-id")
    };
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(t) {
    const s = new Ct(null);
    return s._run(() => s._fromReadableStream(t)), s;
  }
  static createMessage(t, s, r, { logger: n } = {}) {
    const o = new Ct(s, { logger: n });
    for (const a of s.messages)
      o._addMessageParam(a);
    return f(o, be, { ...s, stream: !0 }), o._run(() => o._createMessage(t, { ...s, stream: !0 }, { ...r, headers: { ...r == null ? void 0 : r.headers, "X-Stainless-Helper-Method": "stream" } })), o;
  }
  _run(t) {
    t().then(() => {
      this._emitFinal(), this._emit("end");
    }, c(this, mt, "f"));
  }
  _addMessageParam(t) {
    this.messages.push(t);
  }
  _addMessage(t, s = !0) {
    this.receivedMessages.push(t), s && this._emit("message", t);
  }
  async _createMessage(t, s, r) {
    var a;
    const n = r == null ? void 0 : r.signal;
    let o;
    n && (n.aborted && this.controller.abort(), o = this.controller.abort.bind(this.controller), n.addEventListener("abort", o));
    try {
      c(this, K, "m", Yt).call(this);
      const { response: i, data: l } = await t.create({ ...s, stream: !0 }, { ...r, signal: this.controller.signal }).withResponse();
      this._connected(i);
      for await (const d of l)
        c(this, K, "m", Gt).call(this, d);
      if ((a = l.controller.signal) != null && a.aborted)
        throw new V();
      c(this, K, "m", Zt).call(this);
    } finally {
      n && o && n.removeEventListener("abort", o);
    }
  }
  _connected(t) {
    this.ended || (f(this, ht, t), f(this, ft, t == null ? void 0 : t.headers.get("request-id")), c(this, ct, "f").call(this, t), this._emit("connect"));
  }
  get ended() {
    return c(this, Ue, "f");
  }
  get errored() {
    return c(this, lt, "f");
  }
  get aborted() {
    return c(this, ut, "f");
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
  on(t, s) {
    return (c(this, Z, "f")[t] || (c(this, Z, "f")[t] = [])).push({ listener: s }), this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this MessageStream, so that calls can be chained
   */
  off(t, s) {
    const r = c(this, Z, "f")[t];
    if (!r)
      return this;
    const n = r.findIndex((o) => o.listener === s);
    return n >= 0 && r.splice(n, 1), this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this MessageStream, so that calls can be chained
   */
  once(t, s) {
    return (c(this, Z, "f")[t] || (c(this, Z, "f")[t] = [])).push({ listener: s, once: !0 }), this;
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
  emitted(t) {
    return new Promise((s, r) => {
      f(this, le, !0), t !== "error" && this.once("error", r), this.once(t, s);
    });
  }
  async done() {
    f(this, le, !0), await c(this, $e, "f");
  }
  get currentMessage() {
    return c(this, re, "f");
  }
  /**
   * @returns a promise that resolves with the the final assistant Message response,
   * or rejects if an error occurred or the stream ended prematurely without producing a Message.
   * If structured outputs were used, this will be a ParsedMessage with a `parsed` field.
   */
  async finalMessage() {
    return await this.done(), c(this, K, "m", Qt).call(this);
  }
  /**
   * @returns a promise that resolves with the the final assistant Message's text response, concatenated
   * together if there are more than one text blocks.
   * Rejects if an error occurred or the stream ended prematurely without producing a Message.
   */
  async finalText() {
    return await this.done(), c(this, K, "m", Qs).call(this);
  }
  _emit(t, ...s) {
    if (c(this, Ue, "f"))
      return;
    t === "end" && (f(this, Ue, !0), c(this, dt, "f").call(this));
    const r = c(this, Z, "f")[t];
    if (r && (c(this, Z, "f")[t] = r.filter((n) => !n.once), r.forEach(({ listener: n }) => n(...s))), t === "abort") {
      const n = s[0];
      !c(this, le, "f") && !(r != null && r.length) && Promise.reject(n), c(this, Pe, "f").call(this, n), c(this, Ne, "f").call(this, n), this._emit("end");
      return;
    }
    if (t === "error") {
      const n = s[0];
      !c(this, le, "f") && !(r != null && r.length) && Promise.reject(n), c(this, Pe, "f").call(this, n), c(this, Ne, "f").call(this, n), this._emit("end");
    }
  }
  _emitFinal() {
    this.receivedMessages.at(-1) && this._emit("finalMessage", c(this, K, "m", Qt).call(this));
  }
  async _fromReadableStream(t, s) {
    var o;
    const r = s == null ? void 0 : s.signal;
    let n;
    r && (r.aborted && this.controller.abort(), n = this.controller.abort.bind(this.controller), r.addEventListener("abort", n));
    try {
      c(this, K, "m", Yt).call(this), this._connected(null);
      const a = Y.fromReadableStream(t, this.controller);
      for await (const i of a)
        c(this, K, "m", Gt).call(this, i);
      if ((o = a.controller.signal) != null && o.aborted)
        throw new V();
      c(this, K, "m", Zt).call(this);
    } finally {
      r && n && r.removeEventListener("abort", n);
    }
  }
  [(re = /* @__PURE__ */ new WeakMap(), be = /* @__PURE__ */ new WeakMap(), Le = /* @__PURE__ */ new WeakMap(), ct = /* @__PURE__ */ new WeakMap(), Pe = /* @__PURE__ */ new WeakMap(), $e = /* @__PURE__ */ new WeakMap(), dt = /* @__PURE__ */ new WeakMap(), Ne = /* @__PURE__ */ new WeakMap(), Z = /* @__PURE__ */ new WeakMap(), Ue = /* @__PURE__ */ new WeakMap(), lt = /* @__PURE__ */ new WeakMap(), ut = /* @__PURE__ */ new WeakMap(), le = /* @__PURE__ */ new WeakMap(), ht = /* @__PURE__ */ new WeakMap(), ft = /* @__PURE__ */ new WeakMap(), Ce = /* @__PURE__ */ new WeakMap(), mt = /* @__PURE__ */ new WeakMap(), K = /* @__PURE__ */ new WeakSet(), Qt = function() {
    if (this.receivedMessages.length === 0)
      throw new _("stream ended without producing a Message with role=assistant");
    return this.receivedMessages.at(-1);
  }, Qs = function() {
    if (this.receivedMessages.length === 0)
      throw new _("stream ended without producing a Message with role=assistant");
    const s = this.receivedMessages.at(-1).content.filter((r) => r.type === "text").map((r) => r.text);
    if (s.length === 0)
      throw new _("stream ended without producing a content block with type=text");
    return s.join(" ");
  }, Yt = function() {
    this.ended || f(this, re, void 0);
  }, Gt = function(s) {
    if (this.ended)
      return;
    const r = c(this, K, "m", Ys).call(this, s);
    switch (this._emit("streamEvent", s, r), s.type) {
      case "content_block_delta": {
        const n = r.content.at(-1);
        switch (s.delta.type) {
          case "text_delta": {
            n.type === "text" && this._emit("text", s.delta.text, n.text || "");
            break;
          }
          case "citations_delta": {
            n.type === "text" && this._emit("citation", s.delta.citation, n.citations ?? []);
            break;
          }
          case "input_json_delta": {
            Zs(n) && n.input && this._emit("inputJson", s.delta.partial_json, n.input);
            break;
          }
          case "thinking_delta": {
            n.type === "thinking" && this._emit("thinking", s.delta.thinking, n.thinking);
            break;
          }
          case "signature_delta": {
            n.type === "thinking" && this._emit("signature", n.signature);
            break;
          }
          case "compaction_delta": {
            n.type === "compaction" && n.content && this._emit("compaction", n.content);
            break;
          }
          default:
            s.delta;
        }
        break;
      }
      case "message_stop": {
        this._addMessageParam(r), this._addMessage(Vs(r, c(this, be, "f"), { logger: c(this, Ce, "f") }), !0);
        break;
      }
      case "content_block_stop": {
        this._emit("contentBlock", r.content.at(-1));
        break;
      }
      case "message_start": {
        f(this, re, r);
        break;
      }
    }
  }, Zt = function() {
    if (this.ended)
      throw new _("stream has ended, this shouldn't happen");
    const s = c(this, re, "f");
    if (!s)
      throw new _("request ended without sending any chunks");
    return f(this, re, void 0), Vs(s, c(this, be, "f"), { logger: c(this, Ce, "f") });
  }, Ys = function(s) {
    let r = c(this, re, "f");
    if (s.type === "message_start") {
      if (r)
        throw new _(`Unexpected event order, got ${s.type} before receiving "message_stop"`);
      return s.message;
    }
    if (!r)
      throw new _(`Unexpected event order, got ${s.type} before "message_start"`);
    switch (s.type) {
      case "message_stop":
        return r;
      case "message_delta":
        return r.container = s.delta.container, r.stop_reason = s.delta.stop_reason, r.stop_sequence = s.delta.stop_sequence, r.usage.output_tokens = s.usage.output_tokens, r.context_management = s.context_management, s.usage.input_tokens != null && (r.usage.input_tokens = s.usage.input_tokens), s.usage.cache_creation_input_tokens != null && (r.usage.cache_creation_input_tokens = s.usage.cache_creation_input_tokens), s.usage.cache_read_input_tokens != null && (r.usage.cache_read_input_tokens = s.usage.cache_read_input_tokens), s.usage.server_tool_use != null && (r.usage.server_tool_use = s.usage.server_tool_use), s.usage.iterations != null && (r.usage.iterations = s.usage.iterations), r;
      case "content_block_start":
        return r.content.push(s.content_block), r;
      case "content_block_delta": {
        const n = r.content.at(s.index);
        switch (s.delta.type) {
          case "text_delta": {
            (n == null ? void 0 : n.type) === "text" && (r.content[s.index] = {
              ...n,
              text: (n.text || "") + s.delta.text
            });
            break;
          }
          case "citations_delta": {
            (n == null ? void 0 : n.type) === "text" && (r.content[s.index] = {
              ...n,
              citations: [...n.citations ?? [], s.delta.citation]
            });
            break;
          }
          case "input_json_delta": {
            if (n && Zs(n)) {
              let o = n[Gs] || "";
              o += s.delta.partial_json;
              const a = { ...n };
              if (Object.defineProperty(a, Gs, {
                value: o,
                enumerable: !1,
                writable: !0
              }), o)
                try {
                  a.input = cn(o);
                } catch (i) {
                  const l = new _(`Unable to parse tool parameter JSON from model. Please retry your request or adjust your prompt. Error: ${i}. JSON: ${o}`);
                  c(this, mt, "f").call(this, l);
                }
              r.content[s.index] = a;
            }
            break;
          }
          case "thinking_delta": {
            (n == null ? void 0 : n.type) === "thinking" && (r.content[s.index] = {
              ...n,
              thinking: n.thinking + s.delta.thinking
            });
            break;
          }
          case "signature_delta": {
            (n == null ? void 0 : n.type) === "thinking" && (r.content[s.index] = {
              ...n,
              signature: s.delta.signature
            });
            break;
          }
          case "compaction_delta": {
            (n == null ? void 0 : n.type) === "compaction" && (r.content[s.index] = {
              ...n,
              content: (n.content || "") + s.delta.content
            });
            break;
          }
          default:
            s.delta;
        }
        return r;
      }
      case "content_block_stop":
        return r;
    }
  }, Symbol.asyncIterator)]() {
    const t = [], s = [];
    let r = !1;
    return this.on("streamEvent", (n) => {
      const o = s.shift();
      o ? o.resolve(n) : t.push(n);
    }), this.on("end", () => {
      r = !0;
      for (const n of s)
        n.resolve(void 0);
      s.length = 0;
    }), this.on("abort", (n) => {
      r = !0;
      for (const o of s)
        o.reject(n);
      s.length = 0;
    }), this.on("error", (n) => {
      r = !0;
      for (const o of s)
        o.reject(n);
      s.length = 0;
    }), {
      next: async () => t.length ? { value: t.shift(), done: !1 } : r ? { value: void 0, done: !0 } : new Promise((o, a) => s.push({ resolve: o, reject: a })).then((o) => o ? { value: o, done: !1 } : { value: void 0, done: !0 }),
      return: async () => (this.abort(), { value: void 0, done: !0 })
    };
  }
  toReadableStream() {
    return new Y(this[Symbol.asyncIterator].bind(this), this.controller).toReadableStream();
  }
}
class dn extends Error {
  constructor(t) {
    const s = typeof t == "string" ? t : t.map((r) => r.type === "text" ? r.text : `[${r.type}]`).join(" ");
    super(s), this.name = "ToolError", this.content = t;
  }
}
const va = 1e5, Aa = `You have been working on the task described above but have not yet completed it. Write a continuation summary that will allow you (or another instance of yourself) to resume work efficiently in a future context window where the conversation history will be replaced with this summary. Your summary should be structured, concise, and actionable. Include:
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
var De, we, ue, R, N, C, te, ne, qe, er, us;
function tr() {
  let e, t;
  return { promise: new Promise((r, n) => {
    e = r, t = n;
  }), resolve: e, reject: t };
}
class ln {
  constructor(t, s, r) {
    var a;
    De.add(this), this.client = t, we.set(this, !1), ue.set(this, !1), R.set(this, void 0), N.set(this, void 0), C.set(this, void 0), te.set(this, void 0), ne.set(this, void 0), qe.set(this, 0), f(this, R, {
      params: {
        // You can't clone the entire params since there are functions as handlers.
        // You also don't really need to clone params.messages, but it probably will prevent a foot gun
        // somewhere.
        ...s,
        messages: structuredClone(s.messages)
      }
    });
    const o = ["BetaToolRunner", ...Vr(s.tools, s.messages)].join(", ");
    f(this, N, {
      ...r,
      headers: u([{ "x-stainless-helper": o }, r == null ? void 0 : r.headers])
    }), f(this, ne, tr()), (a = s.compactionControl) != null && a.enabled && console.warn('Anthropic: The `compactionControl` parameter is deprecated and will be removed in a future version. Use server-side compaction instead by passing `edits: [{ type: "compact_20260112" }]` in the params passed to `toolRunner()`. See https://platform.claude.com/docs/en/build-with-claude/compaction');
  }
  async *[(we = /* @__PURE__ */ new WeakMap(), ue = /* @__PURE__ */ new WeakMap(), R = /* @__PURE__ */ new WeakMap(), N = /* @__PURE__ */ new WeakMap(), C = /* @__PURE__ */ new WeakMap(), te = /* @__PURE__ */ new WeakMap(), ne = /* @__PURE__ */ new WeakMap(), qe = /* @__PURE__ */ new WeakMap(), De = /* @__PURE__ */ new WeakSet(), er = async function() {
    var d;
    const s = c(this, R, "f").params.compactionControl;
    if (!s || !s.enabled)
      return !1;
    let r = 0;
    if (c(this, C, "f") !== void 0)
      try {
        const h = await c(this, C, "f");
        r = h.usage.input_tokens + (h.usage.cache_creation_input_tokens ?? 0) + (h.usage.cache_read_input_tokens ?? 0) + h.usage.output_tokens;
      } catch {
        return !1;
      }
    const n = s.contextTokenThreshold ?? va;
    if (r < n)
      return !1;
    const o = s.model ?? c(this, R, "f").params.model, a = s.summaryPrompt ?? Aa, i = c(this, R, "f").params.messages;
    if (i[i.length - 1].role === "assistant") {
      const h = i[i.length - 1];
      if (Array.isArray(h.content)) {
        const p = h.content.filter((b) => b.type !== "tool_use");
        p.length === 0 ? i.pop() : h.content = p;
      }
    }
    const l = await this.client.beta.messages.create({
      model: o,
      messages: [
        ...i,
        {
          role: "user",
          content: [
            {
              type: "text",
              text: a
            }
          ]
        }
      ],
      max_tokens: c(this, R, "f").params.max_tokens
    }, {
      signal: c(this, N, "f").signal,
      headers: u([c(this, N, "f").headers, { "x-stainless-helper": "compaction" }])
    });
    if (((d = l.content[0]) == null ? void 0 : d.type) !== "text")
      throw new _("Expected text response for compaction");
    return c(this, R, "f").params.messages = [
      {
        role: "user",
        content: l.content
      }
    ], !0;
  }, Symbol.asyncIterator)]() {
    var t;
    if (c(this, we, "f"))
      throw new _("Cannot iterate over a consumed stream");
    f(this, we, !0), f(this, ue, !0), f(this, te, void 0);
    try {
      for (; ; ) {
        let s;
        try {
          if (c(this, R, "f").params.max_iterations && c(this, qe, "f") >= c(this, R, "f").params.max_iterations)
            break;
          f(this, ue, !1, "f"), f(this, te, void 0, "f"), f(this, qe, (t = c(this, qe, "f"), t++, t), "f"), f(this, C, void 0, "f");
          const { max_iterations: r, compactionControl: n, ...o } = c(this, R, "f").params;
          if (o.stream ? (s = this.client.beta.messages.stream({ ...o }, c(this, N, "f")), f(this, C, s.finalMessage(), "f"), c(this, C, "f").catch(() => {
          }), yield s) : (f(this, C, this.client.beta.messages.create({ ...o, stream: !1 }, c(this, N, "f")), "f"), yield c(this, C, "f")), !await c(this, De, "m", er).call(this)) {
            if (!c(this, ue, "f")) {
              const { role: l, content: d } = await c(this, C, "f");
              c(this, R, "f").params.messages.push({ role: l, content: d });
            }
            const i = await c(this, De, "m", us).call(this, c(this, R, "f").params.messages.at(-1));
            if (i)
              c(this, R, "f").params.messages.push(i);
            else if (!c(this, ue, "f"))
              break;
          }
        } finally {
          s && s.abort();
        }
      }
      if (!c(this, C, "f"))
        throw new _("ToolRunner concluded without a message from the server");
      c(this, ne, "f").resolve(await c(this, C, "f"));
    } catch (s) {
      throw f(this, we, !1), c(this, ne, "f").promise.catch(() => {
      }), c(this, ne, "f").reject(s), f(this, ne, tr()), s;
    }
  }
  setMessagesParams(t) {
    typeof t == "function" ? c(this, R, "f").params = t(c(this, R, "f").params) : c(this, R, "f").params = t, f(this, ue, !0), f(this, te, void 0);
  }
  setRequestOptions(t) {
    typeof t == "function" ? f(this, N, t(c(this, N, "f"))) : f(this, N, { ...c(this, N, "f"), ...t });
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
  async generateToolResponse(t = c(this, N, "f").signal) {
    const s = await c(this, C, "f") ?? this.params.messages.at(-1);
    return s ? c(this, De, "m", us).call(this, s, t) : null;
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
    return c(this, ne, "f").promise;
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
    if (!c(this, we, "f"))
      for await (const t of this)
        ;
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
    return c(this, R, "f").params;
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
  pushMessages(...t) {
    this.setMessagesParams((s) => ({
      ...s,
      messages: [...s.messages, ...t]
    }));
  }
  /**
   * Makes the ToolRunner directly awaitable, equivalent to calling .runUntilDone()
   * This allows using `await runner` instead of `await runner.runUntilDone()`
   */
  then(t, s) {
    return this.runUntilDone().then(t, s);
  }
}
us = async function(t, s = c(this, N, "f").signal) {
  return c(this, te, "f") !== void 0 ? c(this, te, "f") : (f(this, te, Oa(c(this, R, "f").params, t, {
    ...c(this, N, "f"),
    signal: s
  })), c(this, te, "f"));
};
async function Oa(e, t = e.messages.at(-1), s) {
  if (!t || t.role !== "assistant" || !t.content || typeof t.content == "string")
    return null;
  const r = t.content.filter((o) => o.type === "tool_use");
  return r.length === 0 ? null : {
    role: "user",
    content: await Promise.all(r.map(async (o) => {
      const a = e.tools.find((i) => ("name" in i ? i.name : i.mcp_server_name) === o.name);
      if (!a || !("run" in a))
        return {
          type: "tool_result",
          tool_use_id: o.id,
          content: `Error: Tool '${o.name}' not found`,
          is_error: !0
        };
      try {
        let i = o.input;
        "parse" in a && a.parse && (i = a.parse(i));
        const l = await a.run(i, {
          toolUseBlock: o,
          signal: s == null ? void 0 : s.signal
        });
        return {
          type: "tool_result",
          tool_use_id: o.id,
          content: l
        };
      } catch (i) {
        return {
          type: "tool_result",
          tool_use_id: o.id,
          content: i instanceof dn ? i.content : `Error: ${i instanceof Error ? i.message : String(i)}`,
          is_error: !0
        };
      }
    }))
  };
}
const sr = {
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
}, ja = ["claude-mythos-preview", "claude-opus-4-6"];
let st = class extends M {
  constructor() {
    super(...arguments), this.batches = new rn(this._client);
  }
  create(t, s) {
    const r = rr(t), { betas: n, ...o } = r;
    o.model in sr && console.warn(`The model '${o.model}' is deprecated and will reach end-of-life on ${sr[o.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`), ja.includes(o.model) && o.thinking && o.thinking.type === "enabled" && console.warn(`Using Claude with ${o.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);
    let a = this._client._options.timeout;
    if (!o.stream && a == null) {
      const l = nn[o.model] ?? void 0;
      a = this._client.calculateNonstreamingTimeout(o.max_tokens, l);
    }
    const i = Qr(o.tools, o.messages);
    return this._client.post("/v1/messages?beta=true", {
      body: o,
      timeout: a ?? 6e5,
      ...s,
      headers: u([
        { ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0 },
        i,
        s == null ? void 0 : s.headers
      ]),
      stream: r.stream ?? !1
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
  parse(t, s) {
    return s = {
      ...s,
      headers: u([
        { "anthropic-beta": [...t.betas ?? [], "structured-outputs-2025-12-15"].toString() },
        s == null ? void 0 : s.headers
      ])
    }, this.create(t, s).then((r) => an(r, t, { logger: this._client.logger ?? console }));
  }
  /**
   * Create a Message stream
   */
  stream(t, s) {
    return Ct.createMessage(this, t, s);
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
  countTokens(t, s) {
    const r = rr(t), { betas: n, ...o } = r;
    return this._client.post("/v1/messages/count_tokens?beta=true", {
      body: o,
      ...s,
      headers: u([
        { "anthropic-beta": [...n ?? [], "token-counting-2024-11-01"].toString() },
        s == null ? void 0 : s.headers
      ])
    });
  }
  toolRunner(t, s) {
    return new ln(this._client, t, s);
  }
};
function rr(e) {
  var r;
  if (!e.output_format)
    return e;
  if ((r = e.output_config) != null && r.format)
    throw new _("Both output_format and output_config.format were provided. Please use only output_config.format (output_format is deprecated).");
  const { output_format: t, ...s } = e;
  return {
    ...s,
    output_config: {
      ...e.output_config,
      format: t
    }
  };
}
st.Batches = rn;
st.BetaToolRunner = ln;
st.ToolError = dn;
class un extends M {
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
  list(t, s = {}, r) {
    const { betas: n, ...o } = s ?? {};
    return this._client.getAPIList(g`/v1/sessions/${t}/events?beta=true`, U, {
      query: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  send(t, s, r) {
    const { betas: n, ...o } = s;
    return this._client.post(g`/v1/sessions/${t}/events?beta=true`, {
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  stream(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/sessions/${t}/events/stream?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ]),
      stream: !0
    });
  }
}
class hn extends M {
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
  retrieve(t, s, r) {
    const { session_id: n, betas: o } = s;
    return this._client.get(g`/v1/sessions/${n}/resources/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  update(t, s, r) {
    const { session_id: n, betas: o, ...a } = s;
    return this._client.post(g`/v1/sessions/${n}/resources/${t}?beta=true`, {
      body: a,
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  list(t, s = {}, r) {
    const { betas: n, ...o } = s ?? {};
    return this._client.getAPIList(g`/v1/sessions/${t}/resources?beta=true`, U, {
      query: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  delete(t, s, r) {
    const { session_id: n, betas: o } = s;
    return this._client.delete(g`/v1/sessions/${n}/resources/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  add(t, s, r) {
    const { betas: n, ...o } = s;
    return this._client.post(g`/v1/sessions/${t}/resources?beta=true`, {
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
class Jt extends M {
  constructor() {
    super(...arguments), this.events = new un(this._client), this.resources = new hn(this._client);
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
  create(t, s) {
    const { betas: r, ...n } = t;
    return this._client.post("/v1/sessions?beta=true", {
      body: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  retrieve(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/sessions/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  update(t, s, r) {
    const { betas: n, ...o } = s;
    return this._client.post(g`/v1/sessions/${t}?beta=true`, {
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/sessions?beta=true", U, {
      query: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  delete(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.delete(g`/v1/sessions/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  archive(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.post(g`/v1/sessions/${t}/archive?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
Jt.Events = un;
Jt.Resources = hn;
class fn extends M {
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
  create(t, s = {}, r) {
    const { betas: n, ...o } = s ?? {};
    return this._client.post(g`/v1/skills/${t}/versions?beta=true`, ws({
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "skills-2025-10-02"].toString() },
        r == null ? void 0 : r.headers
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
  retrieve(t, s, r) {
    const { skill_id: n, betas: o } = s;
    return this._client.get(g`/v1/skills/${n}/versions/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "skills-2025-10-02"].toString() },
        r == null ? void 0 : r.headers
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
  list(t, s = {}, r) {
    const { betas: n, ...o } = s ?? {};
    return this._client.getAPIList(g`/v1/skills/${t}/versions?beta=true`, U, {
      query: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "skills-2025-10-02"].toString() },
        r == null ? void 0 : r.headers
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
  delete(t, s, r) {
    const { skill_id: n, betas: o } = s;
    return this._client.delete(g`/v1/skills/${n}/versions/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "skills-2025-10-02"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
class Is extends M {
  constructor() {
    super(...arguments), this.versions = new fn(this._client);
  }
  /**
   * Create Skill
   *
   * @example
   * ```ts
   * const skill = await client.beta.skills.create();
   * ```
   */
  create(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.post("/v1/skills?beta=true", ws({
      body: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "skills-2025-10-02"].toString() },
        s == null ? void 0 : s.headers
      ])
    }, this._client, !1));
  }
  /**
   * Get Skill
   *
   * @example
   * ```ts
   * const skill = await client.beta.skills.retrieve('skill_id');
   * ```
   */
  retrieve(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/skills/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "skills-2025-10-02"].toString() },
        r == null ? void 0 : r.headers
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/skills?beta=true", U, {
      query: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "skills-2025-10-02"].toString() },
        s == null ? void 0 : s.headers
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
  delete(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.delete(g`/v1/skills/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "skills-2025-10-02"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
Is.Versions = fn;
class mn extends M {
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
  create(t, s, r) {
    const { betas: n, ...o } = s;
    return this._client.post(g`/v1/vaults/${t}/credentials?beta=true`, {
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  retrieve(t, s, r) {
    const { vault_id: n, betas: o } = s;
    return this._client.get(g`/v1/vaults/${n}/credentials/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  update(t, s, r) {
    const { vault_id: n, betas: o, ...a } = s;
    return this._client.post(g`/v1/vaults/${n}/credentials/${t}?beta=true`, {
      body: a,
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  list(t, s = {}, r) {
    const { betas: n, ...o } = s ?? {};
    return this._client.getAPIList(g`/v1/vaults/${t}/credentials?beta=true`, U, {
      query: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  delete(t, s, r) {
    const { vault_id: n, betas: o } = s;
    return this._client.delete(g`/v1/vaults/${n}/credentials/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  archive(t, s, r) {
    const { vault_id: n, betas: o } = s;
    return this._client.post(g`/v1/vaults/${n}/credentials/${t}/archive?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...o ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
class Ms extends M {
  constructor() {
    super(...arguments), this.credentials = new mn(this._client);
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
  create(t, s) {
    const { betas: r, ...n } = t;
    return this._client.post("/v1/vaults?beta=true", {
      body: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  retrieve(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/vaults/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  update(t, s, r) {
    const { betas: n, ...o } = s;
    return this._client.post(g`/v1/vaults/${t}?beta=true`, {
      body: o,
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/vaults?beta=true", U, {
      query: n,
      ...s,
      headers: u([
        { "anthropic-beta": [...r ?? [], "managed-agents-2026-04-01"].toString() },
        s == null ? void 0 : s.headers
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
  delete(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.delete(g`/v1/vaults/${t}?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
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
  archive(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.post(g`/v1/vaults/${t}/archive?beta=true`, {
      ...r,
      headers: u([
        { "anthropic-beta": [...n ?? [], "managed-agents-2026-04-01"].toString() },
        r == null ? void 0 : r.headers
      ])
    });
  }
}
Ms.Credentials = mn;
class J extends M {
  constructor() {
    super(...arguments), this.models = new Gr(this._client), this.messages = new st(this._client), this.agents = new Ss(this._client), this.environments = new zr(this._client), this.sessions = new Jt(this._client), this.vaults = new Ms(this._client), this.memoryStores = new Kt(this._client), this.files = new Yr(this._client), this.skills = new Is(this._client), this.userProfiles = new Zr(this._client);
  }
}
J.Models = Gr;
J.Messages = st;
J.Agents = Ss;
J.Environments = zr;
J.Sessions = Jt;
J.Vaults = Ms;
J.MemoryStores = Kt;
J.Files = Yr;
J.Skills = Is;
J.UserProfiles = Zr;
class gn extends M {
  create(t, s) {
    const { betas: r, ...n } = t;
    return this._client.post("/v1/complete", {
      body: n,
      timeout: this._client._options.timeout ?? 6e5,
      ...s,
      headers: u([
        { ...(r == null ? void 0 : r.toString()) != null ? { "anthropic-beta": r == null ? void 0 : r.toString() } : void 0 },
        s == null ? void 0 : s.headers
      ]),
      stream: t.stream ?? !1
    });
  }
}
function pn(e) {
  var t;
  return (t = e == null ? void 0 : e.output_config) == null ? void 0 : t.format;
}
function nr(e, t, s) {
  const r = pn(t);
  return !t || !("parse" in (r ?? {})) ? {
    ...e,
    content: e.content.map((n) => n.type === "text" ? Object.defineProperty({ ...n }, "parsed_output", {
      value: null,
      enumerable: !1
    }) : n),
    parsed_output: null
  } : _n(e, t);
}
function _n(e, t, s) {
  let r = null;
  const n = e.content.map((o) => {
    if (o.type === "text") {
      const a = La(t, o.text);
      return r === null && (r = a), Object.defineProperty({ ...o }, "parsed_output", {
        value: a,
        enumerable: !1
      });
    }
    return o;
  });
  return {
    ...e,
    content: n,
    parsed_output: r
  };
}
function La(e, t) {
  const s = pn(e);
  if ((s == null ? void 0 : s.type) !== "json_schema")
    return null;
  try {
    return "parse" in s ? s.parse(t) : JSON.parse(t);
  } catch (r) {
    throw new _(`Failed to parse structured output: ${r}`);
  }
}
var X, oe, Se, Be, gt, Fe, We, pt, Ke, ee, Xe, _t, yt, he, bt, wt, Je, es, or, ts, ss, rs, ns, ar;
const ir = "__json_buf";
function cr(e) {
  return e.type === "tool_use" || e.type === "server_tool_use";
}
class Dt {
  constructor(t, s) {
    X.add(this), this.messages = [], this.receivedMessages = [], oe.set(this, void 0), Se.set(this, null), this.controller = new AbortController(), Be.set(this, void 0), gt.set(this, () => {
    }), Fe.set(this, () => {
    }), We.set(this, void 0), pt.set(this, () => {
    }), Ke.set(this, () => {
    }), ee.set(this, {}), Xe.set(this, !1), _t.set(this, !1), yt.set(this, !1), he.set(this, !1), bt.set(this, void 0), wt.set(this, void 0), Je.set(this, void 0), ts.set(this, (r) => {
      if (f(this, _t, !0), Ye(r) && (r = new V()), r instanceof V)
        return f(this, yt, !0), this._emit("abort", r);
      if (r instanceof _)
        return this._emit("error", r);
      if (r instanceof Error) {
        const n = new _(r.message);
        return n.cause = r, this._emit("error", n);
      }
      return this._emit("error", new _(String(r)));
    }), f(this, Be, new Promise((r, n) => {
      f(this, gt, r, "f"), f(this, Fe, n, "f");
    })), f(this, We, new Promise((r, n) => {
      f(this, pt, r, "f"), f(this, Ke, n, "f");
    })), c(this, Be, "f").catch(() => {
    }), c(this, We, "f").catch(() => {
    }), f(this, Se, t), f(this, Je, (s == null ? void 0 : s.logger) ?? console);
  }
  get response() {
    return c(this, bt, "f");
  }
  get request_id() {
    return c(this, wt, "f");
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
    f(this, he, !0);
    const t = await c(this, Be, "f");
    if (!t)
      throw new Error("Could not resolve a `Response` object");
    return {
      data: this,
      response: t,
      request_id: t.headers.get("request-id")
    };
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(t) {
    const s = new Dt(null);
    return s._run(() => s._fromReadableStream(t)), s;
  }
  static createMessage(t, s, r, { logger: n } = {}) {
    const o = new Dt(s, { logger: n });
    for (const a of s.messages)
      o._addMessageParam(a);
    return f(o, Se, { ...s, stream: !0 }), o._run(() => o._createMessage(t, { ...s, stream: !0 }, { ...r, headers: { ...r == null ? void 0 : r.headers, "X-Stainless-Helper-Method": "stream" } })), o;
  }
  _run(t) {
    t().then(() => {
      this._emitFinal(), this._emit("end");
    }, c(this, ts, "f"));
  }
  _addMessageParam(t) {
    this.messages.push(t);
  }
  _addMessage(t, s = !0) {
    this.receivedMessages.push(t), s && this._emit("message", t);
  }
  async _createMessage(t, s, r) {
    var a;
    const n = r == null ? void 0 : r.signal;
    let o;
    n && (n.aborted && this.controller.abort(), o = this.controller.abort.bind(this.controller), n.addEventListener("abort", o));
    try {
      c(this, X, "m", ss).call(this);
      const { response: i, data: l } = await t.create({ ...s, stream: !0 }, { ...r, signal: this.controller.signal }).withResponse();
      this._connected(i);
      for await (const d of l)
        c(this, X, "m", rs).call(this, d);
      if ((a = l.controller.signal) != null && a.aborted)
        throw new V();
      c(this, X, "m", ns).call(this);
    } finally {
      n && o && n.removeEventListener("abort", o);
    }
  }
  _connected(t) {
    this.ended || (f(this, bt, t), f(this, wt, t == null ? void 0 : t.headers.get("request-id")), c(this, gt, "f").call(this, t), this._emit("connect"));
  }
  get ended() {
    return c(this, Xe, "f");
  }
  get errored() {
    return c(this, _t, "f");
  }
  get aborted() {
    return c(this, yt, "f");
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
  on(t, s) {
    return (c(this, ee, "f")[t] || (c(this, ee, "f")[t] = [])).push({ listener: s }), this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this MessageStream, so that calls can be chained
   */
  off(t, s) {
    const r = c(this, ee, "f")[t];
    if (!r)
      return this;
    const n = r.findIndex((o) => o.listener === s);
    return n >= 0 && r.splice(n, 1), this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this MessageStream, so that calls can be chained
   */
  once(t, s) {
    return (c(this, ee, "f")[t] || (c(this, ee, "f")[t] = [])).push({ listener: s, once: !0 }), this;
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
  emitted(t) {
    return new Promise((s, r) => {
      f(this, he, !0), t !== "error" && this.once("error", r), this.once(t, s);
    });
  }
  async done() {
    f(this, he, !0), await c(this, We, "f");
  }
  get currentMessage() {
    return c(this, oe, "f");
  }
  /**
   * @returns a promise that resolves with the the final assistant Message response,
   * or rejects if an error occurred or the stream ended prematurely without producing a Message.
   * If structured outputs were used, this will be a ParsedMessage with a `parsed_output` field.
   */
  async finalMessage() {
    return await this.done(), c(this, X, "m", es).call(this);
  }
  /**
   * @returns a promise that resolves with the the final assistant Message's text response, concatenated
   * together if there are more than one text blocks.
   * Rejects if an error occurred or the stream ended prematurely without producing a Message.
   */
  async finalText() {
    return await this.done(), c(this, X, "m", or).call(this);
  }
  _emit(t, ...s) {
    if (c(this, Xe, "f"))
      return;
    t === "end" && (f(this, Xe, !0), c(this, pt, "f").call(this));
    const r = c(this, ee, "f")[t];
    if (r && (c(this, ee, "f")[t] = r.filter((n) => !n.once), r.forEach(({ listener: n }) => n(...s))), t === "abort") {
      const n = s[0];
      !c(this, he, "f") && !(r != null && r.length) && Promise.reject(n), c(this, Fe, "f").call(this, n), c(this, Ke, "f").call(this, n), this._emit("end");
      return;
    }
    if (t === "error") {
      const n = s[0];
      !c(this, he, "f") && !(r != null && r.length) && Promise.reject(n), c(this, Fe, "f").call(this, n), c(this, Ke, "f").call(this, n), this._emit("end");
    }
  }
  _emitFinal() {
    this.receivedMessages.at(-1) && this._emit("finalMessage", c(this, X, "m", es).call(this));
  }
  async _fromReadableStream(t, s) {
    var o;
    const r = s == null ? void 0 : s.signal;
    let n;
    r && (r.aborted && this.controller.abort(), n = this.controller.abort.bind(this.controller), r.addEventListener("abort", n));
    try {
      c(this, X, "m", ss).call(this), this._connected(null);
      const a = Y.fromReadableStream(t, this.controller);
      for await (const i of a)
        c(this, X, "m", rs).call(this, i);
      if ((o = a.controller.signal) != null && o.aborted)
        throw new V();
      c(this, X, "m", ns).call(this);
    } finally {
      r && n && r.removeEventListener("abort", n);
    }
  }
  [(oe = /* @__PURE__ */ new WeakMap(), Se = /* @__PURE__ */ new WeakMap(), Be = /* @__PURE__ */ new WeakMap(), gt = /* @__PURE__ */ new WeakMap(), Fe = /* @__PURE__ */ new WeakMap(), We = /* @__PURE__ */ new WeakMap(), pt = /* @__PURE__ */ new WeakMap(), Ke = /* @__PURE__ */ new WeakMap(), ee = /* @__PURE__ */ new WeakMap(), Xe = /* @__PURE__ */ new WeakMap(), _t = /* @__PURE__ */ new WeakMap(), yt = /* @__PURE__ */ new WeakMap(), he = /* @__PURE__ */ new WeakMap(), bt = /* @__PURE__ */ new WeakMap(), wt = /* @__PURE__ */ new WeakMap(), Je = /* @__PURE__ */ new WeakMap(), ts = /* @__PURE__ */ new WeakMap(), X = /* @__PURE__ */ new WeakSet(), es = function() {
    if (this.receivedMessages.length === 0)
      throw new _("stream ended without producing a Message with role=assistant");
    return this.receivedMessages.at(-1);
  }, or = function() {
    if (this.receivedMessages.length === 0)
      throw new _("stream ended without producing a Message with role=assistant");
    const s = this.receivedMessages.at(-1).content.filter((r) => r.type === "text").map((r) => r.text);
    if (s.length === 0)
      throw new _("stream ended without producing a content block with type=text");
    return s.join(" ");
  }, ss = function() {
    this.ended || f(this, oe, void 0);
  }, rs = function(s) {
    if (this.ended)
      return;
    const r = c(this, X, "m", ar).call(this, s);
    switch (this._emit("streamEvent", s, r), s.type) {
      case "content_block_delta": {
        const n = r.content.at(-1);
        switch (s.delta.type) {
          case "text_delta": {
            n.type === "text" && this._emit("text", s.delta.text, n.text || "");
            break;
          }
          case "citations_delta": {
            n.type === "text" && this._emit("citation", s.delta.citation, n.citations ?? []);
            break;
          }
          case "input_json_delta": {
            cr(n) && n.input && this._emit("inputJson", s.delta.partial_json, n.input);
            break;
          }
          case "thinking_delta": {
            n.type === "thinking" && this._emit("thinking", s.delta.thinking, n.thinking);
            break;
          }
          case "signature_delta": {
            n.type === "thinking" && this._emit("signature", n.signature);
            break;
          }
          default:
            s.delta;
        }
        break;
      }
      case "message_stop": {
        this._addMessageParam(r), this._addMessage(nr(r, c(this, Se, "f"), { logger: c(this, Je, "f") }), !0);
        break;
      }
      case "content_block_stop": {
        this._emit("contentBlock", r.content.at(-1));
        break;
      }
      case "message_start": {
        f(this, oe, r);
        break;
      }
    }
  }, ns = function() {
    if (this.ended)
      throw new _("stream has ended, this shouldn't happen");
    const s = c(this, oe, "f");
    if (!s)
      throw new _("request ended without sending any chunks");
    return f(this, oe, void 0), nr(s, c(this, Se, "f"), { logger: c(this, Je, "f") });
  }, ar = function(s) {
    let r = c(this, oe, "f");
    if (s.type === "message_start") {
      if (r)
        throw new _(`Unexpected event order, got ${s.type} before receiving "message_stop"`);
      return s.message;
    }
    if (!r)
      throw new _(`Unexpected event order, got ${s.type} before "message_start"`);
    switch (s.type) {
      case "message_stop":
        return r;
      case "message_delta":
        return r.stop_reason = s.delta.stop_reason, r.stop_sequence = s.delta.stop_sequence, r.usage.output_tokens = s.usage.output_tokens, s.usage.input_tokens != null && (r.usage.input_tokens = s.usage.input_tokens), s.usage.cache_creation_input_tokens != null && (r.usage.cache_creation_input_tokens = s.usage.cache_creation_input_tokens), s.usage.cache_read_input_tokens != null && (r.usage.cache_read_input_tokens = s.usage.cache_read_input_tokens), s.usage.server_tool_use != null && (r.usage.server_tool_use = s.usage.server_tool_use), r;
      case "content_block_start":
        return r.content.push({ ...s.content_block }), r;
      case "content_block_delta": {
        const n = r.content.at(s.index);
        switch (s.delta.type) {
          case "text_delta": {
            (n == null ? void 0 : n.type) === "text" && (r.content[s.index] = {
              ...n,
              text: (n.text || "") + s.delta.text
            });
            break;
          }
          case "citations_delta": {
            (n == null ? void 0 : n.type) === "text" && (r.content[s.index] = {
              ...n,
              citations: [...n.citations ?? [], s.delta.citation]
            });
            break;
          }
          case "input_json_delta": {
            if (n && cr(n)) {
              let o = n[ir] || "";
              o += s.delta.partial_json;
              const a = { ...n };
              Object.defineProperty(a, ir, {
                value: o,
                enumerable: !1,
                writable: !0
              }), o && (a.input = cn(o)), r.content[s.index] = a;
            }
            break;
          }
          case "thinking_delta": {
            (n == null ? void 0 : n.type) === "thinking" && (r.content[s.index] = {
              ...n,
              thinking: n.thinking + s.delta.thinking
            });
            break;
          }
          case "signature_delta": {
            (n == null ? void 0 : n.type) === "thinking" && (r.content[s.index] = {
              ...n,
              signature: s.delta.signature
            });
            break;
          }
          default:
            s.delta;
        }
        return r;
      }
      case "content_block_stop":
        return r;
    }
  }, Symbol.asyncIterator)]() {
    const t = [], s = [];
    let r = !1;
    return this.on("streamEvent", (n) => {
      const o = s.shift();
      o ? o.resolve(n) : t.push(n);
    }), this.on("end", () => {
      r = !0;
      for (const n of s)
        n.resolve(void 0);
      s.length = 0;
    }), this.on("abort", (n) => {
      r = !0;
      for (const o of s)
        o.reject(n);
      s.length = 0;
    }), this.on("error", (n) => {
      r = !0;
      for (const o of s)
        o.reject(n);
      s.length = 0;
    }), {
      next: async () => t.length ? { value: t.shift(), done: !1 } : r ? { value: void 0, done: !0 } : new Promise((o, a) => s.push({ resolve: o, reject: a })).then((o) => o ? { value: o, done: !1 } : { value: void 0, done: !0 }),
      return: async () => (this.abort(), { value: void 0, done: !0 })
    };
  }
  toReadableStream() {
    return new Y(this[Symbol.asyncIterator].bind(this), this.controller).toReadableStream();
  }
}
class yn extends M {
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
  create(t, s) {
    return this._client.post("/v1/messages/batches", { body: t, ...s });
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
  retrieve(t, s) {
    return this._client.get(g`/v1/messages/batches/${t}`, s);
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
  list(t = {}, s) {
    return this._client.getAPIList("/v1/messages/batches", tt, { query: t, ...s });
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
  delete(t, s) {
    return this._client.delete(g`/v1/messages/batches/${t}`, s);
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
  cancel(t, s) {
    return this._client.post(g`/v1/messages/batches/${t}/cancel`, s);
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
  async results(t, s) {
    const r = await this.retrieve(t);
    if (!r.results_url)
      throw new _(`No batch \`results_url\`; Has it finished processing? ${r.processing_status} - ${r.id}`);
    return this._client.get(r.results_url, {
      ...s,
      headers: u([{ Accept: "application/binary" }, s == null ? void 0 : s.headers]),
      stream: !0,
      __binaryResponse: !0
    })._thenUnwrap((n, o) => Xt.fromResponse(o.response, o.controller));
  }
}
class Ts extends M {
  constructor() {
    super(...arguments), this.batches = new yn(this._client);
  }
  create(t, s) {
    t.model in dr && console.warn(`The model '${t.model}' is deprecated and will reach end-of-life on ${dr[t.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`), Pa.includes(t.model) && t.thinking && t.thinking.type === "enabled" && console.warn(`Using Claude with ${t.model} and 'thinking.type=enabled' is deprecated. Use 'thinking.type=adaptive' instead which results in better model performance in our testing: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking`);
    let r = this._client._options.timeout;
    if (!t.stream && r == null) {
      const o = nn[t.model] ?? void 0;
      r = this._client.calculateNonstreamingTimeout(t.max_tokens, o);
    }
    const n = Qr(t.tools, t.messages);
    return this._client.post("/v1/messages", {
      body: t,
      timeout: r ?? 6e5,
      ...s,
      headers: u([n, s == null ? void 0 : s.headers]),
      stream: t.stream ?? !1
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
  parse(t, s) {
    return this.create(t, s).then((r) => _n(r, t, { logger: this._client.logger ?? console }));
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
  stream(t, s) {
    return Dt.createMessage(this, t, s, { logger: this._client.logger ?? console });
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
  countTokens(t, s) {
    return this._client.post("/v1/messages/count_tokens", { body: t, ...s });
  }
}
const dr = {
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
}, Pa = ["claude-mythos-preview", "claude-opus-4-6"];
Ts.Batches = yn;
class bn extends M {
  /**
   * Get a specific model.
   *
   * The Models API response can be used to determine information about a specific
   * model or resolve a model alias to a model ID.
   */
  retrieve(t, s = {}, r) {
    const { betas: n } = s ?? {};
    return this._client.get(g`/v1/models/${t}`, {
      ...r,
      headers: u([
        { ...(n == null ? void 0 : n.toString()) != null ? { "anthropic-beta": n == null ? void 0 : n.toString() } : void 0 },
        r == null ? void 0 : r.headers
      ])
    });
  }
  /**
   * List available models.
   *
   * The Models API response can be used to determine which models are available for
   * use in the API. More recently released models are listed first.
   */
  list(t = {}, s) {
    const { betas: r, ...n } = t ?? {};
    return this._client.getAPIList("/v1/models", tt, {
      query: n,
      ...s,
      headers: u([
        { ...(r == null ? void 0 : r.toString()) != null ? { "anthropic-beta": r == null ? void 0 : r.toString() } : void 0 },
        s == null ? void 0 : s.headers
      ])
    });
  }
}
const He = (e) => {
  var t, s, r, n, o;
  if (typeof globalThis.process < "u")
    return ((s = (t = globalThis.process.env) == null ? void 0 : t[e]) == null ? void 0 : s.trim()) || void 0;
  if (typeof globalThis.Deno < "u")
    return ((o = (n = (r = globalThis.Deno.env) == null ? void 0 : r.get) == null ? void 0 : n.call(r, e)) == null ? void 0 : o.trim()) || void 0;
};
var hs, ks, jt, wn;
const $a = "\\n\\nHuman:", Na = "\\n\\nAssistant:";
class k {
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
  constructor({ baseURL: t = He("ANTHROPIC_BASE_URL"), apiKey: s = He("ANTHROPIC_API_KEY") ?? null, authToken: r = He("ANTHROPIC_AUTH_TOKEN") ?? null, ...n } = {}) {
    hs.add(this), jt.set(this, void 0);
    const o = {
      apiKey: s,
      authToken: r,
      ...n,
      baseURL: t || "https://api.anthropic.com"
    };
    if (!o.dangerouslyAllowBrowser && Yo())
      throw new _(`It looks like you're running in a browser-like environment.

This is disabled by default, as it risks exposing your secret API credentials to attackers.
If you understand the risks and have appropriate mitigations in place,
you can set the \`dangerouslyAllowBrowser\` option to \`true\`, e.g.,

new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
`);
    this.baseURL = o.baseURL, this.timeout = o.timeout ?? ks.DEFAULT_TIMEOUT, this.logger = o.logger ?? console;
    const a = "warn";
    this.logLevel = a, this.logLevel = Xs(o.logLevel, "ClientOptions.logLevel", this) ?? Xs(He("ANTHROPIC_LOG"), "process.env['ANTHROPIC_LOG']", this) ?? a, this.fetchOptions = o.fetchOptions, this.maxRetries = o.maxRetries ?? 2, this.fetch = o.fetch ?? sa(), f(this, jt, na);
    const i = He("ANTHROPIC_CUSTOM_HEADERS");
    if (i) {
      const l = {};
      for (const d of i.split(`
`)) {
        const h = d.indexOf(":");
        h >= 0 && (l[d.substring(0, h).trim()] = d.substring(h + 1).trim());
      }
      o.defaultHeaders = { ...l, ...o.defaultHeaders };
    }
    this._options = o, this.apiKey = typeof s == "string" ? s : null, this.authToken = r;
  }
  /**
   * Create a new client instance re-using the same options given to the current client with optional overriding.
   */
  withOptions(t) {
    return new this.constructor({
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
      ...t
    });
  }
  defaultQuery() {
    return this._options.defaultQuery;
  }
  validateHeaders({ values: t, nulls: s }) {
    if (!(t.get("x-api-key") || t.get("authorization")) && !(this.apiKey && t.get("x-api-key")) && !s.has("x-api-key") && !(this.authToken && t.get("authorization")) && !s.has("authorization"))
      throw new Error('Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted');
  }
  async authHeaders(t) {
    return u([await this.apiKeyAuth(t), await this.bearerAuth(t)]);
  }
  async apiKeyAuth(t) {
    if (this.apiKey != null)
      return u([{ "X-Api-Key": this.apiKey }]);
  }
  async bearerAuth(t) {
    if (this.authToken != null)
      return u([{ Authorization: `Bearer ${this.authToken}` }]);
  }
  /**
   * Basic re-implementation of `qs.stringify` for primitive types.
   */
  stringifyQuery(t) {
    return oa(t);
  }
  getUserAgent() {
    return `${this.constructor.name}/JS ${Me}`;
  }
  defaultIdempotencyKey() {
    return `stainless-node-retry-${Rr()}`;
  }
  makeStatusError(t, s, r, n) {
    return P.generate(t, s, r, n);
  }
  buildURL(t, s, r) {
    const n = !c(this, hs, "m", wn).call(this) && r || this.baseURL, o = Ho(t) ? new URL(t) : new URL(n + (n.endsWith("/") && t.startsWith("/") ? t.slice(1) : t)), a = this.defaultQuery(), i = Object.fromEntries(o.searchParams);
    return (!Cs(a) || !Cs(i)) && (s = { ...i, ...a, ...s }), typeof s == "object" && s && !Array.isArray(s) && (o.search = this.stringifyQuery(s)), o.toString();
  }
  _calculateNonstreamingTimeout(t) {
    if (3600 * t / 128e3 > 600)
      throw new _("Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#streaming-responses for more details");
    return 600 * 1e3;
  }
  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
   */
  async prepareOptions(t) {
  }
  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  async prepareRequest(t, { url: s, options: r }) {
  }
  get(t, s) {
    return this.methodRequest("get", t, s);
  }
  post(t, s) {
    return this.methodRequest("post", t, s);
  }
  patch(t, s) {
    return this.methodRequest("patch", t, s);
  }
  put(t, s) {
    return this.methodRequest("put", t, s);
  }
  delete(t, s) {
    return this.methodRequest("delete", t, s);
  }
  methodRequest(t, s, r) {
    return this.request(Promise.resolve(r).then((n) => ({ method: t, path: s, ...n })));
  }
  request(t, s = null) {
    return new Wt(this, this.makeRequest(t, s, void 0));
  }
  async makeRequest(t, s, r) {
    var v, A;
    const n = await t, o = n.maxRetries ?? this.maxRetries;
    s == null && (s = o), await this.prepareOptions(n);
    const { req: a, url: i, timeout: l } = await this.buildRequest(n, {
      retryCount: o - s
    });
    await this.prepareRequest(a, { url: i, options: n });
    const d = "log_" + (Math.random() * (1 << 24) | 0).toString(16).padStart(6, "0"), h = r === void 0 ? "" : `, retryOf: ${r}`, p = Date.now();
    if ($(this).debug(`[${d}] sending request`, fe({
      retryOfRequestLogID: r,
      method: n.method,
      url: i,
      options: n,
      headers: a.headers
    })), (v = n.signal) != null && v.aborted)
      throw new V();
    const b = new AbortController(), m = await this.fetchWithTimeout(i, a, l, b).catch(as), w = Date.now();
    if (m instanceof globalThis.Error) {
      const E = `retrying, ${s} attempts remaining`;
      if ((A = n.signal) != null && A.aborted)
        throw new V();
      const T = Ye(m) || /timed? ?out/i.test(String(m) + ("cause" in m ? String(m.cause) : ""));
      if (s)
        return $(this).info(`[${d}] connection ${T ? "timed out" : "failed"} - ${E}`), $(this).debug(`[${d}] connection ${T ? "timed out" : "failed"} (${E})`, fe({
          retryOfRequestLogID: r,
          url: i,
          durationMs: w - p,
          message: m.message
        })), this.retryRequest(n, s, r ?? d);
      throw $(this).info(`[${d}] connection ${T ? "timed out" : "failed"} - error; no more retries left`), $(this).debug(`[${d}] connection ${T ? "timed out" : "failed"} (error; no more retries left)`, fe({
        retryOfRequestLogID: r,
        url: i,
        durationMs: w - p,
        message: m.message
      })), T ? new xr() : new Ft({ cause: m });
    }
    const S = [...m.headers.entries()].filter(([E]) => E === "request-id").map(([E, T]) => ", " + E + ": " + JSON.stringify(T)).join(""), x = `[${d}${h}${S}] ${a.method} ${i} ${m.ok ? "succeeded" : "failed"} with status ${m.status} in ${w - p}ms`;
    if (!m.ok) {
      const E = await this.shouldRetry(m);
      if (s && E) {
        const G = `retrying, ${s} attempts remaining`;
        return await ra(m.body), $(this).info(`${x} - ${G}`), $(this).debug(`[${d}] response error (${G})`, fe({
          retryOfRequestLogID: r,
          url: m.url,
          status: m.status,
          headers: m.headers,
          durationMs: w - p
        })), this.retryRequest(n, s, r ?? d, m.headers);
      }
      const T = E ? "error; no more retries left" : "error; not retryable";
      $(this).info(`${x} - ${T}`);
      const W = await m.text().catch((G) => as(G).message), H = Ur(W), ce = H ? void 0 : W;
      throw $(this).debug(`[${d}] response error (${T})`, fe({
        retryOfRequestLogID: r,
        url: m.url,
        status: m.status,
        headers: m.headers,
        message: ce,
        durationMs: Date.now() - p
      })), this.makeStatusError(m.status, H, ce, m.headers);
    }
    return $(this).info(x), $(this).debug(`[${d}] response start`, fe({
      retryOfRequestLogID: r,
      url: m.url,
      status: m.status,
      headers: m.headers,
      durationMs: w - p
    })), { response: m, options: n, controller: b, requestLogID: d, retryOfRequestLogID: r, startTime: p };
  }
  getAPIList(t, s, r) {
    return this.requestAPIList(s, r && "then" in r ? r.then((n) => ({ method: "get", path: t, ...n })) : { method: "get", path: t, ...r });
  }
  requestAPIList(t, s) {
    const r = this.makeRequest(s, null, void 0);
    return new ma(this, r, t);
  }
  async fetchWithTimeout(t, s, r, n) {
    const { signal: o, method: a, ...i } = s || {}, l = this._makeAbort(n);
    o && o.addEventListener("abort", l, { once: !0 });
    const d = setTimeout(l, r), h = globalThis.ReadableStream && i.body instanceof globalThis.ReadableStream || typeof i.body == "object" && i.body !== null && Symbol.asyncIterator in i.body, p = {
      signal: n.signal,
      ...h ? { duplex: "half" } : {},
      method: "GET",
      ...i
    };
    a && (p.method = a.toUpperCase());
    try {
      return await this.fetch.call(void 0, t, p);
    } finally {
      clearTimeout(d);
    }
  }
  async shouldRetry(t) {
    const s = t.headers.get("x-should-retry");
    return s === "true" ? !0 : s === "false" ? !1 : t.status === 408 || t.status === 409 || t.status === 429 || t.status >= 500;
  }
  async retryRequest(t, s, r, n) {
    let o;
    const a = n == null ? void 0 : n.get("retry-after-ms");
    if (a) {
      const l = parseFloat(a);
      Number.isNaN(l) || (o = l);
    }
    const i = n == null ? void 0 : n.get("retry-after");
    if (i && !o) {
      const l = parseFloat(i);
      Number.isNaN(l) ? o = Date.parse(i) - Date.now() : o = l * 1e3;
    }
    if (o === void 0) {
      const l = t.maxRetries ?? this.maxRetries;
      o = this.calculateDefaultRetryTimeoutMillis(s, l);
    }
    return await Qo(o), this.makeRequest(t, s - 1, r);
  }
  calculateDefaultRetryTimeoutMillis(t, s) {
    const o = s - t, a = Math.min(0.5 * Math.pow(2, o), 8), i = 1 - Math.random() * 0.25;
    return a * i * 1e3;
  }
  calculateNonstreamingTimeout(t, s) {
    if (36e5 * t / 128e3 > 6e5 || s != null && t > s)
      throw new _("Streaming is required for operations that may take longer than 10 minutes. See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details");
    return 6e5;
  }
  async buildRequest(t, { retryCount: s = 0 } = {}) {
    const r = { ...t }, { method: n, path: o, query: a, defaultBaseURL: i } = r, l = this.buildURL(o, a, i);
    "timeout" in r && Vo("timeout", r.timeout), r.timeout = r.timeout ?? this.timeout;
    const { bodyHeaders: d, body: h } = this.buildBody({ options: r }), p = await this.buildHeaders({ options: t, method: n, bodyHeaders: d, retryCount: s });
    return { req: {
      method: n,
      headers: p,
      ...r.signal && { signal: r.signal },
      ...globalThis.ReadableStream && h instanceof globalThis.ReadableStream && { duplex: "half" },
      ...h && { body: h },
      ...this.fetchOptions ?? {},
      ...r.fetchOptions ?? {}
    }, url: l, timeout: r.timeout };
  }
  async buildHeaders({ options: t, method: s, bodyHeaders: r, retryCount: n }) {
    let o = {};
    this.idempotencyHeader && s !== "get" && (t.idempotencyKey || (t.idempotencyKey = this.defaultIdempotencyKey()), o[this.idempotencyHeader] = t.idempotencyKey);
    const a = u([
      o,
      {
        Accept: "application/json",
        "User-Agent": this.getUserAgent(),
        "X-Stainless-Retry-Count": String(n),
        ...t.timeout ? { "X-Stainless-Timeout": String(Math.trunc(t.timeout / 1e3)) } : {},
        ...ta(),
        ...this._options.dangerouslyAllowBrowser ? { "anthropic-dangerous-direct-browser-access": "true" } : void 0,
        "anthropic-version": "2023-06-01"
      },
      await this.authHeaders(t),
      this._options.defaultHeaders,
      r,
      t.headers
    ]);
    return this.validateHeaders(a), a.values;
  }
  _makeAbort(t) {
    return () => t.abort();
  }
  buildBody({ options: { body: t, headers: s } }) {
    if (!t)
      return { bodyHeaders: void 0, body: void 0 };
    const r = u([s]);
    return (
      // Pass raw type verbatim
      ArrayBuffer.isView(t) || t instanceof ArrayBuffer || t instanceof DataView || typeof t == "string" && // Preserve legacy string encoding behavior for now
      r.values.has("content-type") || // `Blob` is superset of `File`
      globalThis.Blob && t instanceof globalThis.Blob || // `FormData` -> `multipart/form-data`
      t instanceof FormData || // `URLSearchParams` -> `application/x-www-form-urlencoded`
      t instanceof URLSearchParams || // Send chunked stream (each chunk has own `length`)
      globalThis.ReadableStream && t instanceof globalThis.ReadableStream ? { bodyHeaders: void 0, body: t } : typeof t == "object" && (Symbol.asyncIterator in t || Symbol.iterator in t && "next" in t && typeof t.next == "function") ? { bodyHeaders: void 0, body: Dr(t) } : typeof t == "object" && r.values.get("content-type") === "application/x-www-form-urlencoded" ? {
        bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
        body: this.stringifyQuery(t)
      } : c(this, jt, "f").call(this, { body: t, headers: r })
    );
  }
}
ks = k, jt = /* @__PURE__ */ new WeakMap(), hs = /* @__PURE__ */ new WeakSet(), wn = function() {
  return this.baseURL !== "https://api.anthropic.com";
};
k.Anthropic = ks;
k.HUMAN_PROMPT = $a;
k.AI_PROMPT = Na;
k.DEFAULT_TIMEOUT = 6e5;
k.AnthropicError = _;
k.APIError = P;
k.APIConnectionError = Ft;
k.APIConnectionTimeoutError = xr;
k.APIUserAbortError = V;
k.NotFoundError = jr;
k.ConflictError = Lr;
k.RateLimitError = $r;
k.BadRequestError = vr;
k.AuthenticationError = Ar;
k.InternalServerError = Nr;
k.PermissionDeniedError = Or;
k.UnprocessableEntityError = Pr;
k.toFile = wa;
class xe extends k {
  constructor() {
    super(...arguments), this.completions = new gn(this), this.messages = new Ts(this), this.models = new bn(this), this.beta = new J(this);
  }
}
xe.Completions = gn;
xe.Messages = Ts;
xe.Models = bn;
xe.Beta = J;
const fs = [];
function L(e) {
  fs.unshift(e), fs.splice(50);
}
function Ua() {
  return fs;
}
function pe(e) {
  return {
    ...e,
    id: `provider-log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "pending",
    startedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function Ca(e) {
  var l, d, h, p, b, m;
  const t = Date.now(), s = {
    model: e.config.model,
    messages: e.messages,
    temperature: e.config.temperature,
    max_tokens: e.config.maxTokens,
    response_format: {
      type: "json_object"
    },
    stream: !1
  }, r = `${xs(e.config.baseURL)}/chat/completions`, n = pe({
    providerId: e.providerId,
    model: e.config.model,
    baseURL: e.config.baseURL,
    request: {
      method: "POST",
      endpoint: r,
      headers: Rs(e.config),
      body: s,
      messageCount: e.messages.length,
      latestUserMessage: e.latestUserMessage
    }
  }), o = await fetch(r, {
    method: "POST",
    headers: Es(e.config),
    body: JSON.stringify(s)
  });
  if (!o.ok) {
    const w = `${o.status}: ${await o.text()}`;
    throw L({
      ...n,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - t,
      error: w
    }), new Error(`OpenAI-compatible 调用失败：${w}`);
  }
  const a = await o.json(), i = ((p = (h = (d = (l = a.choices) == null ? void 0 : l[0]) == null ? void 0 : d.message) == null ? void 0 : h.content) == null ? void 0 : p.trim()) ?? "";
  return L({
    ...n,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - t,
    response: {
      content: i,
      stopReason: (m = (b = a.choices) == null ? void 0 : b[0]) == null ? void 0 : m.finish_reason,
      usage: a.usage
    }
  }), i;
}
async function Sn(e) {
  var p, b;
  const t = Date.now(), s = {
    model: e.config.model,
    messages: In(e),
    temperature: e.config.temperature,
    max_tokens: e.config.maxTokens,
    stream: !0
  }, r = `${xs(e.config.baseURL)}/chat/completions`, n = pe({
    providerId: `${e.config.role}-${e.config.providerKind}`,
    model: e.config.model,
    baseURL: e.config.baseURL,
    request: {
      method: "POST",
      endpoint: r,
      headers: Rs(e.config),
      body: s,
      messageCount: s.messages.length,
      latestUserMessage: e.latestUserMessage
    }
  }), o = await fetch(r, {
    method: "POST",
    headers: Es(e.config),
    body: JSON.stringify(s)
  });
  if (!o.ok || !o.body) {
    const m = `${o.status}: ${await o.text()}`;
    throw L({
      ...n,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - t,
      error: m
    }), new Error(`OpenAI-compatible 流式调用失败：${m}`);
  }
  const a = o.body.getReader(), i = new TextDecoder();
  let l = "", d = "", h;
  for (; ; ) {
    const { done: m, value: w } = await a.read();
    if (m)
      break;
    l += i.decode(w, { stream: !0 });
    const S = l.split(`
`);
    l = S.pop() ?? "";
    for (const x of S) {
      const v = x.trim();
      if (!v.startsWith("data:"))
        continue;
      const A = v.slice(5).trim();
      if (A !== "[DONE]")
        try {
          const T = (p = JSON.parse(A).choices) == null ? void 0 : p[0], W = ((b = T == null ? void 0 : T.delta) == null ? void 0 : b.content) ?? "";
          W && (d += W, e.onDelta(W)), T != null && T.finish_reason && (h = T.finish_reason);
        } catch {
        }
    }
  }
  return L({
    ...n,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - t,
    response: {
      content: d,
      stopReason: h
    }
  }), {
    content: d,
    stopReason: h
  };
}
async function Da(e) {
  const t = In(e), s = Ba(e.toolSelection.selected_tools);
  if (s.length === 0)
    return Sn(e);
  const r = [...t], n = [], o = [];
  let a = "", i, l, d = 0;
  for (let h = 0; h < 8; h += 1) {
    const p = await qa({
      config: e.config,
      messages: r,
      tools: s,
      latestUserMessage: e.latestUserMessage
    }), b = Wa(p.message);
    if (r.push(b), n.push(b), i = p.stopReason, l = p.usage, !b.tool_calls || b.tool_calls.length === 0) {
      a = b.content ?? "", a && e.onDelta(a);
      break;
    }
    for (const m of b.tool_calls) {
      if (d >= 8)
        break;
      d += 1;
      const w = Fa(m), S = w ? await e.executeToolRequest(w) : Ka(m), x = {
        role: "tool",
        tool_call_id: m.id,
        content: Xa(S)
      };
      r.push(x), n.push(x), o.push(S);
    }
    if (d >= 8)
      break;
  }
  return !a && d >= 8 && (a = "[系统提示：本轮原生工具调用已达到 8 次上限，已停止继续请求工具。]", e.onDelta(a)), {
    content: a,
    stopReason: i,
    usage: l,
    nativeMessages: n,
    nativeToolResults: o
  };
}
async function qa(e) {
  var d;
  const t = Date.now(), s = {
    model: e.config.model,
    messages: e.messages,
    tools: e.tools,
    tool_choice: "auto",
    temperature: e.config.temperature,
    max_tokens: e.config.maxTokens,
    stream: !1,
    ...e.config.thinkingEnabled ? { thinking: { type: "enabled" } } : {}
  }, r = `${xs(e.config.baseURL)}/chat/completions`, n = pe({
    providerId: `${e.config.role}-${e.config.providerKind}-native-tools`,
    model: e.config.model,
    baseURL: e.config.baseURL,
    request: {
      method: "POST",
      endpoint: r,
      headers: Rs(e.config),
      body: s,
      messageCount: e.messages.length,
      latestUserMessage: e.latestUserMessage
    }
  }), o = await fetch(r, {
    method: "POST",
    headers: Es(e.config),
    body: JSON.stringify(s)
  });
  if (!o.ok) {
    const h = `${o.status}: ${await o.text()}`;
    throw L({
      ...n,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - t,
      error: h
    }), new Error(`OpenAI-compatible 原生工具调用失败：${h}`);
  }
  const a = await o.json(), i = (d = a.choices) == null ? void 0 : d[0], l = i == null ? void 0 : i.message;
  return L({
    ...n,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - t,
    response: {
      content: JSON.stringify({
        reasoning_content: l == null ? void 0 : l.reasoning_content,
        content: l == null ? void 0 : l.content,
        tool_calls: l == null ? void 0 : l.tool_calls
      }, null, 2),
      stopReason: i == null ? void 0 : i.finish_reason,
      usage: a.usage
    }
  }), {
    message: l,
    stopReason: i == null ? void 0 : i.finish_reason,
    usage: a.usage
  };
}
function In(e) {
  const t = e.messages.filter((n) => n.sender === "user" || n.sender === "assistant").flatMap((n) => {
    if (n.sender === "assistant") {
      const o = Ja(n);
      return o.length > 0 ? o : [{
        role: "assistant",
        content: n.content
      }];
    }
    return [{
      role: "user",
      content: n.content
    }];
  }), s = t.at(-1), r = s ? t.slice(0, -1) : t;
  return [
    {
      role: "system",
      content: e.system
    },
    ...r,
    {
      role: "user",
      content: e.runtimeContext
    },
    ...s ? [s] : []
  ];
}
function Ba(e) {
  const t = new Set(e), s = [];
  return t.has("file.read") && s.push({
    type: "function",
    function: {
      name: "file_read",
      description: "Read a text file inside the current workspace.",
      parameters: Ie({
        reason: O("Why this file needs to be read."),
        path: O("Workspace-relative or absolute path inside the workspace."),
        maxBytes: St("Maximum number of bytes to read.")
      }, ["path"])
    }
  }), t.has("file.list") && s.push({
    type: "function",
    function: {
      name: "file_list",
      description: "List files or directories inside the current workspace.",
      parameters: Ie({
        reason: O("Why this directory needs to be listed."),
        path: O("Workspace-relative or absolute directory path inside the workspace."),
        recursive: { type: "boolean", description: "Whether to list recursively." },
        maxEntries: St("Maximum number of entries to return.")
      }, ["path"])
    }
  }), t.has("file.search") && s.push({
    type: "function",
    function: {
      name: "file_search",
      description: "Search text in files inside the current workspace.",
      parameters: Ie({
        reason: O("Why this search is needed."),
        path: O("Workspace-relative search root. Optional."),
        query: O("Text to search for."),
        glob: O("Optional simple file suffix or glob hint."),
        maxResults: St("Maximum number of results to return.")
      }, ["query"])
    }
  }), t.has("file.write") && s.push({
    type: "function",
    function: {
      name: "file_write",
      description: "Write a text file inside the current workspace.",
      parameters: Ie({
        reason: O("Why this file needs to be written."),
        path: O("Workspace-relative or absolute path inside the workspace."),
        content: O("Full file content to write.")
      }, ["path", "content"])
    }
  }), t.has("memory.save") && s.push({
    type: "function",
    function: {
      name: "memory_save",
      description: "Save a durable memory for future agent turns.",
      parameters: Ie({
        reason: O("Why this memory should be saved."),
        content: O("Memory content."),
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
        importance: St("Importance between 0 and 1.")
      }, ["content"])
    }
  }), t.has("command.run") && s.push({
    type: "function",
    function: {
      name: "command_run",
      description: "Run a PowerShell command in the current workspace when semantic tools are not enough.",
      parameters: Ie({
        reason: O("Why this command is needed."),
        cwd: O("Working directory inside the workspace."),
        command: O("PowerShell command to execute.")
      }, ["command"])
    }
  }), s;
}
function Fa(e) {
  const t = za(e.function.arguments), s = typeof t.reason == "string" ? t.reason : "";
  if (e.function.name === "file_read" && typeof t.path == "string")
    return {
      type: "file.read",
      reason: s,
      path: t.path,
      maxBytes: typeof t.maxBytes == "number" ? t.maxBytes : void 0
    };
  if (e.function.name === "file_list" && typeof t.path == "string")
    return {
      type: "file.list",
      reason: s,
      path: t.path,
      recursive: t.recursive === !0,
      maxEntries: typeof t.maxEntries == "number" ? t.maxEntries : void 0
    };
  if (e.function.name === "file_search" && typeof t.query == "string")
    return {
      type: "file.search",
      reason: s,
      path: typeof t.path == "string" ? t.path : void 0,
      query: t.query,
      glob: typeof t.glob == "string" ? t.glob : void 0,
      maxResults: typeof t.maxResults == "number" ? t.maxResults : void 0
    };
  if (e.function.name === "file_write" && typeof t.path == "string" && typeof t.content == "string")
    return {
      type: "file.write",
      reason: s,
      path: t.path,
      content: t.content
    };
  if (e.function.name === "memory_save" && typeof t.content == "string")
    return {
      type: "memory.save",
      reason: s,
      content: t.content,
      memoryType: Va(t.memoryType),
      tags: Array.isArray(t.tags) ? t.tags.filter((r) => typeof r == "string") : void 0,
      importance: typeof t.importance == "number" ? t.importance : void 0
    };
  if (e.function.name === "command_run" && typeof t.command == "string")
    return {
      type: "command.run",
      reason: s,
      shell: "powershell",
      cwd: typeof t.cwd == "string" ? t.cwd : "",
      command: t.command
    };
}
function Wa(e) {
  return {
    role: "assistant",
    content: (e == null ? void 0 : e.content) ?? "",
    ...e != null && e.reasoning_content ? { reasoning_content: e.reasoning_content } : {},
    ...e != null && e.tool_calls && e.tool_calls.length > 0 ? { tool_calls: e.tool_calls } : {}
  };
}
function Ka(e) {
  return {
    request: {
      type: "memory.save",
      reason: "unsupported native tool call",
      content: `Unsupported tool call: ${e.function.name}`
    },
    decision: "deny",
    status: "skipped",
    reason: `不支持的原生工具：${e.function.name}`,
    stderr: e.function.arguments
  };
}
function Xa(e) {
  return JSON.stringify({
    type: e.request.type,
    decision: e.decision,
    status: e.status,
    reason: e.reason,
    exitCode: e.exitCode,
    stdout: e.stdout,
    stderr: e.stderr,
    output: e.output,
    data: e.data
  }, null, 2);
}
function Ja(e) {
  var s;
  const t = (s = e.metadata) == null ? void 0 : s.openaiNativeMessages;
  return Array.isArray(t) ? t.filter(Ha) : [];
}
function Ha(e) {
  if (typeof e != "object" || e === null)
    return !1;
  const t = e.role;
  return t === "assistant" || t === "tool" || t === "user" || t === "system";
}
function za(e) {
  try {
    const t = JSON.parse(e);
    return typeof t == "object" && t !== null ? t : {};
  } catch {
    return {};
  }
}
function Va(e) {
  return typeof e == "string" && ["fact", "preference", "decision", "plan", "constraint"].includes(e) ? e : void 0;
}
function Ie(e, t) {
  return {
    type: "object",
    properties: e,
    required: t
  };
}
function O(e) {
  return {
    type: "string",
    description: e
  };
}
function St(e) {
  return {
    type: "number",
    description: e
  };
}
function Es(e) {
  return {
    "content-type": "application/json",
    ...e.apiKey ? { authorization: `Bearer ${e.apiKey.trim()}` } : {}
  };
}
function Rs(e) {
  return {
    "content-type": "application/json",
    authorization: e.apiKey ? "Bearer [redacted]" : ""
  };
}
function xs(e) {
  return e.replace(/\/+$/, "");
}
async function Ht(e) {
  if (e.config.providerKind === "openai-compatible")
    return Ca({
      config: e.config,
      providerId: e.providerId,
      latestUserMessage: e.latestUserMessage,
      messages: [
        {
          role: "system",
          content: e.systemPrompt
        },
        {
          role: "user",
          content: e.userPrompt
        }
      ]
    });
  if (e.config.providerKind === "anthropic-compatible")
    return Qa(e);
  if (e.config.providerKind === "ollama")
    return Ya(e);
  throw new Error(`JSON Chat 不支持 provider：${e.config.providerKind}`);
}
async function Qa(e) {
  const t = Date.now(), s = {
    model: e.config.model,
    max_tokens: e.config.maxTokens,
    system: [
      e.systemPrompt,
      "",
      "你必须只输出一个合法 JSON 对象，不要输出 Markdown 代码块，不要输出 JSON 之外的解释。"
    ].join(`
`),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: e.userPrompt
          }
        ]
      }
    ],
    top_p: 0.95,
    stream: !1,
    temperature: e.config.temperature
  }, r = pe({
    providerId: `${e.providerId}-anthropic-compatible`,
    model: e.config.model,
    baseURL: e.config.baseURL,
    request: {
      method: "POST",
      endpoint: `${e.config.baseURL}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": e.config.apiKey ? "[redacted]" : "",
        "anthropic-version": "sdk-managed"
      },
      body: s,
      messageCount: e.messageCount ?? s.messages.length,
      latestUserMessage: e.latestUserMessage
    }
  });
  if (!e.config.apiKey)
    throw L({
      ...r,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - t,
      error: "未检测到 API Key。"
    }), new Error(`${e.providerId} 未检测到 API Key。请在模型库中为该模型块填写 API Key。`);
  const n = new xe({
    apiKey: e.config.apiKey.trim(),
    baseURL: e.config.baseURL
  });
  try {
    const o = await n.messages.create(s), a = o.content.map((i) => i.type === "text" ? i.text : "").join("").trim();
    return L({
      ...r,
      status: "succeeded",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - t,
      response: {
        content: a,
        stopReason: o.stop_reason ?? void 0,
        usage: o.usage
      }
    }), a;
  } catch (o) {
    const a = o instanceof Error ? o.message : String(o);
    throw L({
      ...r,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - t,
      error: a
    }), new Error(`${e.providerId} Anthropic-compatible 调用失败：${a}`);
  }
}
async function Ya(e) {
  var i;
  const t = Date.now(), s = {
    model: e.config.model,
    stream: !1,
    ...e.ollamaFormatJson ? { format: "json" } : {},
    messages: [
      {
        role: "system",
        content: e.systemPrompt
      },
      {
        role: "user",
        content: e.userPrompt
      }
    ],
    options: {
      temperature: e.config.temperature,
      num_predict: e.config.maxTokens
    }
  }, r = pe({
    providerId: `${e.providerId}-ollama`,
    model: e.config.model,
    baseURL: e.config.baseURL,
    request: {
      method: "POST",
      endpoint: `${e.config.baseURL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: s,
      messageCount: e.messageCount ?? s.messages.length,
      latestUserMessage: e.latestUserMessage
    }
  }), n = await fetch(`${e.config.baseURL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(s)
  });
  if (!n.ok) {
    const l = `${n.status}: ${await n.text()}`;
    throw L({
      ...r,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - t,
      error: l
    }), new Error(`${e.providerId} Ollama HTTP ${l}`);
  }
  const o = await n.json(), a = (((i = o.message) == null ? void 0 : i.content) ?? o.response ?? "").trim();
  return L({
    ...r,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - t,
    response: {
      content: a
    }
  }), a;
}
async function Ga(e) {
  var n;
  const t = ie("compression"), s = (n = e.messages.at(-1)) == null ? void 0 : n.content, r = await Ht({
    config: t,
    providerId: "compression",
    systemPrompt: Bo(),
    userPrompt: Fo({
      previousSummary: e.previousSummary ?? "",
      messages: e.messages
    }),
    latestUserMessage: s,
    messageCount: e.messages.length,
    ollamaFormatJson: !0
  });
  return Za(r);
}
function Za(e) {
  const t = JSON.parse(e);
  if (!t.summary || typeof t.summary != "string")
    throw new Error(`会话压缩结果无效：summary 不能为空。实际返回：${e}`);
  return {
    summary: t.summary,
    decisions: It(t.decisions),
    openQuestions: It(t.open_questions),
    constraints: It(t.constraints),
    taskProgress: It(t.task_progress)
  };
}
function It(e) {
  return Array.isArray(e) ? e.filter((t) => typeof t == "string") : [];
}
const ei = 24, ti = 10, si = 6;
async function ri(e) {
  const t = zn(e.projectId, e.sessionId);
  if (e.messages.length < ei)
    return t;
  const s = e.messages.length - ti - 1;
  if (s < 0)
    return t;
  const r = e.messages[s];
  if (!r || (t == null ? void 0 : t.sourceEndMessageId) === r.id)
    return t;
  const n = ni(e.messages, t, s);
  if (n.length < si)
    return t;
  const o = await Ga({
    messages: n,
    previousSummary: t == null ? void 0 : t.summary
  }), a = Vn({
    projectId: e.projectId,
    sessionId: e.sessionId,
    sourceMessages: n,
    summary: o.summary,
    decisions: o.decisions,
    openQuestions: o.openQuestions,
    constraints: o.constraints,
    taskProgress: o.taskProgress
  });
  return eo({
    projectId: e.projectId,
    sessionId: e.sessionId,
    summaryId: a.id,
    content: a.summary,
    payload: {
      sourceStartMessageId: a.sourceStartMessageId,
      sourceEndMessageId: a.sourceEndMessageId,
      decisions: a.decisions,
      openQuestions: a.openQuestions,
      constraints: a.constraints,
      taskProgress: a.taskProgress
    }
  }), a;
}
function ni(e, t, s) {
  const r = t ? e.findIndex((o) => o.id === t.sourceEndMessageId) + 1 : 0, n = r > 0 ? r : 0;
  return e.slice(n, s + 1);
}
function oi(e) {
  return ii(e.userContent, e.routerResult) ? [
    Mn({
      projectId: e.projectId,
      type: ci(e.userContent),
      content: e.userContent,
      tags: e.routerResult.keywords,
      importance: di(e.userContent),
      confidence: e.routerResult.confidence || 0.7,
      sourceSessionId: e.sessionId,
      sourceEventIds: [e.userMessageId]
    })
  ] : [];
}
function Mn(e) {
  const t = (/* @__PURE__ */ new Date()).toISOString(), s = {
    id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: e.projectId,
    type: e.type,
    content: e.content.trim(),
    tags: [...new Set(e.tags.filter((r) => r.trim().length > 0))],
    importance: ur(e.importance),
    confidence: ur(e.confidence),
    sourceSessionId: e.sourceSessionId,
    sourceEventIds: e.sourceEventIds,
    status: "active",
    createdAt: t,
    updatedAt: t
  };
  return ge().prepare(
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
    s.id,
    s.projectId,
    s.type,
    s.content,
    JSON.stringify(s.tags),
    s.importance,
    s.confidence,
    s.sourceSessionId ?? null,
    JSON.stringify(s.sourceEventIds),
    s.status,
    s.createdAt,
    s.updatedAt
  ), s;
}
function ai(e) {
  const t = ge().prepare(
    `
        SELECT *
        FROM memories
        WHERE project_id = ? AND status = 'active'
        ORDER BY importance DESC, updated_at DESC
        LIMIT 80
      `
  ).all(e.projectId), s = ui(e.query);
  return t.map(hi).map((r) => ({
    memory: r,
    score: li(r, s)
  })).filter((r) => r.score > 0 || r.memory.importance >= 0.8).sort((r, n) => n.score - r.score || n.memory.importance - r.memory.importance).slice(0, e.limit ?? 6).map((r) => r.memory);
}
function ii(e, t) {
  const s = e.toLowerCase();
  return [
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
  ].some((n) => s.includes(n.toLowerCase())) || t.task_type === "design" && t.keywords.some((n) => ["记忆", "提示词", "架构", "规则"].includes(n));
}
function ci(e) {
  return e.includes("不要") || e.includes("我希望") || e.includes("偏好") ? "preference" : e.includes("决定") || e.includes("确认") ? "decision" : e.includes("后续") || e.includes("规划") || e.includes("目标") ? "plan" : e.includes("规则") || e.includes("必须") ? "constraint" : "fact";
}
function di(e) {
  return e.includes("系统规则") || e.includes("必须") || e.includes("长期") ? 0.9 : e.includes("我希望") || e.includes("决定") || e.includes("确认") ? 0.8 : 0.65;
}
function li(e, t) {
  const s = `${e.content} ${e.tags.join(" ")}`.toLowerCase();
  return t.reduce((n, o) => n + (s.includes(o) ? 1 : 0), 0) + e.importance * 0.5 + e.confidence * 0.25;
}
function ui(e) {
  return e.toLowerCase().split(/[\s,，。！？、:：;；"'`]+/).map((t) => t.trim()).filter((t) => t.length >= 2);
}
function hi(e) {
  return {
    id: e.id,
    projectId: e.project_id,
    type: e.type,
    content: e.content,
    tags: lr(e.tags_json),
    importance: e.importance,
    confidence: e.confidence,
    sourceSessionId: e.source_session_id,
    sourceEventIds: lr(e.source_event_ids_json),
    status: e.status,
    createdAt: e.created_at,
    updatedAt: e.updated_at
  };
}
function lr(e) {
  const t = JSON.parse(e);
  return Array.isArray(t) ? t.filter((s) => typeof s == "string") : [];
}
function ur(e) {
  return Math.max(0, Math.min(1, e));
}
const fi = Fn(Bn), ms = 2e4, mi = 3e4, gi = 12e4;
async function pi(e) {
  const t = Date.now(), s = _i(e.request);
  if (s.decision !== "allow")
    return {
      request: e.request,
      decision: s.decision,
      status: "skipped",
      reason: s.reason,
      durationMs: Date.now() - t
    };
  try {
    const r = await fi(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", e.request.command],
      {
        cwd: y.resolve(e.request.cwd),
        timeout: wi(e.request.command),
        windowsHide: !0,
        maxBuffer: ms * 2
      }
    );
    return {
      request: e.request,
      decision: "allow",
      status: "executed",
      reason: s.reason,
      exitCode: 0,
      stdout: Mt(r.stdout),
      stderr: Mt(r.stderr),
      durationMs: Date.now() - t
    };
  } catch (r) {
    const n = r;
    return {
      request: e.request,
      decision: "allow",
      status: "failed",
      reason: s.reason,
      exitCode: typeof n.code == "number" ? n.code : void 0,
      stdout: Mt(n.stdout ?? ""),
      stderr: Mt(n.stderr ?? n.message ?? ""),
      durationMs: Date.now() - t
    };
  }
}
function _i(e, t) {
  if (e.shell !== "powershell")
    return {
      decision: "deny",
      reason: "当前命令执行器只支持 PowerShell。"
    };
  const s = e.command.trim(), r = bi(s);
  return r ? {
    decision: "confirm",
    reason: r
  } : {
    decision: "allow",
    reason: "管理员 Agent 模式：PowerShell 命令默认放行。"
  };
}
function yi(e) {
  const t = e.trim().toLowerCase();
  return [
    "corepack pnpm build",
    "corepack pnpm test",
    "pnpm build",
    "pnpm test",
    "npm run build",
    "npm test"
  ].some((r) => t.startsWith(r));
}
function bi(e) {
  const t = e.trim().toLowerCase();
  return [
    "remove-item",
    " rm ",
    "rm ",
    "del ",
    "erase ",
    "rmdir ",
    "rd ",
    "git clean",
    "rimraf"
  ].some((r) => t.includes(r)) ? "删除确认：该 PowerShell 命令看起来包含删除/清理操作，需要用户确认后才能执行。" : void 0;
}
function wi(e) {
  return yi(e) ? gi : mi;
}
function Mt(e) {
  return e.length > ms ? `${e.slice(0, ms)}
[output truncated]` : e;
}
const Tn = 8e4, Si = 200, Ii = 80, Mi = 3e5, kn = /* @__PURE__ */ new Set([".git", "node_modules", "dist", "dist-electron", ".vite"]), Ti = /* @__PURE__ */ new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "secrets.local.json",
  "model-runtime.local.json",
  "agent.db",
  "agent.db-shm",
  "agent.db-wal"
]), ki = /* @__PURE__ */ new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".sqlite", ".db"]), Ei = /* @__PURE__ */ new Set([".ssh"]);
async function En(e) {
  if (e.request.type === "command.run")
    return pi({
      request: e.request,
      toolSelection: e.toolSelection
    });
  const t = Date.now(), s = Ri(e.request, e.toolSelection);
  if (s.decision !== "allow")
    return {
      request: e.request,
      decision: s.decision,
      status: "skipped",
      reason: s.reason,
      durationMs: Date.now() - t
    };
  try {
    const r = await xi({
      request: e.request,
      projectId: e.projectId,
      sessionId: e.sessionId
    });
    return {
      request: e.request,
      decision: "allow",
      status: "executed",
      reason: s.reason,
      ...r,
      durationMs: Date.now() - t
    };
  } catch (r) {
    return {
      request: e.request,
      decision: "allow",
      status: "failed",
      reason: s.reason,
      stderr: r instanceof Error ? r.message : String(r),
      durationMs: Date.now() - t
    };
  }
}
function Ri(e, t) {
  return Pi(e) ? {
    decision: "allow",
    reason: `${e.type} 在管理员 Agent 模式下默认放行，包含敏感文件读取。`
  } : {
    decision: "allow",
    reason: `${e.type} 在管理员 Agent 模式下默认放行。`
  };
}
async function xi(e) {
  return e.request.type === "file.read" ? vi(e.request) : e.request.type === "file.list" ? Ai(e.request) : e.request.type === "file.search" ? Oi(e.request) : e.request.type === "file.write" ? ji(e.request) : Li(e.request, e.projectId, e.sessionId);
}
function vi(e) {
  const t = zt(e.path), s = I.statSync(t);
  if (!s.isFile())
    throw new Error(`不是文件：${t}`);
  const r = e.maxBytes ?? Tn, n = I.readFileSync(t, "utf8"), o = Buffer.byteLength(n, "utf8") > r;
  return {
    output: o ? n.slice(0, r) : n,
    data: {
      path: t,
      bytes: s.size,
      truncated: o
    }
  };
}
function Ai(e) {
  const t = zt(e.path);
  if (!I.statSync(t).isDirectory())
    throw new Error(`不是目录：${t}`);
  const r = e.maxEntries ?? Si, n = e.recursive ? Ui(t, r) : I.readdirSync(t, { withFileTypes: !0 }).slice(0, r).map((o) => ({
    path: y.join(t, o.name),
    type: o.isDirectory() ? "directory" : "file"
  }));
  return {
    output: n.map((o) => `${o.type === "directory" ? "[dir]" : "[file]"} ${Vt(o.path)}`).join(`
`),
    data: {
      path: t,
      entries: n,
      truncated: n.length >= r
    }
  };
}
function Oi(e) {
  const t = zt(e.path ?? "."), s = I.statSync(t), r = e.maxResults ?? Ii, n = s.isDirectory() ? Ci(t, r * 20) : [t], o = [], a = e.query.toLowerCase();
  for (const i of n) {
    if (o.length >= r)
      break;
    if (e.glob && !i.endsWith(e.glob.replace("*", "")))
      continue;
    const l = Di(i);
    if (l === void 0)
      continue;
    const d = l.split(/\r?\n/);
    for (let h = 0; h < d.length && o.length < r; h += 1)
      d[h].toLowerCase().includes(a) && o.push({
        path: i,
        line: h + 1,
        text: d[h].trim()
      });
  }
  return {
    output: o.map((i) => `${Vt(i.path)}:${i.line}: ${i.text}`).join(`
`),
    data: {
      query: e.query,
      results: o,
      truncated: o.length >= r
    }
  };
}
function ji(e) {
  const t = zt(e.path);
  $i(t);
  const s = Buffer.byteLength(e.content, "utf8");
  if (s > Mi)
    throw new Error(`写入内容过大：${s} bytes`);
  return I.mkdirSync(y.dirname(t), { recursive: !0 }), I.writeFileSync(t, e.content, "utf8"), {
    output: `已写入 ${Vt(t)} (${s} bytes)`,
    data: {
      path: t,
      bytes: s
    }
  };
}
function Li(e, t, s) {
  const r = Mn({
    projectId: t,
    type: e.memoryType ?? "fact",
    content: e.content,
    tags: e.tags ?? [],
    importance: e.importance ?? 0.75,
    confidence: 0.8,
    sourceSessionId: s,
    sourceEventIds: []
  });
  return {
    output: `已保存长期记忆：${r.content}`,
    data: r
  };
}
function zt(e) {
  const t = y.resolve(Re()), s = y.isAbsolute(e) ? y.resolve(e) : y.resolve(t, e), r = y.relative(t, s);
  if (r.startsWith("..") || y.isAbsolute(r))
    throw new Error(`路径不在工作区内：${s}`);
  return s;
}
function Vt(e) {
  return y.relative(Re(), e) || ".";
}
function Pi(e) {
  return e.type === "file.read" || e.type === "file.list" || e.type === "file.search";
}
function $i(e) {
  if (Ni(e))
    throw new Error(`敏感文件写入受保护，已拒绝写入：${Vt(e)}`);
}
function Ni(e) {
  const t = y.resolve(Re()), r = y.relative(t, y.resolve(e)).split(y.sep).map((a) => a.toLowerCase()), n = r.at(-1) ?? "", o = y.extname(n);
  return r.some((a) => Ei.has(a)) || Ti.has(n) || ki.has(o) || n.includes("secret") || n.includes("token") || n.includes("apikey") || n.includes("api-key") || n.includes("credential");
}
function Ui(e, t) {
  const s = [], r = [e];
  for (; r.length > 0 && s.length < t; ) {
    const n = r.shift() ?? e;
    for (const o of I.readdirSync(n, { withFileTypes: !0 })) {
      if (s.length >= t)
        break;
      if (o.isDirectory() && kn.has(o.name))
        continue;
      const a = y.join(n, o.name), i = o.isDirectory() ? "directory" : "file";
      s.push({ path: a, type: i }), o.isDirectory() && r.push(a);
    }
  }
  return s;
}
function Ci(e, t) {
  const s = [], r = [e];
  for (; r.length > 0 && s.length < t; ) {
    const n = r.shift() ?? e;
    for (const o of I.readdirSync(n, { withFileTypes: !0 })) {
      if (s.length >= t)
        break;
      if (o.isDirectory() && kn.has(o.name))
        continue;
      const a = y.join(n, o.name);
      o.isDirectory() ? r.push(a) : s.push(a);
    }
  }
  return s;
}
function Di(e) {
  try {
    return I.statSync(e).size > Tn ? void 0 : I.readFileSync(e, "utf8");
  } catch {
    return;
  }
}
function qi(e) {
  const t = (/* @__PURE__ */ new Date()).toISOString(), s = {
    id: `prompt-iteration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: e.projectId,
    sessionId: e.sessionId,
    targetTemplate: e.targetTemplate,
    trigger: e.trigger,
    reason: e.reason,
    suggestedChange: e.suggestedChange,
    sourceEventIds: e.sourceEventIds,
    status: "proposed",
    createdAt: t,
    updatedAt: t
  };
  return ge().prepare(
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
    s.id,
    s.projectId,
    s.sessionId,
    s.targetTemplate,
    s.trigger,
    s.reason,
    s.suggestedChange,
    JSON.stringify(s.sourceEventIds),
    s.status,
    s.createdAt,
    s.updatedAt
  ), s;
}
async function vs(e) {
  const t = ie("main"), s = Co();
  if (t.providerKind === "openai-compatible") {
    const l = [
      e.conversationSummary ? Os(e.conversationSummary) : "",
      e.memories && e.memories.length > 0 ? js(e.memories) : "",
      _s(e.routerContext)
    ].filter((h) => h.trim().length > 0).join(`

---

`), d = {
      config: t,
      system: s,
      messages: As(e.messages, e.conversationSummary),
      runtimeContext: l,
      latestUserMessage: e.latestUserMessage,
      onDelta: e.onDelta
    };
    return t.toolCallingMode === "native-openai" && e.toolSelection && e.executeToolRequest ? Da({
      ...d,
      toolSelection: e.toolSelection,
      executeToolRequest: e.executeToolRequest
    }) : Sn(d);
  }
  if (t.providerKind === "ollama")
    return Fi({
      config: t,
      systemPrompt: s,
      messages: e.messages,
      latestUserMessage: e.latestUserMessage,
      routerContext: e.routerContext,
      conversationSummary: e.conversationSummary,
      memories: e.memories,
      onDelta: e.onDelta
    });
  if (t.providerKind !== "anthropic-compatible")
    throw new Error(`主模型当前只支持 ollama、anthropic-compatible 或 openai-compatible，实际配置为：${t.providerKind}`);
  const r = Date.now(), n = {
    model: t.model,
    max_tokens: t.maxTokens,
    system: s,
    messages: Bi(e.messages, e.routerContext, e.conversationSummary, e.memories),
    top_p: 0.95,
    stream: !0,
    temperature: t.temperature
  }, o = pe({
    providerId: "main-anthropic-compatible",
    model: t.model,
    baseURL: t.baseURL,
    request: {
      method: "POST",
      endpoint: `${t.baseURL}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": "[redacted]",
        "anthropic-version": "sdk-managed"
      },
      body: n,
      messageCount: e.messages.length,
      latestUserMessage: e.latestUserMessage
    }
  }), a = t.apiKey;
  if (!a)
    return L({
      ...o,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - r,
      error: "未检测到主模型 API Key。"
    }), {
      content: "未检测到主模型 API Key。请打开模型配置，填写 main 模型的 API Key 后重新发送。",
      stopReason: "missing_api_key"
    };
  const i = new xe({
    apiKey: a.trim(),
    baseURL: t.baseURL
  });
  try {
    let l = "";
    const d = i.messages.stream(n);
    d.on("text", (p) => {
      l += p, e.onDelta(p);
    });
    const h = await d.finalMessage();
    return L({
      ...o,
      status: "succeeded",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - r,
      response: {
        content: l,
        stopReason: h.stop_reason ?? void 0,
        usage: h.usage
      }
    }), {
      content: l,
      stopReason: h.stop_reason ?? void 0,
      usage: h.usage
    };
  } catch (l) {
    const d = l instanceof Error ? l.message : String(l);
    throw L({
      ...o,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - r,
      error: d
    }), new Error(Xi(d));
  }
}
function Bi(e, t, s, r) {
  const n = As(e, s), o = Ki(n), a = o.at(-1), i = a ? o.slice(0, -1) : o, l = s ? {
    role: "user",
    content: [
      {
        type: "text",
        text: Os(s)
      }
    ]
  } : void 0, d = {
    role: "user",
    content: [
      {
        type: "text",
        text: _s(t)
      }
    ]
  }, h = r && r.length > 0 ? {
    role: "user",
    content: [
      {
        type: "text",
        text: js(r)
      }
    ]
  } : void 0, p = [
    ...l ? [l] : [],
    ...h ? [h] : []
  ];
  return a ? [...p, ...i, d, a] : [...p, d];
}
async function Fi(e) {
  var h;
  const t = Date.now(), s = {
    model: e.config.model,
    stream: !0,
    messages: Wi(e),
    options: {
      temperature: e.config.temperature,
      num_predict: e.config.maxTokens
    }
  }, r = pe({
    providerId: "main-ollama",
    model: e.config.model,
    baseURL: e.config.baseURL,
    request: {
      method: "POST",
      endpoint: `${e.config.baseURL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: s,
      messageCount: e.messages.length,
      latestUserMessage: e.latestUserMessage
    }
  }), n = await fetch(`${e.config.baseURL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(s)
  });
  if (!n.ok || !n.body) {
    const p = `${n.status}: ${await n.text()}`;
    throw L({
      ...r,
      status: "failed",
      completedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs: Date.now() - t,
      error: p
    }), new Error(`Ollama 主模型调用失败：${p}`);
  }
  const o = n.body.getReader(), a = new TextDecoder();
  let i = "", l = "", d;
  for (; ; ) {
    const { done: p, value: b } = await o.read();
    if (p)
      break;
    i += a.decode(b, { stream: !0 });
    const m = i.split(`
`);
    i = m.pop() ?? "";
    for (const w of m) {
      const S = w.trim();
      if (S)
        try {
          const x = JSON.parse(S), v = ((h = x.message) == null ? void 0 : h.content) ?? "";
          v && (l += v, e.onDelta(v)), x.done && (d = x.done_reason ?? "stop");
        } catch {
        }
    }
  }
  return L({
    ...r,
    status: "succeeded",
    completedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: Date.now() - t,
    response: {
      content: l,
      stopReason: d
    }
  }), {
    content: l,
    stopReason: d
  };
}
function Wi(e) {
  const s = As(e.messages, e.conversationSummary).filter((a) => a.sender === "user" || a.sender === "assistant").map((a) => ({
    role: a.sender === "assistant" ? "assistant" : "user",
    content: a.content
  })), r = s.at(-1), n = r ? s.slice(0, -1) : s, o = [
    e.conversationSummary ? Os(e.conversationSummary) : "",
    e.memories && e.memories.length > 0 ? js(e.memories) : "",
    _s(e.routerContext)
  ].filter((a) => a.trim().length > 0).join(`

---

`);
  return [
    {
      role: "system",
      content: e.systemPrompt
    },
    ...n,
    {
      role: "user",
      content: o
    },
    ...r ? [r] : []
  ];
}
function As(e, t) {
  if (!t)
    return e;
  const s = e.findIndex((r) => r.id === t.sourceEndMessageId);
  return s >= 0 ? e.slice(s + 1) : e;
}
function Os(e) {
  return [
    "【会话压缩摘要】",
    "",
    "以下内容是系统根据较早真实对话生成的会话摘要，不是用户本轮输入。它用于替代已从上下文中裁剪的早期对话。",
    "",
    `覆盖范围：${e.sourceStartMessageId} -> ${e.sourceEndMessageId}`,
    "",
    "摘要：",
    e.summary,
    "",
    Tt("已确认决策", e.decisions),
    Tt("未确认问题", e.openQuestions),
    Tt("约束与偏好", e.constraints),
    Tt("任务进度", e.taskProgress)
  ].filter((t) => t.trim().length > 0).join(`
`);
}
function js(e) {
  return [
    "【长期记忆召回】",
    "",
    "以下内容是系统从本地长期记忆数据库召回的用户偏好、项目决策、约束或规划，不是用户本轮新输入。请优先遵守其中的高重要性规则，但不要原样复述。",
    "",
    ...e.map((t) => [
      `- id: ${t.id}`,
      `  type: ${t.type}`,
      `  importance: ${t.importance}`,
      `  confidence: ${t.confidence}`,
      `  content: ${t.content}`,
      t.tags.length > 0 ? `  tags: ${t.tags.join(", ")}` : ""
    ].filter((s) => s.length > 0).join(`
`))
  ].join(`
`);
}
function Tt(e, t) {
  return t.length === 0 ? "" : [`${e}：`, ...t.map((s) => `- ${s}`)].join(`
`);
}
function Ki(e) {
  return e.filter((t) => t.sender === "user" || t.sender === "assistant").map((t) => ({
    role: t.sender === "assistant" ? "assistant" : "user",
    content: [
      {
        type: "text",
        text: t.content
      }
    ]
  }));
}
function Xi(e) {
  return e.includes("401") || e.toLowerCase().includes("invalid api key") ? "主模型服务返回 401：API Key 无效。请确认模型配置中的 API Key、Base URL 和模型名正确。" : `主模型调用失败：${e}`;
}
async function Ji(e, t) {
  const s = ie("router"), r = await Ht({
    config: s,
    providerId: "router",
    systemPrompt: No(),
    userPrompt: Uo(e, t),
    latestUserMessage: t,
    messageCount: e.length
  });
  return Hi(r);
}
function Hi(e) {
  const t = JSON.parse(e), s = ae(t.turn_analysis), r = ae(t.workflow_decision), n = ae(t.context_decision), o = ae(t.profile_observation), a = ae(t.evaluation_seed), i = ["code", "chat", "search", "debug", "analysis"], l = Rn(s.intent ?? t.intent, i);
  if (!l)
    throw new Error(`Router 任务分析结果无效：turn_analysis.intent 必须是 ${i.join(" | ")} 之一。实际返回：${e}`);
  const d = Vi(s.task_type ?? t.task_type) ?? Qi(l), h = ke(n.needs_tools ?? t.needs_tools), p = ic(n.suggested_tools ?? t.suggested_tools, h), b = zi(s.secondary_intents ?? t.secondary_intents, i, l), m = B(s.rewritten_input ?? t.rewritten_input), w = j(s.keywords ?? t.keywords), S = ke(s.is_task ?? t.is_task), x = B(s.task_goal ?? t.task_goal), v = Yi(s.complexity ?? t.complexity), A = Gi(s.task_scope ?? t.task_scope), E = Zi(r.execution_mode ?? t.execution_mode, h), T = B(s.reasoning_brief ?? t.reasoning_brief), W = B(s.expected_output ?? t.expected_output), H = j(n.required_context ?? t.required_context), ce = ke(n.requires_project_context ?? t.requires_project_context), ve = ke(r.needs_user_clarification ?? t.needs_user_clarification), G = j(r.clarifying_questions ?? t.clarifying_questions), nt = B(n.tool_reason ?? t.tool_reason), _e = B(a.verification_question ?? t.verification_question), Q = j(a.success_criteria ?? t.success_criteria), Ae = xn(a.confidence ?? t.confidence), Ps = ec(r.workflow_route, E, S), jn = tc(ae(r.input_risk)), Ln = nc(ae(o.profile_snapshot_used)), Pn = oc(o.profile_updates), $n = j(n.context_needs), Nn = B(n.memory_query), Un = rc(n.time_context_mode);
  return {
    intent: l,
    secondary_intents: b,
    rewritten_input: m,
    keywords: w,
    is_task: S,
    task_goal: x,
    task_type: d,
    complexity: v,
    task_scope: A,
    execution_mode: E,
    reasoning_brief: T,
    planned_steps: j(t.planned_steps),
    expected_output: W,
    required_context: H,
    constraints: j(t.constraints),
    risks: j(t.risks),
    suggested_roles: j(t.suggested_roles),
    main_model_brief: B(t.main_model_brief),
    routing_notes: B(t.routing_notes),
    verification_question: _e,
    success_criteria: Q,
    needs_user_clarification: ve,
    clarifying_questions: G,
    requires_project_context: ce,
    needs_tools: h,
    suggested_tools: p,
    tool_reason: nt,
    confidence: Ae,
    turn_analysis: {
      intent: l,
      secondary_intents: b,
      rewritten_input: m,
      keywords: w,
      is_task: S,
      task_goal: x,
      task_type: d,
      complexity: v,
      task_scope: A,
      reasoning_brief: T,
      expected_output: W
    },
    workflow_decision: {
      workflow_route: Ps,
      planning_required: ke(r.planning_required) || Ps === "planning",
      execution_mode: E,
      needs_user_clarification: ve,
      clarifying_questions: G,
      input_risk: jn
    },
    context_decision: {
      requires_project_context: ce,
      context_needs: $n,
      required_context: H,
      memory_query: Nn,
      time_context_mode: Un,
      needs_tools: h,
      suggested_tools: p,
      tool_reason: nt
    },
    profile_observation: {
      profile_snapshot_used: Ln,
      profile_updates: Pn,
      routing_influences: j(o.routing_influences)
    },
    evaluation_seed: {
      verification_question: _e,
      success_criteria: Q,
      confidence: Ae
    }
  };
}
function zi(e, t, s) {
  return j(e).map((r) => Rn(r, t)).filter((r) => !!(r && r !== s));
}
function Rn(e, t) {
  if (typeof e != "string")
    return;
  const s = e.trim();
  return t.includes(s) ? s : s.split("|").map((o) => o.trim()).find((o) => t.includes(o));
}
function Vi(e) {
  const t = [
    "chat",
    "analysis",
    "design",
    "implementation",
    "debugging",
    "verification"
  ];
  if (typeof e != "string")
    return;
  const s = e.trim();
  return t.includes(s) ? s : s.split("|").map((n) => n.trim()).find((n) => t.includes(n));
}
function Qi(e) {
  return e === "code" ? "implementation" : e === "debug" ? "debugging" : e === "chat" ? "chat" : "analysis";
}
function Yi(e) {
  return typeof e == "string" && ["simple", "moderate", "complex"].includes(e) ? e : "moderate";
}
function Gi(e) {
  return typeof e == "string" && ["single_turn", "multi_turn", "project"].includes(e) ? e : "single_turn";
}
function Zi(e, t) {
  return typeof e == "string" && ["answer_only", "plan", "use_tools", "modify_files", "verify"].includes(e) ? e : t ? "use_tools" : "answer_only";
}
function ec(e, t, s) {
  return typeof e == "string" && ["answer_only", "planning", "ask_user", "reject"].includes(e) ? e : t === "plan" || t === "use_tools" || t === "modify_files" || t === "verify" || s ? "planning" : "answer_only";
}
function tc(e) {
  return {
    level: sc(e.level),
    requires_confirmation: ke(e.requires_confirmation),
    reasons: j(e.reasons)
  };
}
function sc(e) {
  return typeof e == "string" && ["low", "medium", "high"].includes(e) ? e : "low";
}
function rc(e) {
  return typeof e == "string" && ["none", "current_time", "recent_history", "historical_timeline"].includes(e) ? e : "none";
}
function nc(e) {
  return {
    environment: j(e.environment),
    user: j(e.user),
    project: j(e.project)
  };
}
function oc(e) {
  return Array.isArray(e) ? e.map((t) => {
    const s = ae(t);
    return {
      target: ac(s.target),
      field: B(s.field),
      value: B(s.value),
      reason: B(s.reason),
      confidence: xn(s.confidence),
      evidence: B(s.evidence)
    };
  }).filter((t) => t.field && t.value) : [];
}
function ac(e) {
  return typeof e == "string" && ["environment", "user", "project"].includes(e) ? e : "user";
}
function ke(e) {
  return e === !0;
}
function B(e) {
  return typeof e == "string" ? e : "";
}
function j(e) {
  return Array.isArray(e) ? e.filter((t) => typeof t == "string") : [];
}
function ae(e) {
  return e && typeof e == "object" && !Array.isArray(e) ? e : {};
}
function ic(e, t) {
  const s = /* @__PURE__ */ new Set(["command.run", "file.read", "file.list", "file.search", "file.write", "memory.save"]), r = j(e).filter((n) => s.has(n));
  return t && r.length === 0 ? ["file.read", "file.search", "command.run"] : r;
}
function xn(e) {
  return typeof e != "number" || Number.isNaN(e) ? 0 : Math.max(0, Math.min(1, e));
}
async function cc(e) {
  const t = ie("evaluator"), s = JSON.stringify(e.routerResult, null, 2), r = Ko({
    userInput: e.userInput,
    routerResult: s,
    assistantAnswer: e.assistantAnswer
  }), n = await Ht({
    config: {
      ...t,
      temperature: Math.min(t.temperature, 0.2)
    },
    providerId: "output-evaluator",
    systemPrompt: Wo(),
    userPrompt: r,
    latestUserMessage: e.userInput,
    messageCount: e.messages.length
  });
  return dc(n, e.routerResult);
}
function dc(e, t) {
  const s = JSON.parse(e), r = lc(s.next_action), n = hr(s.should_evaluate), o = kt(s.missing_criteria), a = hr(s.passed) && o.length === 0;
  return {
    should_evaluate: n,
    passed: a,
    verification_question: os(s.verification_question) || t.verification_question,
    satisfied_criteria: kt(s.satisfied_criteria),
    missing_criteria: o,
    issues: kt(s.issues),
    check_steps: kt(s.check_steps),
    decision_reason: os(s.decision_reason),
    next_action: a ? "final" : r,
    revision_instruction: os(s.revision_instruction),
    confidence: uc(s.confidence)
  };
}
function lc(e) {
  const t = ["final", "revise_answer", "ask_user", "use_tools"];
  if (typeof e != "string")
    return "revise_answer";
  const s = e.trim();
  return t.includes(s) ? s : "revise_answer";
}
function hr(e) {
  return e === !0;
}
function os(e) {
  return typeof e == "string" ? e : "";
}
function kt(e) {
  return Array.isArray(e) ? e.filter((t) => typeof t == "string") : [];
}
function uc(e) {
  return typeof e != "number" || Number.isNaN(e) ? 0 : Math.max(0, Math.min(1, e));
}
async function hc(e) {
  var o;
  const t = ie("planner"), s = Do(), r = qo({
    userInput: e.latestUserMessage,
    routerResult: JSON.stringify(e.routerResult, null, 2),
    toolSelection: JSON.stringify(e.toolSelection, null, 2),
    memories: gc(e.memories ?? []),
    conversationSummary: ((o = e.conversationSummary) == null ? void 0 : o.summary) ?? "",
    recentMessages: e.messages
  }), n = await Ht({
    config: t,
    providerId: "planner",
    systemPrompt: s,
    userPrompt: r,
    latestUserMessage: e.latestUserMessage,
    messageCount: e.messages.length
  });
  return fc(n, e);
}
function fc(e, t) {
  const s = JSON.parse(e), r = Et(s.required_tools).filter((n) => t.toolSelection.selected_tools.includes(n));
  return {
    goal: me(s.goal) || t.routerResult.task_goal || t.routerResult.rewritten_input,
    plan_summary: me(s.plan_summary),
    execution_plan: mc(s.execution_plan),
    required_tools: r,
    files_to_inspect: Et(s.files_to_inspect),
    files_to_modify: Et(s.files_to_modify),
    risks: Et(s.risks),
    needs_user_confirmation: s.needs_user_confirmation === !0,
    confirmation_reason: me(s.confirmation_reason),
    expected_result: me(s.expected_result) || t.routerResult.expected_output,
    execution_instruction: me(s.execution_instruction),
    confidence: _c(s.confidence)
  };
}
function mc(e) {
  return Array.isArray(e) ? e.map((t, s) => {
    const r = pc(t);
    return {
      step: typeof r.step == "number" ? r.step : s + 1,
      title: me(r.title),
      detail: me(r.detail)
    };
  }).filter((t) => t.title || t.detail).slice(0, 6) : [];
}
function gc(e) {
  return e.length === 0 ? "" : e.map((t) => [
    `- type: ${t.type}`,
    `  importance: ${t.importance}`,
    `  content: ${t.content}`,
    t.tags.length > 0 ? `  tags: ${t.tags.join(", ")}` : ""
  ].filter((s) => s.length > 0).join(`
`)).join(`
`);
}
function pc(e) {
  return e && typeof e == "object" && !Array.isArray(e) ? e : {};
}
function me(e) {
  return typeof e == "string" ? e : "";
}
function Et(e) {
  return Array.isArray(e) ? e.filter((t) => typeof t == "string") : [];
}
function _c(e) {
  return typeof e != "number" || Number.isNaN(e) ? 0 : Math.max(0, Math.min(1, e));
}
const vn = /```(?:json)?\s*([\s\S]*?)```/gi, yc = /* @__PURE__ */ new Set([
  "command.run",
  "file.read",
  "file.list",
  "file.search",
  "file.write",
  "memory.save"
]);
function bc(e) {
  const t = Sc(e), s = [];
  for (const r of t) {
    const n = gs(r);
    Ge(n, s);
  }
  return s.slice(0, 8);
}
function wc(e) {
  const t = e.replace(vn, (o, a) => {
    const i = gs((a ?? "").trim()), l = [];
    return Ge(i, l), l.length > 0 ? "" : o;
  }), s = t.trim(), r = gs(s), n = [];
  return Ge(r, n), n.length > 0 ? "" : t.trim();
}
function Sc(e) {
  var n;
  const t = [];
  let s;
  for (; s = vn.exec(e); )
    t.push(((n = s[1]) == null ? void 0 : n.trim()) ?? "");
  const r = e.trim();
  return (r.startsWith("{") || r.startsWith("[")) && t.push(r), t.filter((o) => o.length > 0);
}
function gs(e) {
  try {
    return JSON.parse(e);
  } catch {
    return;
  }
}
function Ge(e, t) {
  if (Array.isArray(e)) {
    e.forEach((s) => Ge(s, t));
    return;
  }
  if (Ac(e)) {
    if (typeof e.type == "string" && yc.has(e.type)) {
      const s = Ic(e);
      s && t.push(s);
    }
    for (const s of Object.values(e))
      Ge(s, t);
  }
}
function Ic(e) {
  if (e.type === "command.run")
    return Mc(e);
  if (e.type === "file.read")
    return Tc(e);
  if (e.type === "file.list")
    return kc(e);
  if (e.type === "file.search")
    return Ec(e);
  if (e.type === "file.write")
    return Rc(e);
  if (e.type === "memory.save")
    return xc(e);
}
function Mc(e) {
  if (!(typeof e.command != "string" || e.command.trim().length === 0))
    return {
      type: "command.run",
      reason: typeof e.reason == "string" ? e.reason : "",
      shell: "powershell",
      cwd: typeof e.cwd == "string" && e.cwd.trim().length > 0 ? e.cwd : Re(),
      command: e.command
    };
}
function Tc(e) {
  if (!(typeof e.path != "string" || e.path.trim().length === 0))
    return {
      type: "file.read",
      reason: rt(e),
      path: e.path,
      maxBytes: Ls(e.maxBytes)
    };
}
function kc(e) {
  if (!(typeof e.path != "string" || e.path.trim().length === 0))
    return {
      type: "file.list",
      reason: rt(e),
      path: e.path,
      recursive: e.recursive === !0,
      maxEntries: Ls(e.maxEntries)
    };
}
function Ec(e) {
  if (!(typeof e.query != "string" || e.query.trim().length === 0))
    return {
      type: "file.search",
      reason: rt(e),
      path: typeof e.path == "string" && e.path.trim().length > 0 ? e.path : void 0,
      query: e.query,
      glob: typeof e.glob == "string" && e.glob.trim().length > 0 ? e.glob : void 0,
      maxResults: Ls(e.maxResults)
    };
}
function Rc(e) {
  if (!(typeof e.path != "string" || e.path.trim().length === 0 || typeof e.content != "string"))
    return {
      type: "file.write",
      reason: rt(e),
      path: e.path,
      content: e.content
    };
}
function xc(e) {
  if (!(typeof e.content != "string" || e.content.trim().length === 0))
    return {
      type: "memory.save",
      reason: rt(e),
      content: e.content,
      memoryType: vc(e.memoryType),
      tags: Array.isArray(e.tags) ? e.tags.filter((t) => typeof t == "string") : void 0,
      importance: typeof e.importance == "number" ? e.importance : void 0
    };
}
function rt(e) {
  return typeof e.reason == "string" ? e.reason : "";
}
function Ls(e) {
  return typeof e == "number" && Number.isInteger(e) && e > 0 ? e : void 0;
}
function vc(e) {
  return typeof e == "string" && ["fact", "preference", "decision", "plan", "constraint"].includes(e) ? e : void 0;
}
function Ac(e) {
  return typeof e == "object" && e !== null;
}
const Oc = 0.7, jc = "command.run", Lc = ["file.read", "file.list", "file.search"], Pc = ["file.write"], $c = ["memory.save"];
function Nc(e) {
  const t = e.confidence;
  return {
    selected_tools: Uc(),
    access_mode: "project_write",
    reason: Cc(e),
    confidence_threshold: Oc,
    router_confidence: t,
    auto_allowed: !0
  };
}
function Uc() {
  return [...Lc, ...Pc, jc, ...$c];
}
function Cc(e) {
  return e.tool_reason ? e.tool_reason : (e.intent === "code" || e.intent === "debug", "管理员 Agent 模式：默认开放读取、写入、记忆和命令工具；删除类命令会在结果中提醒。");
}
function Dc() {
  const e = ie("main");
  return [
    {
      id: "mimo-v2-5-pro",
      providerId: e.providerKind,
      label: e.label || "Main Model",
      model: e.model || Pt,
      status: e.providerKind === "ollama" || e.apiKey ? "configured" : "missing-config",
      capabilities: {
        chat: !0,
        streamChat: !0,
        structuredOutput: !1,
        toolCalling: e.toolCallingMode === "native-openai"
      }
    }
  ];
}
async function qc(e) {
  let t = null;
  if (await An(e, (s) => {
    if (s.type === "done" && (t = {
      session: s.session,
      assistantMessage: s.assistantMessage
    }), s.type === "error")
      throw new Error(s.error);
  }), !t)
    throw new Error("MiMo 未返回内容。");
  return t;
}
async function An(e, t) {
  const s = (/* @__PURE__ */ new Date()).toISOString(), r = Wn(e, s);
  let n = "会话压缩";
  try {
    t({
      type: "stage",
      label: "会话压缩",
      detail: "正在检查是否需要压缩较早对话"
    });
    const o = await ri({
      projectId: r.projectId,
      sessionId: r.id,
      messages: r.messages
    }), a = td(e.message, s), i = [...r.messages, a], l = `msg-assistant-${Date.now()}`, d = ie("router");
    $s({
      projectId: r.projectId,
      sessionId: r.id,
      message: a
    }), n = "Router 任务分析", t({
      type: "stage",
      label: n,
      detail: `正在调用 ${d.label} (${d.model})`
    });
    const h = await Ji(i, e.message);
    Yn({
      projectId: r.projectId,
      sessionId: r.id,
      content: JSON.stringify(h, null, 2)
    });
    const p = oi({
      projectId: r.projectId,
      sessionId: r.id,
      userMessageId: a.id,
      userContent: e.message,
      routerResult: h
    });
    so({
      projectId: r.projectId,
      sessionId: r.id,
      memories: p
    });
    const b = ai({
      projectId: r.projectId,
      query: [
        e.message,
        h.rewritten_input,
        h.keywords.join(" "),
        h.task_goal
      ].join(" "),
      limit: 6
    });
    ro({
      projectId: r.projectId,
      sessionId: r.id,
      memories: b
    });
    const m = Nc(h);
    Gn({
      projectId: r.projectId,
      sessionId: r.id,
      result: m
    });
    const S = Fc(h) ? await Kc({
      messages: i,
      latestUserMessage: e.message,
      routerResult: h,
      toolSelection: m,
      conversationSummary: o,
      memories: b,
      projectId: r.projectId,
      sessionId: r.id,
      setCurrentStage: (Q) => {
        n = Q;
      },
      onEvent: t
    }) : void 0, x = S || {
      skipped: !0,
      reason: Wc(h)
    }, v = JSON.stringify(
      {
        router: h,
        planning: x,
        tool_selection: m
      },
      null,
      2
    );
    n = "大模型执行", t({
      type: "stage",
      label: n,
      detail: S ? `Planning: ${S.goal || h.intent} / tools ${S.required_tools.join(", ") || m.selected_tools.join(", ") || "none"}` : `Router: ${h.workflow_decision.workflow_route} / 跳过 Planning`
    }), t({
      type: "start",
      sessionId: r.id,
      messageId: l,
      roleLabel: "MiMo"
    });
    const A = await vs({
      messages: i,
      latestUserMessage: e.message,
      routerContext: v,
      conversationSummary: o,
      memories: b,
      toolSelection: m,
      executeToolRequest: async (Q) => {
        t({
          type: "stage",
          label: "原生工具执行",
          detail: `正在执行 ${Q.type}`
        }), pr({
          projectId: r.projectId,
          sessionId: r.id,
          request: Q
        });
        const Ae = await En({
          request: Q,
          toolSelection: m,
          projectId: r.projectId,
          sessionId: r.id
        });
        return _r({
          projectId: r.projectId,
          sessionId: r.id,
          result: Ae
        }), Ae;
      },
      onDelta: (Q) => {
        t({
          type: "delta",
          sessionId: r.id,
          messageId: l,
          delta: Q
        });
      }
    });
    ps({
      projectId: r.projectId,
      sessionId: r.id,
      stopReason: A.stopReason,
      usage: A.usage
    });
    const E = wc(A.content);
    E !== A.content && t({
      type: "replace",
      sessionId: r.id,
      messageId: l,
      content: E
    });
    const W = await Gc({
      content: A.content,
      projectId: r.projectId,
      sessionId: r.id,
      toolSelection: m,
      onEvent: t,
      assistantMessageId: l
    }), H = W.length > 0 ? await Qc({
      baseMessages: i,
      assistantMessageId: l,
      firstAssistantContent: E,
      projectId: r.projectId,
      sessionId: r.id,
      runtimeContext: v,
      toolResults: W,
      onEvent: t
    }) : void 0, ce = H ? `

【工具结果整理】
${H.content}` : "", ve = `${E}${ce}`, G = await Xc({
      messages: i,
      userInput: e.message,
      routerResult: h,
      assistantMessageId: l,
      projectId: r.projectId,
      sessionId: r.id,
      content: ve,
      runtimeContext: v,
      onEvent: t
    }), nt = Vc(
      G.content,
      (H == null ? void 0 : H.stopReason) ?? A.stopReason
    ), _e = Kn(
      r,
      i,
      l,
      "MiMo",
      nt,
      Bc(A)
    );
    $s({
      projectId: r.projectId,
      sessionId: r.id,
      message: _e.assistantMessage
    }), t({
      type: "done",
      session: _e.session,
      assistantMessage: _e.assistantMessage
    });
  } catch (o) {
    const a = o instanceof Error ? o.message : String(o);
    yr({
      projectId: r.projectId,
      sessionId: r.id,
      message: a,
      stage: n
    }), t({
      type: "error",
      error: a
    });
  }
}
function Bc(e) {
  if (!(!e.nativeMessages || e.nativeMessages.length === 0))
    return {
      openaiNativeMessages: e.nativeMessages,
      nativeToolResults: e.nativeToolResults ?? []
    };
}
function Fc(e) {
  return e.workflow_decision.workflow_route === "planning" ? !0 : e.workflow_decision.workflow_route === "ask_user" || e.workflow_decision.workflow_route === "reject" ? !1 : e.workflow_decision.planning_required;
}
function Wc(e) {
  return e.workflow_decision.workflow_route === "answer_only" ? "Router 判断本轮可直接回答，不需要进入 Planning。" : e.workflow_decision.workflow_route === "ask_user" ? "Router 判断本轮需要先追问用户，跳过 Planning。" : e.workflow_decision.workflow_route === "reject" ? "Router 判断本轮存在高风险或不可执行请求，跳过 Planning。" : "Router 未要求 Planning。";
}
async function Kc(e) {
  const t = ie("planner");
  e.setCurrentStage("规划目标"), e.onEvent({
    type: "stage",
    label: "规划目标",
    detail: `正在调用 ${t.label} (${t.model})`
  });
  const s = await hc({
    messages: e.messages,
    latestUserMessage: e.latestUserMessage,
    routerResult: e.routerResult,
    toolSelection: e.toolSelection,
    conversationSummary: e.conversationSummary,
    memories: e.memories
  });
  return Zn({
    projectId: e.projectId,
    sessionId: e.sessionId,
    result: s
  }), s;
}
async function Xc(e) {
  if (!Hc(e.routerResult))
    return {
      content: e.content
    };
  e.onEvent({
    type: "stage",
    label: "输出验收",
    detail: "正在检查大模型回复是否满足本轮成功条件"
  });
  let t;
  try {
    t = await cc({
      messages: e.messages,
      userInput: e.userInput,
      routerResult: e.routerResult,
      assistantAnswer: e.content
    }), to({
      projectId: e.projectId,
      sessionId: e.sessionId,
      result: t
    });
    const r = Jc({
      projectId: e.projectId,
      sessionId: e.sessionId,
      evaluation: t,
      routerResult: e.routerResult
    });
    r && no({
      projectId: e.projectId,
      sessionId: e.sessionId,
      record: r
    });
  } catch (r) {
    return yr({
      projectId: e.projectId,
      sessionId: e.sessionId,
      message: r instanceof Error ? r.message : String(r),
      stage: "输出验收"
    }), {
      content: e.content
    };
  }
  if (t.passed || t.next_action === "final")
    return {
      content: e.content,
      evaluation: t
    };
  if (t.next_action !== "revise_answer")
    return {
      content: [
        e.content.trimEnd(),
        "",
        zc(t)
      ].join(`
`),
      evaluation: t
    };
  const s = await Yc({
    baseMessages: e.messages,
    assistantMessageId: e.assistantMessageId,
    firstAssistantContent: e.content,
    userInput: e.userInput,
    projectId: e.projectId,
    sessionId: e.sessionId,
    runtimeContext: e.runtimeContext,
    evaluation: t,
    onEvent: e.onEvent
  });
  return {
    content: `${e.content}

【补充修正】
${s.content}`,
    evaluation: t
  };
}
function Jc(e) {
  if (e.evaluation.passed || e.evaluation.next_action === "final")
    return;
  const t = e.evaluation.next_action === "use_tools" ? "main.agent.v1" : "output.evaluator.v1", s = [
    `Evaluator next_action=${e.evaluation.next_action}`,
    e.evaluation.decision_reason,
    e.evaluation.missing_criteria.length > 0 ? `missing=${e.evaluation.missing_criteria.join("；")}` : "",
    e.evaluation.issues.length > 0 ? `issues=${e.evaluation.issues.join("；")}` : ""
  ].filter((n) => n.trim().length > 0).join("；"), r = [
    `建议检查模板 ${t}。`,
    `任务类型：${e.routerResult.task_type}，意图：${e.routerResult.intent}。`,
    e.routerResult.expected_output ? `期望产出：${e.routerResult.expected_output}。` : "",
    e.evaluation.revision_instruction ? `修正指令：${e.evaluation.revision_instruction}` : "",
    e.evaluation.missing_criteria.length > 0 ? `需要补强的验收项：${e.evaluation.missing_criteria.join("；")}` : ""
  ].filter((n) => n.trim().length > 0).join(`
`);
  return qi({
    projectId: e.projectId,
    sessionId: e.sessionId,
    targetTemplate: t,
    trigger: "evaluation_gap",
    reason: s || "输出验收认为当前回复仍需后续动作。",
    suggestedChange: r,
    sourceEventIds: []
  });
}
function Hc(e) {
  return !e.is_task || e.intent === "chat" ? !1 : e.verification_question.trim().length > 0 || e.success_criteria.length > 0;
}
function zc(e) {
  return e.next_action === "ask_user" ? [
    "[系统提示：本轮输出验收认为还需要用户补充信息。]",
    e.revision_instruction || e.issues.join("；")
  ].filter((t) => t.trim().length > 0).join(`
`) : e.next_action === "use_tools" ? [
    "[系统提示：本轮输出验收认为还需要工具或项目上下文才能继续。]",
    e.revision_instruction || e.issues.join("；")
  ].filter((t) => t.trim().length > 0).join(`
`) : "";
}
function Vc(e, t) {
  return t !== "max_tokens" ? e : [
    e.trimEnd(),
    "",
    "[系统提示：本次回复达到 max_tokens 输出上限，内容可能被截断。可以输入“继续”让我接着补完。]"
  ].join(`
`);
}
async function Qc(e) {
  const t = Zc(e.toolResults), s = [
    ...e.baseMessages,
    {
      id: `msg-tool-request-${Date.now()}`,
      sender: "assistant",
      roleLabel: "MiMo",
      content: e.firstAssistantContent,
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
        t
      ].join(`
`),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  ];
  e.onEvent({
    type: "stage",
    label: "工具结果整理",
    detail: "正在让 MiMo 基于工具结果生成最终回应"
  }), e.onEvent({
    type: "delta",
    sessionId: e.sessionId,
    messageId: e.assistantMessageId,
    delta: `

【工具结果整理】
`
  });
  const r = await vs({
    messages: s,
    latestUserMessage: "系统工具结果",
    routerContext: JSON.stringify(
      {
        phase: "tool_result_followup",
        previous_runtime_context: JSON.parse(e.runtimeContext),
        tool_results: e.toolResults
      },
      null,
      2
    ),
    onDelta: (n) => {
      e.onEvent({
        type: "delta",
        sessionId: e.sessionId,
        messageId: e.assistantMessageId,
        delta: n
      });
    }
  });
  return ps({
    projectId: e.projectId,
    sessionId: e.sessionId,
    stopReason: r.stopReason,
    usage: r.usage
  }), r;
}
async function Yc(e) {
  const t = [
    ...e.baseMessages,
    {
      id: `msg-eval-answer-${Date.now()}`,
      sender: "assistant",
      roleLabel: "MiMo",
      content: e.firstAssistantContent,
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
        JSON.stringify(e.evaluation, null, 2)
      ].join(`
`),
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    }
  ];
  e.onEvent({
    type: "stage",
    label: "补充修正",
    detail: "输出验收未通过，正在让大模型补充缺失内容"
  }), e.onEvent({
    type: "delta",
    sessionId: e.sessionId,
    messageId: e.assistantMessageId,
    delta: `

【补充修正】
`
  });
  const s = await vs({
    messages: t,
    latestUserMessage: "系统输出验收",
    routerContext: JSON.stringify(
      {
        phase: "output_evaluation_revision",
        previous_runtime_context: e.runtimeContext,
        original_user_input: e.userInput,
        output_evaluation: e.evaluation
      },
      null,
      2
    ),
    onDelta: (r) => {
      e.onEvent({
        type: "delta",
        sessionId: e.sessionId,
        messageId: e.assistantMessageId,
        delta: r
      });
    }
  });
  return ps({
    projectId: e.projectId,
    sessionId: e.sessionId,
    stopReason: s.stopReason,
    usage: s.usage
  }), s;
}
async function Gc(e) {
  const t = bc(e.content), s = [];
  if (t.length === 0)
    return s;
  e.onEvent({
    type: "stage",
    label: "工具执行",
    detail: `检测到 ${t.length} 个本地工具请求，正在交给 Tool Gateway`
  });
  for (const r of t) {
    pr({
      projectId: e.projectId,
      sessionId: e.sessionId,
      request: r
    });
    const n = await En({
      request: r,
      toolSelection: e.toolSelection,
      projectId: e.projectId,
      sessionId: e.sessionId
    });
    _r({
      projectId: e.projectId,
      sessionId: e.sessionId,
      result: n
    }), s.push(n);
  }
  return s;
}
function Zc(e) {
  return e.length === 0 ? "" : [
    "",
    "",
    "【系统工具执行结果】",
    ...e.map((t, s) => [
      "",
      `#${s + 1} ${ed(t)}`,
      `decision: ${t.decision}`,
      `status: ${t.status}`,
      `reason: ${t.reason}`,
      typeof t.exitCode == "number" ? `exitCode: ${t.exitCode}` : "",
      t.output ? `output:
${t.output}` : "",
      t.stdout ? `stdout:
${t.stdout}` : "",
      t.stderr ? `stderr:
${t.stderr}` : "",
      t.data ? `data:
${JSON.stringify(t.data, null, 2)}` : ""
    ].filter((r) => r.length > 0).join(`
`))
  ].join(`
`);
}
function ed(e) {
  return e.request.type === "command.run" ? `command.run ${e.request.command}` : e.request.type === "file.read" || e.request.type === "file.list" || e.request.type === "file.write" ? `${e.request.type} ${e.request.path}` : e.request.type === "file.search" ? `${e.request.type} ${e.request.query}` : `${e.request.type} ${e.request.content.slice(0, 60)}`;
}
function td(e, t) {
  return {
    id: `msg-user-${Date.now()}`,
    sender: "user",
    roleLabel: "你",
    content: e,
    createdAt: t
  };
}
const sd = Cn(import.meta.url), On = y.dirname(sd);
process.env.APP_ROOT = y.join(On, "..");
const fr = process.env.VITE_DEV_SERVER_URL, rd = y.join(process.env.APP_ROOT, "dist"), nd = y.join(On, "preload.cjs");
let Rt = null;
async function mr() {
  Rt = new gr({
    title: "XiaoMi Agent Workbench",
    width: 1380,
    height: 880,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#0f1316",
    webPreferences: {
      preload: nd,
      nodeIntegration: !1,
      contextIsolation: !0,
      sandbox: !1
    }
  }), fr ? (await Rt.loadURL(fr), Rt.webContents.openDevTools({ mode: "detach" })) : await Rt.loadFile(y.join(rd, "index.html"));
}
Lt.whenReady().then(async () => {
  od(), await mr(), Lt.on("activate", async () => {
    gr.getAllWindows().length === 0 && await mr();
  });
});
Lt.on("window-all-closed", () => {
  process.platform !== "darwin" && Lt.quit();
});
function od() {
  de.handle("workbench:get-initial-state", () => ({
    modelProfiles: Dc()
  })), de.handle("workbench:send-chat-message", async (e, t) => qc(t)), de.handle("workbench:stream-chat-message", async (e, t) => (await An(t, (s) => {
    e.sender.isDestroyed() || e.sender.send("workbench:chat-stream-event", s);
  }), { ok: !0 })), de.handle("workbench:list-provider-debug-logs", () => Ua()), de.handle("workbench:list-session-events", (e, t) => oo({
    projectId: t.projectId,
    sessionId: t.sessionId,
    limit: 100
  })), de.handle("workbench:get-model-runtime-settings", () => Ir()), de.handle("workbench:save-model-runtime-settings", (e, t) => uo(t));
}
