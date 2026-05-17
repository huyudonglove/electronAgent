import type { ChatMessage, MemoryType, ModelRuntimeConfig, ToolRequest, ToolResult, ToolSelectionResult } from "@xiaomi/shared";
import { addProviderDebugLog, createDebugLogBase } from "../providerDebugLogs";

interface OpenAiChoiceMessage {
  readonly content?: string;
  readonly reasoning_content?: string;
  readonly tool_calls?: readonly OpenAiToolCall[];
}

interface OpenAiChatResponse {
  readonly choices?: readonly {
    readonly message?: OpenAiChoiceMessage;
    readonly finish_reason?: string;
  }[];
  readonly usage?: unknown;
}

interface OpenAiToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

type OpenAiMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content?: string | null;
      readonly reasoning_content?: string;
      readonly tool_calls?: readonly OpenAiToolCall[];
    }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

type OpenAiAssistantMessage = Extract<OpenAiMessage, { readonly role: "assistant" }>;

export interface OpenAiStreamResponse {
  readonly content: string;
  readonly stopReason?: string;
  readonly usage?: unknown;
  readonly nativeMessages?: readonly OpenAiMessage[];
  readonly nativeToolResults?: readonly ToolResult[];
}

export async function createOpenAiJsonChat(input: {
  readonly config: ModelRuntimeConfig;
  readonly messages: readonly { readonly role: "system" | "user" | "assistant"; readonly content: string }[];
  readonly latestUserMessage?: string;
  readonly providerId: string;
}): Promise<string> {
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    messages: input.messages,
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    response_format: {
      type: "json_object"
    },
    stream: false
  };
  const endpoint = `${trimTrailingSlash(input.config.baseURL)}/chat/completions`;
  const debugLog = createDebugLogBase({
    providerId: input.providerId,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint,
      headers: buildDebugHeaders(input.config),
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(input.config),
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const message = `${response.status}: ${await response.text()}`;
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(`OpenAI-compatible 调用失败：${message}`);
  }

  const data = (await response.json()) as OpenAiChatResponse;
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content,
      stopReason: data.choices?.[0]?.finish_reason,
      usage: data.usage
    }
  });

  return content;
}

export async function streamOpenAiChat(input: {
  readonly config: ModelRuntimeConfig;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly runtimeContext: string;
  readonly latestUserMessage: string;
  readonly onDelta: (delta: string) => void;
}): Promise<OpenAiStreamResponse> {
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    messages: buildOpenAiMessages(input),
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    stream: true
  };
  const endpoint = `${trimTrailingSlash(input.config.baseURL)}/chat/completions`;
  const debugLog = createDebugLogBase({
    providerId: `${input.config.role}-${input.config.providerKind}`,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint,
      headers: buildDebugHeaders(input.config),
      body: requestBody,
      messageCount: requestBody.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(input.config),
    body: JSON.stringify(requestBody)
  });

  if (!response.ok || !response.body) {
    const message = `${response.status}: ${await response.text()}`;
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(`OpenAI-compatible 流式调用失败：${message}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let stopReason: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }

      const data = trimmed.slice("data:".length).trim();
      if (data === "[DONE]") {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as {
          readonly choices?: readonly {
            readonly delta?: { readonly content?: string };
            readonly finish_reason?: string;
          }[];
        };
        const choice = parsed.choices?.[0];
        const delta = choice?.delta?.content ?? "";
        if (delta) {
          content += delta;
          input.onDelta(delta);
        }
        if (choice?.finish_reason) {
          stopReason = choice.finish_reason;
        }
      } catch {
        // Ignore malformed SSE fragments; the provider debug log keeps raw request details.
      }
    }
  }

  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content,
      stopReason
    }
  });

  return {
    content,
    stopReason
  };
}

export async function streamOpenAiChatWithNativeTools(input: {
  readonly config: ModelRuntimeConfig;
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly runtimeContext: string;
  readonly latestUserMessage: string;
  readonly toolSelection: ToolSelectionResult;
  readonly executeToolRequest: (request: ToolRequest) => Promise<ToolResult>;
  readonly onDelta: (delta: string) => void;
}): Promise<OpenAiStreamResponse> {
  const baseMessages = buildOpenAiMessages(input);
  const tools = buildOpenAiTools(input.toolSelection.selected_tools);

  if (tools.length === 0) {
    return streamOpenAiChat(input);
  }

  const messages: OpenAiMessage[] = [...baseMessages];
  const nativeMessages: OpenAiMessage[] = [];
  const nativeToolResults: ToolResult[] = [];
  let content = "";
  let stopReason: string | undefined;
  let usage: unknown;
  let toolRequestCount = 0;

  for (let requestIndex = 0; requestIndex < 8; requestIndex += 1) {
    const response = await createOpenAiNativeToolChat({
      config: input.config,
      messages,
      tools,
      latestUserMessage: input.latestUserMessage,
      requestIndex
    });
    const assistantMessage = normalizeAssistantMessage(response.message);
    messages.push(assistantMessage);
    nativeMessages.push(assistantMessage);
    stopReason = response.stopReason;
    usage = response.usage;

    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      content = assistantMessage.content ?? "";
      if (content) {
        input.onDelta(content);
      }
      break;
    }

    for (const toolCall of assistantMessage.tool_calls) {
      if (toolRequestCount >= 8) {
        break;
      }

      toolRequestCount += 1;
      const request = toolRequestToLocalRequest(toolCall);
      const result = request
        ? await input.executeToolRequest(request)
        : unsupportedNativeToolResult(toolCall);
      const toolMessage: OpenAiMessage = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: formatNativeToolResult(result)
      };

      messages.push(toolMessage);
      nativeMessages.push(toolMessage);
      nativeToolResults.push(result);
    }

    if (toolRequestCount >= 8) {
      break;
    }
  }

  if (!content && toolRequestCount >= 8) {
    content = "[系统提示：本轮原生工具调用已达到 8 次上限，已停止继续请求工具。]";
    input.onDelta(content);
  }

  return {
    content,
    stopReason,
    usage,
    nativeMessages,
    nativeToolResults
  };
}

async function createOpenAiNativeToolChat(input: {
  readonly config: ModelRuntimeConfig;
  readonly messages: readonly OpenAiMessage[];
  readonly tools: readonly OpenAiToolDefinition[];
  readonly latestUserMessage: string;
  readonly requestIndex: number;
}): Promise<{
  readonly message?: OpenAiChoiceMessage;
  readonly stopReason?: string;
  readonly usage?: unknown;
}> {
  const startedAtMs = Date.now();
  const requestBody = {
    model: input.config.model,
    messages: input.messages,
    tools: input.tools,
    tool_choice: "auto",
    temperature: input.config.temperature,
    max_tokens: input.config.maxTokens,
    stream: false,
    ...(input.config.thinkingEnabled ? { thinking: { type: "enabled" } } : {})
  };
  const endpoint = `${trimTrailingSlash(input.config.baseURL)}/chat/completions`;
  const debugLog = createDebugLogBase({
    providerId: `${input.config.role}-${input.config.providerKind}-native-tools`,
    model: input.config.model,
    baseURL: input.config.baseURL,
    request: {
      method: "POST",
      endpoint,
      headers: buildDebugHeaders(input.config),
      body: requestBody,
      messageCount: input.messages.length,
      latestUserMessage: input.latestUserMessage
    }
  });
  const response = await fetch(endpoint, {
    method: "POST",
    headers: buildHeaders(input.config),
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const message = `${response.status}: ${await response.text()}`;
    addProviderDebugLog({
      ...debugLog,
      status: "failed",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: message
    });
    throw new Error(`OpenAI-compatible 原生工具调用失败：${message}`);
  }

  const data = (await response.json()) as OpenAiChatResponse;
  const choice = data.choices?.[0];
  const message = choice?.message;
  addProviderDebugLog({
    ...debugLog,
    status: "succeeded",
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAtMs,
    response: {
      content: JSON.stringify({
        reasoning_content: message?.reasoning_content,
        content: message?.content,
        tool_calls: message?.tool_calls
      }, null, 2),
      stopReason: choice?.finish_reason,
      usage: data.usage
    }
  });

  return {
    message,
    stopReason: choice?.finish_reason,
    usage: data.usage
  };
}

function buildOpenAiMessages(input: {
  readonly system: string;
  readonly messages: readonly ChatMessage[];
  readonly runtimeContext: string;
}): readonly OpenAiMessage[] {
  const conversationMessages = input.messages
    .filter((message) => message.sender === "user" || message.sender === "assistant")
    .flatMap((message): readonly OpenAiMessage[] => {
      if (message.sender === "assistant") {
        const nativeMessages = extractNativeOpenAiMessages(message);
        if (nativeMessages.length > 0) {
          return nativeMessages;
        }

        return [{
          role: "assistant",
          content: message.content
        }];
      }

      return [{
        role: "user",
        content: message.content
      }];
    });
  const latestUserMessage = conversationMessages.at(-1);
  const historyMessages = latestUserMessage ? conversationMessages.slice(0, -1) : conversationMessages;

  return [
    {
      role: "system",
      content: input.system
    },
    ...historyMessages,
    {
      role: "user",
      content: input.runtimeContext
    },
    ...(latestUserMessage ? [latestUserMessage] : [])
  ];
}

interface OpenAiToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  };
}

function buildOpenAiTools(selectedTools: readonly string[]): readonly OpenAiToolDefinition[] {
  const selected = new Set(selectedTools);
  const tools: OpenAiToolDefinition[] = [];

  if (selected.has("file.read")) {
    tools.push({
      type: "function",
      function: {
        name: "file_read",
        description: "Read a text file inside the current workspace.",
        parameters: objectSchema({
          reason: stringSchema("Why this file needs to be read."),
          path: stringSchema("Workspace-relative or absolute path inside the workspace."),
          maxBytes: numberSchema("Maximum number of bytes to read.")
        }, ["path"])
      }
    });
  }

  if (selected.has("file.list")) {
    tools.push({
      type: "function",
      function: {
        name: "file_list",
        description: "List files or directories inside the current workspace.",
        parameters: objectSchema({
          reason: stringSchema("Why this directory needs to be listed."),
          path: stringSchema("Workspace-relative or absolute directory path inside the workspace."),
          recursive: { type: "boolean", description: "Whether to list recursively." },
          maxEntries: numberSchema("Maximum number of entries to return.")
        }, ["path"])
      }
    });
  }

  if (selected.has("file.search")) {
    tools.push({
      type: "function",
      function: {
        name: "file_search",
        description: "Search text in files inside the current workspace.",
        parameters: objectSchema({
          reason: stringSchema("Why this search is needed."),
          path: stringSchema("Workspace-relative search root. Optional."),
          query: stringSchema("Text to search for."),
          glob: stringSchema("Optional simple file suffix or glob hint."),
          maxResults: numberSchema("Maximum number of results to return.")
        }, ["query"])
      }
    });
  }

  if (selected.has("file.write")) {
    tools.push({
      type: "function",
      function: {
        name: "file_write",
        description: "Write a text file inside the current workspace.",
        parameters: objectSchema({
          reason: stringSchema("Why this file needs to be written."),
          path: stringSchema("Workspace-relative or absolute path inside the workspace."),
          content: stringSchema("Full file content to write.")
        }, ["path", "content"])
      }
    });
  }

  if (selected.has("memory.save")) {
    tools.push({
      type: "function",
      function: {
        name: "memory_save",
        description: "Save a durable memory for future agent turns.",
        parameters: objectSchema({
          reason: stringSchema("Why this memory should be saved."),
          content: stringSchema("Memory content."),
          memoryType: {
            type: "string",
            enum: ["fact", "preference", "decision", "plan", "constraint"],
            description: "Memory category."
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Short tags."
          },
          importance: numberSchema("Importance between 0 and 1.")
        }, ["content"])
      }
    });
  }

  if (selected.has("command.run")) {
    tools.push({
      type: "function",
      function: {
        name: "command_run",
        description: "Run a PowerShell command in the current workspace when semantic tools are not enough.",
        parameters: objectSchema({
          reason: stringSchema("Why this command is needed."),
          cwd: stringSchema("Working directory inside the workspace."),
          command: stringSchema("PowerShell command to execute.")
        }, ["command"])
      }
    });
  }

  return tools;
}

function toolRequestToLocalRequest(toolCall: OpenAiToolCall): ToolRequest | undefined {
  const args = parseArguments(toolCall.function.arguments);
  const reason = typeof args.reason === "string" ? args.reason : "";

  if (toolCall.function.name === "file_read" && typeof args.path === "string") {
    return {
      type: "file.read",
      reason,
      path: args.path,
      maxBytes: typeof args.maxBytes === "number" ? args.maxBytes : undefined
    };
  }

  if (toolCall.function.name === "file_list" && typeof args.path === "string") {
    return {
      type: "file.list",
      reason,
      path: args.path,
      recursive: args.recursive === true,
      maxEntries: typeof args.maxEntries === "number" ? args.maxEntries : undefined
    };
  }

  if (toolCall.function.name === "file_search" && typeof args.query === "string") {
    return {
      type: "file.search",
      reason,
      path: typeof args.path === "string" ? args.path : undefined,
      query: args.query,
      glob: typeof args.glob === "string" ? args.glob : undefined,
      maxResults: typeof args.maxResults === "number" ? args.maxResults : undefined
    };
  }

  if (toolCall.function.name === "file_write" && typeof args.path === "string" && typeof args.content === "string") {
    return {
      type: "file.write",
      reason,
      path: args.path,
      content: args.content
    };
  }

  if (toolCall.function.name === "memory_save" && typeof args.content === "string") {
    return {
      type: "memory.save",
      reason,
      content: args.content,
      memoryType: toMemoryType(args.memoryType),
      tags: Array.isArray(args.tags) ? args.tags.filter((item): item is string => typeof item === "string") : undefined,
      importance: typeof args.importance === "number" ? args.importance : undefined
    };
  }

  if (toolCall.function.name === "command_run" && typeof args.command === "string") {
    return {
      type: "command.run",
      reason,
      shell: "powershell",
      cwd: typeof args.cwd === "string" ? args.cwd : "",
      command: args.command
    };
  }

  return undefined;
}

function normalizeAssistantMessage(message?: OpenAiChoiceMessage): OpenAiAssistantMessage {
  return {
    role: "assistant",
    content: message?.content ?? "",
    ...(message?.reasoning_content ? { reasoning_content: message.reasoning_content } : {}),
    ...(message?.tool_calls && message.tool_calls.length > 0 ? { tool_calls: message.tool_calls } : {})
  };
}

function unsupportedNativeToolResult(toolCall: OpenAiToolCall): ToolResult {
  return {
    request: {
      type: "memory.save",
      reason: "unsupported native tool call",
      content: `Unsupported tool call: ${toolCall.function.name}`
    },
    decision: "deny",
    status: "skipped",
    reason: `不支持的原生工具：${toolCall.function.name}`,
    stderr: toolCall.function.arguments
  };
}

function formatNativeToolResult(result: ToolResult): string {
  return JSON.stringify({
    type: result.request.type,
    decision: result.decision,
    status: result.status,
    reason: result.reason,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.output,
    data: result.data
  }, null, 2);
}

function extractNativeOpenAiMessages(message: ChatMessage): readonly OpenAiMessage[] {
  const value = message.metadata?.openaiNativeMessages;
  return Array.isArray(value) ? value.filter(isOpenAiMessage) : [];
}

function isOpenAiMessage(value: unknown): value is OpenAiMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const role = (value as { readonly role?: unknown }).role;
  return role === "assistant" || role === "tool" || role === "user" || role === "system";
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toMemoryType(value: unknown): MemoryType | undefined {
  const allowed: readonly MemoryType[] = ["fact", "preference", "decision", "plan", "constraint"];
  return typeof value === "string" && allowed.includes(value as MemoryType) ? value as MemoryType : undefined;
}

function objectSchema(properties: Record<string, unknown>, required: readonly string[]): Record<string, unknown> {
  return {
    type: "object",
    properties,
    required
  };
}

function stringSchema(description: string): Record<string, unknown> {
  return {
    type: "string",
    description
  };
}

function numberSchema(description: string): Record<string, unknown> {
  return {
    type: "number",
    description
  };
}

function buildHeaders(config: ModelRuntimeConfig): HeadersInit {
  return {
    "content-type": "application/json",
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey.trim()}` } : {})
  };
}

function buildDebugHeaders(config: ModelRuntimeConfig): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: config.apiKey ? "Bearer [redacted]" : ""
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
