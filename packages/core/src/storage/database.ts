import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { resolveProjectPath } from "../utils/projectRoot";

let database: Database.Database | undefined;

export function getDatabase(): Database.Database {
  if (database) {
    return database;
  }

  const dataDir = resolveProjectPath("data");
  fs.mkdirSync(dataDir, { recursive: true });

  database = new Database(path.join(dataDir, "agent.db"));
  database.pragma("journal_mode = WAL");
  migrate(database);

  return database;
}

function migrate(db: Database.Database): void {
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
  `);
}
