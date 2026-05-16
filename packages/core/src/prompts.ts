import type { ChatMessage } from "@xiaomi/shared";
import { DEFAULT_SYSTEM_PROMPT } from "./modelConfig";
import { readMarkdown, readMarkdownFiles } from "./utils/mdRead";

const SYSTEM_PROMPT_MODULES = [
  "packages/memorizes/system/01-role.md",
  "packages/memorizes/system/02-goals.md",
  "packages/memorizes/system/03-style.md"
] as const;

const INTENT_PROMPT_MODULES = [
  "packages/memorizes/intent/01-parser.md"
] as const;

const INTENT_USER_MODULES = [
  "packages/memorizes/intent/02-input.md"
] as const;

const INTENT_CONTEXT_TEMPLATE = "packages/memorizes/context/intent-result.md";

const COMPRESSION_PROMPT_MODULES = [
  "packages/memorizes/compression/01-system.md"
] as const;

const COMPRESSION_USER_MODULES = [
  "packages/memorizes/compression/02-input.md"
] as const;

export function buildIntentSystemPrompt(): string {
  return readMarkdownFiles(INTENT_PROMPT_MODULES);
}

export function buildIntentUserPrompt(messages: readonly ChatMessage[], latestUserMessage: string): string {
  return renderTemplate(readMarkdownFiles(INTENT_USER_MODULES), {
    recent_messages: formatRecentMessages(messages),
    input: latestUserMessage
  });
}

export function buildSystemPrompt(): string {
  return readMarkdownFiles(SYSTEM_PROMPT_MODULES, DEFAULT_SYSTEM_PROMPT);
}

export function buildIntentContextMessage(intentSummary: string): string {
  return renderTemplate(readMarkdown(INTENT_CONTEXT_TEMPLATE), {
    intent_result: intentSummary
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
