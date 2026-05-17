import type { ChatMessage, RouterIntent, RouterResult, RouterTaskType } from "@xiaomi/shared";
import { getModelRuntimeConfig } from "../modelRuntimeConfig";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";
import { buildIntentSystemPrompt, buildIntentUserPrompt } from "../prompts";
import { createOpenAiJsonChat } from "./openAiCompatibleProvider";

interface OllamaChatResponse {
  readonly message?: {
    readonly content?: string;
  };
  readonly response?: string;
}

export async function recognizeIntent(messages: readonly ChatMessage[], latestUserMessage: string): Promise<RouterResult> {
  const startedAtMs = Date.now();
  const config = getModelRuntimeConfig("router");

  if (config.providerKind === "openai-compatible") {
    const content = await createOpenAiJsonChat({
      config,
      providerId: "router-openai-compatible",
      latestUserMessage,
      messages: [
        {
          role: "system",
          content: buildIntentSystemPrompt()
        },
        {
          role: "user",
          content: buildIntentUserPrompt(messages, latestUserMessage)
        }
      ]
    });

    return parseRouterResult(content);
  }

  if (config.providerKind !== "ollama") {
    throw new Error(`Router 当前只支持 ollama 或 openai-compatible，实际配置为：${config.providerKind}`);
  }

  const requestBody = {
    model: config.model,
    stream: false,
    messages: [
      {
        role: "system",
        content: buildIntentSystemPrompt()
      },
      {
        role: "user",
        content: buildIntentUserPrompt(messages, latestUserMessage)
      }
    ],
    options: {
      temperature: config.temperature,
      num_predict: config.maxTokens
    }
  };
  const debugLog = createDebugLogBase({
    providerId: "ollama-intent",
    model: config.model,
    baseURL: config.baseURL,
    request: {
      method: "POST",
      endpoint: `${config.baseURL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: requestBody,
      messageCount: messages.length,
      latestUserMessage
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
    throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  const content = (data.message?.content ?? data.response ?? "").trim();
  const routerResult = parseRouterResult(content);

  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content
    }
  });

  return routerResult;
}

function parseRouterResult(content: string): RouterResult {
  const parsed = JSON.parse(content) as Partial<RouterResult>;
  const allowedIntents = ["code", "chat", "search", "debug", "analysis"];
  const intent = normalizeIntent(parsed.intent, allowedIntents);

  if (!intent) {
    throw new Error(`意图识别结果无效：intent 必须是 ${allowedIntents.join(" | ")} 之一。实际返回：${content}`);
  }

  const taskType = normalizeTaskType(parsed.task_type) ?? defaultTaskTypeForIntent(intent);
  const needsTools = toBoolean(parsed.needs_tools);
  const suggestedTools = normalizeSuggestedTools(parsed.suggested_tools, needsTools);

  return {
    intent,
    rewritten_input: toStringValue(parsed.rewritten_input),
    keywords: toStringArray(parsed.keywords),
    is_task: toBoolean(parsed.is_task),
    task_goal: toStringValue(parsed.task_goal),
    task_type: taskType,
    reasoning_brief: toStringValue(parsed.reasoning_brief),
    planned_steps: toStringArray(parsed.planned_steps),
    expected_output: toStringValue(parsed.expected_output),
    verification_question: toStringValue(parsed.verification_question),
    success_criteria: toStringArray(parsed.success_criteria),
    needs_user_clarification: toBoolean(parsed.needs_user_clarification),
    clarifying_questions: toStringArray(parsed.clarifying_questions),
    requires_project_context: toBoolean(parsed.requires_project_context),
    needs_tools: needsTools,
    suggested_tools: suggestedTools,
    tool_reason: toStringValue(parsed.tool_reason),
    confidence: clampConfidence(parsed.confidence)
  };
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

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
