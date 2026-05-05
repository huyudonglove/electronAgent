export type ChatSessionId = string;
export type ChatMessageId = string;
export type ProviderId = string;
export type ModelProfileId = string;

export type ChatMessageSender = "user" | "assistant" | "system";

export interface ChatMessage {
  readonly id: ChatMessageId;
  readonly sender: ChatMessageSender;
  readonly roleLabel: string;
  readonly content: string;
  readonly createdAt: string;
}

export interface ChatSession {
  readonly id: ChatSessionId;
  readonly projectId: string;
  readonly title: string;
  readonly modelProfileId: ModelProfileId;
  readonly messages: readonly ChatMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProviderCapability {
  readonly chat: boolean;
  readonly streamChat: boolean;
  readonly structuredOutput: boolean;
  readonly toolCalling: boolean;
}

export interface ModelProfile {
  readonly id: ModelProfileId;
  readonly providerId: ProviderId;
  readonly label: string;
  readonly model: string;
  readonly status: "mock" | "configured" | "missing-config";
  readonly capabilities: ProviderCapability;
}

export interface ChatRequest {
  readonly sessionId?: ChatSessionId;
  readonly projectId: string;
  readonly modelProfileId: ModelProfileId;
  readonly message: string;
}

export interface ChatResponse {
  readonly session: ChatSession;
  readonly assistantMessage: ChatMessage;
}

export type ChatStreamEvent =
  | {
      readonly type: "stage";
      readonly label: string;
      readonly detail?: string;
    }
  | {
      readonly type: "start";
      readonly sessionId: ChatSessionId;
      readonly messageId: ChatMessageId;
      readonly roleLabel: string;
    }
  | {
      readonly type: "delta";
      readonly sessionId: ChatSessionId;
      readonly messageId: ChatMessageId;
      readonly delta: string;
    }
  | {
      readonly type: "done";
      readonly session: ChatSession;
      readonly assistantMessage: ChatMessage;
    }
  | {
      readonly type: "error";
      readonly error: string;
    };

export interface ProviderDebugLog {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly model: string;
  readonly baseURL?: string;
  readonly status: "pending" | "succeeded" | "failed";
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly request: {
    readonly method?: string;
    readonly endpoint?: string;
    readonly headers?: Record<string, string>;
    readonly body?: unknown;
    readonly messageCount: number;
    readonly latestUserMessage?: string;
  };
  readonly response?: {
    readonly content: string;
    readonly stopReason?: string;
    readonly usage?: unknown;
  };
  readonly error?: string;
}
