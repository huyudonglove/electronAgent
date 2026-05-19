import type {
  AgentEventRecord,
  MemoryPanelData,
  MemoryPanelStats,
  MemoryRecord,
  MemoryTagCount,
  MemoryType,
  MemoryTypeCount,
  RouterResult
} from "@xiaomi/shared";
import { getDatabase } from "./storage/database";
import { listSessionEvents } from "./events";

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

export function listProjectMemories(input: {
  readonly projectId: string;
  readonly limit?: number;
}): readonly MemoryRecord[] {
  const rows = getDatabase()
    .prepare(
      `
        SELECT *
        FROM memories
        WHERE project_id = ? AND status = 'active'
        ORDER BY updated_at DESC, importance DESC
        LIMIT ?
      `
    )
    .all(input.projectId, input.limit ?? 200) as MemoryRow[];

  return rows.map(toMemoryRecord);
}

export function getMemoryPanelData(input: {
  readonly projectId: string;
  readonly sessionId?: string;
}): MemoryPanelData {
  const projectMemories = listProjectMemories({
    projectId: input.projectId,
    limit: 200
  });
  const sessionMemories = input.sessionId
    ? projectMemories.filter((memory) => memory.sourceSessionId === input.sessionId)
    : [];
  const events = input.sessionId
    ? listSessionEvents({
        projectId: input.projectId,
        sessionId: input.sessionId,
        limit: 200
      })
    : [];
  const recentWrites = readMemoriesFromLatestEvent(events, "memory_write");
  const recentRecalls = readMemoriesFromLatestEvent(events, "memory_recall");
  const stats: MemoryPanelStats = {
    recentWrites: recentWrites.length,
    recentRecalls: recentRecalls.length,
    totalProjectMemories: projectMemories.length,
    totalSessionMemories: sessionMemories.length,
    typeCounts: buildMemoryTypeCounts(projectMemories),
    topTags: buildTopTags(projectMemories)
  };

  return {
    stats,
    layers: [
      {
        key: "recent_writes",
        title: "本轮新增",
        description: "这一轮对话刚写入的长期记忆。",
        count: recentWrites.length,
        memories: recentWrites
      },
      {
        key: "recent_recalls",
        title: "本轮召回",
        description: "系统本轮真正拿来参与推理的长期记忆。",
        count: recentRecalls.length,
        memories: recentRecalls
      },
      {
        key: "session_memories",
        title: "当前会话沉淀",
        description: "来自当前会话的历史记忆，适合回顾本段讨论累计了什么。",
        count: sessionMemories.length,
        memories: sessionMemories
      },
      {
        key: "project_memories",
        title: "项目长期记忆",
        description: "当前项目下全部有效长期记忆，按最近更新时间排序。",
        count: projectMemories.length,
        memories: projectMemories
      }
    ]
  };
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

function readMemoriesFromLatestEvent(
  events: readonly AgentEventRecord[],
  type: "memory_write" | "memory_recall"
): readonly MemoryRecord[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== type) {
      continue;
    }

    const payload = asRecord(event.payload);
    const memories = payload.memories;
    if (!Array.isArray(memories)) {
      return [];
    }

    return memories.map(asMemoryRecord).filter((item): item is MemoryRecord => Boolean(item));
  }

  return [];
}

function buildMemoryTypeCounts(memories: readonly MemoryRecord[]): readonly MemoryTypeCount[] {
  const order: readonly MemoryType[] = ["fact", "decision", "plan", "preference", "constraint"];
  const counts = new Map<MemoryType, number>();

  for (const memory of memories) {
    counts.set(memory.type, (counts.get(memory.type) ?? 0) + 1);
  }

  return order.map((type) => ({
    type,
    count: counts.get(type) ?? 0
  }));
}

function buildTopTags(memories: readonly MemoryRecord[]): readonly MemoryTagCount[] {
  const counts = new Map<string, number>();

  for (const memory of memories) {
    for (const tag of memory.tags) {
      const normalized = tag.trim();
      if (!normalized) {
        continue;
      }
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 6)
    .map(([tag, count]) => ({ tag, count }));
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

function asMemoryRecord(value: unknown): MemoryRecord | undefined {
  const record = asRecord(value);
  const id = stringOrEmpty(record.id);
  const projectId = stringOrEmpty(record.projectId);
  const type = record.type;
  const content = stringOrEmpty(record.content);
  const status = record.status;
  const createdAt = stringOrEmpty(record.createdAt);
  const updatedAt = stringOrEmpty(record.updatedAt);

  if (!id || !projectId || !content || !createdAt || !updatedAt) {
    return undefined;
  }

  if (type !== "fact" && type !== "preference" && type !== "decision" && type !== "plan" && type !== "constraint") {
    return undefined;
  }

  if (status !== "active" && status !== "archived") {
    return undefined;
  }

  return {
    id,
    projectId,
    type,
    content,
    tags: arrayOfStrings(record.tags),
    importance: numberOrDefault(record.importance, 0),
    confidence: numberOrDefault(record.confidence, 0),
    sourceSessionId: stringOrUndefined(record.sourceSessionId),
    sourceEventIds: arrayOfStrings(record.sourceEventIds),
    status,
    createdAt,
    updatedAt
  };
}

function parseStringArray(value: string): readonly string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
