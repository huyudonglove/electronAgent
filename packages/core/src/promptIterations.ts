import type { PromptIterationRecord } from "@xiaomi/shared";
import { getDatabase } from "./storage/database";

interface PromptIterationRow {
  readonly id: string;
  readonly project_id: string;
  readonly session_id: string;
  readonly target_template: string;
  readonly trigger: PromptIterationRecord["trigger"];
  readonly reason: string;
  readonly suggested_change: string;
  readonly source_event_ids_json: string;
  readonly status: PromptIterationRecord["status"];
  readonly created_at: string;
  readonly updated_at: string;
}

export function savePromptIteration(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly targetTemplate: string;
  readonly trigger: PromptIterationRecord["trigger"];
  readonly reason: string;
  readonly suggestedChange: string;
  readonly sourceEventIds: readonly string[];
}): PromptIterationRecord {
  const now = new Date().toISOString();
  const record: PromptIterationRecord = {
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

  getDatabase()
    .prepare(
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
    )
    .run(
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

export function listPromptIterations(input: {
  readonly projectId: string;
  readonly status?: PromptIterationRecord["status"];
  readonly limit?: number;
}): readonly PromptIterationRecord[] {
  const rows = input.status
    ? getDatabase()
        .prepare(
          `
            SELECT *
            FROM prompt_iterations
            WHERE project_id = ? AND status = ?
            ORDER BY updated_at DESC
            LIMIT ?
          `
        )
        .all(input.projectId, input.status, input.limit ?? 20) as PromptIterationRow[]
    : getDatabase()
        .prepare(
          `
            SELECT *
            FROM prompt_iterations
            WHERE project_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
          `
        )
        .all(input.projectId, input.limit ?? 20) as PromptIterationRow[];

  return rows.map(toPromptIterationRecord);
}

function toPromptIterationRecord(row: PromptIterationRow): PromptIterationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    targetTemplate: row.target_template,
    trigger: row.trigger,
    reason: row.reason,
    suggestedChange: row.suggested_change,
    sourceEventIds: parseStringArray(row.source_event_ids_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseStringArray(value: string): readonly string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}
