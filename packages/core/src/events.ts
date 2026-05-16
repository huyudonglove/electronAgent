import { randomUUID } from "node:crypto";
import type {
  AgentEventRecord,
  AgentEventType,
  ChatMessage,
  CommandRunRequest,
  CommandRunResult,
  ToolSelectionResult
} from "@xiaomi/shared";
import { getDatabase } from "./storage/database";

interface EventRow {
  readonly id: string;
  readonly project_id: string;
  readonly session_id: string;
  readonly message_id?: string;
  readonly type: AgentEventType;
  readonly actor: string;
  readonly role_label?: string;
  readonly content?: string;
  readonly payload_json: string;
  readonly created_at: string;
}

export function saveChatMessageEvent(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly message: ChatMessage;
}): AgentEventRecord {
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    messageId: input.message.id,
    type: "chat_message",
    actor: input.message.sender,
    roleLabel: input.message.roleLabel,
    content: input.message.content,
    payload: {
      createdAt: input.message.createdAt
    },
    createdAt: input.message.createdAt
  });
}

export function saveRouterResultEvent(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly content: string;
}): AgentEventRecord {
  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "router_result",
    actor: "router",
    roleLabel: "Ollama Router",
    content: input.content,
    payload: parseJsonPayload(input.content),
    createdAt: new Date().toISOString()
  });
}

export function saveToolSelectionEvent(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly result: ToolSelectionResult;
}): AgentEventRecord {
  const content = JSON.stringify(input.result, null, 2);

  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "tool_selection",
    actor: "core",
    roleLabel: "Tool Selection Policy",
    content,
    payload: input.result,
    createdAt: new Date().toISOString()
  });
}

export function saveToolCallEvent(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly request: CommandRunRequest;
}): AgentEventRecord {
  const content = JSON.stringify(input.request, null, 2);

  return saveEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    type: "tool_call",
    actor: "model",
    roleLabel: "command.run",
    content,
    payload: input.request,
    createdAt: new Date().toISOString()
  });
}

export function saveToolResultEvent(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly result: CommandRunResult;
}): AgentEventRecord {
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
    roleLabel: "Command Gateway",
    content,
    payload: input.result,
    createdAt: new Date().toISOString()
  });
}

export function saveConversationSummaryEvent(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly summaryId: string;
  readonly content: string;
  readonly payload: unknown;
}): AgentEventRecord {
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
    createdAt: new Date().toISOString()
  });
}

export function saveModelReturnEvent(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly stopReason?: string;
  readonly usage?: unknown;
}): AgentEventRecord {
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
    createdAt: new Date().toISOString()
  });
}

export function saveErrorEvent(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly message: string;
  readonly stage?: string;
}): AgentEventRecord {
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
    createdAt: new Date().toISOString()
  });
}

export function listSessionEvents(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly limit?: number;
}): readonly AgentEventRecord[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM events
        WHERE project_id = ? AND session_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `
    )
    .all(input.projectId, input.sessionId, input.limit ?? 100) as EventRow[];

  return rows.map(toEventRecord).reverse();
}

function saveEvent(input: Omit<AgentEventRecord, "id">): AgentEventRecord {
  const event: AgentEventRecord = {
    ...input,
    id: `event-${randomUUID()}`
  };

  getDatabase()
    .prepare(
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
    )
    .run(
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

function toEventRecord(row: EventRow): AgentEventRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    messageId: row.message_id ?? undefined,
    type: row.type,
    actor: row.actor,
    roleLabel: row.role_label ?? undefined,
    content: row.content ?? undefined,
    payload: parseJsonPayload(row.payload_json),
    createdAt: row.created_at
  };
}

function parseJsonPayload(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}
