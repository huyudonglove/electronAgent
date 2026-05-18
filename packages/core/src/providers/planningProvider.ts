import type {
  ChatMessage,
  MemoryRecord,
  PlanningResult,
  RouterResult,
  ToolSelectionResult
} from "@xiaomi/shared";
import type { ConversationSummary } from "../conversationSummaries";
import { getModelRuntimeConfig } from "../modelRuntimeConfig";
import { buildPlanningSystemPrompt, buildPlanningUserPrompt } from "../prompts";
import { createJsonChat } from "./jsonChatProvider";

export async function createExecutionPlan(input: {
  readonly messages: readonly ChatMessage[];
  readonly latestUserMessage: string;
  readonly routerResult: RouterResult;
  readonly toolSelection: ToolSelectionResult;
  readonly conversationSummary?: ConversationSummary;
  readonly memories?: readonly MemoryRecord[];
}): Promise<PlanningResult> {
  const config = getModelRuntimeConfig("planner");
  const systemPrompt = buildPlanningSystemPrompt();
  const userPrompt = buildPlanningUserPrompt({
    userInput: input.latestUserMessage,
    routerResult: JSON.stringify(input.routerResult, null, 2),
    toolSelection: JSON.stringify(input.toolSelection, null, 2),
    memories: formatMemories(input.memories ?? []),
    conversationSummary: input.conversationSummary?.summary ?? "",
    recentMessages: input.messages
  });

  const content = await createJsonChat({
    config,
    providerId: "planner",
    systemPrompt,
    userPrompt,
    latestUserMessage: input.latestUserMessage,
    messageCount: input.messages.length
  });

  return parsePlanningResult(content, input);
}

function parsePlanningResult(
  content: string,
  fallbackInput: {
    readonly routerResult: RouterResult;
    readonly toolSelection: ToolSelectionResult;
  }
): PlanningResult {
  const parsed = JSON.parse(content) as Partial<PlanningResult>;
  const requiredTools = toStringArray(parsed.required_tools)
    .filter((tool) => fallbackInput.toolSelection.selected_tools.includes(tool));

  return {
    goal: toStringValue(parsed.goal) || fallbackInput.routerResult.task_goal || fallbackInput.routerResult.rewritten_input,
    plan_summary: toStringValue(parsed.plan_summary),
    execution_plan: normalizeSteps(parsed.execution_plan),
    required_tools: requiredTools,
    files_to_inspect: toStringArray(parsed.files_to_inspect),
    files_to_modify: toStringArray(parsed.files_to_modify),
    risks: toStringArray(parsed.risks),
    needs_user_confirmation: parsed.needs_user_confirmation === true,
    confirmation_reason: toStringValue(parsed.confirmation_reason),
    expected_result: toStringValue(parsed.expected_result) || fallbackInput.routerResult.expected_output,
    execution_instruction: toStringValue(parsed.execution_instruction),
    confidence: clampConfidence(parsed.confidence)
  };
}

function normalizeSteps(value: unknown): PlanningResult["execution_plan"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index) => {
      const record = asRecord(item);
      return {
        step: typeof record.step === "number" ? record.step : index + 1,
        title: toStringValue(record.title),
        detail: toStringValue(record.detail)
      };
    })
    .filter((step) => step.title || step.detail)
    .slice(0, 6);
}

function formatMemories(memories: readonly MemoryRecord[]): string {
  if (memories.length === 0) {
    return "";
  }

  return memories.map((memory) => {
    return [
      `- type: ${memory.type}`,
      `  importance: ${memory.importance}`,
      `  content: ${memory.content}`,
      memory.tags.length > 0 ? `  tags: ${memory.tags.join(", ")}` : ""
    ].filter((line) => line.length > 0).join("\n");
  }).join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
