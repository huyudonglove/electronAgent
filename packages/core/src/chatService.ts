import { existsSync } from "node:fs";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  EnvironmentFingerprint,
  ModelProfile,
  OutputEvaluationResult,
  RouterResult,
  ToolResult
} from "@xiaomi/shared";
import { appendAssistantMessage, getOrCreateSession } from "./chatSessions";
import { maybeCompressConversation } from "./conversationCompressor";
import { ensureEnvironmentFingerprint, formatEnvironmentFingerprintForPrompt } from "./environmentProfile";
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
import { writeRuntimeLog } from "./runtimeLogs";
import { parseLocalToolRequests, removeLocalToolRequestBlocks } from "./toolCallParser";
import { selectToolsForRouter } from "./toolSelectionPolicy";

export type ChatStreamHandler = (event: ChatStreamEvent) => void;

const MAX_AUTO_EVALUATION_ATTEMPTS = 5;

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
  const turnId = `turn-${Date.now()}`;
  let currentStage = "环境指纹";

  try {
    writeRuntimeLog({
      projectId: session.projectId,
      sessionId: session.id,
      turnId,
      stage: "session",
      level: "info",
      message: "开始处理新一轮对话",
      payload: {
        modelProfileId: request.modelProfileId,
        userInput: request.message
      }
    });
    onEvent({
      type: "stage",
      label: "环境指纹",
      detail: "正在确认共享环境指纹"
    });
    const environmentFingerprint = ensureEnvironmentFingerprint();
    const environmentPrompt = formatEnvironmentFingerprintForPrompt(environmentFingerprint);
    writeRuntimeLog({
      projectId: session.projectId,
      sessionId: session.id,
      turnId,
      stage: "environment",
      level: "info",
      message: "环境指纹已确认",
      payload: {
        summary: environmentFingerprint.summary,
        fingerprintHash: environmentFingerprint.fingerprintHash
      }
    });

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

    const routerResult = await analyzeRoute(messages, request.message, environmentPrompt);
    writeRuntimeLog({
      projectId: session.projectId,
      sessionId: session.id,
      turnId,
      stage: "router",
      level: "info",
      message: "Router 分析完成",
      payload: routerResult
    });
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
    writeRuntimeLog({
      projectId: session.projectId,
      sessionId: session.id,
      turnId,
      stage: "memory",
      level: "debug",
      message: "记忆写入与召回完成",
      payload: {
        capturedCount: capturedMemories.length,
        recalledCount: recalledMemories.length
      }
    });

    const toolSelection = selectToolsForRouter(routerResult);
    writeRuntimeLog({
      projectId: session.projectId,
      sessionId: session.id,
      turnId,
      stage: "tool_selection",
      level: "info",
      message: "工具策略已确定",
      payload: toolSelection
    });
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
          environmentFingerprint,
          projectId: session.projectId,
          sessionId: session.id,
          setCurrentStage: (stage) => {
            currentStage = stage;
          },
          onEvent
        })
      : undefined;
    if (planningResult) {
      writeRuntimeLog({
        projectId: session.projectId,
        sessionId: session.id,
        turnId,
        stage: "planning",
        level: "info",
        message: "Planning 阶段完成",
        payload: planningResult
      });
    }
    const planningContext = planningResult
      ? planningResult
      : {
          skipped: true,
          reason: formatPlanningSkipReason(routerResult)
        };

    const runtimeContext = JSON.stringify(
      {
        environment: environmentFingerprint,
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
      environmentFingerprint: environmentPrompt,
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
    writeRuntimeLog({
      projectId: session.projectId,
      sessionId: session.id,
      turnId,
      stage: "main",
      level: "info",
      message: "主模型完成首轮输出",
      payload: {
        stopReason: modelResponse.stopReason,
        usage: modelResponse.usage,
        contentPreview: modelResponse.content.slice(0, 600)
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

    const toolExecution = await executeToolRounds({
      baseMessages: messages,
      assistantMessageId,
      projectId: session.projectId,
      sessionId: session.id,
      turnId,
      runtimeContext,
      environmentFingerprint: environmentPrompt,
      toolSelection,
      initialRawContent: modelResponse.content,
      initialVisibleContent: visibleModelContent,
      onEvent
    });

    const contentBeforeEvaluation = toolExecution.content;
    const evaluationResult = await maybeEvaluateAndRevise({
      messages,
      userInput: request.message,
      routerResult,
      planningResult,
      assistantMessageId,
      projectId: session.projectId,
      sessionId: session.id,
      content: contentBeforeEvaluation,
      executedToolResults: toolExecution.toolResults,
      runtimeContext,
      environmentFingerprint: environmentPrompt,
      toolSelection,
      onEvent
    });
    if (evaluationResult.evaluation) {
      writeRuntimeLog({
        projectId: session.projectId,
        sessionId: session.id,
        turnId,
        stage: "evaluation",
        level: evaluationResult.evaluation.passed ? "info" : "warn",
        message: "输出验收完成",
        payload: evaluationResult.evaluation
      });
    }

    const content = appendModelReturnNotice(
      evaluationResult.content,
      toolExecution.stopReason ?? modelResponse.stopReason
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
    writeRuntimeLog({
      projectId: session.projectId,
      sessionId: session.id,
      turnId,
      stage: "session",
      level: "info",
      message: "本轮对话完成",
      payload: {
        assistantMessageId,
        finalContentPreview: content.slice(0, 600)
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeRuntimeLog({
      projectId: session.projectId,
      sessionId: session.id,
      turnId,
      stage: mapStageToRuntimeLogStage(currentStage),
      level: "error",
      message: "本轮对话失败",
      payload: {
        currentStage,
        error: message
      }
    });
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
  readonly environmentFingerprint: EnvironmentFingerprint;
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
    environmentFingerprint: formatEnvironmentFingerprintForPrompt(input.environmentFingerprint),
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
  readonly planningResult?: Awaited<ReturnType<typeof runPlanningStage>>;
  readonly assistantMessageId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly content: string;
  readonly executedToolResults: readonly ToolResult[];
  readonly runtimeContext: string;
  readonly environmentFingerprint: string;
  readonly toolSelection: Parameters<typeof runLocalToolThroughGateway>[0]["toolSelection"];
  readonly onEvent: ChatStreamHandler;
}): Promise<{ readonly content: string; readonly evaluation?: OutputEvaluationResult }> {
  if (!shouldEvaluateOutput(input.routerResult, input.planningResult)) {
    return {
      content: input.content
    };
  }

  input.onEvent({
    type: "stage",
    label: "输出验收",
    detail: "正在检查大模型回复是否满足本轮成功条件"
  });

  let currentContent = input.content;
  const turnToolResults: ToolResult[] = [...input.executedToolResults];
  let latestEvaluation: OutputEvaluationResult | undefined;

  for (let attempt = 1; attempt <= MAX_AUTO_EVALUATION_ATTEMPTS; attempt += 1) {
    let evaluation: OutputEvaluationResult;
    try {
      const rawEvaluation = await evaluateOutput({
        messages: input.messages,
        userInput: input.userInput,
        routerResult: input.routerResult,
        planningResult: input.planningResult,
        assistantAnswer: currentContent,
        evaluationAttempt: attempt
      });
      evaluation = enforcePlannedArtifactOutcome(
        normalizeEvaluationForAutomation(rawEvaluation),
        input.planningResult,
        turnToolResults
      );
      latestEvaluation = evaluation;
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
        content: currentContent
      };
    }

    if (evaluation.passed || evaluation.next_action === "final") {
      return {
        content: currentContent,
        evaluation
      };
    }

    const forceToolContinuation = shouldForceToolContinuation(evaluation, input.planningResult);
    const synthesizedArtifact = await maybeSynthesizeAndPersistPlannedArtifact({
      messages: input.messages,
      userInput: input.userInput,
      planningResult: input.planningResult,
      evaluation,
      assistantMessageId: input.assistantMessageId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      currentContent,
      runtimeContext: input.runtimeContext,
      environmentFingerprint: input.environmentFingerprint,
      turnToolResults,
      toolSelection: input.toolSelection,
      onEvent: input.onEvent
    });
    if (synthesizedArtifact) {
      if (synthesizedArtifact.writeResult) {
        turnToolResults.push(synthesizedArtifact.writeResult);
      }
      currentContent = synthesizedArtifact.content;
      input.onEvent({
        type: "replace",
        sessionId: input.sessionId,
        messageId: input.assistantMessageId,
        content: currentContent
      });
      continue;
    }

    if (evaluation.next_action === "ask_user") {
      return {
        content: [
          currentContent.trimEnd(),
          "",
          formatEvaluationNotice(evaluation)
        ].join("\n"),
        evaluation
      };
    }

    if (attempt >= MAX_AUTO_EVALUATION_ATTEMPTS) {
      return {
        content: [
          currentContent.trimEnd(),
          "",
          formatTaskIncompleteNotice(evaluation, input.planningResult, MAX_AUTO_EVALUATION_ATTEMPTS)
        ].join("\n"),
        evaluation
      };
    }

    if (evaluation.next_action === "use_tools" || forceToolContinuation) {
      const continuation = await streamEvaluationToolContinuation({
        baseMessages: input.messages,
        assistantMessageId: input.assistantMessageId,
        currentContent,
        userInput: input.userInput,
        projectId: input.projectId,
        sessionId: input.sessionId,
        runtimeContext: input.runtimeContext,
        environmentFingerprint: input.environmentFingerprint,
        evaluation: forceToolContinuation
          ? {
              ...evaluation,
              next_action: "use_tools",
              revision_instruction: evaluation.revision_instruction || "请继续读取剩余关键文件，完成分析，并使用 file.write 保存目标文档。"
            }
          : evaluation,
        onEvent: input.onEvent
      });
      const continuationVisibleContent = removeLocalToolRequestBlocks(continuation.content).trim();
      const continuationBaseContent = continuationVisibleContent.length > 0
        ? `${currentContent}\n\n【继续执行】\n${continuationVisibleContent}`
        : currentContent;
      const continuationExecution = await executeToolRounds({
        baseMessages: input.messages,
        assistantMessageId: input.assistantMessageId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        turnId: `evaluation-${Date.now()}`,
        runtimeContext: input.runtimeContext,
        environmentFingerprint: input.environmentFingerprint,
        toolSelection: input.toolSelection,
        initialRawContent: continuation.content,
        initialVisibleContent: continuationBaseContent,
        onEvent: input.onEvent,
      });
      turnToolResults.push(...continuationExecution.toolResults);
      currentContent = continuationExecution.content;
      input.onEvent({
        type: "replace",
        sessionId: input.sessionId,
        messageId: input.assistantMessageId,
        content: currentContent
      });
      continue;
    }

    const revision = await streamEvaluationRevision({
      baseMessages: input.messages,
      assistantMessageId: input.assistantMessageId,
      firstAssistantContent: currentContent,
      userInput: input.userInput,
      projectId: input.projectId,
      sessionId: input.sessionId,
      runtimeContext: input.runtimeContext,
      environmentFingerprint: input.environmentFingerprint,
      evaluation,
      onEvent: input.onEvent
    });

    currentContent = `${currentContent}\n\n【补充修正】\n${revision.content}`;
  }

  return {
    content: currentContent,
    evaluation: latestEvaluation
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

function shouldEvaluateOutput(
  routerResult: RouterResult,
  planningResult?: Awaited<ReturnType<typeof runPlanningStage>>
): boolean {
  if (!routerResult.is_task || routerResult.intent === "chat") {
    return false;
  }

  return routerResult.verification_question.trim().length > 0
    || routerResult.success_criteria.length > 0
    || Boolean(planningResult?.expected_result.trim());
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

function shouldForceToolContinuation(
  evaluation: OutputEvaluationResult,
  planningResult?: Awaited<ReturnType<typeof runPlanningStage>>
): boolean {
  if (!planningResult) {
    return false;
  }

  if (evaluation.next_action === "use_tools" || evaluation.next_action === "ask_user") {
    return false;
  }

  const signalText = [
    ...planningResult.files_to_modify,
    planningResult.expected_result,
    planningResult.execution_instruction,
    evaluation.revision_instruction,
    ...evaluation.missing_criteria,
    ...evaluation.issues
  ].join("\n");

  const mentionsWriteRequirement = /file\.write|保存|写入|本地文件|文档已生成|文件保存|落盘/i.test(signalText);
  return mentionsWriteRequirement;
}

function normalizeEvaluationForAutomation(evaluation: OutputEvaluationResult): OutputEvaluationResult {
  const filteredMissingCriteria = evaluation.missing_criteria.filter((item) => !isUserApprovalCriterion(item));
  const filteredIssues = evaluation.issues.filter((item) => !isUserApprovalCriterion(item));
  const removedApprovalOnlyBlocker = filteredMissingCriteria.length !== evaluation.missing_criteria.length
    || filteredIssues.length !== evaluation.issues.length;

  if (!removedApprovalOnlyBlocker) {
    return evaluation;
  }

  const nextAction = filteredMissingCriteria.length === 0 && evaluation.next_action === "ask_user"
    ? "final"
    : evaluation.next_action;
  const passed = filteredMissingCriteria.length === 0 && filteredIssues.length === 0 && nextAction === "final"
    ? true
    : evaluation.passed;
  const decisionReason = [
    evaluation.decision_reason,
    "系统已忽略“用户确认/无异议”这类后验认可条件，不再把它作为自动闭环的阻塞项。"
  ]
    .filter((item) => item.trim().length > 0)
    .join("；");

  return {
    ...evaluation,
    passed,
    next_action: nextAction,
    missing_criteria: filteredMissingCriteria,
    issues: filteredIssues,
    decision_reason: decisionReason
  };
}

function isUserApprovalCriterion(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  return /(用户|你).*(无异议|无疑义|确认|认可|接受|同意|满意|review|approve|approval)/i.test(normalized)
    || /(等待|需要).*(用户|你).*(确认|认可|同意|回复)/i.test(normalized);
}

async function maybeSynthesizeAndPersistPlannedArtifact(input: {
  readonly messages: readonly ChatMessage[];
  readonly userInput: string;
  readonly planningResult?: Awaited<ReturnType<typeof runPlanningStage>>;
  readonly evaluation: OutputEvaluationResult;
  readonly assistantMessageId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly currentContent: string;
  readonly runtimeContext: string;
  readonly environmentFingerprint: string;
  readonly turnToolResults: readonly ToolResult[];
  readonly toolSelection: Parameters<typeof runLocalToolThroughGateway>[0]["toolSelection"];
  readonly onEvent: ChatStreamHandler;
}): Promise<{ readonly content: string; readonly writeResult?: ToolResult } | undefined> {
  const targetPath = resolveArtifactTargetPath(input.planningResult, input.evaluation, input.userInput);
  if (!targetPath) {
    return undefined;
  }

  if (!shouldAutoSynthesizeArtifact(input.evaluation, input.planningResult)) {
    return undefined;
  }

  const synthesisEvidence = collectArtifactSynthesisEvidence({
    targetPath,
    planningResult: input.planningResult,
    toolResults: input.turnToolResults
  });
  if (!synthesisEvidence) {
    return undefined;
  }

  input.onEvent({
    type: "stage",
    label: "文档生成",
    detail: "正在基于已收集的信息直接生成最终 Markdown 文档"
  });
  input.onEvent({
    type: "delta",
    sessionId: input.sessionId,
    messageId: input.assistantMessageId,
    delta: "\n\n【文档生成】\n"
  });

  const synthesisResponse = await streamMimoChat({
    messages: [
      ...input.messages,
      {
        id: `msg-artifact-answer-${Date.now()}`,
        sender: "assistant",
        roleLabel: "MiMo",
        content: input.currentContent,
        createdAt: new Date().toISOString()
      },
      {
        id: `msg-artifact-request-${Date.now()}`,
        sender: "user",
        roleLabel: "系统产物生成",
        content: [
          "请只根据下面【已验证项目证据】生成最终 Markdown 交接文档正文。",
          "不要解释，不要道歉，不要输出 JSON，不要输出工具请求，不要声称“已保存”。",
          "只输出最终 Markdown 文档内容本身，第一行必须是 `# ` 开头的标题。",
          "如果某一项没有证据支撑，就省略该结论或明确写“未在已读取文件中确认”；不要用“待补充”“推测”“根据常见项目结构”等模板占位。",
          "禁止把当前 Agent 工作台自身的 Node.js、Electron、pnpm、操作系统、Shell 环境写进目标项目文档，除非这些信息明确出现在目标项目文件里。",
          "如果这是交接文档，优先包含这些章节：`## 项目概述`、`## 技术栈与结构`、`## 埋点说明`、`## 参数与配置`、`## 注意事项`；但不要为了凑模板编造内容。",
          "如果代码中未发现标准埋点，也要在文档中明确写出“未发现标准埋点”以及依据。",
          "不要输出“目标理解 / 处理步骤 / 本轮结果 / 下一步 / 我将继续”等过程性措辞。",
          `目标保存路径：${targetPath}`,
          "",
          "【已验证项目证据】",
          synthesisEvidence,
          "",
          JSON.stringify(input.evaluation, null, 2)
        ].join("\n"),
        createdAt: new Date().toISOString()
      }
    ],
    latestUserMessage: "系统产物生成",
    environmentFingerprint: "文档生成阶段：只允许引用目标项目文件中已经验证过的事实，禁止引用当前 Agent 工作台运行环境。",
    routerContext: JSON.stringify(
      {
        phase: "artifact_synthesis",
        original_user_input: input.userInput,
        planning: input.planningResult,
        output_evaluation: input.evaluation,
        target_path: targetPath,
        verified_evidence_count: input.turnToolResults.length
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
    stopReason: synthesisResponse.stopReason,
    usage: synthesisResponse.usage
  });

  const documentContent = sanitizeGeneratedDocument(removeLocalToolRequestBlocks(synthesisResponse.content));
  if (!looksLikeGeneratedDocument(documentContent)) {
    return undefined;
  }

  const writeRequest = {
    type: "file.write" as const,
    reason: "系统根据已完成的项目分析，直接落盘最终 Markdown 交接文档。",
    path: targetPath,
    content: documentContent
  };
  saveToolCallEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    request: writeRequest
  });
  const writeResult = await runLocalToolThroughGateway({
    request: writeRequest,
    toolSelection: input.toolSelection,
    projectId: input.projectId,
    sessionId: input.sessionId
  });
  saveToolResultEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    result: writeResult
  });

  if (writeResult.status !== "executed") {
    return {
      content: [
        input.currentContent.trimEnd(),
        "",
        "【文档生成】",
        documentContent,
        "",
        `【产物保存失败】${writeResult.reason}`
      ].join("\n")
    };
  }

  const data = writeResult.data && typeof writeResult.data === "object" && !Array.isArray(writeResult.data)
    ? writeResult.data as Record<string, unknown>
    : {};
  const existedBefore = data.existedBefore === true;
  input.onEvent({
    type: "artifact",
    sessionId: input.sessionId,
    messageId: input.assistantMessageId,
    action: existedBefore ? "updated" : "created",
    path: typeof data.path === "string" ? data.path : targetPath,
    bytes: typeof data.bytes === "number" ? data.bytes : undefined
  });
  writeRuntimeLog({
    projectId: input.projectId,
    sessionId: input.sessionId,
    turnId: `artifact-${Date.now()}`,
    stage: "tool_gateway",
    level: "info",
    message: "系统已直接落盘最终文档产物",
    payload: writeResult
  });

  return {
    content: [
      input.currentContent.trimEnd(),
      "",
      "【文档生成】",
      documentContent,
      "",
      `【产物保存】已保存到 \`${targetPath}\`。`
    ].join("\n"),
    writeResult
  };
}

function shouldAutoSynthesizeArtifact(
  evaluation: OutputEvaluationResult,
  planningResult?: Awaited<ReturnType<typeof runPlanningStage>>
): boolean {
  if (!planningResult) {
    return false;
  }

  if (evaluation.next_action === "ask_user") {
    return false;
  }

  const signalText = [
    planningResult.expected_result,
    planningResult.execution_instruction,
    evaluation.revision_instruction,
    ...evaluation.missing_criteria,
    ...evaluation.issues
  ].join("\n");

  const expectsDocument = /markdown|md|交接文档|文档|handover/i.test(signalText);
  const expectsSave = /保存|写入|file\.write|本地路径|落盘/i.test(signalText);
  const stillMissingArtifact = evaluation.missing_criteria.length > 0 || evaluation.next_action === "revise_answer";
  return expectsDocument && expectsSave && stillMissingArtifact;
}

function looksLikeGeneratedDocument(content: string): boolean {
  if (content.trim().length < 120) {
    return false;
  }

  const hasTitle = /^#\s+/m.test(content);
  const hasSections = [
    "## 项目概述",
    "## 技术栈与结构",
    "## 埋点说明",
    "## 参数与配置",
    "## 注意事项"
  ].filter((section) => content.includes(section)).length >= 3;
  const hasProcessMarkers = /目标理解|处理步骤|本轮结果|下一步|我将继续|开始执行/i.test(content);
  const hasTemplateFillers = /待补充|根据常见项目结构|推测技术|需根据实际|占位内容/i.test(content);
  return hasTitle && hasSections && !hasProcessMarkers && !hasTemplateFillers;
}

function collectArtifactSynthesisEvidence(input: {
  readonly targetPath: string;
  readonly planningResult?: Awaited<ReturnType<typeof runPlanningStage>>;
  readonly toolResults: readonly ToolResult[];
}): string | undefined {
  const normalizedTargetPath = input.targetPath.trim().toLowerCase();
  const projectFacts: string[] = [];
  let recursiveListCount = 0;
  let codeReadCount = 0;
  let searchCount = 0;

  for (const result of input.toolResults) {
    if (result.status !== "executed") {
      continue;
    }

    if (result.request.type === "file.list") {
      const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? result.data as Record<string, unknown>
        : {};
      if (data.truncated === false || result.request.recursive === true) {
        recursiveListCount += 1;
      }
      projectFacts.push([
        `- 目录扫描：${result.request.path}`,
        result.output ? indentEvidence(trimEvidence(result.output, 1200)) : ""
      ].filter((item) => item.length > 0).join("\n"));
      continue;
    }

    if (result.request.type === "file.search") {
      searchCount += 1;
      projectFacts.push([
        `- 代码搜索：${result.request.path ?? "(default path)"} / query=${result.request.query}`,
        result.output ? indentEvidence(trimEvidence(result.output, 1600)) : ""
      ].filter((item) => item.length > 0).join("\n"));
      continue;
    }

    if (result.request.type === "file.read") {
      const lowerPath = result.request.path.trim().toLowerCase();
      if (lowerPath === normalizedTargetPath || /\\readme\.md$/i.test(result.request.path)) {
        continue;
      }
      if (!/\.(?:js|ts|tsx|jsx|html|json|ya?ml|css|md)$/i.test(result.request.path)) {
        continue;
      }

      codeReadCount += 1;
      projectFacts.push([
        `- 文件读取：${result.request.path}`,
        result.output ? indentEvidence(trimEvidence(result.output, 2200)) : ""
      ].filter((item) => item.length > 0).join("\n"));
    }
  }

  const evidenceScore = recursiveListCount + codeReadCount + (searchCount * 2);
  const hasStrongEvidence = searchCount > 0 || codeReadCount >= 2;
  if (evidenceScore < 4 || !hasStrongEvidence || projectFacts.length === 0) {
    return undefined;
  }

  return [
    `证据摘要：recursive_lists=${recursiveListCount}, code_reads=${codeReadCount}, searches=${searchCount}`,
    ...projectFacts
  ].join("\n\n");
}

function trimEvidence(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function indentEvidence(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
}

function enforcePlannedArtifactOutcome(
  evaluation: OutputEvaluationResult,
  planningResult: Awaited<ReturnType<typeof runPlanningStage>> | undefined,
  turnToolResults: readonly ToolResult[]
): OutputEvaluationResult {
  const plannedPaths = collectArtifactTargetPaths(planningResult, evaluation)
    .filter((path) => path.trim().length > 0);
  if (plannedPaths.length === 0) {
    return evaluation;
  }

  const modifiedThisTurnPaths = new Set(
    turnToolResults
      .filter((result) => result.request.type === "file.write" && result.status === "executed")
      .map((result) => {
        const request = result.request;
        return request.type === "file.write" ? request.path.trim().toLowerCase() : "";
      })
      .filter((path) => path.length > 0)
  );
  const unmodifiedPaths = plannedPaths.filter((path) => !modifiedThisTurnPaths.has(path.trim().toLowerCase()));
  if (unmodifiedPaths.length > 0) {
    return mergeArtifactFailureIntoEvaluation(
      evaluation,
      unmodifiedPaths.map((path) => `目标文件本轮未真实写入：${path}`),
      `请在本轮对以下文件执行真实 file.write 写入，而不是只在回复中声称已完成：${unmodifiedPaths.join("；")}。`
    );
  }

  const missingPaths = plannedPaths.filter((path) => !existsSync(path));
  if (missingPaths.length === 0) {
    return evaluation;
  }

  return mergeArtifactFailureIntoEvaluation(
    evaluation,
    missingPaths.map((path) => `目标文件未落盘：${path}`),
    `请使用 file.write 将最终文档真实写入这些路径：${missingPaths.join("；")}。写入后再结束本轮。`
  );
}

function mergeArtifactFailureIntoEvaluation(
  evaluation: OutputEvaluationResult,
  missingItems: readonly string[],
  additionalInstruction: string
): OutputEvaluationResult {
  const mergedMissingCriteria = Array.from(new Set([
    ...evaluation.missing_criteria,
    ...missingItems
  ]));
  const mergedIssues = Array.from(new Set([
    ...evaluation.issues,
    ...missingItems
  ]));
  const revisionInstruction = [
    evaluation.revision_instruction,
    additionalInstruction
  ]
    .filter((item) => item.trim().length > 0)
    .join("\n");

  return {
    ...evaluation,
    passed: false,
    next_action: "use_tools",
    decision_reason: `${evaluation.decision_reason}；系统文件校验发现目标产物未按要求完成。`,
    missing_criteria: mergedMissingCriteria,
    issues: mergedIssues,
    revision_instruction: revisionInstruction,
    confidence: Math.min(evaluation.confidence, 0.4)
  };
}

function sanitizeGeneratedDocument(content: string): string {
  let normalized = content.trim();
  normalized = normalized.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();

  const processMarker = normalized.search(/(^|\n)(目标理解|处理步骤|本轮结果|下一步)[:：]/);
  if (processMarker > 0) {
    normalized = normalized.slice(0, processMarker).trim();
  }

  return normalized;
}

function collectArtifactTargetPaths(
  planningResult?: Awaited<ReturnType<typeof runPlanningStage>>,
  evaluation?: OutputEvaluationResult
): readonly string[] {
  const paths = new Set<string>();

  for (const path of planningResult?.files_to_modify ?? []) {
    const trimmed = path.trim();
    if (trimmed) {
      paths.add(trimmed);
    }
  }

  for (const text of [
    planningResult?.expected_result ?? "",
    planningResult?.execution_instruction ?? "",
    evaluation?.revision_instruction ?? "",
    ...(evaluation?.missing_criteria ?? []),
    ...(evaluation?.issues ?? [])
  ]) {
    for (const path of extractWindowsFilePaths(text)) {
      paths.add(path);
    }
  }

  return [...paths];
}

function resolveArtifactTargetPath(
  planningResult: Awaited<ReturnType<typeof runPlanningStage>> | undefined,
  evaluation: OutputEvaluationResult,
  userInput: string
): string | undefined {
  const explicitTargets = collectArtifactTargetPaths(planningResult, evaluation);
  if (explicitTargets.length > 0) {
    return explicitTargets[0];
  }

  const userMentionedTargets = extractWindowsFilePaths(userInput);
  if (userMentionedTargets.length > 0) {
    return userMentionedTargets[0];
  }

  return undefined;
}

function extractWindowsFilePaths(text: string): readonly string[] {
  if (!text.trim()) {
    return [];
  }

  const matches = text.match(/[A-Za-z]:\\[^\\\r\n:*?"<>|]+(?:\\[^\\\r\n:*?"<>|]+)*\.(?:md|markdown|txt)/gi) ?? [];
  return matches.map((item) => item.trim());
}

function formatTaskIncompleteNotice(
  evaluation: OutputEvaluationResult,
  planningResult: Awaited<ReturnType<typeof runPlanningStage>> | undefined,
  maxAttempts: number
): string {
  return [
    "[系统提示：本轮回复已结束，但任务尚未达成。]",
    planningResult?.expected_result ? `目标产物：${planningResult.expected_result}` : "",
    evaluation.missing_criteria.length > 0 ? `缺失项：${evaluation.missing_criteria.join("；")}` : "",
    evaluation.revision_instruction ? `建议下一步：${evaluation.revision_instruction}` : "",
    `停止原因：已达到最多 ${maxAttempts} 次自动补充/修正循环。`
  ]
    .filter((item) => item.trim().length > 0)
    .join("\n");
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
  readonly environmentFingerprint: string;
  readonly toolResults: readonly ToolResult[];
  readonly round?: number;
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
    detail: `正在让 MiMo 基于工具结果生成后续回应${input.round ? `（第 ${input.round} 轮）` : ""}`
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
    environmentFingerprint: input.environmentFingerprint,
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

async function executeToolRounds(input: {
  readonly baseMessages: readonly ChatMessage[];
  readonly assistantMessageId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly runtimeContext: string;
  readonly environmentFingerprint: string;
  readonly toolSelection: Parameters<typeof runLocalToolThroughGateway>[0]["toolSelection"];
  readonly initialRawContent: string;
  readonly initialVisibleContent: string;
  readonly onEvent: ChatStreamHandler;
}): Promise<{ readonly content: string; readonly stopReason?: string; readonly toolResults: readonly ToolResult[] }> {
  let currentRawContent = input.initialRawContent;
  let currentVisibleContent = input.initialVisibleContent;
  let lastStopReason: string | undefined;
  const allToolResults: ToolResult[] = [];

  for (let round = 1; round <= 5; round += 1) {
    const toolResults = await runRequestedTools({
      content: currentRawContent,
      projectId: input.projectId,
      sessionId: input.sessionId,
      toolSelection: input.toolSelection,
      onEvent: input.onEvent,
      assistantMessageId: input.assistantMessageId
    });

    if (toolResults.length === 0) {
      break;
    }
    allToolResults.push(...toolResults);

    writeRuntimeLog({
      projectId: input.projectId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      stage: "tool_gateway",
      level: "info",
      message: `工具执行完成（第 ${round} 轮）`,
      payload: toolResults
    });

    const followupResponse = await streamToolResultFollowup({
      baseMessages: input.baseMessages,
      assistantMessageId: input.assistantMessageId,
      firstAssistantContent: currentVisibleContent,
      projectId: input.projectId,
      sessionId: input.sessionId,
      runtimeContext: input.runtimeContext,
      environmentFingerprint: input.environmentFingerprint,
      toolResults,
      round,
      onEvent: input.onEvent
    });
    lastStopReason = followupResponse.stopReason;

    writeRuntimeLog({
      projectId: input.projectId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      stage: "tool_followup",
      level: "info",
      message: `工具结果整理完成（第 ${round} 轮）`,
      payload: {
        stopReason: followupResponse.stopReason,
        usage: followupResponse.usage,
        contentPreview: followupResponse.content.slice(0, 600)
      }
    });

    const visibleFollowupContent = removeLocalToolRequestBlocks(followupResponse.content).trim();
    if (visibleFollowupContent.length > 0) {
      currentVisibleContent = `${currentVisibleContent}\n\n【工具结果整理】\n${visibleFollowupContent}`;
    }
    currentRawContent = followupResponse.content;
  }

  const finalPendingToolResults = await runRequestedTools({
    content: currentRawContent,
    projectId: input.projectId,
    sessionId: input.sessionId,
    toolSelection: input.toolSelection,
    onEvent: input.onEvent,
    assistantMessageId: input.assistantMessageId
  });

  if (finalPendingToolResults.length > 0) {
    allToolResults.push(...finalPendingToolResults);
    writeRuntimeLog({
      projectId: input.projectId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      stage: "tool_gateway",
      level: "info",
      message: "最终待执行工具请求已刷新并执行",
      payload: finalPendingToolResults
    });
    currentVisibleContent = [
      currentVisibleContent,
      "",
      "【最终工具执行】",
      formatToolResults(finalPendingToolResults)
    ].join("\n");
  }

  return {
    content: currentVisibleContent,
    stopReason: lastStopReason,
    toolResults: allToolResults
  };
}

async function streamEvaluationRevision(input: {
  readonly baseMessages: readonly ChatMessage[];
  readonly assistantMessageId: string;
  readonly firstAssistantContent: string;
  readonly userInput: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly runtimeContext: string;
  readonly environmentFingerprint: string;
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
    environmentFingerprint: input.environmentFingerprint,
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

async function streamEvaluationToolContinuation(input: {
  readonly baseMessages: readonly ChatMessage[];
  readonly assistantMessageId: string;
  readonly currentContent: string;
  readonly userInput: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly runtimeContext: string;
  readonly environmentFingerprint: string;
  readonly evaluation: OutputEvaluationResult;
  readonly onEvent: ChatStreamHandler;
}): Promise<{ readonly content: string; readonly stopReason?: string; readonly usage?: unknown }> {
  const continuationMessages: readonly ChatMessage[] = [
    ...input.baseMessages,
    {
      id: `msg-eval-tools-answer-${Date.now()}`,
      sender: "assistant",
      roleLabel: "MiMo",
      content: input.currentContent,
      createdAt: new Date().toISOString()
    },
    {
      id: `msg-eval-tools-result-${Date.now()}`,
      sender: "user",
      roleLabel: "系统输出验收",
      content: [
        "以下是本轮输出验收结果。这不是用户的新输入，而是系统 evaluator 认为上一轮还缺少工具或项目上下文。",
        "",
        "请继续执行任务，允许继续请求工具，并优先补齐验收缺失项与目标产物。",
        "如果需要读取文件、列目录或写出最终文档，请直接继续发起对应工具请求。",
        "不要假装任务已完成；如果仍无法完成，请明确指出阻塞点。",
        "",
        JSON.stringify(input.evaluation, null, 2)
      ].join("\n"),
      createdAt: new Date().toISOString()
    }
  ];

  input.onEvent({
    type: "stage",
    label: "继续执行",
    detail: "输出验收要求继续使用工具，正在自动续跑本轮任务"
  });
  input.onEvent({
    type: "delta",
    sessionId: input.sessionId,
    messageId: input.assistantMessageId,
    delta: "\n\n【继续执行】\n"
  });

  const response = await streamMimoChat({
    messages: continuationMessages,
    latestUserMessage: "系统输出验收",
    environmentFingerprint: input.environmentFingerprint,
    routerContext: JSON.stringify(
      {
        phase: "output_evaluation_tool_continuation",
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
    if (request.type === "file.write" && result.status === "executed") {
      const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? result.data as Record<string, unknown>
        : {};
      const existedBefore = data.existedBefore === true;
      input.onEvent({
        type: "artifact",
        sessionId: input.sessionId,
        messageId: input.assistantMessageId,
        action: existedBefore ? "updated" : "created",
        path: typeof data.path === "string" ? data.path : request.path,
        bytes: typeof data.bytes === "number" ? data.bytes : undefined
      });
    }
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

function mapStageToRuntimeLogStage(stage: string) {
  if (stage.includes("环境")) {
    return "environment" as const;
  }
  if (stage.includes("压缩")) {
    return "compression" as const;
  }
  if (stage.includes("Router")) {
    return "router" as const;
  }
  if (stage.includes("规划")) {
    return "planning" as const;
  }
  if (stage.includes("工具结果")) {
    return "tool_followup" as const;
  }
  if (stage.includes("工具")) {
    return "tool_gateway" as const;
  }
  if (stage.includes("验收")) {
    return "evaluation" as const;
  }
  if (stage.includes("修正")) {
    return "revision" as const;
  }
  if (stage.includes("执行") || stage.includes("模型")) {
    return "main" as const;
  }
  return "system" as const;
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
