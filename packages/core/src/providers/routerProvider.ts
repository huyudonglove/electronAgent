import type {
  ChatMessage,
  RouterComplexity,
  RouterExecutionMode,
  RouterIntent,
  RouterProfileTarget,
  RouterResult,
  RouterRiskLevel,
  RouterTaskScope,
  RouterTaskType,
  RouterTimeContextMode,
  RouterWorkflowRoute
} from "@xiaomi/shared";
import { getModelRuntimeConfig } from "../modelRuntimeConfig";
import { buildRouterSystemPrompt, buildRouterUserPrompt } from "../prompts";
import { createJsonChat } from "./jsonChatProvider";

export async function analyzeRoute(messages: readonly ChatMessage[], latestUserMessage: string): Promise<RouterResult> {
  const config = getModelRuntimeConfig("router");
  const content = await createJsonChat({
    config,
    providerId: "router",
    systemPrompt: buildRouterSystemPrompt(),
    userPrompt: buildRouterUserPrompt(messages, latestUserMessage),
    latestUserMessage,
    messageCount: messages.length
  });

  return parseRouterResult(content);
}

function parseRouterResult(content: string): RouterResult {
  const parsed = JSON.parse(content) as Partial<RouterResult>;
  const turnAnalysis = asRecord(parsed.turn_analysis);
  const workflowDecision = asRecord(parsed.workflow_decision);
  const contextDecision = asRecord(parsed.context_decision);
  const profileObservation = asRecord(parsed.profile_observation);
  const evaluationSeed = asRecord(parsed.evaluation_seed);
  const allowedIntents = ["code", "chat", "search", "debug", "analysis"];
  const intent = normalizeIntent(turnAnalysis.intent ?? parsed.intent, allowedIntents);

  if (!intent) {
    throw new Error(`Router 任务分析结果无效：turn_analysis.intent 必须是 ${allowedIntents.join(" | ")} 之一。实际返回：${content}`);
  }

  const taskType = normalizeTaskType(turnAnalysis.task_type ?? parsed.task_type) ?? defaultTaskTypeForIntent(intent);
  const needsTools = toBoolean(contextDecision.needs_tools ?? parsed.needs_tools);
  const suggestedTools = normalizeSuggestedTools(contextDecision.suggested_tools ?? parsed.suggested_tools, needsTools);
  const secondaryIntents = normalizeSecondaryIntents(turnAnalysis.secondary_intents ?? parsed.secondary_intents, allowedIntents, intent);
  const rewrittenInput = toStringValue(turnAnalysis.rewritten_input ?? parsed.rewritten_input);
  const keywords = toStringArray(turnAnalysis.keywords ?? parsed.keywords);
  const isTask = toBoolean(turnAnalysis.is_task ?? parsed.is_task);
  const taskGoal = toStringValue(turnAnalysis.task_goal ?? parsed.task_goal);
  const complexity = normalizeComplexity(turnAnalysis.complexity ?? parsed.complexity);
  const taskScope = normalizeTaskScope(turnAnalysis.task_scope ?? parsed.task_scope);
  const executionMode = normalizeExecutionMode(workflowDecision.execution_mode ?? parsed.execution_mode, needsTools);
  const reasoningBrief = toStringValue(turnAnalysis.reasoning_brief ?? parsed.reasoning_brief);
  const expectedOutput = toStringValue(turnAnalysis.expected_output ?? parsed.expected_output);
  const requiredContext = toStringArray(contextDecision.required_context ?? parsed.required_context);
  const requiresProjectContext = toBoolean(contextDecision.requires_project_context ?? parsed.requires_project_context);
  const needsUserClarification = toBoolean(workflowDecision.needs_user_clarification ?? parsed.needs_user_clarification);
  const clarifyingQuestions = toStringArray(workflowDecision.clarifying_questions ?? parsed.clarifying_questions);
  const toolReason = toStringValue(contextDecision.tool_reason ?? parsed.tool_reason);
  const verificationQuestion = toStringValue(evaluationSeed.verification_question ?? parsed.verification_question);
  const successCriteria = toStringArray(evaluationSeed.success_criteria ?? parsed.success_criteria);
  const confidence = clampConfidence(evaluationSeed.confidence ?? parsed.confidence);
  const workflowRoute = normalizeWorkflowRoute(workflowDecision.workflow_route, executionMode, isTask);
  const inputRisk = normalizeInputRisk(asRecord(workflowDecision.input_risk));
  const profileSnapshotUsed = normalizeProfileSnapshot(asRecord(profileObservation.profile_snapshot_used));
  const profileUpdates = normalizeProfileUpdates(profileObservation.profile_updates);
  const contextNeeds = toStringArray(contextDecision.context_needs);
  const memoryQuery = toStringValue(contextDecision.memory_query);
  const timeContextMode = normalizeTimeContextMode(contextDecision.time_context_mode);

  return {
    intent,
    secondary_intents: secondaryIntents,
    rewritten_input: rewrittenInput,
    keywords,
    is_task: isTask,
    task_goal: taskGoal,
    task_type: taskType,
    complexity,
    task_scope: taskScope,
    execution_mode: executionMode,
    reasoning_brief: reasoningBrief,
    planned_steps: toStringArray(parsed.planned_steps),
    expected_output: expectedOutput,
    required_context: requiredContext,
    constraints: toStringArray(parsed.constraints),
    risks: toStringArray(parsed.risks),
    suggested_roles: toStringArray(parsed.suggested_roles),
    main_model_brief: toStringValue(parsed.main_model_brief),
    routing_notes: toStringValue(parsed.routing_notes),
    verification_question: verificationQuestion,
    success_criteria: successCriteria,
    needs_user_clarification: needsUserClarification,
    clarifying_questions: clarifyingQuestions,
    requires_project_context: requiresProjectContext,
    needs_tools: needsTools,
    suggested_tools: suggestedTools,
    tool_reason: toolReason,
    confidence,
    turn_analysis: {
      intent,
      secondary_intents: secondaryIntents,
      rewritten_input: rewrittenInput,
      keywords,
      is_task: isTask,
      task_goal: taskGoal,
      task_type: taskType,
      complexity,
      task_scope: taskScope,
      reasoning_brief: reasoningBrief,
      expected_output: expectedOutput
    },
    workflow_decision: {
      workflow_route: workflowRoute,
      planning_required: toBoolean(workflowDecision.planning_required) || workflowRoute === "planning",
      execution_mode: executionMode,
      needs_user_clarification: needsUserClarification,
      clarifying_questions: clarifyingQuestions,
      input_risk: inputRisk
    },
    context_decision: {
      requires_project_context: requiresProjectContext,
      context_needs: contextNeeds,
      required_context: requiredContext,
      memory_query: memoryQuery,
      time_context_mode: timeContextMode,
      needs_tools: needsTools,
      suggested_tools: suggestedTools,
      tool_reason: toolReason
    },
    profile_observation: {
      profile_snapshot_used: profileSnapshotUsed,
      profile_updates: profileUpdates,
      routing_influences: toStringArray(profileObservation.routing_influences)
    },
    evaluation_seed: {
      verification_question: verificationQuestion,
      success_criteria: successCriteria,
      confidence
    }
  };
}

function normalizeSecondaryIntents(
  value: unknown,
  allowedIntents: readonly string[],
  primaryIntent: RouterIntent
): readonly RouterIntent[] {
  return toStringArray(value)
    .map((item) => normalizeIntent(item, allowedIntents))
    .filter((item): item is RouterIntent => Boolean(item && item !== primaryIntent));
}

function normalizeIntent(intent: unknown, allowedIntents: readonly string[]): RouterIntent | undefined {
  if (typeof intent !== "string") {
    return undefined;
  }

  const exactIntent = intent.trim();
  if (allowedIntents.includes(exactIntent)) {
    return exactIntent as RouterIntent;
  }

  const candidates = exactIntent.split("|").map((item) => item.trim());
  const firstAllowedIntent = candidates.find((item) => allowedIntents.includes(item));

  return firstAllowedIntent as RouterIntent | undefined;
}

function normalizeTaskType(taskType: unknown): RouterTaskType | undefined {
  const allowedTaskTypes: readonly RouterTaskType[] = [
    "chat",
    "analysis",
    "design",
    "implementation",
    "debugging",
    "verification"
  ];

  if (typeof taskType !== "string") {
    return undefined;
  }

  const exactTaskType = taskType.trim();
  if (allowedTaskTypes.includes(exactTaskType as RouterTaskType)) {
    return exactTaskType as RouterTaskType;
  }

  const candidates = exactTaskType.split("|").map((item) => item.trim());
  return candidates.find((item): item is RouterTaskType => allowedTaskTypes.includes(item as RouterTaskType));
}

function defaultTaskTypeForIntent(intent: RouterIntent): RouterTaskType {
  if (intent === "code") {
    return "implementation";
  }

  if (intent === "debug") {
    return "debugging";
  }

  if (intent === "chat") {
    return "chat";
  }

  return "analysis";
}

function normalizeComplexity(value: unknown): RouterComplexity {
  const allowed: readonly RouterComplexity[] = ["simple", "moderate", "complex"];
  return typeof value === "string" && allowed.includes(value as RouterComplexity) ? value as RouterComplexity : "moderate";
}

function normalizeTaskScope(value: unknown): RouterTaskScope {
  const allowed: readonly RouterTaskScope[] = ["single_turn", "multi_turn", "project"];
  return typeof value === "string" && allowed.includes(value as RouterTaskScope) ? value as RouterTaskScope : "single_turn";
}

function normalizeExecutionMode(value: unknown, needsTools: boolean): RouterExecutionMode {
  const allowed: readonly RouterExecutionMode[] = ["answer_only", "plan", "use_tools", "modify_files", "verify"];
  if (typeof value === "string" && allowed.includes(value as RouterExecutionMode)) {
    return value as RouterExecutionMode;
  }

  return needsTools ? "use_tools" : "answer_only";
}

function normalizeWorkflowRoute(value: unknown, executionMode: RouterExecutionMode, isTask: boolean): RouterWorkflowRoute {
  const allowed: readonly RouterWorkflowRoute[] = ["answer_only", "planning", "ask_user", "reject"];
  if (typeof value === "string" && allowed.includes(value as RouterWorkflowRoute)) {
    return value as RouterWorkflowRoute;
  }

  if (executionMode === "plan" || executionMode === "use_tools" || executionMode === "modify_files" || executionMode === "verify") {
    return "planning";
  }

  return isTask ? "planning" : "answer_only";
}

function normalizeInputRisk(value: Record<string, unknown>) {
  return {
    level: normalizeRiskLevel(value.level),
    requires_confirmation: toBoolean(value.requires_confirmation),
    reasons: toStringArray(value.reasons)
  };
}

function normalizeRiskLevel(value: unknown): RouterRiskLevel {
  const allowed: readonly RouterRiskLevel[] = ["low", "medium", "high"];
  return typeof value === "string" && allowed.includes(value as RouterRiskLevel) ? value as RouterRiskLevel : "low";
}

function normalizeTimeContextMode(value: unknown): RouterTimeContextMode {
  const allowed: readonly RouterTimeContextMode[] = ["none", "current_time", "recent_history", "historical_timeline"];
  return typeof value === "string" && allowed.includes(value as RouterTimeContextMode) ? value as RouterTimeContextMode : "none";
}

function normalizeProfileSnapshot(value: Record<string, unknown>) {
  return {
    environment: toStringArray(value.environment),
    user: toStringArray(value.user),
    project: toStringArray(value.project)
  };
}

function normalizeProfileUpdates(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      return {
        target: normalizeProfileTarget(record.target),
        field: toStringValue(record.field),
        value: toStringValue(record.value),
        reason: toStringValue(record.reason),
        confidence: clampConfidence(record.confidence),
        evidence: toStringValue(record.evidence)
      };
    })
    .filter((item) => item.field && item.value);
}

function normalizeProfileTarget(value: unknown): RouterProfileTarget {
  const allowed: readonly RouterProfileTarget[] = ["environment", "user", "project"];
  return typeof value === "string" && allowed.includes(value as RouterProfileTarget) ? value as RouterProfileTarget : "user";
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeSuggestedTools(value: unknown, needsTools: boolean): readonly string[] {
  const allowed = new Set(["command.run", "file.read", "file.list", "file.search", "file.write", "memory.save"]);
  const tools = toStringArray(value).filter((tool) => allowed.has(tool));

  if (needsTools && tools.length === 0) {
    return ["file.read", "file.search", "command.run"];
  }

  return tools;
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
