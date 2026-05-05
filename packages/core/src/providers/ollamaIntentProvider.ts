import type { ChatMessage } from "@xiaomi/shared";
import { OLLAMA_BASE_URL, OLLAMA_INTENT_MODEL } from "../modelConfig";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";
import { buildIntentSystemPrompt, buildIntentUserPrompt } from "../prompts";

interface OllamaChatResponse {
  readonly message?: {
    readonly content?: string;
  };
  readonly response?: string;
}

interface IntentResult {
  readonly rewritten_input: string;
  readonly intent: "code" | "chat" | "search" | "debug" | "analysis";
  readonly keywords: readonly string[];
}

export async function recognizeIntent(messages: readonly ChatMessage[], latestUserMessage: string): Promise<string> {
  const startedAtMs = Date.now();
  const requestBody = {
    model: OLLAMA_INTENT_MODEL,
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
      temperature: 0.2,
      num_predict: 512
    }
  };
  const debugLog = createDebugLogBase({
    providerId: "ollama-intent",
    model: OLLAMA_INTENT_MODEL,
    baseURL: OLLAMA_BASE_URL,
    request: {
      method: "POST",
      endpoint: `${OLLAMA_BASE_URL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: requestBody,
      messageCount: messages.length,
      latestUserMessage
    }
  });

  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
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
  const summary = (data.message?.content ?? data.response ?? "").trim();
  const intentResult = parseIntentResult(summary);

  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content: summary
    }
  });

  return JSON.stringify(intentResult, null, 2);
}

function parseIntentResult(content: string): IntentResult {
  const parsed = JSON.parse(content) as Partial<IntentResult>;
  const allowedIntents = ["code", "chat", "search", "debug", "analysis"];
  const intent = normalizeIntent(parsed.intent, allowedIntents);

  if (!intent) {
    throw new Error(`意图识别结果无效：intent 必须是 ${allowedIntents.join(" | ")} 之一。实际返回：${content}`);
  }

  return {
    rewritten_input: parsed.rewritten_input ?? "",
    intent,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : []
  };
}

function normalizeIntent(intent: unknown, allowedIntents: readonly string[]): IntentResult["intent"] | undefined {
  if (typeof intent !== "string") {
    return undefined;
  }

  const exactIntent = intent.trim();
  if (allowedIntents.includes(exactIntent)) {
    return exactIntent as IntentResult["intent"];
  }

  const candidates = exactIntent.split("|").map((item) => item.trim());
  const firstAllowedIntent = candidates.find((item) => allowedIntents.includes(item));

  return firstAllowedIntent as IntentResult["intent"] | undefined;
}
