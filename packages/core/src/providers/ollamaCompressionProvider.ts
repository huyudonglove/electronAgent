import type { ChatMessage } from "@xiaomi/shared";
import { getModelRuntimeConfig } from "../modelRuntimeConfig";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";
import { buildCompressionSystemPrompt, buildCompressionUserPrompt } from "../prompts";
import { createOpenAiJsonChat } from "./openAiCompatibleProvider";

interface OllamaChatResponse {
  readonly message?: {
    readonly content?: string;
  };
  readonly response?: string;
}

export interface CompressionResult {
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly constraints: readonly string[];
  readonly taskProgress: readonly string[];
}

interface CompressionJson {
  readonly summary?: string;
  readonly decisions?: unknown;
  readonly open_questions?: unknown;
  readonly constraints?: unknown;
  readonly task_progress?: unknown;
}

export async function compressConversationWithOllama(input: {
  readonly messages: readonly ChatMessage[];
  readonly previousSummary?: string;
}): Promise<CompressionResult> {
  const startedAtMs = Date.now();
  const config = getModelRuntimeConfig("compression");
  const compressionMessages = [
    {
      role: "system" as const,
      content: buildCompressionSystemPrompt()
    },
    {
      role: "user" as const,
      content: buildCompressionUserPrompt({
        previousSummary: input.previousSummary ?? "",
        messages: input.messages
      })
    }
  ];

  if (config.providerKind === "openai-compatible") {
    const content = await createOpenAiJsonChat({
      config,
      providerId: "compression-openai-compatible",
      latestUserMessage: input.messages.at(-1)?.content,
      messages: compressionMessages
    });

    return parseCompressionResult(content);
  }

  if (config.providerKind !== "ollama") {
    throw new Error(`会话压缩当前只支持 ollama 或 openai-compatible，实际配置为：${config.providerKind}`);
  }

  const requestBody = {
    model: config.model,
    stream: false,
    format: "json",
    messages: compressionMessages,
    options: {
      temperature: config.temperature,
      num_predict: config.maxTokens
    }
  };
  const latestUserMessage = input.messages.at(-1)?.content;
  const debugLog = createDebugLogBase({
    providerId: "ollama-compression",
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
    throw new Error(`Ollama 会话压缩 HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  const content = (data.message?.content ?? data.response ?? "").trim();
  const result = parseCompressionResult(content);

  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content
    }
  });

  return result;
}

function parseCompressionResult(content: string): CompressionResult {
  const parsed = JSON.parse(content) as CompressionJson;

  if (!parsed.summary || typeof parsed.summary !== "string") {
    throw new Error(`会话压缩结果无效：summary 不能为空。实际返回：${content}`);
  }

  return {
    summary: parsed.summary,
    decisions: toStringArray(parsed.decisions),
    openQuestions: toStringArray(parsed.open_questions),
    constraints: toStringArray(parsed.constraints),
    taskProgress: toStringArray(parsed.task_progress)
  };
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
