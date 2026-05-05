import type { ChatMessage, ChatRequest, ChatSession } from "@xiaomi/shared";

const sessions = new Map<string, ChatSession>();

export function getOrCreateSession(request: ChatRequest, now: string): ChatSession {
  if (request.sessionId && sessions.has(request.sessionId)) {
    return sessions.get(request.sessionId) as ChatSession;
  }

  const session: ChatSession = {
    id: request.sessionId ?? `chat-${Date.now()}`,
    projectId: request.projectId,
    title: "项目协作会话",
    modelProfileId: request.modelProfileId,
    messages: [],
    createdAt: now,
    updatedAt: now
  };

  sessions.set(session.id, session);
  return session;
}

export function appendAssistantMessage(
  session: ChatSession,
  messages: readonly ChatMessage[],
  assistantMessageId: string,
  roleLabel: string,
  content: string
): { session: ChatSession; assistantMessage: ChatMessage } {
  const assistantMessage: ChatMessage = {
    id: assistantMessageId,
    sender: "assistant",
    roleLabel,
    content,
    createdAt: new Date().toISOString()
  };
  const updatedSession: ChatSession = {
    ...session,
    messages: [...messages, assistantMessage],
    updatedAt: assistantMessage.createdAt
  };

  sessions.set(updatedSession.id, updatedSession);

  return {
    session: updatedSession,
    assistantMessage
  };
}
