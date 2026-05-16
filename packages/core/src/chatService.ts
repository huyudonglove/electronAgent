import type { ChatMessage, ChatRequest, ChatResponse, ChatStreamEvent, CommandRunResult, ModelProfile } from "@xiaomi/shared";
import { appendAssistantMessage, getOrCreateSession } from "./chatSessions";
import { runCommandThroughGateway } from "./commandGateway";
import { maybeCompressConversation } from "./conversationCompressor";
import {
  saveChatMessageEvent,
  saveErrorEvent,
  saveModelReturnEvent,
  saveRouterResultEvent,
  saveToolCallEvent,
  saveToolResultEvent,
  saveToolSelectionEvent
} from "./events";
import { getModelRuntimeConfig } from "./modelRuntimeConfig";
import { MIMO_MODEL } from "./modelConfig";
import { streamMimoChat } from "./providers/mimoProvider";
import { recognizeIntent } from "./providers/ollamaIntentProvider";
import { parseCommandRunRequests, removeCommandRunRequestBlocks } from "./toolCallParser";
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

    currentStage = "意图识别";
    onEvent({
      type: "stage",
      label: currentStage,
      detail: `正在调用 ${routerConfig.label} (${routerConfig.model})`
    });

    const routerResult = await recognizeIntent(messages, request.message);
    saveRouterResultEvent({
      projectId: session.projectId,
      sessionId: session.id,
      content: JSON.stringify(routerResult, null, 2)
    });

    const toolSelection = selectToolsForRouter(routerResult);
    saveToolSelectionEvent({
      projectId: session.projectId,
      sessionId: session.id,
      result: toolSelection
    });

    const runtimeContext = JSON.stringify(
      {
        router: routerResult,
        tool_selection: toolSelection
      },
      null,
      2
    );

    currentStage = "大模型对话";
    onEvent({
      type: "stage",
      label: currentStage,
      detail: `Router: ${routerResult.intent} / ${routerResult.task_type} / tools ${toolSelection.selected_tools.join(", ") || "none"}`
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
      intentSummary: runtimeContext,
      conversationSummary,
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
    const visibleModelContent = removeCommandRunRequestBlocks(modelResponse.content);
    const shouldReplaceVisibleContent = visibleModelContent !== modelResponse.content;

    if (shouldReplaceVisibleContent) {
      onEvent({
        type: "replace",
        sessionId: session.id,
        messageId: assistantMessageId,
        content: visibleModelContent
      });
    }

    const toolResults = await runRequestedCommands({
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

    const content = appendModelReturnNotice(
      `${visibleModelContent}${followupContent}`,
      followupResponse?.stopReason ?? modelResponse.stopReason
    );
    const result = appendAssistantMessage(session, messages, assistantMessageId, "MiMo", content);
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
  readonly toolResults: readonly CommandRunResult[];
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
        "以下是本轮工具执行结果。这不是用户的新输入，而是本地 Command Gateway 返回的观察结果。",
        "",
        "请基于这些结果给用户一个简洁的最终回应。",
        "不要继续请求工具，不要重复前面的 command.run JSON。",
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
    intentSummary: JSON.stringify(
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

async function runRequestedCommands(input: {
  readonly content: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly toolSelection: Parameters<typeof runCommandThroughGateway>[0]["toolSelection"];
  readonly onEvent: ChatStreamHandler;
  readonly assistantMessageId: string;
}): Promise<readonly CommandRunResult[]> {
  const requests = parseCommandRunRequests(input.content);
  const results: CommandRunResult[] = [];

  if (requests.length === 0) {
    return results;
  }

  input.onEvent({
    type: "stage",
    label: "工具执行",
    detail: `检测到 ${requests.length} 个 command.run 请求，正在交给 Command Gateway`
  });

  for (const request of requests) {
    saveToolCallEvent({
      projectId: input.projectId,
      sessionId: input.sessionId,
      request
    });

    const result = await runCommandThroughGateway({
      request,
      toolSelection: input.toolSelection
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

function formatToolResults(results: readonly CommandRunResult[]): string {
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
        `#${index + 1} ${result.request.command}`,
        `decision: ${result.decision}`,
        `status: ${result.status}`,
        `reason: ${result.reason}`,
        typeof result.exitCode === "number" ? `exitCode: ${result.exitCode}` : "",
        result.stdout ? `stdout:\n${result.stdout}` : "",
        result.stderr ? `stderr:\n${result.stderr}` : ""
      ]
        .filter((line) => line.length > 0)
        .join("\n");
    })
  ].join("\n");
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
