import type { ChatMessage, ChatRequest, ChatResponse, ChatStreamEvent, ModelProfile } from "@xiaomi/shared";
import { appendAssistantMessage, getOrCreateSession } from "./chatSessions";
import { getMimoApiKey } from "./localSecrets";
import { MIMO_MODEL, OLLAMA_INTENT_MODEL } from "./modelConfig";
import { streamMimoChat } from "./providers/mimoProvider";
import { recognizeIntent } from "./providers/ollamaIntentProvider";

export type ChatStreamHandler = (event: ChatStreamEvent) => void;

export function listModelProfiles(): readonly ModelProfile[] {
  return [
    {
      id: "mimo-v2-5-pro",
      providerId: "mimo-anthropic",
      label: "MiMo v2.5 Pro",
      model: MIMO_MODEL,
      status: getMimoApiKey() ? "configured" : "missing-config",
      capabilities: {
        chat: true,
        streamChat: true,
        structuredOutput: false,
        toolCalling: false
      }
    }
  ];
}

export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  let response: ChatResponse | null = null;

  await streamChatMessage(request, (event) => {
    if (event.type === "done") {
      response = {
        session: event.session,
        assistantMessage: event.assistantMessage
      };
    }

    if (event.type === "error") {
      throw new Error(event.error);
    }
  });

  if (!response) {
    throw new Error("MiMo 未返回内容。");
  }

  return response;
}

export async function streamChatMessage(request: ChatRequest, onEvent: ChatStreamHandler): Promise<void> {
  const now = new Date().toISOString();
  const session = getOrCreateSession(request, now);
  const userMessage = createUserMessage(request.message, now);
  const messages = [...session.messages, userMessage];
  const assistantMessageId = `msg-assistant-${Date.now()}`;

  onEvent({
    type: "stage",
    label: "意图识别",
    detail: `正在调用本地 Ollama 小模型 ${OLLAMA_INTENT_MODEL}`
  });

  const intentSummary = await recognizeIntent(messages, request.message);

  onEvent({
    type: "stage",
    label: "大模型对话",
    detail: "正在将意图识别结果组装进 MiMo 上下文"
  });

  onEvent({
    type: "start",
    sessionId: session.id,
    messageId: assistantMessageId,
    roleLabel: "MiMo"
  });

  try {
    const content = await streamMimoChat({
      messages,
      latestUserMessage: request.message,
      intentSummary,
      onDelta: (delta) => {
        onEvent({
          type: "delta",
          sessionId: session.id,
          messageId: assistantMessageId,
          delta
        });
      }
    });
    const result = appendAssistantMessage(session, messages, assistantMessageId, "MiMo", content);

    onEvent({
      type: "done",
      session: result.session,
      assistantMessage: result.assistantMessage
    });
  } catch (error) {
    onEvent({
      type: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function createUserMessage(content: string, createdAt: string): ChatMessage {
  return {
    id: `msg-user-${Date.now()}`,
    sender: "user",
    roleLabel: "你",
    content,
    createdAt
  };
}
