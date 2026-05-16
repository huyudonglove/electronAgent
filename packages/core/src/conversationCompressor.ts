import type { ChatMessage } from "@xiaomi/shared";
import {
  getLatestConversationSummary,
  saveConversationSummary,
  type ConversationSummary
} from "./conversationSummaries";
import { saveConversationSummaryEvent } from "./events";
import { compressConversationWithOllama } from "./providers/ollamaCompressionProvider";

const MIN_MESSAGES_BEFORE_COMPRESSION = 24;
const RECENT_MESSAGES_TO_KEEP = 10;
const MIN_NEW_MESSAGES_TO_COMPRESS = 6;

export async function maybeCompressConversation(input: {
  readonly projectId: string;
  readonly sessionId: string;
  readonly messages: readonly ChatMessage[];
}): Promise<ConversationSummary | undefined> {
  const latestSummary = getLatestConversationSummary(input.projectId, input.sessionId);

  if (input.messages.length < MIN_MESSAGES_BEFORE_COMPRESSION) {
    return latestSummary;
  }

  const compressionEndIndex = input.messages.length - RECENT_MESSAGES_TO_KEEP - 1;
  if (compressionEndIndex < 0) {
    return latestSummary;
  }

  const compressionEndMessage = input.messages[compressionEndIndex];
  if (!compressionEndMessage || latestSummary?.sourceEndMessageId === compressionEndMessage.id) {
    return latestSummary;
  }

  const sourceMessages = selectSourceMessages(input.messages, latestSummary, compressionEndIndex);
  if (sourceMessages.length < MIN_NEW_MESSAGES_TO_COMPRESS) {
    return latestSummary;
  }

  const compressed = await compressConversationWithOllama({
    messages: sourceMessages,
    previousSummary: latestSummary?.summary
  });

  const summary = saveConversationSummary({
    projectId: input.projectId,
    sessionId: input.sessionId,
    sourceMessages,
    summary: compressed.summary,
    decisions: compressed.decisions,
    openQuestions: compressed.openQuestions,
    constraints: compressed.constraints,
    taskProgress: compressed.taskProgress
  });

  saveConversationSummaryEvent({
    projectId: input.projectId,
    sessionId: input.sessionId,
    summaryId: summary.id,
    content: summary.summary,
    payload: {
      sourceStartMessageId: summary.sourceStartMessageId,
      sourceEndMessageId: summary.sourceEndMessageId,
      decisions: summary.decisions,
      openQuestions: summary.openQuestions,
      constraints: summary.constraints,
      taskProgress: summary.taskProgress
    }
  });

  return summary;
}

function selectSourceMessages(
  messages: readonly ChatMessage[],
  latestSummary: ConversationSummary | undefined,
  compressionEndIndex: number
): readonly ChatMessage[] {
  const afterPreviousSummaryIndex = latestSummary
    ? messages.findIndex((message) => message.id === latestSummary.sourceEndMessageId) + 1
    : 0;
  const startIndex = afterPreviousSummaryIndex > 0 ? afterPreviousSummaryIndex : 0;

  return messages.slice(startIndex, compressionEndIndex + 1);
}
