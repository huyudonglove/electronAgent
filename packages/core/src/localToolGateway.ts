import fs from "node:fs";
import path from "node:path";
import type {
  CommandDecision,
  FileListRequest,
  FileReadRequest,
  FileSearchRequest,
  FileWriteRequest,
  MemorySaveRequest,
  ToolRequest,
  ToolResult,
  ToolSelectionResult
} from "@xiaomi/shared";
import { runCommandThroughGateway } from "./commandGateway";
import { saveMemory } from "./longTermMemories";
import { resolveProjectPath } from "./utils/projectRoot";

const DEFAULT_MAX_READ_BYTES = 80_000;
const DEFAULT_MAX_LIST_ENTRIES = 200;
const DEFAULT_MAX_SEARCH_RESULTS = 80;
const MAX_WRITE_BYTES = 300_000;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "dist-electron", ".vite"]);
const PROTECTED_WRITE_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  "secrets.local.json",
  "model-runtime.local.json",
  "agent.db",
  "agent.db-shm",
  "agent.db-wal"
]);
const PROTECTED_WRITE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".sqlite", ".db"]);
const PROTECTED_WRITE_PATH_PARTS = new Set([".ssh"]);

export async function runLocalToolThroughGateway(input: {
  readonly request: ToolRequest;
  readonly toolSelection: ToolSelectionResult;
  readonly projectId: string;
  readonly sessionId: string;
}): Promise<ToolResult> {
  if (input.request.type === "command.run") {
    return runCommandThroughGateway({
      request: input.request,
      toolSelection: input.toolSelection
    });
  }

  const startedAt = Date.now();
  const policy = decideLocalTool(input.request, input.toolSelection);

  if (policy.decision !== "allow") {
    return {
      request: input.request,
      decision: policy.decision,
      status: "skipped",
      reason: policy.reason,
      durationMs: Date.now() - startedAt
    };
  }

  try {
    const result = await executeLocalTool({
      request: input.request,
      projectId: input.projectId,
      sessionId: input.sessionId
    });

    return {
      request: input.request,
      decision: "allow",
      status: "executed",
      reason: policy.reason,
      ...result,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      request: input.request,
      decision: "allow",
      status: "failed",
      reason: policy.reason,
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt
    };
  }
}

function decideLocalTool(
  request: ToolRequest,
  toolSelection: ToolSelectionResult
): { readonly decision: CommandDecision; readonly reason: string } {
  if (isReadTool(request)) {
    return {
      decision: "allow",
      reason: `${request.type} 在管理员 Agent 模式下默认放行，包含敏感文件读取。`
    };
  }

  return {
    decision: "allow",
    reason: `${request.type} 在管理员 Agent 模式下默认放行。`
  };
}

async function executeLocalTool(input: {
  readonly request: Exclude<ToolRequest, { readonly type: "command.run" }>;
  readonly projectId: string;
  readonly sessionId: string;
}): Promise<Pick<ToolResult, "output" | "data" | "stdout" | "stderr">> {
  if (input.request.type === "file.read") {
    return readFileTool(input.request);
  }

  if (input.request.type === "file.list") {
    return listFileTool(input.request);
  }

  if (input.request.type === "file.search") {
    return searchFileTool(input.request);
  }

  if (input.request.type === "file.write") {
    return writeFileTool(input.request);
  }

  return saveMemoryTool(input.request, input.projectId, input.sessionId);
}

function readFileTool(request: FileReadRequest): Pick<ToolResult, "output" | "data"> {
  const filePath = resolveWorkspacePath(request.path);
  const stat = fs.statSync(filePath);

  if (!stat.isFile()) {
    throw new Error(`不是文件：${filePath}`);
  }

  const maxBytes = request.maxBytes ?? DEFAULT_MAX_READ_BYTES;
  const content = fs.readFileSync(filePath, "utf8");
  const truncated = Buffer.byteLength(content, "utf8") > maxBytes;
  const output = truncated ? content.slice(0, maxBytes) : content;

  return {
    output,
    data: {
      path: filePath,
      bytes: stat.size,
      truncated
    }
  };
}

function listFileTool(request: FileListRequest): Pick<ToolResult, "output" | "data"> {
  const dirPath = resolveWorkspacePath(request.path);
  const stat = fs.statSync(dirPath);

  if (!stat.isDirectory()) {
    throw new Error(`不是目录：${dirPath}`);
  }

  const maxEntries = request.maxEntries ?? DEFAULT_MAX_LIST_ENTRIES;
  const entries = request.recursive
    ? listRecursive(dirPath, maxEntries)
    : fs.readdirSync(dirPath, { withFileTypes: true }).slice(0, maxEntries).map((entry) => {
        return {
          path: path.join(dirPath, entry.name),
          type: entry.isDirectory() ? "directory" : "file"
        };
      });

  return {
    output: entries.map((entry) => `${entry.type === "directory" ? "[dir]" : "[file]"} ${relativeWorkspacePath(entry.path)}`).join("\n"),
    data: {
      path: dirPath,
      entries,
      truncated: entries.length >= maxEntries
    }
  };
}

function searchFileTool(request: FileSearchRequest): Pick<ToolResult, "output" | "data"> {
  const rootPath = resolveWorkspacePath(request.path ?? ".");
  const stat = fs.statSync(rootPath);
  const maxResults = request.maxResults ?? DEFAULT_MAX_SEARCH_RESULTS;
  const files = stat.isDirectory() ? collectFiles(rootPath, maxResults * 20) : [rootPath];
  const results: Array<{ readonly path: string; readonly line: number; readonly text: string }> = [];
  const query = request.query.toLowerCase();

  for (const filePath of files) {
    if (results.length >= maxResults) {
      break;
    }

    if (request.glob && !filePath.endsWith(request.glob.replace("*", ""))) {
      continue;
    }

    const content = readTextFileIfPossible(filePath);
    if (content === undefined) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
      if (lines[index].toLowerCase().includes(query)) {
        results.push({
          path: filePath,
          line: index + 1,
          text: lines[index].trim()
        });
      }
    }
  }

  return {
    output: results.map((item) => `${relativeWorkspacePath(item.path)}:${item.line}: ${item.text}`).join("\n"),
    data: {
      query: request.query,
      results,
      truncated: results.length >= maxResults
    }
  };
}

function writeFileTool(request: FileWriteRequest): Pick<ToolResult, "output" | "data"> {
  const filePath = resolveWorkspacePath(request.path);
  assertNotProtectedWritePath(filePath);
  const bytes = Buffer.byteLength(request.content, "utf8");

  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`写入内容过大：${bytes} bytes`);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, request.content, "utf8");

  return {
    output: `已写入 ${relativeWorkspacePath(filePath)} (${bytes} bytes)`,
    data: {
      path: filePath,
      bytes
    }
  };
}

function saveMemoryTool(
  request: MemorySaveRequest,
  projectId: string,
  sessionId: string
): Pick<ToolResult, "output" | "data"> {
  const memory = saveMemory({
    projectId,
    type: request.memoryType ?? "fact",
    content: request.content,
    tags: request.tags ?? [],
    importance: request.importance ?? 0.75,
    confidence: 0.8,
    sourceSessionId: sessionId,
    sourceEventIds: []
  });

  return {
    output: `已保存长期记忆：${memory.content}`,
    data: memory
  };
}

function resolveWorkspacePath(inputPath: string): string {
  const workspaceRoot = path.resolve(resolveProjectPath());
  const resolved = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(workspaceRoot, inputPath);
  const relative = path.relative(workspaceRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径不在工作区内：${resolved}`);
  }

  return resolved;
}

function relativeWorkspacePath(inputPath: string): string {
  return path.relative(resolveProjectPath(), inputPath) || ".";
}

function isReadTool(request: ToolRequest): boolean {
  return request.type === "file.read" || request.type === "file.list" || request.type === "file.search";
}

function assertNotProtectedWritePath(inputPath: string): void {
  if (isProtectedWritePath(inputPath)) {
    throw new Error(`敏感文件写入受保护，已拒绝写入：${relativeWorkspacePath(inputPath)}`);
  }
}

function isProtectedWritePath(inputPath: string): boolean {
  const workspaceRoot = path.resolve(resolveProjectPath());
  const relative = path.relative(workspaceRoot, path.resolve(inputPath));
  const normalizedParts = relative.split(path.sep).map((part) => part.toLowerCase());
  const fileName = normalizedParts.at(-1) ?? "";
  const ext = path.extname(fileName);

  return normalizedParts.some((part) => PROTECTED_WRITE_PATH_PARTS.has(part))
    || PROTECTED_WRITE_FILE_NAMES.has(fileName)
    || PROTECTED_WRITE_EXTENSIONS.has(ext)
    || fileName.includes("secret")
    || fileName.includes("token")
    || fileName.includes("apikey")
    || fileName.includes("api-key")
    || fileName.includes("credential");
}

function listRecursive(rootPath: string, maxEntries: number): Array<{ readonly path: string; readonly type: "directory" | "file" }> {
  const results: Array<{ readonly path: string; readonly type: "directory" | "file" }> = [];
  const pending = [rootPath];

  while (pending.length > 0 && results.length < maxEntries) {
    const current = pending.shift() ?? rootPath;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (results.length >= maxEntries) {
        break;
      }

      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(current, entry.name);
      const type = entry.isDirectory() ? "directory" : "file";
      results.push({ path: entryPath, type });

      if (entry.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }

  return results;
}

function collectFiles(rootPath: string, maxFiles: number): readonly string[] {
  const files: string[] = [];
  const pending = [rootPath];

  while (pending.length > 0 && files.length < maxFiles) {
    const current = pending.shift() ?? rootPath;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (files.length >= maxFiles) {
        break;
      }

      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function readTextFileIfPossible(filePath: string): string | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > DEFAULT_MAX_READ_BYTES) {
      return undefined;
    }

    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}
