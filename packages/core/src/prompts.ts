import type { ChatMessage } from "@xiaomi/shared";
import { DEFAULT_SYSTEM_PROMPT } from "./modelConfig";
import { readMarkdown, readMarkdownFiles } from "./utils/mdRead";

const SYSTEM_PROMPT_MODULES = [
  "packages/memorizes/system/01-role.md",
  "packages/memorizes/system/02-goals.md",
  "packages/memorizes/system/03-style.md"
] as const;

const ROUTER_PROMPT_MODULES = [
  "packages/memorizes/router/01-system.md"
] as const;

const ROUTER_USER_MODULES = [
  "packages/memorizes/router/02-input.md"
] as const;

const ROUTER_CONTEXT_TEMPLATE = "packages/memorizes/context/router-runtime.md";

const PLANNING_PROMPT_MODULES = [
  "packages/memorizes/planning/01-system.md"
] as const;

const PLANNING_USER_MODULES = [
  "packages/memorizes/planning/02-input.md"
] as const;

const COMPRESSION_PROMPT_MODULES = [
  "packages/memorizes/compression/01-system.md"
] as const;

const COMPRESSION_USER_MODULES = [
  "packages/memorizes/compression/02-input.md"
] as const;

const EVALUATOR_PROMPT_MODULES = [
  "packages/memorizes/evaluator/01-system.md"
] as const;

const EVALUATOR_USER_MODULES = [
  "packages/memorizes/evaluator/02-input.md"
] as const;

export function buildRouterSystemPrompt(): string {
  return readMarkdownFiles(ROUTER_PROMPT_MODULES);
}

export function buildRouterUserPrompt(
  messages: readonly ChatMessage[],
  latestUserMessage: string,
  environmentFingerprint: string
): string {
  return renderTemplate(readMarkdownFiles(ROUTER_USER_MODULES), {
    environment_fingerprint: environmentFingerprint || "无",
    recent_messages: formatRecentMessages(messages),
    input: latestUserMessage
  });
}

export function buildSystemPrompt(): string {
  return readMarkdownFiles(SYSTEM_PROMPT_MODULES, DEFAULT_SYSTEM_PROMPT);
}

export function buildRouterContextMessage(routerContext: string): string {
  return renderTemplate(readMarkdown(ROUTER_CONTEXT_TEMPLATE), {
    router_context: routerContext
  });
}

export function buildPlanningSystemPrompt(): string {
  return readMarkdownFiles(PLANNING_PROMPT_MODULES);
}

export function buildPlanningUserPrompt(input: {
  readonly userInput: string;
  readonly environmentFingerprint: string;
  readonly routerResult: string;
  readonly toolSelection: string;
  readonly memories: string;
  readonly conversationSummary: string;
  readonly recentMessages: readonly ChatMessage[];
}): string {
  return renderTemplate(readMarkdownFiles(PLANNING_USER_MODULES), {
    user_input: input.userInput,
    environment_fingerprint: input.environmentFingerprint || "无",
    router_result: input.routerResult,
    tool_selection: input.toolSelection,
    memories: input.memories || "无",
    conversation_summary: input.conversationSummary || "无",
    recent_messages: formatRecentMessages(input.recentMessages)
  });
}

export function buildCompressionSystemPrompt(): string {
  return readMarkdownFiles(COMPRESSION_PROMPT_MODULES);
}

export function buildCompressionUserPrompt(input: {
  readonly previousSummary: string;
  readonly messages: readonly ChatMessage[];
}): string {
  return renderTemplate(readMarkdownFiles(COMPRESSION_USER_MODULES), {
    previous_summary: input.previousSummary || "无",
    messages: formatMessages(input.messages)
  });
}

export function buildEvaluatorSystemPrompt(): string {
  return readMarkdownFiles(EVALUATOR_PROMPT_MODULES);
}

export function buildEvaluatorUserPrompt(input: {
  readonly userInput: string;
  readonly routerResult: string;
  readonly planningResult: string;
  readonly assistantAnswer: string;
  readonly evaluationAttempt?: number;
}): string {
  return renderTemplate(readMarkdownFiles(EVALUATOR_USER_MODULES), {
    user_input: input.userInput,
    router_result: input.routerResult,
    planning_result: input.planningResult || "无",
    assistant_answer: input.assistantAnswer,
    evaluation_attempt: input.evaluationAttempt ? String(input.evaluationAttempt) : "1"
  });
}

function formatRecentMessages(messages: readonly ChatMessage[]): string {
  return (
    messages
      .slice(-8)
      .map((message) => `${message.roleLabel}: ${message.content}`)
      .join("\n\n") || "无"
  );
}

function formatMessages(messages: readonly ChatMessage[]): string {
  return (
    messages
      .map((message) => {
        return [
          `id: ${message.id}`,
          `role: ${message.sender}`,
          `label: ${message.roleLabel}`,
          `time: ${message.createdAt}`,
          `content: ${message.content}`
        ].join("\n");
      })
      .join("\n\n---\n\n") || "无"
  );
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((content, [key, value]) => {
    return content.replaceAll(`{{${key}}}`, value);
  }, template);
}
