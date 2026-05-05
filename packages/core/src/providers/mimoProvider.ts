import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "@xiaomi/shared";
import { getMimoApiKey } from "../localSecrets";
import { MIMO_BASE_URL, MIMO_MAX_TOKENS, MIMO_MODEL } from "../modelConfig";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";
import { buildIntentContextMessage, buildSystemPrompt } from "../prompts";

interface StreamMimoChatInput {
  readonly messages: readonly ChatMessage[];
  readonly latestUserMessage: string;
  readonly intentSummary: string;
  readonly onDelta: (delta: string) => void;
}

export async function streamMimoChat(input: StreamMimoChatInput): Promise<string> {
  const startedAtMs = Date.now();
  const requestBody: Anthropic.Messages.MessageCreateParamsStreaming = {
    model: MIMO_MODEL,
    max_tokens: MIMO_MAX_TOKENS,
    system: buildSystemPrompt(),
    messages: buildMimoMessages(input.messages, input.intentSummary),
    top_p: 0.95,
    stream: true,
    temperature: 1.0
  };
  const debugLog = createDebugLogBase({
    providerId: "mimo-anthropic",
    model: MIMO_MODEL,
    baseURL: MIMO_BASE_URL,
    request: {
      method: "POST",
      endpoint: `${MIMO_BASE_URL}/v1/messages`,
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
  const apiKey = getMimoApiKey();

  if (!apiKey) {
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: "未检测到 MiMo API Key。"
    });

    return "未检测到 MiMo API Key。请复制 config/secrets.example.json 为 config/secrets.local.json，并填写 mimoApiKey；或配置环境变量 MIMO_API_KEY 后重新启动应用。";
  }

  const client = new Anthropic({
    apiKey: apiKey.trim(),
    baseURL: MIMO_BASE_URL
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

    throw new Error(toMimoErrorMessage(message));
  }
}

function buildMimoMessages(
  messages: readonly ChatMessage[],
  intentSummary: string
): Anthropic.Messages.MessageParam[] {
  const conversationMessages = messages
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

  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: buildIntentContextMessage(intentSummary)
        }
      ]
    },
    ...conversationMessages
  ];
}

function toMimoErrorMessage(message: string): string {
  if (message.includes("401") || message.toLowerCase().includes("invalid api key")) {
    return "MiMo 服务返回 401：API Key 无效。请确认 config/secrets.local.json 中的 mimoApiKey 是小米 MiMo 平台生成的有效 Key，并且该 Key 有权限调用 mimo-v2.5-pro。";
  }

  return `MiMo 调用失败：${message}`;
}
