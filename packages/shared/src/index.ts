export type RoleId = string;
export type NodeId = string;
export type WorkflowId = string;
export type RunId = string;
export type ChatSessionId = string;
export type ChatMessageId = string;
export type ProviderId = string;
export type ModelProfileId = string;

export type NodeStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "skipped";

export type AgentNodeKind =
  | "start"
  | "role-agent"
  | "tool-action"
  | "human-approval"
  | "merge"
  | "decision"
  | "artifact-output"
  | "end";

export interface PermissionPolicy {
  readonly readFiles?: boolean;
  readonly writeFiles?: boolean;
  readonly runCommands?: boolean;
  readonly network?: boolean;
  readonly highRisk?: boolean;
}

export interface RoleDefinition {
  readonly id: RoleId;
  readonly name: string;
  readonly responsibility: string;
  readonly systemPrompt: string;
  readonly permissions: PermissionPolicy;
  readonly outputFormat: "markdown" | "json";
  readonly model?: string;
}

export interface AgentNodeData {
  readonly label: string;
  readonly description?: string;
  readonly roleId?: RoleId;
  readonly prompt?: string;
}

export interface AgentNode {
  readonly id: NodeId;
  readonly kind: AgentNodeKind;
  readonly data: AgentNodeData;
}

export interface WorkflowEdge {
  readonly id: string;
  readonly source: NodeId;
  readonly target: NodeId;
}

export interface WorkflowDefinition {
  readonly id: WorkflowId;
  readonly name: string;
  readonly nodes: readonly AgentNode[];
  readonly edges: readonly WorkflowEdge[];
}

export interface NodeRun {
  readonly nodeId: NodeId;
  readonly status: NodeStatus;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly input?: string;
  readonly output?: string;
  readonly error?: string;
}

export interface WorkflowRun {
  readonly id: RunId;
  readonly workflowId: WorkflowId;
  readonly status: NodeStatus;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly nodes: readonly NodeRun[];
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

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
  readonly context?: {
    readonly workflow?: WorkflowDefinition;
    readonly latestRun?: WorkflowRun | null;
  };
}

export interface ChatResponse {
  readonly session: ChatSession;
  readonly assistantMessage: ChatMessage;
}

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
  };
  readonly error?: string;
}
