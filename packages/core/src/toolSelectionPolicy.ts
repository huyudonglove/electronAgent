import type { RouterResult, ToolAccessMode, ToolSelectionResult } from "@xiaomi/shared";

const ROUTER_CONFIDENCE_THRESHOLD = 0.7;
const COMMAND_RUN = "command.run";

export function selectToolsForRouter(routerResult: RouterResult): ToolSelectionResult {
  const routerConfidence = routerResult.confidence;

  if (routerConfidence < ROUTER_CONFIDENCE_THRESHOLD) {
    return noTools(routerResult, "Router 置信度低于阈值，Core 保守处理，不自动开放工具。");
  }

  if (routerResult.intent === "chat") {
    return noTools(routerResult, "普通聊天不需要开放工具。");
  }

  if (routerResult.intent === "search") {
    return noTools(routerResult, "当前阶段尚未实现 web.search，因此不开放搜索工具。");
  }

  if (!routerResult.needs_tools && routerResult.suggested_tools.length === 0) {
    return noTools(routerResult, "Router 判断本轮不需要工具。");
  }

  if (!routerResult.needs_tools && routerResult.intent === "analysis" && !routerResult.requires_project_context) {
    return noTools(routerResult, "普通分析不需要读取项目上下文。");
  }

  if (!routerResult.suggested_tools.includes(COMMAND_RUN) && !routerResult.needs_tools) {
    return noTools(routerResult, "Router 没有建议当前可用工具。");
  }

  return {
    selected_tools: [COMMAND_RUN],
    access_mode: resolveAccessMode(routerResult),
    reason: buildReason(routerResult),
    confidence_threshold: ROUTER_CONFIDENCE_THRESHOLD,
    router_confidence: routerConfidence,
    auto_allowed: true
  };
}

function noTools(routerResult: RouterResult, reason: string): ToolSelectionResult {
  return {
    selected_tools: [],
    access_mode: "none",
    reason,
    confidence_threshold: ROUTER_CONFIDENCE_THRESHOLD,
    router_confidence: routerResult.confidence,
    auto_allowed: false
  };
}

function resolveAccessMode(routerResult: RouterResult): ToolAccessMode {
  if (routerResult.intent === "code" || routerResult.task_type === "implementation") {
    return "project_write";
  }

  if (routerResult.intent === "debug" || routerResult.task_type === "debugging" || routerResult.task_type === "verification") {
    return "project_verify";
  }

  return "project_read";
}

function buildReason(routerResult: RouterResult): string {
  if (routerResult.tool_reason) {
    return routerResult.tool_reason;
  }

  if (routerResult.intent === "code") {
    return "本轮需要推进代码实现，允许后续 Command Gateway 在项目范围内处理读写和验证命令。";
  }

  if (routerResult.intent === "debug") {
    return "本轮需要定位问题，允许后续 Command Gateway 在项目范围内读取文件并执行验证命令。";
  }

  return "本轮需要项目上下文，允许后续 Command Gateway 进行项目只读检查。";
}
