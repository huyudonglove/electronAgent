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

export type ModelRuntimeRole = "router" | "main" | "compression";
export type ModelProviderKind = "ollama" | "anthropic-compatible" | "openai-compatible";

export interface ModelRuntimeConfig {
  readonly role: ModelRuntimeRole;
  readonly label: string;
  readonly providerKind: ModelProviderKind;
  readonly baseURL: string;
  readonly model: string;
  readonly apiKey: string;
  readonly temperature: number;
  readonly maxTokens: number;
}

export interface ModelRuntimeSettings {
  readonly router: ModelRuntimeConfig;
  readonly main: ModelRuntimeConfig;
  readonly compression: ModelRuntimeConfig;
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
      readonly type: "replace";
      readonly sessionId: ChatSessionId;
      readonly messageId: ChatMessageId;
      readonly content: string;
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

export type RouterIntent = "chat" | "analysis" | "code" | "debug" | "search";
export type RouterTaskType = "chat" | "analysis" | "design" | "implementation" | "debugging" | "verification";

export interface RouterResult {
  readonly intent: RouterIntent;
  readonly rewritten_input: string;
  readonly keywords: readonly string[];
  readonly is_task: boolean;
  readonly task_goal: string;
  readonly task_type: RouterTaskType;
  readonly requires_project_context: boolean;
  readonly needs_tools: boolean;
  readonly suggested_tools: readonly string[];
  readonly tool_reason: string;
  readonly confidence: number;
}

export type ToolAccessMode = "none" | "project_read" | "project_write" | "project_verify";

export interface ToolSelectionResult {
  readonly selected_tools: readonly string[];
  readonly access_mode: ToolAccessMode;
  readonly reason: string;
  readonly confidence_threshold: number;
  readonly router_confidence: number;
  readonly auto_allowed: boolean;
}

export interface CommandRunRequest {
  readonly type: "command.run";
  readonly reason: string;
  readonly shell: "powershell";
  readonly cwd: string;
  readonly command: string;
}

export type CommandDecision = "allow" | "confirm" | "deny";

export interface CommandRunResult {
  readonly request: CommandRunRequest;
  readonly decision: CommandDecision;
  readonly status: "executed" | "skipped" | "failed";
  readonly reason: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly durationMs?: number;
}

export type AgentEventType =
  | "chat_message"
  | "router_result"
  | "tool_selection"
  | "tool_call"
  | "tool_result"
  | "conversation_summary"
  | "model_return"
  | "error";

export interface AgentEventRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly messageId?: string;
  readonly type: AgentEventType;
  readonly actor: string;
  readonly roleLabel?: string;
  readonly content?: string;
  readonly payload: unknown;
  readonly createdAt: string;
}
