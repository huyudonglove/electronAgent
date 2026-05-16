import type { ChatMessage } from "@xiaomi/shared";
import { getDatabase } from "./storage/database";

export interface ConversationSummary {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly sourceStartMessageId: string;
  readonly sourceEndMessageId: string;
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly constraints: readonly string[];
  readonly taskProgress: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface ConversationSummaryRow {
  readonly id: string;
  readonly project_id: string;
  readonly session_id: string;
  readonly source_start_message_id: string;
  readonly source_end_message_id: string;
  readonly summary: string;
  readonly decisions_json: string;
  readonly open_questions_json: string;
  readonly constraints_json: string;
  readonly task_progress_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ConversationSummaryInput {
  readonly projectId: string;
  readonly sessionId: string;
  readonly sourceMessages: readonly ChatMessage[];
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly constraints: readonly string[];
  readonly taskProgress: readonly string[];
}

export function getLatestConversationSummary(projectId: string, sessionId: string): ConversationSummary | undefined {
  const row = getDatabase()
    .prepare(
      `
        SELECT *
        FROM conversation_summaries
        WHERE project_id = ? AND session_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `
    )
    .get(projectId, sessionId) as ConversationSummaryRow | undefined;

  return row ? toConversationSummary(row) : undefined;
}

export function saveConversationSummary(input: ConversationSummaryInput): ConversationSummary {
  const now = new Date().toISOString();
  const firstMessage = input.sourceMessages[0];
  const lastMessage = input.sourceMessages.at(-1);

  if (!firstMessage || !lastMessage) {
    throw new Error("会话压缩失败：没有可压缩的消息。");
  }

  const summary: ConversationSummary = {
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

  getDatabase()
    .prepare(
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
    )
    .run(
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

function toConversationSummary(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id,
    summary: row.summary,
    decisions: parseStringArray(row.decisions_json),
    openQuestions: parseStringArray(row.open_questions_json),
    constraints: parseStringArray(row.constraints_json),
    taskProgress: parseStringArray(row.task_progress_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseStringArray(value: string): readonly string[] {
  const parsed = JSON.parse(value) as unknown;

  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}
