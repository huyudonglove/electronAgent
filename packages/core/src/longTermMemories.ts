import type { MemoryRecord, MemoryType, RouterResult } from "@xiaomi/shared";
import { getDatabase } from "./storage/database";

interface MemoryRow {
  readonly id: string;
  readonly project_id: string;
  readonly type: MemoryType;
  readonly content: string;
  readonly tags_json: string;
  readonly importance: number;
  readonly confidence: number;
  readonly source_session_id?: string;
  readonly source_event_ids_json: string;
  readonly status: "active" | "archived";
  readonly created_at: string;
  readonly updated_at: string;
}

export function captureLongTermMemories(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly userMessageId: string;
  readonly userContent: string;
  readonly routerResult: RouterResult;
}): readonly MemoryRecord[] {
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

export function saveMemory(input: {
  readonly projectId: string;
  readonly type: MemoryType;
  readonly content: string;
  readonly tags: readonly string[];
  readonly importance: number;
  readonly confidence: number;
  readonly sourceSessionId?: string;
  readonly sourceEventIds: readonly string[];
}): MemoryRecord {
  const now = new Date().toISOString();
  const memory: MemoryRecord = {
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

  getDatabase()
    .prepare(
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
    )
    .run(
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

export function listRelevantMemories(input: {
  readonly projectId: string;
  readonly query: string;
  readonly limit?: number;
}): readonly MemoryRecord[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM memories
        WHERE project_id = ? AND status = 'active'
        ORDER BY importance DESC, updated_at DESC
        LIMIT 80
      `
    )
    .all(input.projectId) as MemoryRow[];
  const queryTerms = terms(input.query);

  return rows
    .map(toMemoryRecord)
    .map((memory) => ({
      memory,
      score: scoreMemory(memory, queryTerms)
    }))
    .filter((item) => item.score > 0 || item.memory.importance >= 0.8)
    .sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance)
    .slice(0, input.limit ?? 6)
    .map((item) => item.memory);
}

function shouldCaptureMemory(content: string, routerResult: RouterResult): boolean {
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

  return explicitSignals.some((signal) => normalized.includes(signal.toLowerCase()))
    || routerResult.task_type === "design"
    && routerResult.keywords.some((keyword) => ["记忆", "提示词", "架构", "规则"].includes(keyword));
}

function inferMemoryType(content: string): MemoryType {
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

function inferImportance(content: string): number {
  if (content.includes("系统规则") || content.includes("必须") || content.includes("长期")) {
    return 0.9;
  }

  if (content.includes("我希望") || content.includes("决定") || content.includes("确认")) {
    return 0.8;
  }

  return 0.65;
}

function scoreMemory(memory: MemoryRecord, queryTerms: readonly string[]): number {
  const haystack = `${memory.content} ${memory.tags.join(" ")}`.toLowerCase();
  const termScore = queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);

  return termScore + memory.importance * 0.5 + memory.confidence * 0.25;
}

function terms(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(/[\s,，。！？、:：;；"'`]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function toMemoryRecord(row: MemoryRow): MemoryRecord {
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

function parseStringArray(value: string): readonly string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
