import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, MemoryRecord, ToolRequest, ToolResult, ToolSelectionResult } from "@xiaomi/shared";
import type { ConversationSummary } from "../conversationSummaries";
import { getModelRuntimeConfig } from "../modelRuntimeConfig";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";
import { buildRouterContextMessage, buildSystemPrompt } from "../prompts";
import { streamOpenAiChat, streamOpenAiChatWithNativeTools } from "./openAiCompatibleProvider";

interface StreamMimoChatInput {
  readonly messages: readonly ChatMessage[];
  readonly latestUserMessage: string;
  readonly routerContext: string;
  readonly conversationSummary?: ConversationSummary;
  readonly memories?: readonly MemoryRecord[];
  readonly toolSelection?: ToolSelectionResult;
  readonly executeToolRequest?: (request: ToolRequest) => Promise<ToolResult>;
  readonly onDelta: (delta: string) => void;
}

export interface ModelResponse {
  readonly content: string;
  readonly stopReason?: string;
  readonly usage?: unknown;
  readonly nativeMessages?: readonly unknown[];
  readonly nativeToolResults?: readonly ToolResult[];
}

export async function streamMimoChat(input: StreamMimoChatInput): Promise<ModelResponse> {
  const config = getModelRuntimeConfig("main");
  const systemPrompt = buildSystemPrompt();

  if (config.providerKind === "openai-compatible") {
    const runtimeContext = [
      input.conversationSummary ? formatConversationSummary(input.conversationSummary) : "",
      input.memories && input.memories.length > 0 ? formatLongTermMemories(input.memories) : "",
      buildRouterContextMessage(input.routerContext)
    ]
      .filter((item) => item.trim().length > 0)
      .join("\n\n---\n\n");

    const openAiInput = {
      config,
      system: systemPrompt,
      messages: trimCompressedMessages(input.messages, input.conversationSummary),
      runtimeContext,
      latestUserMessage: input.latestUserMessage,
      onDelta: input.onDelta
    };

    if (config.toolCallingMode === "native-openai" && input.toolSelection && input.executeToolRequest) {
      return streamOpenAiChatWithNativeTools({
        ...openAiInput,
        toolSelection: input.toolSelection,
        executeToolRequest: input.executeToolRequest
      });
    }

    return streamOpenAiChat(openAiInput);
  }

  if (config.providerKind === "ollama") {
    return streamOllamaMainChat({
      config,
      systemPrompt,
      messages: input.messages,
      latestUserMessage: input.latestUserMessage,
      routerContext: input.routerContext,
      conversationSummary: input.conversationSummary,
      memories: input.memories,
      onDelta: input.onDelta
    });
  }

  if (config.providerKind !== "anthropic-compatible") {
    throw new Error(`主模型当前只支持 ollama、anthropic-compatible 或 openai-compatible，实际配置为：${config.providerKind}`);
  }

  const startedAtMs = Date.now();
  const requestBody: Anthropic.Messages.MessageCreateParamsStreaming = {
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemPrompt,
    messages: buildMimoMessages(input.messages, input.routerContext, input.conversationSummary, input.memories),
    top_p: 0.95,
    stream: true,
    temperature: config.temperature
  };
  const debugLog = createDebugLogBase({
    providerId: "main-anthropic-compatible",
    model: config.model,
    baseURL: config.baseURL,
    request: {
      method: "POST",
      endpoint: `${config.baseURL}/v1/messages`,
      headers: {
        "content-type": "application/json",
        "x-api-key": "[redacted]",
        "anthropic-version": "sdk-managed"
      },
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });
  const apiKey = config.apiKey;

  if (!apiKey) {
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: "未检测到主模型 API Key。"
    });

    return {
      content:
        "未检测到主模型 API Key。请打开模型配置，填写 main 模型的 API Key 后重新发送。",
      stopReason: "missing_api_key"
    };
  }

  const client = new Anthropic({
    apiKey: apiKey.trim(),
    baseURL: config.baseURL
  });
  try {
    let content = "";
    const stream = client.messages.stream(requestBody);

    stream.on("text", (delta) => {
      content += delta;
      input.onDelta(delta);
    });

    const finalMessage = await stream.finalMessage();

    addProviderDebugLog({
      ...debugLog,
      status: "succeeded",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      response: {
        content,
        stopReason: finalMessage.stop_reason ?? undefined,
        usage: finalMessage.usage
      }
    });

    return {
      content,
      stopReason: finalMessage.stop_reason ?? undefined,
      usage: finalMessage.usage
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });

    throw new Error(toMimoErrorMessage(message));
  }
}

function buildMimoMessages(
  messages: readonly ChatMessage[],
  routerContext: string,
  conversationSummary?: ConversationSummary,
  memories?: readonly MemoryRecord[]
): Anthropic.Messages.MessageParam[] {
  const activeMessages = trimCompressedMessages(messages, conversationSummary);
  const conversationMessages = toAnthropicMessages(activeMessages);
  const latestUserMessage = conversationMessages.at(-1);
  const historyMessages = latestUserMessage ? conversationMessages.slice(0, -1) : conversationMessages;
  const summaryContextMessage = conversationSummary
    ? {
        role: "user",
        content: [
          {
            type: "text",
            text: formatConversationSummary(conversationSummary)
          }
        ]
      } satisfies Anthropic.Messages.MessageParam
    : undefined;
  const runtimeContextMessage: Anthropic.Messages.MessageParam = {
    role: "user",
    content: [
      {
        type: "text",
        text: buildRouterContextMessage(routerContext)
      }
    ]
  };
  const memoryContextMessage: Anthropic.Messages.MessageParam | undefined = memories && memories.length > 0
    ? {
        role: "user",
        content: [
          {
            type: "text",
            text: formatLongTermMemories(memories)
          }
        ]
      }
    : undefined;
  const stableContextMessages = [
    ...(summaryContextMessage ? [summaryContextMessage] : []),
    ...(memoryContextMessage ? [memoryContextMessage] : [])
  ];

  if (!latestUserMessage) {
    return [...stableContextMessages, runtimeContextMessage];
  }

  return [...stableContextMessages, ...historyMessages, runtimeContextMessage, latestUserMessage];
}

async function streamOllamaMainChat(input: {
  readonly config: ReturnType<typeof getModelRuntimeConfig>;
  readonly systemPrompt: string;
  readonly messages: readonly ChatMessage[];
  readonly latestUserMessage: string;
  readonly routerContext: string;
  readonly conversationSummary?: ConversationSummary;
  readonly memories?: readonly MemoryRecord[];
  readonly onDelta: (delta: string) => void;
}): Promise<ModelResponse> {
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    stream: true,
    messages: buildOllamaMessages(input),
    options: {
      temperature: input.config.temperature,
      num_predict: input.config.maxTokens
    }
  };
  const debugLog = createDebugLogBase({
    providerId: "main-ollama",
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint: `${input.config.baseURL}/api/chat`,
      headers: {
        "content-type": "application/json"
      },
      body: requestBody,
      messageCount: input.messages.length,
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

  if (!response.ok || !response.body) {
    const message = `${response.status}: ${await response.text()}`;
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(`Ollama 主模型调用失败：${message}`);
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
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as {
          readonly message?: { readonly content?: string };
          readonly done?: boolean;
          readonly done_reason?: string;
        };
        const delta = parsed.message?.content ?? "";
        if (delta) {
          content += delta;
          input.onDelta(delta);
        }
        if (parsed.done) {
          stopReason = parsed.done_reason ?? "stop";
        }
      } catch {
        // Ignore malformed streaming fragments.
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

function buildOllamaMessages(input: {
  readonly systemPrompt: string;
  readonly messages: readonly ChatMessage[];
  readonly routerContext: string;
  readonly conversationSummary?: ConversationSummary;
  readonly memories?: readonly MemoryRecord[];
}): readonly { readonly role: "system" | "user" | "assistant"; readonly content: string }[] {
  const activeMessages = trimCompressedMessages(input.messages, input.conversationSummary);
  const conversationMessages = activeMessages
    .filter((message) => message.sender === "user" || message.sender === "assistant")
    .map((message) => ({
      role: message.sender === "assistant" ? "assistant" as const : "user" as const,
      content: message.content
    }));
  const latestUserMessage = conversationMessages.at(-1);
  const historyMessages = latestUserMessage ? conversationMessages.slice(0, -1) : conversationMessages;
  const runtimeContext = [
    input.conversationSummary ? formatConversationSummary(input.conversationSummary) : "",
    input.memories && input.memories.length > 0 ? formatLongTermMemories(input.memories) : "",
    buildRouterContextMessage(input.routerContext)
  ].filter((item) => item.trim().length > 0).join("\n\n---\n\n");

  return [
    {
      role: "system",
      content: input.systemPrompt
    },
    ...historyMessages,
    {
      role: "user",
      content: runtimeContext
    },
    ...(latestUserMessage ? [latestUserMessage] : [])
  ];
}

function trimCompressedMessages(
  messages: readonly ChatMessage[],
  conversationSummary?: ConversationSummary
): readonly ChatMessage[] {
  if (!conversationSummary) {
    return messages;
  }

  const sourceEndIndex = messages.findIndex((message) => message.id === conversationSummary.sourceEndMessageId);

  return sourceEndIndex >= 0 ? messages.slice(sourceEndIndex + 1) : messages;
}

function formatConversationSummary(summary: ConversationSummary): string {
  return [
    "【会话压缩摘要】",
    "",
    "以下内容是系统根据较早真实对话生成的会话摘要，不是用户本轮输入。它用于替代已从上下文中裁剪的早期对话。",
    "",
    `覆盖范围：${summary.sourceStartMessageId} -> ${summary.sourceEndMessageId}`,
    "",
    "摘要：",
    summary.summary,
    "",
    formatList("已确认决策", summary.decisions),
    formatList("未确认问题", summary.openQuestions),
    formatList("约束与偏好", summary.constraints),
    formatList("任务进度", summary.taskProgress)
  ]
    .filter((item) => item.trim().length > 0)
    .join("\n");
}

function formatLongTermMemories(memories: readonly MemoryRecord[]): string {
  return [
    "【长期记忆召回】",
    "",
    "以下内容是系统从本地长期记忆数据库召回的用户偏好、项目决策、约束或规划，不是用户本轮新输入。请优先遵守其中的高重要性规则，但不要原样复述。",
    "",
    ...memories.map((memory) => {
      return [
        `- id: ${memory.id}`,
        `  type: ${memory.type}`,
        `  importance: ${memory.importance}`,
        `  confidence: ${memory.confidence}`,
        `  content: ${memory.content}`,
        memory.tags.length > 0 ? `  tags: ${memory.tags.join(", ")}` : ""
      ].filter((item) => item.length > 0).join("\n");
    })
  ].join("\n");
}

function formatList(label: string, items: readonly string[]): string {
  if (items.length === 0) {
    return "";
  }

  return [`${label}：`, ...items.map((item) => `- ${item}`)].join("\n");
}

function toAnthropicMessages(messages: readonly ChatMessage[]): Anthropic.Messages.MessageParam[] {
  return messages
    .filter((message) => message.sender === "user" || message.sender === "assistant")
    .map((message) => ({
      role: message.sender === "assistant" ? "assistant" : "user",
      content: [
        {
          type: "text",
          text: message.content
        }
      ]
    }) satisfies Anthropic.Messages.MessageParam);
}

function toMimoErrorMessage(message: string): string {
  if (message.includes("401") || message.toLowerCase().includes("invalid api key")) {
    return "主模型服务返回 401：API Key 无效。请确认模型配置中的 API Key、Base URL 和模型名正确。";
  }

  return `主模型调用失败：${message}`;
}
