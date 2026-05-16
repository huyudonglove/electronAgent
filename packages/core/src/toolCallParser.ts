import type { CommandRunRequest } from "@xiaomi/shared";
import { resolveProjectPath } from "./utils/projectRoot";

const JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/gi;

export function parseCommandRunRequests(content: string): readonly CommandRunRequest[] {
  const candidates = collectJsonCandidates(content);
  const requests: CommandRunRequest[] = [];

  for (const candidate of candidates) {
    const parsed = parseJson(candidate);
    collectRequests(parsed, requests);
  }

  return requests.slice(0, 8);
}

export function removeCommandRunRequestBlocks(content: string): string {
  const withoutFencedRequests = content.replace(JSON_FENCE_PATTERN, (block, jsonContent: string | undefined) => {
    const parsed = parseJson((jsonContent ?? "").trim());
    const requests: CommandRunRequest[] = [];
    collectRequests(parsed, requests);

    return requests.length > 0 ? "" : block;
  });
  const trimmed = withoutFencedRequests.trim();
  const parsed = parseJson(trimmed);
  const requests: CommandRunRequest[] = [];
  collectRequests(parsed, requests);

  if (requests.length > 0) {
    return "";
  }

  return withoutFencedRequests.trim();
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
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function collectRequests(value: unknown, requests: CommandRunRequest[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRequests(item, requests));
    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (value.type === "command.run") {
    const request = toCommandRunRequest(value);
    if (request) {
      requests.push(request);
    }
  }

  for (const item of Object.values(value)) {
    collectRequests(item, requests);
  }
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
