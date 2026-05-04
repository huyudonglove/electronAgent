import type { ChatMessage, ChatRequest, ChatResponse, ChatSession } from "@xiaomi/shared";
import { getModelProfile, getProvider, listModelProfiles as getModelProfiles } from "./modelProviders";

const sessions = new Map<string, ChatSession>();

export function listModelProfiles() {
  return getModelProfiles();
}

export async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const now = new Date().toISOString();
  const session = getOrCreateSession(request, now);
  const userMessage: ChatMessage = {
    id: `msg-user-${Date.now()}`,
    sender: "user",
    roleLabel: "你",
    content: request.message,
    createdAt: now
  };
  const nextMessages = [...session.messages, userMessage];
  const modelProfile = getModelProfile(request.modelProfileId);
  const provider = getProvider(modelProfile.providerId);
  const providerResponse = await provider.chat({
    ...request,
    messages: nextMessages,
    modelProfile
  });
  const assistantMessage: ChatMessage = {
    id: `msg-assistant-${Date.now()}`,
    sender: "assistant",
    roleLabel: providerResponse.roleLabel,
    content: providerResponse.content,
    createdAt: new Date().toISOString()
  };
  const updatedSession: ChatSession = {
    ...session,
    modelProfileId: modelProfile.id,
    messages: [...nextMessages, assistantMessage],
    updatedAt: assistantMessage.createdAt
  };

  sessions.set(updatedSession.id, updatedSession);

  return {
    session: updatedSession,
    assistantMessage
  };
}

function getOrCreateSession(request: ChatRequest, now: string): ChatSession {
  if (request.sessionId && sessions.has(request.sessionId)) {
    return sessions.get(request.sessionId) as ChatSession;
  }

  const session: ChatSession = {
    id: request.sessionId ?? `chat-${Date.now()}`,
    projectId: request.projectId,
    title: "项目协作会话",
    modelProfileId: request.modelProfileId,
    messages: [
      
    ],
    createdAt: now,
    updatedAt: now
  };

  sessions.set(session.id, session);
  return session;
}
