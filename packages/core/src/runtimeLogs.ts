import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RuntimeLogRecord } from "@xiaomi/shared";
import { getDatabase } from "./storage/database";
import { resolveAppStoragePath } from "./utils/projectRoot";
const MAX_LOGS = 400;

const logs: RuntimeLogRecord[] = [];

export function writeRuntimeLog(input: Omit<RuntimeLogRecord, "id" | "createdAt">): RuntimeLogRecord {
  const record: RuntimeLogRecord = {
    ...input,
    id: `runtime-log-${randomUUID()}`,
    createdAt: new Date().toISOString()
  };

  logs.unshift(record);
  logs.splice(MAX_LOGS);

  getDatabase()
    .prepare(
      `
        INSERT INTO runtime_logs (
          id,
          project_id,
          session_id,
          turn_id,
          stage,
          level,
          message,
          payload_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      record.id,
      record.projectId,
      record.sessionId ?? null,
      record.turnId ?? null,
      record.stage,
      record.level,
      record.message,
      JSON.stringify(record.payload ?? {}),
      record.createdAt
    );

  appendRuntimeLogFile(record);
  return record;
}

export function listRuntimeLogs(input?: {
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly limit?: number;
}): readonly RuntimeLogRecord[] {
  const projectId = input?.projectId;
  const sessionId = input?.sessionId;
  const limit = input?.limit ?? 100;

  return logs
    .filter((record) => !projectId || record.projectId === projectId)
    .filter((record) => !sessionId || record.sessionId === sessionId)
    .slice(0, limit)
    .reverse();
}

function appendRuntimeLogFile(record: RuntimeLogRecord): void {
  const logDir = resolveAppStoragePath("data", "runtime-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const filePath = path.join(logDir, `${record.projectId}.jsonl`);
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
}
