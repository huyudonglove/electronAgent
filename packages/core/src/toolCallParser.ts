import type {
  CommandRunRequest,
  FileListRequest,
  FileReadRequest,
  FileSearchRequest,
  FileWriteRequest,
  MemorySaveRequest,
  MemoryType,
  ToolRequest
} from "@xiaomi/shared";
import { resolveProjectPath } from "./utils/projectRoot";
import { parseModelJson } from "./utils/parseModelJson";

const JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/gi;
const TOOL_CALLS_BLOCK_PATTERN = /<tool_calls>[\s\S]*?<\/tool_calls>/gi;
const TOOL_CALL_BLOCK_PATTERN = /<tool_call>[\s\S]*?<\/tool_call>/gi;
const XML_TOOL_CALL_PATTERN = /<function>([^<]+)<\/function>\s*<parameters>([\s\S]*?)<\/parameters>/gi;
const TOOL_TYPES = new Set([
  "command.run",
  "file.read",
  "file.list",
  "file.search",
  "file.write",
  "memory.save"
]);

export function parseCommandRunRequests(content: string): readonly CommandRunRequest[] {
  return parseLocalToolRequests(content).filter((request): request is CommandRunRequest => request.type === "command.run");
}

export function parseLocalToolRequests(content: string): readonly ToolRequest[] {
  const candidates = collectJsonCandidates(content);
  const requests: ToolRequest[] = [];

  for (const candidate of candidates) {
    const parsed = parseJson(candidate);
    collectRequests(parsed, requests);
  }

  requests.push(...collectXmlToolRequests(content));

  return requests.slice(0, 8);
}

export function removeCommandRunRequestBlocks(content: string): string {
  return removeLocalToolRequestBlocks(content);
}

export function removeLocalToolRequestBlocks(content: string): string {
  const withoutFencedRequests = content.replace(JSON_FENCE_PATTERN, (block, jsonContent: string | undefined) => {
    const parsed = parseJson((jsonContent ?? "").trim());
    const requests: ToolRequest[] = [];
    collectRequests(parsed, requests);

    return requests.length > 0 ? "" : block;
  });
  const withoutXmlRequests = withoutFencedRequests
    .replace(TOOL_CALLS_BLOCK_PATTERN, "")
    .replace(TOOL_CALL_BLOCK_PATTERN, "");
  const trimmed = withoutXmlRequests.trim();
  const parsed = parseJson(trimmed);
  const requests: ToolRequest[] = [];
  collectRequests(parsed, requests);

  if (requests.length > 0) {
    return "";
  }

  return withoutXmlRequests.trim();
}

function collectJsonCandidates(content: string): readonly string[] {
  const candidates: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = JSON_FENCE_PATTERN.exec(content))) {
    candidates.push(match[1]?.trim() ?? "");
  }

  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.push(trimmed);
  }

  return candidates.filter((candidate) => candidate.length > 0);
}

function parseJson(content: string): unknown {
  try {
    return parseModelJson<unknown>(content, "Tool request");
  } catch {
    return undefined;
  }
}

function collectXmlToolRequests(content: string): readonly ToolRequest[] {
  const requests: ToolRequest[] = [];
  let match: RegExpExecArray | null;

  while ((match = XML_TOOL_CALL_PATTERN.exec(content))) {
    const functionName = match[1]?.trim() ?? "";
    const parameterBlock = match[2] ?? "";

    if (!TOOL_TYPES.has(functionName)) {
      continue;
    }

    const value = xmlToolCallToRecord(functionName, parameterBlock);
    const request = toToolRequest(value);
    if (request) {
      requests.push(request);
    }
  }

  return requests;
}

function xmlToolCallToRecord(functionName: string, parameterBlock: string): Record<string, unknown> {
  const record: Record<string, unknown> = {
    type: functionName
  };
  const parameterPattern = /<([a-zA-Z0-9_.-]+)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = parameterPattern.exec(parameterBlock))) {
    const key = match[1]?.trim() ?? "";
    const rawValue = (match[2] ?? "").trim();
    if (!key) {
      continue;
    }

    record[key] = normalizeXmlParameterValue(rawValue);
  }

  return record;
}

function normalizeXmlParameterValue(value: string): unknown {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (/^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : value;
  }

  return value;
}

function collectRequests(value: unknown, requests: ToolRequest[]): void {
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

function toToolRequest(value: Record<string, unknown>): ToolRequest | undefined {
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

  return undefined;
}

function toCommandRunRequest(value: Record<string, unknown>): CommandRunRequest | undefined {
  if (typeof value.command !== "string" || value.command.trim().length === 0) {
    return undefined;
  }

  return {
    type: "command.run",
    reason: typeof value.reason === "string" ? value.reason : "",
    shell: "powershell",
    cwd: typeof value.cwd === "string" && value.cwd.trim().length > 0 ? value.cwd : resolveProjectPath(),
    command: value.command
  };
}

function toFileReadRequest(value: Record<string, unknown>): FileReadRequest | undefined {
  if (typeof value.path !== "string" || value.path.trim().length === 0) {
    return undefined;
  }

  return {
    type: "file.read",
    reason: toReason(value),
    path: value.path,
    maxBytes: toPositiveInteger(value.maxBytes)
  };
}

function toFileListRequest(value: Record<string, unknown>): FileListRequest | undefined {
  if (typeof value.path !== "string" || value.path.trim().length === 0) {
    return undefined;
  }

  return {
    type: "file.list",
    reason: toReason(value),
    path: value.path,
    recursive: value.recursive === true,
    maxEntries: toPositiveInteger(value.maxEntries)
  };
}

function toFileSearchRequest(value: Record<string, unknown>): FileSearchRequest | undefined {
  if (typeof value.query !== "string" || value.query.trim().length === 0) {
    return undefined;
  }

  return {
    type: "file.search",
    reason: toReason(value),
    path: typeof value.path === "string" && value.path.trim().length > 0 ? value.path : undefined,
    query: value.query,
    glob: typeof value.glob === "string" && value.glob.trim().length > 0 ? value.glob : undefined,
    maxResults: toPositiveInteger(value.maxResults)
  };
}

function toFileWriteRequest(value: Record<string, unknown>): FileWriteRequest | undefined {
  if (typeof value.path !== "string" || value.path.trim().length === 0 || typeof value.content !== "string") {
    return undefined;
  }

  return {
    type: "file.write",
    reason: toReason(value),
    path: value.path,
    content: value.content
  };
}

function toMemorySaveRequest(value: Record<string, unknown>): MemorySaveRequest | undefined {
  if (typeof value.content !== "string" || value.content.trim().length === 0) {
    return undefined;
  }

  return {
    type: "memory.save",
    reason: toReason(value),
    content: value.content,
    memoryType: toMemoryType(value.memoryType),
    tags: Array.isArray(value.tags) ? value.tags.filter((item): item is string => typeof item === "string") : undefined,
    importance: typeof value.importance === "number" ? value.importance : undefined
  };
}

function toReason(value: Record<string, unknown>): string {
  return typeof value.reason === "string" ? value.reason : "";
}

function toPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function toMemoryType(value: unknown): MemoryType | undefined {
  const allowed: readonly MemoryType[] = ["fact", "preference", "decision", "plan", "constraint"];
  return typeof value === "string" && allowed.includes(value as MemoryType) ? value as MemoryType : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
