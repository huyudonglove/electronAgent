import type { RouterResult, ToolSelectionResult } from "@xiaomi/shared";

const ROUTER_CONFIDENCE_THRESHOLD = 0.7;
const COMMAND_RUN = "command.run";
const READ_TOOLS = ["file.read", "file.list", "file.search"] as const;
const WRITE_TOOLS = ["file.write"] as const;
const MEMORY_TOOLS = ["memory.save"] as const;

export function selectToolsForRouter(routerResult: RouterResult): ToolSelectionResult {
  const routerConfidence = routerResult.confidence;

  return {
    selected_tools: allTools(),
    access_mode: "project_write",
    reason: buildReason(routerResult),
    confidence_threshold: ROUTER_CONFIDENCE_THRESHOLD,
    router_confidence: routerConfidence,
    auto_allowed: true
  };
}

function allTools(): readonly string[] {
  return [...READ_TOOLS, ...WRITE_TOOLS, COMMAND_RUN, ...MEMORY_TOOLS];
}

function buildReason(routerResult: RouterResult): string {
  if (routerResult.tool_reason) {
    return routerResult.tool_reason;
  }

  if (routerResult.intent === "code") {
    return "管理员 Agent 模式：默认开放读取、写入、记忆和命令工具；删除类命令会在结果中提醒。";
  }

  if (routerResult.intent === "debug") {
    return "管理员 Agent 模式：默认开放读取、写入、记忆和命令工具；删除类命令会在结果中提醒。";
  }

  return "管理员 Agent 模式：默认开放读取、写入、记忆和命令工具；删除类命令会在结果中提醒。";
}
