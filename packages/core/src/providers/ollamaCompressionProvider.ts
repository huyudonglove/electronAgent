import type { ChatMessage } from "@xiaomi/shared";
import { getModelRuntimeConfig } from "../modelRuntimeConfig";
import { buildCompressionSystemPrompt, buildCompressionUserPrompt } from "../prompts";
import { createJsonChat } from "./jsonChatProvider";

export interface CompressionResult {
  readonly summary: string;
  readonly decisions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly constraints: readonly string[];
  readonly taskProgress: readonly string[];
}

interface CompressionJson {
  readonly summary?: string;
  readonly decisions?: unknown;
  readonly open_questions?: unknown;
  readonly constraints?: unknown;
  readonly task_progress?: unknown;
}

export async function compressConversationWithOllama(input: {
  readonly messages: readonly ChatMessage[];
  readonly previousSummary?: string;
}): Promise<CompressionResult> {
  const config = getModelRuntimeConfig("compression");
  const latestUserMessage = input.messages.at(-1)?.content;
  const content = await createJsonChat({
    config,
    providerId: "compression",
    systemPrompt: buildCompressionSystemPrompt(),
    userPrompt: buildCompressionUserPrompt({
      previousSummary: input.previousSummary ?? "",
      messages: input.messages
    }),
    latestUserMessage,
    messageCount: input.messages.length,
    ollamaFormatJson: true
  });

  return parseCompressionResult(content);
}

function parseCompressionResult(content: string): CompressionResult {
  const parsed = JSON.parse(content) as CompressionJson;

  if (!parsed.summary || typeof parsed.summary !== "string") {
    throw new Error(`会话压缩结果无效：summary 不能为空。实际返回：${content}`);
  }

  return {
    summary: parsed.summary,
    decisions: toStringArray(parsed.decisions),
    openQuestions: toStringArray(parsed.open_questions),
    constraints: toStringArray(parsed.constraints),
    taskProgress: toStringArray(parsed.task_progress)
  };
}

function toStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
