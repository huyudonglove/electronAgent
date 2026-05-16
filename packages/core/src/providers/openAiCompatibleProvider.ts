import type { ChatMessage, ModelRuntimeConfig } from "@xiaomi/shared";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";

interface OpenAiChatResponse {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string;
    };
    readonly finish_reason?: string;
  }[];
  readonly usage?: unknown;
}

export interface OpenAiStreamResponse {
  readonly content: string;
  readonly stopReason?: string;
  readonly usage?: unknown;
}

export async function createOpenAiJsonChat(input: {
  readonly config: ModelRuntimeConfig;
  readonly messages: readonly { readonly role: "system" | "user" | "assistant"; readonly content: string }[];
  readonly latestUserMessage?: string;
  readonly providerId: string;
}): Promise<string> {
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    messages: input.messages,
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    response_format: {
      type: "json_object"
    },
    stream: false
  };
  const endpoint = `${trimTrailingSlash(input.config.baseURL)}/chat/completions`;
  const debugLog = createDebugLogBase({
    providerId: input.providerId,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint,
      headers: buildDebugHeaders(input.config),
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(input.config),
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
    throw new Error(`OpenAI-compatible 调用失败：${message}`);
  }

  const data = (await response.json()) as OpenAiChatResponse;
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content,
      stopReason: data.choices?.[0]?.finish_reason,
      usage: data.usage
    }
  });

  return content;
}

export async function streamOpenAiChat(input: {
  readonly config: ModelRuntimeConfig;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly runtimeContext: string;
  readonly latestUserMessage: string;
  readonly onDelta: (delta: string) => void;
}): Promise<OpenAiStreamResponse> {
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    messages: buildOpenAiMessages(input),
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    stream: true
  };
  const endpoint = `${trimTrailingSlash(input.config.baseURL)}/chat/completions`;
  const debugLog = createDebugLogBase({
    providerId: `${input.config.role}-${input.config.providerKind}`,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint,
      headers: buildDebugHeaders(input.config),
      body: requestBody,
      messageCount: requestBody.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(input.config),
    body: JSON.stringify(requestBody)
  });

  if (!response.ok || !response.body) {
    const message = `${response.status}: ${await response.text()}`;
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(`OpenAI-compatible 流式调用失败：${message}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let stopReason: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const data = trimmed.slice("data:".length).trim();
      if (data === "[DONE]") {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as {
          readonly choices?: readonly {
            readonly delta?: { readonly content?: string };
            readonly finish_reason?: string;
          }[];
        };
        const choice = parsed.choices?.[0];
        const delta = choice?.delta?.content ?? "";
        if (delta) {
          content += delta;
          input.onDelta(delta);
        }
        if (choice?.finish_reason) {
          stopReason = choice.finish_reason;
        }
      } catch {
        // Ignore malformed SSE fragments; the provider debug log keeps raw request details.
      }
    }
  }

  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content,
      stopReason
    }
  });

  return {
    content,
    stopReason
  };
}

function buildOpenAiMessages(input: {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly runtimeContext: string;
}): readonly { readonly role: "system" | "user" | "assistant"; readonly content: string }[] {
  const conversationMessages = input.messages
    .filter((message) => message.sender === "user" || message.sender === "assistant")
    .map((message) => ({
      role: message.sender === "assistant" ? "assistant" as const : "user" as const,
      content: message.content
    }));
  const latestUserMessage = conversationMessages.at(-1);
  const historyMessages = latestUserMessage ? conversationMessages.slice(0, -1) : conversationMessages;

  return [
    {
      role: "system",
      content: input.system
    },
    ...historyMessages,
    {
      role: "user",
      content: input.runtimeContext
    },
    ...(latestUserMessage ? [latestUserMessage] : [])
  ];
}

function buildHeaders(config: ModelRuntimeConfig): HeadersInit {
  return {
    "content-type": "application/json",
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey.trim()}` } : {})
  };
}

function buildDebugHeaders(config: ModelRuntimeConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: config.apiKey ? "Bearer [redacted]" : ""
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
