import type { AiradeskCallContextPayload } from "../../services/callContext.service";
import {
  buildAiradeskCallContext,
} from "../../services/callContext.service";
import { prisma } from "../../db/prisma";
import { getHumeToolRuntimeConfig } from "./humeToolRuntime.config";

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function logHumeLatency(
  event: string,
  fields: Record<string, unknown> = {},
) {
  console.info(
    JSON.stringify({
      scope: "hume_latency",
      event,
      at: new Date().toISOString(),
      ...fields,
    }),
  );
}

export async function prewarmAiradeskCallContext(input: {
  callId: string;
  companyId: string;
  chatId?: string | null;
}) {
  const ttl = getHumeToolRuntimeConfig().contextCacheTtlSeconds;
  try {
    const payload = await buildAiradeskCallContext(input.callId, input.companyId);
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await prisma.humeCallContextCache.upsert({
      where: {
        companyId_callId: {
          companyId: input.companyId,
          callId: input.callId,
        },
      },
      create: {
        callId: input.callId,
        companyId: input.companyId,
        chatId: input.chatId || null,
        payload: payload as object,
        expiresAt,
      },
      update: {
        chatId: input.chatId || null,
        payload: payload as object,
        expiresAt,
      },
    });
    logHumeLatency("context_prewarmed", {
      callId: redactId(input.callId),
      companyId: redactId(input.companyId),
      chatId: redactId(input.chatId),
      ttlSeconds: ttl,
    });
  } catch (error) {
    logHumeLatency("context_prewarm_failed", {
      callId: redactId(input.callId),
      companyId: redactId(input.companyId),
      chatId: redactId(input.chatId),
      errorCategory: error instanceof Error ? error.message.slice(0, 80) : "prewarm_failed",
    });
  }
}

export async function getCachedAiradeskCallContext(input: {
  callId: string;
  companyId: string;
}): Promise<AiradeskCallContextPayload | null> {
  const row = await prisma.humeCallContextCache.findUnique({
    where: {
      companyId_callId: {
        companyId: input.companyId,
        callId: input.callId,
      },
    },
  });
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await prisma.humeCallContextCache
      .delete({ where: { id: row.id } })
      .catch(() => undefined);
    return null;
  }
  return row.payload as AiradeskCallContextPayload;
}

export async function invalidateAiradeskCallContextCache(input: {
  callId: string;
  companyId: string;
}) {
  await prisma.humeCallContextCache
    .deleteMany({
      where: { callId: input.callId, companyId: input.companyId },
    })
    .catch(() => undefined);
}

export async function loadAiradeskCallContextFast(input: {
  callId: string;
  companyId: string;
}): Promise<{ context: AiradeskCallContextPayload; source: "cache" | "database" }> {
  const cached = await getCachedAiradeskCallContext(input);
  if (cached) return { context: cached, source: "cache" };
  const context = await buildAiradeskCallContext(input.callId, input.companyId);
  return { context, source: "database" };
}
