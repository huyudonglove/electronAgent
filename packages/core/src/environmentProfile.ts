import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { EnvironmentFingerprint, EnvironmentFingerprintPayload, EnvironmentToolAvailability } from "@xiaomi/shared";
import { getDatabase } from "./storage/database";
import { resolveProjectPath } from "./utils/projectRoot";

interface EnvironmentProfileRow {
  readonly id: string;
  readonly scope: string;
  readonly fingerprint_hash: string;
  readonly summary: string;
  readonly snapshot_json: string;
  readonly payload_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const GLOBAL_SCOPE = "global";

export function ensureEnvironmentFingerprint(): EnvironmentFingerprint {
  const existing = getEnvironmentFingerprint();
  if (existing) {
    return existing;
  }

  const collected = collectEnvironmentFingerprint();
  return saveEnvironmentFingerprint(collected);
}

export function getEnvironmentFingerprint(): EnvironmentFingerprint | undefined {
  const row = getDatabase()
    .prepare(
      `
        SELECT *
        FROM environment_profiles
        WHERE scope = ?
        LIMIT 1
      `
    )
    .get(GLOBAL_SCOPE) as EnvironmentProfileRow | undefined;

  return row ? toEnvironmentFingerprint(row) : undefined;
}

export function formatEnvironmentFingerprintForPrompt(fingerprint: EnvironmentFingerprint): string {
  return [
    "【共享环境指纹】",
    "",
    "以下内容是系统在本地自动采集并长期复用的稳定环境档案，供多个对话和 Agent 共用。",
    "它不是用户本轮输入；除非与当前任务直接相关，不要逐字复述。",
    "",
    `摘要：${fingerprint.summary}`,
    "",
    ...fingerprint.snapshot.map((item) => `- ${item}`),
    "",
    "工具可用性：",
    ...fingerprint.payload.tools.map((tool) => {
      const availability = tool.available ? "available" : "missing";
      return `- ${tool.name}: ${availability}${tool.version ? ` (${tool.version})` : ""}`;
    })
  ].join("\n");
}

function collectEnvironmentFingerprint(): EnvironmentFingerprint {
  const projectRoot = resolveProjectPath();
  const packageJson = readJsonFile(path.join(projectRoot, "package.json"));
  const packageManager = typeof packageJson?.packageManager === "string" ? packageJson.packageManager : "unknown";
  const tools = collectTools();
  const markers = collectMarkers(projectRoot);
  const payload: EnvironmentFingerprintPayload = {
    os: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch
    },
    runtime: {
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
      shell: detectShell()
    },
    workspace: {
      cwd: process.cwd(),
      projectRoot,
      packageManager,
      isGitRepo: fs.existsSync(path.join(projectRoot, ".git")),
      hasPnpmWorkspace: fs.existsSync(path.join(projectRoot, "pnpm-workspace.yaml")),
      appKind: inferAppKind(projectRoot)
    },
    markers,
    tools
  };
  const snapshot = buildSnapshot(payload);
  const summary = buildSummary(payload, tools);
  const now = new Date().toISOString();
  const fingerprintHash = createHash("sha256")
    .update(JSON.stringify({ summary, snapshot, payload }))
    .digest("hex")
    .slice(0, 16);

  return {
    id: `env-${Date.now()}`,
    scope: "global",
    fingerprintHash,
    summary,
    snapshot,
    payload,
    createdAt: now,
    updatedAt: now
  };
}

function saveEnvironmentFingerprint(fingerprint: EnvironmentFingerprint): EnvironmentFingerprint {
  getDatabase()
    .prepare(
      `
        INSERT INTO environment_profiles (
          id,
          scope,
          fingerprint_hash,
          summary,
          snapshot_json,
          payload_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(scope) DO UPDATE SET
          fingerprint_hash = excluded.fingerprint_hash,
          summary = excluded.summary,
          snapshot_json = excluded.snapshot_json,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `
    )
    .run(
      fingerprint.id,
      fingerprint.scope,
      fingerprint.fingerprintHash,
      fingerprint.summary,
      JSON.stringify(fingerprint.snapshot),
      JSON.stringify(fingerprint.payload),
      fingerprint.createdAt,
      fingerprint.updatedAt
    );

  return getEnvironmentFingerprint() ?? fingerprint;
}

function toEnvironmentFingerprint(row: EnvironmentProfileRow): EnvironmentFingerprint {
  return {
    id: row.id,
    scope: "global",
    fingerprintHash: row.fingerprint_hash,
    summary: row.summary,
    snapshot: parseStringArray(row.snapshot_json),
    payload: parsePayload(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parsePayload(value: string): EnvironmentFingerprintPayload {
  const parsed = parseJson(value);
  return {
    os: {
      platform: stringOrDefault(parsed?.os?.platform, "unknown"),
      release: stringOrDefault(parsed?.os?.release, "unknown"),
      arch: stringOrDefault(parsed?.os?.arch, "unknown")
    },
    runtime: {
      nodeVersion: stringOrDefault(parsed?.runtime?.nodeVersion, "unknown"),
      electronVersion: stringOrUndefined(parsed?.runtime?.electronVersion),
      timezone: stringOrDefault(parsed?.runtime?.timezone, "unknown"),
      shell: stringOrDefault(parsed?.runtime?.shell, "unknown")
    },
    workspace: {
      cwd: stringOrDefault(parsed?.workspace?.cwd, process.cwd()),
      projectRoot: stringOrDefault(parsed?.workspace?.projectRoot, resolveProjectPath()),
      packageManager: stringOrDefault(parsed?.workspace?.packageManager, "unknown"),
      isGitRepo: parsed?.workspace?.isGitRepo === true,
      hasPnpmWorkspace: parsed?.workspace?.hasPnpmWorkspace === true,
      appKind: stringOrDefault(parsed?.workspace?.appKind, "unknown")
    },
    markers: toStringArray(parsed?.markers),
    tools: Array.isArray(parsed?.tools)
      ? parsed.tools.map((tool: unknown) => {
          const record = asRecord(tool);
          return {
            name: stringOrDefault(record.name, "unknown"),
            available: record.available === true,
            version: stringOrUndefined(record.version)
          };
        })
      : []
  };
}

function collectMarkers(projectRoot: string): readonly string[] {
  const markers: string[] = [];

  if (fs.existsSync(path.join(projectRoot, "pnpm-workspace.yaml"))) {
    markers.push("pnpm-workspace");
  }
  if (fs.existsSync(path.join(projectRoot, "apps", "desktop", "electron", "main.ts"))) {
    markers.push("electron-desktop");
  }
  if (fs.existsSync(path.join(projectRoot, "packages", "core", "src", "storage", "database.ts"))) {
    markers.push("local-sqlite");
  }
  if (fs.existsSync(path.join(projectRoot, ".git"))) {
    markers.push("git-repo");
  }

  return markers;
}

function inferAppKind(projectRoot: string): string {
  if (fs.existsSync(path.join(projectRoot, "apps", "desktop", "electron", "main.ts"))) {
    return "electron-agent-workbench";
  }

  return "local-node-project";
}

function buildSnapshot(payload: EnvironmentFingerprintPayload): readonly string[] {
  const availableTools = payload.tools.filter((tool) => tool.available).map((tool) => tool.name);

  return [
    `${payload.os.platform} ${payload.os.release} / ${payload.os.arch}`,
    `${payload.runtime.shell} / ${payload.runtime.timezone}`,
    payload.workspace.projectRoot,
    `${payload.workspace.packageManager} / ${payload.workspace.appKind}`,
    `git=${payload.workspace.isGitRepo ? "yes" : "no"} / pnpm-workspace=${payload.workspace.hasPnpmWorkspace ? "yes" : "no"}`,
    `tools: ${availableTools.join(", ") || "none"}`
  ];
}

function buildSummary(
  payload: EnvironmentFingerprintPayload,
  tools: readonly EnvironmentToolAvailability[]
): string {
  const available = tools.filter((tool) => tool.available).map((tool) => tool.name);
  return [
    `${payload.os.platform}/${payload.os.arch}`,
    payload.runtime.shell,
    payload.runtime.timezone,
    payload.workspace.appKind,
    payload.workspace.packageManager,
    available.length > 0 ? `tools=${available.join(",")}` : "tools=none"
  ].join(" | ");
}

function collectTools(): readonly EnvironmentToolAvailability[] {
  return [
    detectTool("node", ["-v"]),
    detectTool("pnpm", ["-v"]),
    detectTool("git", ["--version"]),
    detectTool("rg", ["--version"]),
    detectTool("ollama", ["--version"])
  ];
}

function detectTool(command: string, args: readonly string[]): EnvironmentToolAvailability {
  try {
    const result = spawnSync(command, [...args], {
      cwd: resolveProjectPath(),
      encoding: "utf8",
      timeout: 1200,
      windowsHide: true
    });

    if (result.status !== 0) {
      return {
        name: command,
        available: false
      };
    }

    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    const version = combined.split(/\r?\n/)[0]?.trim();

    return {
      name: command,
      available: true,
      version: version || undefined
    };
  } catch {
    return {
      name: command,
      available: false
    };
  }
}

function detectShell(): string {
  const value = process.env.ComSpec || process.env.SHELL || process.env.TERM_PROGRAM || "unknown";
  return path.basename(value).replace(/\.exe$/i, "");
}

function readJsonFile(filePath: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseStringArray(value: string): readonly string[] {
  return toStringArray(parseJson(value));
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
