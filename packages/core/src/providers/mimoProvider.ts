import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "@xiaomi/shared";
import type { ConversationSummary } from "../conversationSummaries";
import { getModelRuntimeConfig } from "../modelRuntimeConfig";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";
import { buildIntentContextMessage, buildSystemPrompt } from "../prompts";
import { streamOpenAiChat } from "./openAiCompatibleProvider";

interface StreamMimoChatInput {
  readonly messages: readonly ChatMessage[];
  readonly latestUserMessage: string;
  readonly intentSummary: string;
  readonly conversationSummary?: ConversationSummary;
  readonly onDelta: (delta: string) => void;
}

export interface ModelResponse {
  readonly content: string;
  readonly stopReason?: string;
  readonly usage?: unknown;
}

export async function streamMimoChat(input: StreamMimoChatInput): Promise<ModelResponse> {
  const config = getModelRuntimeConfig("main");
  const systemPrompt = buildSystemPrompt();

  if (config.providerKind === "openai-compatible") {
    const runtimeContext = [
      input.conversationSummary ? formatConversationSummary(input.conversationSummary) : "",
      buildIntentContextMessage(input.intentSummary)
    ]
      .filter((item) => item.trim().length > 0)
      .join("\n\n---\n\n");

    return streamOpenAiChat({
      config,
      system: systemPrompt,
      messages: trimCompressedMessages(input.messages, input.conversationSummary),
      runtimeContext,
      latestUserMessage: input.latestUserMessage,
      onDelta: input.onDelta
    });
  }

  if (config.providerKind !== "anthropic-compatible") {
    throw new Error(`主模型当前只支持 anthropic-compatible 或 openai-compatible，实际配置为：${config.providerKind}`);
  }

  const startedAtMs = Date.now();
  const requestBody: Anthropic.Messages.MessageCreateParamsStreaming = {
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemPrompt,
    messages: buildMimoMessages(input.messages, input.intentSummary, input.conversationSummary),
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
  intentSummary: string,
  conversationSummary?: ConversationSummary
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
        text: buildIntentContextMessage(intentSummary)
      }
    ]
  };
  const stableContextMessages = summaryContextMessage ? [summaryContextMessage] : [];

  if (!latestUserMessage) {
    return [...stableContextMessages, runtimeContextMessage];
  }

  return [...stableContextMessages, ...historyMessages, runtimeContextMessage, latestUserMessage];
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
