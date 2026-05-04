import type { ChatMessage, ChatRequest, ModelProfile } from "@xiaomi/shared";
import Anthropic from "@anthropic-ai/sdk";
import { getMimoApiKey } from "./localSecrets";
import { addProviderDebugLog, createDebugLogBase } from "./providerDebugLogs";

export interface ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly chat: (request: ProviderChatRequest) => Promise<ProviderChatResponse>;
}

export interface ProviderChatRequest extends ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly modelProfile: ModelProfile;
}

export interface ProviderChatResponse {
  readonly content: string;
  readonly roleLabel: string;
}

export function listModelProfiles(): readonly ModelProfile[] {
  return [
    {
      id: "mimo-v2-5-pro",
      providerId: "mimo-anthropic",
      label: "MiMo v2.5 Pro",
      model: "mimo-v2.5-pro",
      status: getMimoApiKey() ? "configured" : "missing-config",
      capabilities: {
        chat: true,
        streamChat: false,
        structuredOutput: false,
        toolCalling: false
      }
    },
  {
    id: "openai-compatible-default",
    providerId: "openai-compatible",
    label: "OpenAI-compatible / 待配置",
    model: "configured-later",
    status: "missing-config",
    capabilities: {
      chat: true,
      streamChat: true,
      structuredOutput: true,
      toolCalling: true
    }
  },
  {
    id: "mock-project-role",
    providerId: "mock",
    label: "项目角色 / UI Mock",
    model: "mock-project-role",
    status: "mock",
    capabilities: {
      chat: true,
      streamChat: false,
      structuredOutput: false,
      toolCalling: false
    }
  },
  {
    id: "mock-developer-role",
    providerId: "mock",
    label: "开发角色 / UI Mock",
    model: "mock-developer-role",
    status: "mock",
    capabilities: {
      chat: true,
      streamChat: false,
      structuredOutput: false,
      toolCalling: false
    }
  }
  ];
}

export const mockProvider: ModelProvider = {
  id: "mock",
  name: "Mock Provider",
  async chat(request) {
    const latestUserMessage = findLatestUserMessage(request.messages);
    const workflowSummary = request.context?.workflow
      ? `当前画布包含 ${request.context.workflow.nodes.length} 个节点和 ${request.context.workflow.edges.length} 条连接。`
      : "当前没有可用工作流上下文。";
    const runSummary = request.context?.latestRun
      ? `最近一次运行状态为 ${request.context.latestRun.status}。`
      : "还没有运行记录。";

    return {
      roleLabel: request.modelProfile.id === "mock-developer-role" ? "开发角色" : "项目角色",
      content: [
        "已通过 Core ChatService 接收到你的消息。",
        "",
        `你的输入：${latestUserMessage}`,
        workflowSummary,
        runSummary,
        "",
        "真实模型 Provider 接入后，这里会基于项目记忆、画布和运行记录继续协作。"
      ].join("\n")
    };
  }
};

export const mimoAnthropicProvider: ModelProvider = {
  id: "mimo-anthropic",
  name: "MiMo Anthropic-compatible Provider",
  async chat(request) {
    const baseURL = "https://token-plan-cn.xiaomimimo.com/anthropic";
    const startedAtMs = Date.now();
    const anthropicMessages = toAnthropicMessages(request.messages);
    const requestBody: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: request.modelProfile.model,
      max_tokens: 1024,
      system:
        "你是一个资深的agent开发工程师，能够协助用户完成agent相关的开发任务。请基于用户输入和上下文信息，提供专业、准确的建议和解决方案。包括记忆模式，流程编排，代码开发等任务。请确保你的回答清晰、简洁，并且直接针对用户的问题进行解答。请显示输出自己的思考过程，以便用户理解你的建议是如何得出的。",
      messages: anthropicMessages,
      top_p: 0.95,
      stream: false,
      temperature: 1.0
    };
    const debugLog = createDebugLogBase({
      providerId: "mimo-anthropic",
      model: request.modelProfile.model,
      baseURL,
      request: {
        method: "POST",
        endpoint: `${baseURL}/v1/messages`,
        headers: {
          "content-type": "application/json",
          "x-api-key": "[redacted]",
          "anthropic-version": "sdk-managed"
        },
        body: requestBody,
        messageCount: request.messages.length,
        latestUserMessage: findLatestUserMessage(request.messages)
      }
    });
    const apiKey = getMimoApiKey();
    if (!apiKey) {
      addProviderDebugLog({
        ...debugLog,
        status: "failed",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        error: "未检测到 MiMo API Key。"
      });
      return {
        roleLabel: "系统",
        content:
          "未检测到 MiMo API Key。请复制 config/secrets.example.json 为 config/secrets.local.json，并填写 mimoApiKey；或配置环境变量 MIMO_API_KEY 后重新启动应用。"
      };
    }

    const client = new Anthropic({
      apiKey: apiKey.trim(),
      baseURL
    });
    const response = await client.messages
      .create(requestBody)
      .catch((error: unknown) => {
        const message = toProviderErrorMessage(error);
        addProviderDebugLog({
          ...debugLog,
          status: "failed",
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
          error: message
        });
        throw new Error(message);
      });
    const content = extractTextContent(response.content);

    addProviderDebugLog({
      ...debugLog,
      status: "succeeded",
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      response: {
        content
      }
    });

    return {
      roleLabel: "MiMo",
      content
    };
  }
};

function toProviderErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("401") || message.toLowerCase().includes("invalid api key")) {
    return "MiMo 服务返回 401：API Key 无效。请确认 config/secrets.local.json 中的 mimoApiKey 是小米 MiMo 平台生成的有效 Key，并且该 Key 有权限调用 mimo-v2.5-pro。";
  }

  return `MiMo 调用失败：${message}`;
}

function findLatestUserMessage(messages: readonly ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sender === "user") {
      return message.content;
    }
  }

  return "";
}

export function getModelProfile(modelProfileId: string): ModelProfile {
  const profiles = listModelProfiles();
  return profiles.find((profile) => profile.id === modelProfileId) ?? profiles[0];
}

export function getProvider(providerId: string): ModelProvider {
  if (providerId === "mimo-anthropic") {
    return mimoAnthropicProvider;
  }

  if (providerId === "mock") {
    return mockProvider;
  }

  return {
    id: providerId,
    name: providerId,
    async chat() {
      return {
        roleLabel: "系统",
        content: "该 Provider 尚未配置。请先完成 baseURL、模型和 API Key 设置。"
      };
    }
  };
}

function toAnthropicMessages(messages: readonly ChatMessage[]): Anthropic.Messages.MessageParam[] {
  return messages
    .filter((message) => message.sender === "user" || message.sender === "assistant")
    .map((message) => ({
      role: message.sender === "assistant" ? "assistant" : "user",
      content: [
        {
          type: "text",
          text: message.content
        }
      ]
    }));
}

function extractTextContent(content: Anthropic.Messages.Message["content"]): string {
  const text = content
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  return text || "MiMo 返回了空内容。";
}
