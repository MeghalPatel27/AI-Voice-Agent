import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export type TranscriptMessage = {
  senderType: string;
  body: string;
  createdAt?: Date;
  providerMessageId?: string | null;
};

export function buildTranscriptTextFromMessages(
  messages: TranscriptMessage[],
): string {
  return messages
    .map((message) => {
      const speaker =
        message.senderType === "CUSTOMER"
          ? "Customer"
          : message.senderType === "AI"
            ? "AI"
            : "Human";
      const stamp = message.createdAt
        ? `[${message.createdAt.toISOString()}] `
        : "";
      return `${stamp}${speaker}: ${message.body}`;
    })
    .join("\n");
}

export function buildLabeledTranscriptLines(
  messages: TranscriptMessage[],
): string {
  return messages
    .map((message) => {
      const speaker =
        message.senderType === "CUSTOMER"
          ? "CUSTOMER"
          : message.senderType === "AI"
            ? "AI"
            : "HUMAN";
      const body = String(message.body || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!body) return null;
      return `${speaker}: ${body}`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/** Strict per-call message scope for transcript reads and writes. */
export function callScopedMessageWhere(
  callId: string,
  conversationId: string,
): Prisma.MessageWhereInput {
  return {
    conversationId,
    callId,
  };
}

export async function loadCallScopedMessages(
  callId: string,
  conversationId: string,
  options?: { includeLegacySingleCall?: boolean },
) {
  const scoped = await prisma.message.findMany({
    where: callScopedMessageWhere(callId, conversationId),
    orderBy: { createdAt: "asc" },
    select: {
      senderType: true,
      body: true,
      createdAt: true,
      providerMessageId: true,
      provider: true,
      providerStatus: true,
    },
  });

  if (scoped.length > 0) {
    return scoped.filter(
      (message) => message.providerStatus !== "interrupted",
    );
  }

  if (options?.includeLegacySingleCall === false) {
    return [];
  }

  const callCount = await prisma.call.count({
    where: { conversationId },
  });

  if (callCount !== 1) {
    return [];
  }

  return prisma.message.findMany({
    where: {
      conversationId,
      callId: null,
    },
    orderBy: { createdAt: "asc" },
    select: {
      senderType: true,
      body: true,
      createdAt: true,
      providerMessageId: true,
      provider: true,
      providerStatus: true,
    },
  });
}

export async function resolveCallTranscript(input: {
  callId: string;
  conversationId: string;
  storedTranscript?: string | null;
}) {
  if (input.storedTranscript?.trim()) {
    return input.storedTranscript.trim();
  }

  const messages = await loadCallScopedMessages(
    input.callId,
    input.conversationId,
  );

  return buildTranscriptTextFromMessages(messages);
}
