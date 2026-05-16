import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { CommandDecision, CommandRunRequest, CommandRunResult, ToolSelectionResult } from "@xiaomi/shared";
import { resolveProjectPath } from "./utils/projectRoot";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_LENGTH = 20_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 120_000;

export async function runCommandThroughGateway(input: {
  readonly request: CommandRunRequest;
  readonly toolSelection: ToolSelectionResult;
}): Promise<CommandRunResult> {
  const startedAt = Date.now();
  const policy = decideCommand(input.request, input.toolSelection);

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
    const result = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", input.request.command],
      {
        cwd: path.resolve(input.request.cwd),
        timeout: getTimeout(input.request.command),
        windowsHide: true,
        maxBuffer: MAX_OUTPUT_LENGTH * 2
      }
    );

    return {
      request: input.request,
      decision: "allow",
      status: "executed",
      reason: policy.reason,
      exitCode: 0,
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr),
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const execError = error as {
      readonly code?: number;
      readonly stdout?: string;
      readonly stderr?: string;
      readonly message?: string;
    };

    return {
      request: input.request,
      decision: "allow",
      status: "failed",
      reason: policy.reason,
      exitCode: typeof execError.code === "number" ? execError.code : undefined,
      stdout: truncateOutput(execError.stdout ?? ""),
      stderr: truncateOutput(execError.stderr ?? execError.message ?? ""),
      durationMs: Date.now() - startedAt
    };
  }
}

function decideCommand(
  request: CommandRunRequest,
  toolSelection: ToolSelectionResult
): { readonly decision: CommandDecision; readonly reason: string } {
  if (!toolSelection.selected_tools.includes("command.run") || toolSelection.access_mode === "none") {
    return {
      decision: "deny",
      reason: "本轮 Core 未开放 command.run。"
    };
  }

  if (request.shell !== "powershell") {
    return {
      decision: "deny",
      reason: "第一版 Command Gateway 只允许 PowerShell。"
    };
  }

  const cwdCheck = checkWorkspaceCwd(request.cwd);
  if (!cwdCheck.allowed) {
    return {
      decision: "deny",
      reason: cwdCheck.reason
    };
  }

  const command = request.command.trim();
  if (isDangerousCommand(command)) {
    return {
      decision: "deny",
      reason: "命令命中危险模式，已拒绝执行。"
    };
  }

  if (toolSelection.access_mode === "project_read" && !isReadCommand(command)) {
    return {
      decision: "confirm",
      reason: "当前只开放项目只读工具能力，这条命令需要更高权限。"
    };
  }

  if (toolSelection.access_mode === "project_verify" && !isReadCommand(command) && !isVerifyCommand(command)) {
    return {
      decision: "confirm",
      reason: "当前只开放项目读取和验证能力，这条命令需要写权限。"
    };
  }

  if (requiresConfirm(command)) {
    return {
      decision: "confirm",
      reason: "该命令需要用户确认，第一版暂不自动执行。"
    };
  }

  return {
    decision: "allow",
    reason: "命令通过 Command Gateway 第一版策略。"
  };
}

function checkWorkspaceCwd(cwd: string): { readonly allowed: boolean; readonly reason: string } {
  const workspaceRoot = path.resolve(resolveProjectPath());
  const resolvedCwd = path.resolve(cwd);
  const relative = path.relative(workspaceRoot, resolvedCwd);
  const isInsideWorkspace = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

  return isInsideWorkspace
    ? { allowed: true, reason: "cwd 位于工作区内。" }
    : { allowed: false, reason: `cwd 不在工作区内：${resolvedCwd}` };
}

function isDangerousCommand(command: string): boolean {
  const lowerCommand = command.toLowerCase();
  const dangerousPatterns = [
    "invoke-expression",
    "iex",
    "curl |",
    "irm ",
    "iwr ",
    "format-volume",
    "format ",
    "diskpart",
    "shutdown",
    "restart-computer",
    "remove-item -recurse",
    "rm -r",
    "rmdir /s",
    "del /s",
    "set-executionpolicy"
  ];

  return dangerousPatterns.some((pattern) => lowerCommand.includes(pattern));
}

function isReadCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  const readPrefixes = [
    "get-childitem",
    "dir",
    "ls",
    "get-content",
    "select-string",
    "test-path",
    "resolve-path",
    "git status",
    "git diff",
    "git log"
  ];

  return readPrefixes.some((prefix) => normalized.startsWith(prefix));
}

function isVerifyCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  const verifyCommands = [
    "corepack pnpm build",
    "corepack pnpm test",
    "pnpm build",
    "pnpm test",
    "npm run build",
    "npm test"
  ];

  return verifyCommands.some((prefix) => normalized.startsWith(prefix));
}

function requiresConfirm(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  const confirmPatterns = ["git add", "git commit", "git push", "pnpm add", "npm install", "corepack pnpm add"];

  return confirmPatterns.some((pattern) => normalized.startsWith(pattern));
}

function getTimeout(command: string): number {
  return isVerifyCommand(command) ? BUILD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function truncateOutput(output: string): string {
  return output.length > MAX_OUTPUT_LENGTH ? `${output.slice(0, MAX_OUTPUT_LENGTH)}\n[output truncated]` : output;
}
