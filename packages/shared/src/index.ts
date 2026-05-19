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
  readonly metadata?: Record<string, unknown>;
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

export type ModelRuntimeRole = "router" | "planner" | "main" | "evaluator" | "compression";
export type ModelProviderKind = "ollama" | "anthropic-compatible" | "openai-compatible";
export type ModelToolCallingMode = "text-json" | "native-openai";

export interface ModelBlockConfig {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly description: string;
  readonly providerKind: ModelProviderKind;
  readonly baseURL: string;
  readonly model: string;
  readonly apiKey: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly toolCallingMode: ModelToolCallingMode;
  readonly thinkingEnabled: boolean;
}

export interface ModelRuntimeConfig {
  readonly role: ModelRuntimeRole;
  readonly modelBlockId?: string;
  readonly label: string;
  readonly providerKind: ModelProviderKind;
  readonly baseURL: string;
  readonly model: string;
  readonly apiKey: string;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly toolCallingMode: ModelToolCallingMode;
  readonly thinkingEnabled: boolean;
}

export interface ModelRuntimeSettings {
  readonly modelBlocks: readonly ModelBlockConfig[];
  readonly router: ModelRuntimeConfig;
  readonly planner: ModelRuntimeConfig;
  readonly main: ModelRuntimeConfig;
  readonly evaluator: ModelRuntimeConfig;
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
      readonly type: "artifact";
      readonly sessionId: ChatSessionId;
      readonly messageId: ChatMessageId;
      readonly action: "created" | "updated";
      readonly path: string;
      readonly bytes?: number;
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
export type RouterComplexity = "simple" | "moderate" | "complex";
export type RouterTaskScope = "single_turn" | "multi_turn" | "project";
export type RouterExecutionMode = "answer_only" | "plan" | "use_tools" | "modify_files" | "verify";
export type RouterWorkflowRoute = "answer_only" | "planning" | "ask_user" | "reject";
export type RouterRiskLevel = "low" | "medium" | "high";
export type RouterTimeContextMode = "none" | "current_time" | "recent_history" | "historical_timeline";
export type RouterProfileTarget = "environment" | "user" | "project";

export interface RouterTurnAnalysis {
  readonly intent: RouterIntent;
  readonly secondary_intents: readonly RouterIntent[];
  readonly rewritten_input: string;
  readonly keywords: readonly string[];
  readonly is_task: boolean;
  readonly task_goal: string;
  readonly task_type: RouterTaskType;
  readonly complexity: RouterComplexity;
  readonly task_scope: RouterTaskScope;
  readonly reasoning_brief: string;
  readonly expected_output: string;
}

export interface RouterInputRisk {
  readonly level: RouterRiskLevel;
  readonly requires_confirmation: boolean;
  readonly reasons: readonly string[];
}

export interface RouterWorkflowDecision {
  readonly workflow_route: RouterWorkflowRoute;
  readonly planning_required: boolean;
  readonly execution_mode: RouterExecutionMode;
  readonly needs_user_clarification: boolean;
  readonly clarifying_questions: readonly string[];
  readonly input_risk: RouterInputRisk;
}

export interface RouterContextDecision {
  readonly requires_project_context: boolean;
  readonly context_needs: readonly string[];
  readonly required_context: readonly string[];
  readonly memory_query: string;
  readonly time_context_mode: RouterTimeContextMode;
  readonly needs_tools: boolean;
  readonly suggested_tools: readonly string[];
  readonly tool_reason: string;
}

export interface RouterProfileSnapshotUsed {
  readonly environment: readonly string[];
  readonly user: readonly string[];
  readonly project: readonly string[];
}

export interface RouterProfileUpdate {
  readonly target: RouterProfileTarget;
  readonly field: string;
  readonly value: string;
  readonly reason: string;
  readonly confidence: number;
  readonly evidence: string;
}

export interface RouterProfileObservation {
  readonly profile_snapshot_used: RouterProfileSnapshotUsed;
  readonly profile_updates: readonly RouterProfileUpdate[];
  readonly routing_influences: readonly string[];
}

export interface RouterEvaluationSeed {
  readonly verification_question: string;
  readonly success_criteria: readonly string[];
  readonly confidence: number;
}

export interface RouterResult {
  readonly intent: RouterIntent;
  readonly secondary_intents: readonly RouterIntent[];
  readonly rewritten_input: string;
  readonly keywords: readonly string[];
  readonly is_task: boolean;
  readonly task_goal: string;
  readonly task_type: RouterTaskType;
  readonly complexity: RouterComplexity;
  readonly task_scope: RouterTaskScope;
  readonly execution_mode: RouterExecutionMode;
  readonly reasoning_brief: string;
  readonly planned_steps: readonly string[];
  readonly expected_output: string;
  readonly required_context: readonly string[];
  readonly constraints: readonly string[];
  readonly risks: readonly string[];
  readonly suggested_roles: readonly string[];
  readonly suggested_skills?: readonly string[];
  readonly main_model_brief: string;
  readonly routing_notes: string;
  readonly verification_question: string;
  readonly success_criteria: readonly string[];
  readonly needs_user_clarification: boolean;
  readonly clarifying_questions: readonly string[];
  readonly requires_project_context: boolean;
  readonly needs_tools: boolean;
  readonly suggested_tools: readonly string[];
  readonly tool_reason: string;
  readonly confidence: number;
  readonly turn_analysis: RouterTurnAnalysis;
  readonly workflow_decision: RouterWorkflowDecision;
  readonly context_decision: RouterContextDecision;
  readonly profile_observation: RouterProfileObservation;
  readonly evaluation_seed: RouterEvaluationSeed;
}

export interface PlanningStep {
  readonly step: number;
  readonly title: string;
  readonly detail: string;
}

export interface PlanningResult {
  readonly goal: string;
  readonly plan_summary: string;
  readonly execution_plan: readonly PlanningStep[];
  readonly required_tools: readonly string[];
  readonly files_to_inspect: readonly string[];
  readonly files_to_modify: readonly string[];
  readonly risks: readonly string[];
  readonly needs_user_confirmation: boolean;
  readonly confirmation_reason: string;
  readonly expected_result: string;
  readonly execution_instruction: string;
  readonly confidence: number;
}

export type EvaluationNextAction = "final" | "revise_answer" | "ask_user" | "use_tools";

export interface OutputEvaluationResult {
  readonly should_evaluate: boolean;
  readonly passed: boolean;
  readonly verification_question: string;
  readonly satisfied_criteria: readonly string[];
  readonly missing_criteria: readonly string[];
  readonly issues: readonly string[];
  readonly check_steps: readonly string[];
  readonly decision_reason: string;
  readonly next_action: EvaluationNextAction;
  readonly revision_instruction: string;
  readonly confidence: number;
}

export type MemoryType = "fact" | "preference" | "decision" | "plan" | "constraint";

export interface MemoryRecord {
  readonly id: string;
  readonly projectId: string;
  readonly type: MemoryType;
  readonly content: string;
  readonly tags: readonly string[];
  readonly importance: number;
  readonly confidence: number;
  readonly sourceSessionId?: string;
  readonly sourceEventIds: readonly string[];
  readonly status: "active" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryTypeCount {
  readonly type: MemoryType;
  readonly count: number;
}

export interface MemoryTagCount {
  readonly tag: string;
  readonly count: number;
}

export interface MemoryLayerGroup {
  readonly key: "recent_writes" | "recent_recalls" | "session_memories" | "project_memories";
  readonly title: string;
  readonly description: string;
  readonly count: number;
  readonly memories: readonly MemoryRecord[];
}

export interface MemoryPanelStats {
  readonly recentWrites: number;
  readonly recentRecalls: number;
  readonly totalProjectMemories: number;
  readonly totalSessionMemories: number;
  readonly typeCounts: readonly MemoryTypeCount[];
  readonly topTags: readonly MemoryTagCount[];
}

export interface MemoryPanelData {
  readonly stats: MemoryPanelStats;
  readonly layers: readonly MemoryLayerGroup[];
}

export interface EnvironmentToolAvailability {
  readonly name: string;
  readonly available: boolean;
  readonly version?: string;
}

export interface EnvironmentFingerprintPayload {
  readonly os: {
    readonly platform: string;
    readonly release: string;
    readonly arch: string;
  };
  readonly runtime: {
    readonly nodeVersion: string;
    readonly electronVersion?: string;
    readonly timezone: string;
    readonly shell: string;
  };
  readonly workspace: {
    readonly cwd: string;
    readonly projectRoot: string;
    readonly packageManager: string;
    readonly isGitRepo: boolean;
    readonly hasPnpmWorkspace: boolean;
    readonly appKind: string;
  };
  readonly markers: readonly string[];
  readonly tools: readonly EnvironmentToolAvailability[];
}

export interface EnvironmentFingerprint {
  readonly id: string;
  readonly scope: "global";
  readonly fingerprintHash: string;
  readonly summary: string;
  readonly snapshot: readonly string[];
  readonly payload: EnvironmentFingerprintPayload;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PromptIterationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly targetTemplate: string;
  readonly trigger: "evaluation_gap" | "user_feedback" | "manual";
  readonly reason: string;
  readonly suggestedChange: string;
  readonly sourceEventIds: readonly string[];
  readonly status: "proposed" | "accepted" | "rejected" | "applied";
  readonly createdAt: string;
  readonly updatedAt: string;
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

export interface FileReadRequest {
  readonly type: "file.read";
  readonly reason: string;
  readonly path: string;
  readonly maxBytes?: number;
}

export interface FileListRequest {
  readonly type: "file.list";
  readonly reason: string;
  readonly path: string;
  readonly recursive?: boolean;
  readonly maxEntries?: number;
}

export interface FileSearchRequest {
  readonly type: "file.search";
  readonly reason: string;
  readonly path?: string;
  readonly query: string;
  readonly glob?: string;
  readonly maxResults?: number;
}

export interface FileWriteRequest {
  readonly type: "file.write";
  readonly reason: string;
  readonly path: string;
  readonly content: string;
}

export interface MemorySaveRequest {
  readonly type: "memory.save";
  readonly reason: string;
  readonly content: string;
  readonly memoryType?: MemoryType;
  readonly tags?: readonly string[];
  readonly importance?: number;
}

export type ToolRequest =
  | CommandRunRequest
  | FileReadRequest
  | FileListRequest
  | FileSearchRequest
  | FileWriteRequest
  | MemorySaveRequest;

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

export interface ToolResult {
  readonly request: ToolRequest;
  readonly decision: CommandDecision;
  readonly status: "executed" | "skipped" | "failed";
  readonly reason: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly output?: string;
  readonly data?: unknown;
  readonly durationMs?: number;
}

export type AgentEventType =
  | "chat_message"
  | "router_result"
  | "planning_result"
  | "tool_selection"
  | "tool_call"
  | "tool_result"
  | "output_evaluation"
  | "memory_write"
  | "memory_recall"
  | "prompt_iteration"
  | "conversation_summary"
  | "model_return"
  | "error";

export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

export type RuntimeLogStage =
  | "environment"
  | "compression"
  | "router"
  | "memory"
  | "tool_selection"
  | "planning"
  | "main"
  | "tool_gateway"
  | "tool_followup"
  | "evaluation"
  | "revision"
  | "session"
  | "system";

export interface RuntimeLogRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly stage: RuntimeLogStage;
  readonly level: RuntimeLogLevel;
  readonly message: string;
  readonly payload?: unknown;
  readonly createdAt: string;
}

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