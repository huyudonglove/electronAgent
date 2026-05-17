import type { ChatMessage, EvaluationNextAction, OutputEvaluationResult, RouterResult } from "@xiaomi/shared";
import { getModelRuntimeConfig } from "../modelRuntimeConfig";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";
import { buildEvaluatorSystemPrompt, buildEvaluatorUserPrompt } from "../prompts";
import { createOpenAiJsonChat } from "./openAiCompatibleProvider";

interface OllamaChatResponse {
  readonly message?: {
    readonly content?: string;
  };
  readonly response?: string;
}

export async function evaluateOutput(input: {
  readonly messages: readonly ChatMessage[];
  readonly userInput: string;
  readonly routerResult: RouterResult;
  readonly assistantAnswer: string;
}): Promise<OutputEvaluationResult> {
  const config = getModelRuntimeConfig("router");
  const routerResultText = JSON.stringify(input.routerResult, null, 2);
  const userPrompt = buildEvaluatorUserPrompt({
    userInput: input.userInput,
    routerResult: routerResultText,
    assistantAnswer: input.assistantAnswer
  });

  if (config.providerKind === "openai-compatible") {
    const content = await createOpenAiJsonChat({
      config,
      providerId: "output-evaluator-openai-compatible",
      latestUserMessage: input.userInput,
      messages: [
        {
          role: "system",
          content: buildEvaluatorSystemPrompt()
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    });

    return parseEvaluationResult(content, input.routerResult);
  }

  if (config.providerKind !== "ollama") {
    return defaultPassedEvaluation(input.routerResult, "Router Provider 不支持输出验收，跳过 evaluator。");
  }

  const startedAtMs = Date.now();
  const requestBody = {
    model: config.model,
    stream: false,
    messages: [
      {
        role: "system",
        content: buildEvaluatorSystemPrompt()
      },
      {
        role: "user",
        content: userPrompt
      }
    ],
    options: {
      temperature: Math.min(config.temperature, 0.2),
      num_predict: config.maxTokens
    }
  };
  const debugLog = createDebugLogBase({
    providerId: "output-evaluator-ollama",
    model: config.model,
    baseURL: config.baseURL,
    request: {
      method: "POST",
      endpoint: `${config.baseURL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage: input.userInput
    }
  });

  const response = await fetch(`${config.baseURL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`Ollama Evaluator HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  const content = (data.message?.content ?? data.response ?? "").trim();
  const evaluation = parseEvaluationResult(content, input.routerResult);

  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content
    }
  });

  return evaluation;
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
