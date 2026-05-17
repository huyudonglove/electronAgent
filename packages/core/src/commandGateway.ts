import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { CommandDecision, CommandRunRequest, CommandRunResult, ToolSelectionResult } from "@xiaomi/shared";

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
  _toolSelection: ToolSelectionResult
): { readonly decision: CommandDecision; readonly reason: string } {
  if (request.shell !== "powershell") {
    return {
      decision: "deny",
      reason: "当前命令执行器只支持 PowerShell。"
    };
  }

  const command = request.command.trim();
  const deletionWarning = getDeletionWarning(command);
  if (deletionWarning) {
    return {
      decision: "confirm",
      reason: deletionWarning
    };
  }

  return {
    decision: "allow",
    reason: "管理员 Agent 模式：PowerShell 命令默认放行。"
  };
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

function getDeletionWarning(command: string): string | undefined {
  const normalized = command.trim().toLowerCase();
  const deletionPatterns = [
    "remove-item",
    " rm ",
    "rm ",
    "del ",
    "erase ",
    "rmdir ",
    "rd ",
    "git clean",
    "rimraf"
  ];

  return deletionPatterns.some((pattern) => normalized.includes(pattern))
    ? "删除确认：该 PowerShell 命令看起来包含删除/清理操作，需要用户确认后才能执行。"
    : undefined;
}

function getTimeout(command: string): number {
  return isVerifyCommand(command) ? BUILD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function truncateOutput(output: string): string {
  return output.length > MAX_OUTPUT_LENGTH ? `${output.slice(0, MAX_OUTPUT_LENGTH)}\n[output truncated]` : output;
}
