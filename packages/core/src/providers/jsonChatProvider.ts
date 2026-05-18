import Anthropic from "@anthropic-ai/sdk";
import type { ModelRuntimeConfig } from "@xiaomi/shared";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";
import { createOpenAiJsonChat } from "./openAiCompatibleProvider";

interface OllamaChatResponse {
  readonly message?: {
    readonly content?: string;
  };
  readonly response?: string;
}

export async function createJsonChat(input: {
  readonly config: ModelRuntimeConfig;
  readonly providerId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly latestUserMessage?: string;
  readonly messageCount?: number;
  readonly ollamaFormatJson?: boolean;
}): Promise<string> {
  if (input.config.providerKind === "openai-compatible") {
    return createOpenAiJsonChat({
      config: input.config,
      providerId: input.providerId,
      latestUserMessage: input.latestUserMessage,
      messages: [
        {
          role: "system",
          content: input.systemPrompt
        },
        {
          role: "user",
          content: input.userPrompt
        }
      ]
    });
  }

  if (input.config.providerKind === "anthropic-compatible") {
    return createAnthropicJsonChat(input);
  }

  if (input.config.providerKind === "ollama") {
    return createOllamaJsonChat(input);
  }

  throw new Error(`JSON Chat 不支持 provider：${input.config.providerKind}`);
}

async function createAnthropicJsonChat(input: {
  readonly config: ModelRuntimeConfig;
  readonly providerId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly latestUserMessage?: string;
  readonly messageCount?: number;
}): Promise<string> {
  const startedAtMs = Date.now();
  const requestBody: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: input.config.model,
    max_tokens: input.config.maxTokens,
    system: [
      input.systemPrompt,
      "",
      "你必须只输出一个合法 JSON 对象，不要输出 Markdown 代码块，不要输出 JSON 之外的解释。"
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: input.userPrompt
          }
        ]
      }
    ],
    top_p: 0.95,
    stream: false,
    temperature: input.config.temperature
  };
  const debugLog = createDebugLogBase({
    providerId: `${input.providerId}-anthropic-compatible`,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint: `${input.config.baseURL}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": input.config.apiKey ? "[redacted]" : "",
        "anthropic-version": "sdk-managed"
      },
      body: requestBody,
      messageCount: input.messageCount ?? requestBody.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });

  if (!input.config.apiKey) {
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: "未检测到 API Key。"
    });
    throw new Error(`${input.providerId} 未检测到 API Key。请在模型库中为该模型块填写 API Key。`);
  }

  const client = new Anthropic({
    apiKey: input.config.apiKey.trim(),
    baseURL: input.config.baseURL
  });

  try {
    const response = await client.messages.create(requestBody);
    const content = response.content
      .map((block) => block.type === "text" ? block.text : "")
      .join("")
      .trim();

    addProviderDebugLog({
      ...debugLog,
      status: "succeeded",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      response: {
        content,
        stopReason: response.stop_reason ?? undefined,
        usage: response.usage
      }
    });

    return content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(`${input.providerId} Anthropic-compatible 调用失败：${message}`);
  }
}

async function createOllamaJsonChat(input: {
  readonly config: ModelRuntimeConfig;
  readonly providerId: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly latestUserMessage?: string;
  readonly messageCount?: number;
  readonly ollamaFormatJson?: boolean;
}): Promise<string> {
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    stream: false,
    ...(input.ollamaFormatJson ? { format: "json" } : {}),
    messages: [
      {
        role: "system",
        content: input.systemPrompt
      },
      {
        role: "user",
        content: input.userPrompt
      }
    ],
    options: {
      temperature: input.config.temperature,
      num_predict: input.config.maxTokens
    }
  };
  const debugLog = createDebugLogBase({
    providerId: `${input.providerId}-ollama`,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint: `${input.config.baseURL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: requestBody,
      messageCount: input.messageCount ?? requestBody.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });

  const response = await fetch(`${input.config.baseURL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const message = `${response.status}: ${await response.text()}`;
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(`${input.providerId} Ollama HTTP ${message}`);
  }

  const data = (await response.json()) as OllamaChatResponse;
  const content = (data.message?.content ?? data.response ?? "").trim();
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content
    }
  });

  return content;
}
