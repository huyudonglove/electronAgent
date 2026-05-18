import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  ModelProfile,
  OutputEvaluationResult,
  RouterResult,
  ToolResult
} from "@xiaomi/shared";
import { appendAssistantMessage, getOrCreateSession } from "./chatSessions";
import { maybeCompressConversation } from "./conversationCompressor";
import {
  saveChatMessageEvent,
  saveErrorEvent,
  saveMemoryRecallEvent,
  saveMemoryWriteEvent,
  saveModelReturnEvent,
  saveOutputEvaluationEvent,
  savePlanningResultEvent,
  savePromptIterationEvent,
  saveRouterResultEvent,
  saveToolCallEvent,
  saveToolResultEvent,
  saveToolSelectionEvent
} from "./events";
import { captureLongTermMemories, listRelevantMemories } from "./longTermMemories";
import { runLocalToolThroughGateway } from "./localToolGateway";
import { getModelRuntimeConfig } from "./modelRuntimeConfig";
import { MIMO_MODEL } from "./modelConfig";
import { savePromptIteration } from "./promptIterations";
import { streamMimoChat } from "./providers/mimoProvider";
import { analyzeRoute } from "./providers/routerProvider";
import { evaluateOutput } from "./providers/outputEvaluatorProvider";
import { createExecutionPlan } from "./providers/planningProvider";
import { parseLocalToolRequests, removeLocalToolRequestBlocks } from "./toolCallParser";
import { selectToolsForRouter } from "./toolSelectionPolicy";

export type ChatStreamHandler = (event: ChatStreamEvent) => void;

export function listModelProfiles(): readonly ModelProfile[] {
  const mainConfig = getModelRuntimeConfig("main");

  return [
    {
      id: "mimo-v2-5-pro",
      providerId: mainConfig.providerKind,
      label: mainConfig.label || "Main Model",
      model: mainConfig.model || MIMO_MODEL,
      status: mainConfig.providerKind === "ollama" || mainConfig.apiKey ? "configured" : "missing-config",
      capabilities: {
        chat: true,
        streamChat: true,
        structuredOutput: false,
        toolCalling: mainConfig.toolCallingMode === "native-openai"
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
  let currentStage = "会话压缩";

  try {
    onEvent({
      type: "stage",
      label: "会话压缩",
      detail: "正在检查是否需要压缩较早对话"
    });

    const conversationSummary = await maybeCompressConversation({
      projectId: session.projectId,
      sessionId: session.id,
      messages: session.messages
    });

    const userMessage = createUserMessage(request.message, now);
    const messages = [...session.messages, userMessage];
    const assistantMessageId = `msg-assistant-${Date.now()}`;
    const routerConfig = getModelRuntimeConfig("router");
    saveChatMessageEvent({
      projectId: session.projectId,
      sessionId: session.id,
      message: userMessage
    });

    currentStage = "Router 任务分析";
    onEvent({
      type: "stage",
      label: currentStage,
      detail: `正在调用 ${routerConfig.label} (${routerConfig.model})`
    });

    const routerResult = await analyzeRoute(messages, request.message);
    saveRouterResultEvent({
      projectId: session.projectId,
      sessionId: session.id,
      content: JSON.stringify(routerResult, null, 2)
    });
    const capturedMemories = captureLongTermMemories({
      projectId: session.projectId,
      sessionId: session.id,
      userMessageId: userMessage.id,
      userContent: request.message,
      routerResult
    });
    saveMemoryWriteEvent({
      projectId: session.projectId,
      sessionId: session.id,
      memories: capturedMemories
    });
    const recalledMemories = listRelevantMemories({
      projectId: session.projectId,
      query: [
        request.message,
        routerResult.rewritten_input,
        routerResult.keywords.join(" "),
        routerResult.task_goal
      ].join(" "),
      limit: 6
    });
    saveMemoryRecallEvent({
      projectId: session.projectId,
      sessionId: session.id,
      memories: recalledMemories
    });

    const toolSelection = selectToolsForRouter(routerResult);
    saveToolSelectionEvent({
      projectId: session.projectId,
      sessionId: session.id,
      result: toolSelection
    });

    const shouldPlan = shouldRunPlanning(routerResult);
    const planningResult = shouldPlan
      ? await runPlanningStage({
          messages,
          latestUserMessage: request.message,
          routerResult,
          toolSelection,
          conversationSummary,
          memories: recalledMemories,
          projectId: session.projectId,
          sessionId: session.id,
          setCurrentStage: (stage) => {
            currentStage = stage;
          },
          onEvent
        })
      : undefined;
    const planningContext = planningResult
      ? planningResult
      : {
          skipped: true,
          reason: formatPlanningSkipReason(routerResult)
        };

    const runtimeContext = JSON.stringify(
      {
        router: routerResult,
        planning: planningContext,
        tool_selection: toolSelection
      },
      null,
      2
    );

    currentStage = "大模型执行";
    onEvent({
      type: "stage",
      label: currentStage,
      detail: planningResult
        ? `Planning: ${planningResult.goal || routerResult.intent} / tools ${planningResult.required_tools.join(", ") || toolSelection.selected_tools.join(", ") || "none"}`
        : `Router: ${routerResult.workflow_decision.workflow_route} / 跳过 Planning`
    });

    onEvent({
      type: "start",
      sessionId: session.id,
      messageId: assistantMessageId,
      roleLabel: "MiMo"
    });

    const modelResponse = await streamMimoChat({
      messages,
      latestUserMessage: request.message,
      routerContext: runtimeContext,
      conversationSummary,
      memories: recalledMemories,
      toolSelection,
      executeToolRequest: async (toolRequest) => {
        onEvent({
          type: "stage",
          label: "原生工具执行",
          detail: `正在执行 ${toolRequest.type}`
        });
        saveToolCallEvent({
          projectId: session.projectId,
          sessionId: session.id,
          request: toolRequest
        });
        const result = await runLocalToolThroughGateway({
          request: toolRequest,
          toolSelection,
          projectId: session.projectId,
          sessionId: session.id
        });
        saveToolResultEvent({
          projectId: session.projectId,
          sessionId: session.id,
          result
        });

        return result;
      },
      onDelta: (delta) => {
        onEvent({
          type: "delta",
          sessionId: session.id,
          messageId: assistantMessageId,
          delta
        });
      }
    });
    saveModelReturnEvent({
      projectId: session.projectId,
      sessionId: session.id,
      stopReason: modelResponse.stopReason,
      usage: modelResponse.usage
    });
    const visibleModelContent = removeLocalToolRequestBlocks(modelResponse.content);
    const shouldReplaceVisibleContent = visibleModelContent !== modelResponse.content;

    if (shouldReplaceVisibleContent) {
      onEvent({
        type: "replace",
        sessionId: session.id,
        messageId: assistantMessageId,
        content: visibleModelContent
      });
    }

    const toolResults = await runRequestedTools({
      content: modelResponse.content,
      projectId: session.projectId,
      sessionId: session.id,
      toolSelection,
      onEvent,
      assistantMessageId
    });
    const followupResponse = toolResults.length > 0
      ? await streamToolResultFollowup({
          baseMessages: messages,
          assistantMessageId,
          firstAssistantContent: visibleModelContent,
          projectId: session.projectId,
          sessionId: session.id,
          runtimeContext,
          toolResults,
          onEvent
        })
      : undefined;
    const followupContent = followupResponse ? `\n\n【工具结果整理】\n${followupResponse.content}` : "";

    const contentBeforeEvaluation = `${visibleModelContent}${followupContent}`;
    const evaluationResult = await maybeEvaluateAndRevise({
      messages,
      userInput: request.message,
      routerResult,
      assistantMessageId,
      projectId: session.projectId,
      sessionId: session.id,
      content: contentBeforeEvaluation,
      runtimeContext,
      onEvent
    });

    const content = appendModelReturnNotice(
      evaluationResult.content,
      followupResponse?.stopReason ?? modelResponse.stopReason
    );
    const result = appendAssistantMessage(
      session,
      messages,
      assistantMessageId,
      "MiMo",
      content,
      buildAssistantMetadata(modelResponse)
    );
    saveChatMessageEvent({
      projectId: session.projectId,
      sessionId: session.id,
      message: result.assistantMessage
    });

    onEvent({
      type: "done",
      session: result.session,
      assistantMessage: result.assistantMessage
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    saveErrorEvent({
      projectId: session.projectId,
      sessionId: session.id,
      message,
      stage: currentStage
    });
    onEvent({
      type: "error",
      error: message
    });
  }
}

function buildAssistantMetadata(modelResponse: {
  readonly nativeMessages?: readonly unknown[];
  readonly nativeToolResults?: readonly ToolResult[];
}): Record<string, unknown> | undefined {
  if (!modelResponse.nativeMessages || modelResponse.nativeMessages.length === 0) {
    return undefined;
  }

  return {
    openaiNativeMessages: modelResponse.nativeMessages,
    nativeToolResults: modelResponse.nativeToolResults ?? []
  };
}

function shouldRunPlanning(routerResult: RouterResult): boolean {
  if (routerResult.workflow_decision.workflow_route === "planning") {
    return true;
  }

  if (routerResult.workflow_decision.workflow_route === "ask_user" || routerResult.workflow_decision.workflow_route === "reject") {
    return false;
  }

  return routerResult.workflow_decision.planning_required;
}

function formatPlanningSkipReason(routerResult: RouterResult): string {
  if (routerResult.workflow_decision.workflow_route === "answer_only") {
    return "Router 判断本轮可直接回答，不需要进入 Planning。";
  }

  if (routerResult.workflow_decision.workflow_route === "ask_user") {
    return "Router 判断本轮需要先追问用户，跳过 Planning。";
  }

  if (routerResult.workflow_decision.workflow_route === "reject") {
    return "Router 判断本轮存在高风险或不可执行请求，跳过 Planning。";
  }

  return "Router 未要求 Planning。";
}

async function runPlanningStage(input: {
  readonly messages: readonly ChatMessage[];
  readonly latestUserMessage: string;
  readonly routerResult: RouterResult;
  readonly toolSelection: ReturnType<typeof selectToolsForRouter>;
  readonly conversationSummary: Awaited<ReturnType<typeof maybeCompressConversation>>;
  readonly memories: ReturnType<typeof listRelevantMemories>;
  readonly projectId: string;
  readonly sessionId: string;
  readonly setCurrentStage: (stage: string) => void;
  readonly onEvent: ChatStreamHandler;
}) {
  const plannerConfig = getModelRuntimeConfig("planner");
  input.setCurrentStage("规划目标");
  input.onEvent({
    type: "stage",
    label: "规划目标",
    detail: `正在调用 ${plannerConfig.label} (${plannerConfig.model})`
  });

  const planningResult = await createExecutionPlan({
    messages: input.messages,
    latestUserMessage: input.latestUserMessage,
    routerResult: input.routerResult,
    toolSelection: input.toolSelection,
    conversationSummary: input.conversationSummary,
    memories: input.memories
  });
  savePlanningResultEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    result: planningResult
  });

  return planningResult;
}

async function maybeEvaluateAndRevise(input: {
  readonly messages: readonly ChatMessage[];
  readonly userInput: string;
  readonly routerResult: RouterResult;
  readonly assistantMessageId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly content: string;
  readonly runtimeContext: string;
  readonly onEvent: ChatStreamHandler;
}): Promise<{ readonly content: string; readonly evaluation?: OutputEvaluationResult }> {
  if (!shouldEvaluateOutput(input.routerResult)) {
    return {
      content: input.content
    };
  }

  input.onEvent({
    type: "stage",
    label: "输出验收",
    detail: "正在检查大模型回复是否满足本轮成功条件"
  });

  let evaluation: OutputEvaluationResult;
  try {
    evaluation = await evaluateOutput({
      messages: input.messages,
      userInput: input.userInput,
      routerResult: input.routerResult,
      assistantAnswer: input.content
    });
    saveOutputEvaluationEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      result: evaluation
    });
    const promptIteration = maybeCreatePromptIteration({
      projectId: input.projectId,
      sessionId: input.sessionId,
      evaluation,
      routerResult: input.routerResult
    });
    if (promptIteration) {
      savePromptIterationEvent({
        projectId: input.projectId,
        sessionId: input.sessionId,
        record: promptIteration
      });
    }
  } catch (error) {
    saveErrorEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      message: error instanceof Error ? error.message : String(error),
      stage: "输出验收"
    });

    return {
      content: input.content
    };
  }

  if (evaluation.passed || evaluation.next_action === "final") {
    return {
      content: input.content,
      evaluation
    };
  }

  if (evaluation.next_action !== "revise_answer") {
    return {
      content: [
        input.content.trimEnd(),
        "",
        formatEvaluationNotice(evaluation)
      ].join("\n"),
      evaluation
    };
  }

  const revision = await streamEvaluationRevision({
    baseMessages: input.messages,
    assistantMessageId: input.assistantMessageId,
    firstAssistantContent: input.content,
    userInput: input.userInput,
    projectId: input.projectId,
    sessionId: input.sessionId,
    runtimeContext: input.runtimeContext,
    evaluation,
    onEvent: input.onEvent
  });

  return {
    content: `${input.content}\n\n【补充修正】\n${revision.content}`,
    evaluation
  };
}

function maybeCreatePromptIteration(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly evaluation: OutputEvaluationResult;
  readonly routerResult: RouterResult;
}) {
  if (input.evaluation.passed || input.evaluation.next_action === "final") {
    return undefined;
  }

  const targetTemplate = input.evaluation.next_action === "use_tools" ? "main.agent.v1" : "output.evaluator.v1";
  const reason = [
    `Evaluator next_action=${input.evaluation.next_action}`,
    input.evaluation.decision_reason,
    input.evaluation.missing_criteria.length > 0 ? `missing=${input.evaluation.missing_criteria.join("；")}` : "",
    input.evaluation.issues.length > 0 ? `issues=${input.evaluation.issues.join("；")}` : ""
  ]
    .filter((item) => item.trim().length > 0)
    .join("；");
  const suggestedChange = [
    `建议检查模板 ${targetTemplate}。`,
    `任务类型：${input.routerResult.task_type}，意图：${input.routerResult.intent}。`,
    input.routerResult.expected_output ? `期望产出：${input.routerResult.expected_output}。` : "",
    input.evaluation.revision_instruction ? `修正指令：${input.evaluation.revision_instruction}` : "",
    input.evaluation.missing_criteria.length > 0 ? `需要补强的验收项：${input.evaluation.missing_criteria.join("；")}` : ""
  ]
    .filter((item) => item.trim().length > 0)
    .join("\n");

  return savePromptIteration({
    projectId: input.projectId,
    sessionId: input.sessionId,
    targetTemplate,
    trigger: "evaluation_gap",
    reason: reason || "输出验收认为当前回复仍需后续动作。",
    suggestedChange,
    sourceEventIds: []
  });
}

function shouldEvaluateOutput(routerResult: RouterResult): boolean {
  if (!routerResult.is_task || routerResult.intent === "chat") {
    return false;
  }

  return routerResult.verification_question.trim().length > 0 || routerResult.success_criteria.length > 0;
}

function formatEvaluationNotice(evaluation: OutputEvaluationResult): string {
  if (evaluation.next_action === "ask_user") {
    return [
      "[系统提示：本轮输出验收认为还需要用户补充信息。]",
      evaluation.revision_instruction || evaluation.issues.join("；")
    ]
      .filter((item) => item.trim().length > 0)
      .join("\n");
  }

  if (evaluation.next_action === "use_tools") {
    return [
      "[系统提示：本轮输出验收认为还需要工具或项目上下文才能继续。]",
      evaluation.revision_instruction || evaluation.issues.join("；")
    ]
      .filter((item) => item.trim().length > 0)
      .join("\n");
  }

  return "";
}

function appendModelReturnNotice(content: string, stopReason?: string): string {
  if (stopReason !== "max_tokens") {
    return content;
  }

  return [
    content.trimEnd(),
    "",
    "[系统提示：本次回复达到 max_tokens 输出上限，内容可能被截断。可以输入“继续”让我接着补完。]"
  ].join("\n");
}

async function streamToolResultFollowup(input: {
  readonly baseMessages: readonly ChatMessage[];
  readonly assistantMessageId: string;
  readonly firstAssistantContent: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly runtimeContext: string;
  readonly toolResults: readonly ToolResult[];
  readonly onEvent: ChatStreamHandler;
}): Promise<{ readonly content: string; readonly stopReason?: string; readonly usage?: unknown }> {
  const toolReport = formatToolResults(input.toolResults);
  const followupMessages: readonly ChatMessage[] = [
    ...input.baseMessages,
    {
      id: `msg-tool-request-${Date.now()}`,
      sender: "assistant",
      roleLabel: "MiMo",
      content: input.firstAssistantContent,
      createdAt: new Date().toISOString()
    },
    {
      id: `msg-tool-result-${Date.now()}`,
      sender: "user",
      roleLabel: "系统工具结果",
      content: [
        "以下是本轮工具执行结果。这不是用户的新输入，而是本地 Tool Gateway 返回的观察结果。",
        "",
        "请基于这些结果给用户一个简洁的最终回应。",
        "不要继续请求工具，不要重复前面的工具 JSON。",
        "",
        toolReport
      ].join("\n"),
      createdAt: new Date().toISOString()
    }
  ];

  input.onEvent({
    type: "stage",
    label: "工具结果整理",
    detail: "正在让 MiMo 基于工具结果生成最终回应"
  });
  input.onEvent({
    type: "delta",
    sessionId: input.sessionId,
    messageId: input.assistantMessageId,
    delta: "\n\n【工具结果整理】\n"
  });

  const response = await streamMimoChat({
    messages: followupMessages,
    latestUserMessage: "系统工具结果",
    routerContext: JSON.stringify(
      {
        phase: "tool_result_followup",
        previous_runtime_context: JSON.parse(input.runtimeContext),
        tool_results: input.toolResults
      },
      null,
      2
    ),
    onDelta: (delta) => {
      input.onEvent({
        type: "delta",
        sessionId: input.sessionId,
        messageId: input.assistantMessageId,
        delta
      });
    }
  });

  saveModelReturnEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    stopReason: response.stopReason,
    usage: response.usage
  });

  return response;
}

async function streamEvaluationRevision(input: {
  readonly baseMessages: readonly ChatMessage[];
  readonly assistantMessageId: string;
  readonly firstAssistantContent: string;
  readonly userInput: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly runtimeContext: string;
  readonly evaluation: OutputEvaluationResult;
  readonly onEvent: ChatStreamHandler;
}): Promise<{ readonly content: string; readonly stopReason?: string; readonly usage?: unknown }> {
  const revisionMessages: readonly ChatMessage[] = [
    ...input.baseMessages,
    {
      id: `msg-eval-answer-${Date.now()}`,
      sender: "assistant",
      roleLabel: "MiMo",
      content: input.firstAssistantContent,
      createdAt: new Date().toISOString()
    },
    {
      id: `msg-eval-result-${Date.now()}`,
      sender: "user",
      roleLabel: "系统输出验收",
      content: [
        "以下是本轮输出验收结果。这不是用户的新输入，而是系统 evaluator 对上一条助手回复的检查结果。",
        "",
        "请只补充或修正缺失部分，不要重复已有内容，不要请求工具。",
        "",
        JSON.stringify(input.evaluation, null, 2)
      ].join("\n"),
      createdAt: new Date().toISOString()
    }
  ];

  input.onEvent({
    type: "stage",
    label: "补充修正",
    detail: "输出验收未通过，正在让大模型补充缺失内容"
  });
  input.onEvent({
    type: "delta",
    sessionId: input.sessionId,
    messageId: input.assistantMessageId,
    delta: "\n\n【补充修正】\n"
  });

  const response = await streamMimoChat({
    messages: revisionMessages,
    latestUserMessage: "系统输出验收",
    routerContext: JSON.stringify(
      {
        phase: "output_evaluation_revision",
        previous_runtime_context: input.runtimeContext,
        original_user_input: input.userInput,
        output_evaluation: input.evaluation
      },
      null,
      2
    ),
    onDelta: (delta) => {
      input.onEvent({
        type: "delta",
        sessionId: input.sessionId,
        messageId: input.assistantMessageId,
        delta
      });
    }
  });

  saveModelReturnEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    stopReason: response.stopReason,
    usage: response.usage
  });

  return response;
}

async function runRequestedTools(input: {
  readonly content: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly toolSelection: Parameters<typeof runLocalToolThroughGateway>[0]["toolSelection"];
  readonly onEvent: ChatStreamHandler;
  readonly assistantMessageId: string;
}): Promise<readonly ToolResult[]> {
  const requests = parseLocalToolRequests(input.content);
  const results: ToolResult[] = [];

  if (requests.length === 0) {
    return results;
  }

  input.onEvent({
    type: "stage",
    label: "工具执行",
    detail: `检测到 ${requests.length} 个本地工具请求，正在交给 Tool Gateway`
  });

  for (const request of requests) {
    saveToolCallEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      request
    });

    const result = await runLocalToolThroughGateway({
      request,
      toolSelection: input.toolSelection,
      projectId: input.projectId,
      sessionId: input.sessionId
    });

    saveToolResultEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      result
    });
    results.push(result);
  }

  return results;
}

function formatToolResults(results: readonly ToolResult[]): string {
  if (results.length === 0) {
    return "";
  }

  return [
    "",
    "",
    "【系统工具执行结果】",
    ...results.map((result, index) => {
      return [
        "",
        `#${index + 1} ${formatToolTitle(result)}`,
        `decision: ${result.decision}`,
        `status: ${result.status}`,
        `reason: ${result.reason}`,
        typeof result.exitCode === "number" ? `exitCode: ${result.exitCode}` : "",
        result.output ? `output:\n${result.output}` : "",
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : "",
        result.data ? `data:\n${JSON.stringify(result.data, null, 2)}` : ""
      ]
        .filter((line) => line.length > 0)
        .join("\n");
    })
  ].join("\n");
}

function formatToolTitle(result: ToolResult): string {
  if (result.request.type === "command.run") {
    return `command.run ${result.request.command}`;
  }

  if (result.request.type === "file.read" || result.request.type === "file.list" || result.request.type === "file.write") {
    return `${result.request.type} ${result.request.path}`;
  }

  if (result.request.type === "file.search") {
    return `${result.request.type} ${result.request.query}`;
  }

  return `${result.request.type} ${result.request.content.slice(0, 60)}`;
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
