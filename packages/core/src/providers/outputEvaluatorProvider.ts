import type { ChatMessage, EvaluationNextAction, OutputEvaluationResult, RouterResult } from "@xiaomi/shared";
import { getModelRuntimeConfig } from "../modelRuntimeConfig";
import { buildEvaluatorSystemPrompt, buildEvaluatorUserPrompt } from "../prompts";
import { createJsonChat } from "./jsonChatProvider";

export async function evaluateOutput(input: {
  readonly messages: readonly ChatMessage[];
  readonly userInput: string;
  readonly routerResult: RouterResult;
  readonly assistantAnswer: string;
}): Promise<OutputEvaluationResult> {
  const config = getModelRuntimeConfig("evaluator");
  const routerResultText = JSON.stringify(input.routerResult, null, 2);
  const userPrompt = buildEvaluatorUserPrompt({
    userInput: input.userInput,
    routerResult: routerResultText,
    assistantAnswer: input.assistantAnswer
  });

  const content = await createJsonChat({
    config: {
      ...config,
      temperature: Math.min(config.temperature, 0.2)
    },
    providerId: "output-evaluator",
    systemPrompt: buildEvaluatorSystemPrompt(),
    userPrompt,
    latestUserMessage: input.userInput,
    messageCount: input.messages.length
  });

  return parseEvaluationResult(content, input.routerResult);
}

function parseEvaluationResult(content: string, routerResult: RouterResult): OutputEvaluationResult {
  const parsed = JSON.parse(content) as Partial<OutputEvaluationResult>;
  const nextAction = normalizeNextAction(parsed.next_action);
  const shouldEvaluate = toBoolean(parsed.should_evaluate);
  const missingCriteria = toStringArray(parsed.missing_criteria);
  const passed = toBoolean(parsed.passed) && missingCriteria.length === 0;

  return {
    should_evaluate: shouldEvaluate,
    passed,
    verification_question: toStringValue(parsed.verification_question) || routerResult.verification_question,
    satisfied_criteria: toStringArray(parsed.satisfied_criteria),
    missing_criteria: missingCriteria,
    issues: toStringArray(parsed.issues),
    check_steps: toStringArray(parsed.check_steps),
    decision_reason: toStringValue(parsed.decision_reason),
    next_action: passed ? "final" : nextAction,
    revision_instruction: toStringValue(parsed.revision_instruction),
    confidence: clampConfidence(parsed.confidence)
  };
}

function defaultPassedEvaluation(routerResult: RouterResult, reason: string): OutputEvaluationResult {
  return {
    should_evaluate: false,
    passed: true,
    verification_question: routerResult.verification_question,
    satisfied_criteria: [],
    missing_criteria: [],
    issues: [reason],
    check_steps: [],
    decision_reason: reason,
    next_action: "final",
    revision_instruction: "",
    confidence: 1
  };
}

function normalizeNextAction(value: unknown): EvaluationNextAction {
  const allowed: readonly EvaluationNextAction[] = ["final", "revise_answer", "ask_user", "use_tools"];

  if (typeof value !== "string") {
    return "revise_answer";
  }

  const nextAction = value.trim();
  return allowed.includes(nextAction as EvaluationNextAction) ? nextAction as EvaluationNextAction : "revise_answer";
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

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}
