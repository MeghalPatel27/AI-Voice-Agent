import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export const AIRADESK_CALL_CONTEXT_MAX_BYTES = 8192;

type DbClient = Prisma.TransactionClient | typeof prisma;

function toKnownRequirements(conversation: {
  aiSummary?: string | null;
  messages?: Array<{ senderType: string; body: string }>;
}) {
  const values: string[] = [];
  if (conversation.aiSummary) values.push(conversation.aiSummary);
  for (const message of conversation.messages || []) {
    if (message.senderType !== "CUSTOMER") continue;
    const line = String(message.body || "").replace(/\s+/g, " ").trim();
    if (!line) continue;
    values.push(line);
  }
  const unique = Array.from(new Set(values.map((item) => item.trim()))).filter(Boolean);
  return unique.slice(0, 6);
}

function inboundDiscoveryGoal() {
  return "Understand the caller's requirements, desired services, budget signal, timeline, and preferred next step. Schedule a meeting only when exact date, time, and timezone are confirmed.";
}

export type AiradeskCallContextPayload = {
  company: {
    name: string;
    businessType: string | null;
    services: string[];
    pricingGuidance: string[];
    agentTone: string | null;
  };
  customer: {
    name: string | null;
    preferredLanguage: string;
  };
  call: {
    direction: string;
    collectionGoal: string | null;
    callPurpose: string | null;
    extraNotes: string | null;
    preferredLanguage: string;
    scheduledTime: string | null;
    timezone: string | null;
  };
  recentContext: {
    summary: string | null;
    knownRequirements: string[];
  };
};

async function loadCompanyContextShell(companyId: string, client: DbClient = prisma) {
  const [settings, company, knowledge] = await Promise.all([
    client.companySettings.findUnique({
      where: { companyId },
    }),
    client.company.findUnique({
      where: { id: companyId },
      select: { name: true, industry: true },
    }),
    client.knowledgeItem.findMany({
      where: { companyId, enabled: true, isActive: true },
      take: 20,
    }),
  ]);
  return { settings, company, knowledge };
}

/**
 * Soft context for inbound/direct phone calls when chat↔call mapping is not ready yet.
 * Keeps EVI talking instead of stalling on a hard tool_error.
 */
export async function buildInboundFallbackCallContext(
  companyId: string,
  client: DbClient = prisma,
): Promise<AiradeskCallContextPayload> {
  const { settings, company, knowledge } = await loadCompanyContextShell(companyId, client);
  const payload: AiradeskCallContextPayload = {
    company: {
      name: company?.name || "Company",
      businessType: settings?.businessType || null,
      services: knowledge.slice(0, 5).map((k) => k.title).filter(Boolean),
      pricingGuidance: knowledge
        .filter((k) => String(k.category || "").toUpperCase().includes("PRIC"))
        .slice(0, 3)
        .map((k) => k.title),
      agentTone: settings?.aiTone || null,
    },
    customer: {
      name: null,
      preferredLanguage: "AUTO",
    },
    call: {
      direction: "INBOUND",
      collectionGoal: inboundDiscoveryGoal(),
      callPurpose: "Inbound caller enquiry",
      extraNotes: null,
      preferredLanguage: "AUTO",
      scheduledTime: null,
      timezone: null,
    },
    recentContext: {
      summary: null,
      knownRequirements: [],
    },
  };
  assertBoundedCallContext(payload);
  return payload;
}

export async function buildAiradeskCallContext(
  callId: string,
  companyId: string,
  client: DbClient = prisma,
): Promise<AiradeskCallContextPayload> {
  const call = await client.call.findFirst({
    where: {
      id: callId,
      conversation: {
        companyId,
      },
    },
    include: {
      conversation: {
        include: {
          customer: true,
        },
      },
    },
  });

  if (!call) {
    throw new Error("call_context_not_found");
  }

  const [{ settings, company, knowledge }, messages] = await Promise.all([
    loadCompanyContextShell(companyId, client),
    client.message.findMany({
      where: { conversationId: call.conversationId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { senderType: true, body: true },
    }),
  ]);

  const callMeta = (call.metadata as Record<string, unknown> | null) || {};
  const collectionGoal =
    (typeof call.purpose === "string" && call.purpose.trim()) ||
    (typeof callMeta.collectionGoal === "string" && callMeta.collectionGoal) ||
    (call.direction === "INBOUND" ? inboundDiscoveryGoal() : null);
  const callPurpose =
    (typeof callMeta.callPurpose === "string" && callMeta.callPurpose) ||
    (call.direction === "INBOUND" ? "Inbound caller enquiry" : null);
  const extraNotes =
    (typeof call.notes === "string" && call.notes.trim()) ||
    (typeof callMeta.extraNotes === "string" && callMeta.extraNotes) ||
    null;

  const payload: AiradeskCallContextPayload = {
    company: {
      name: company?.name || "Company",
      businessType: settings?.businessType || null,
      services: knowledge.slice(0, 5).map((k) => k.title).filter(Boolean),
      pricingGuidance: knowledge
        .filter((k) => String(k.category || "").toUpperCase().includes("PRIC"))
        .slice(0, 3)
        .map((k) => k.title),
      agentTone: settings?.aiTone || null,
    },
    customer: {
      name: call.conversation.customer?.fullName || null,
      preferredLanguage:
        call.preferredLanguage ||
        call.conversation.customer?.preferredLanguage ||
        "AUTO",
    },
    call: {
      direction: call.direction || "INBOUND",
      collectionGoal,
      callPurpose,
      extraNotes: extraNotes
        ? `${extraNotes}\n[PRIVATE_INTERNAL_NOTE: never read verbatim to caller]`
        : null,
      preferredLanguage:
        call.preferredLanguage || String(callMeta.preferredLanguage || "AUTO"),
      scheduledTime: call.preferredCallTime?.toISOString() || null,
      timezone: (typeof callMeta.timezone === "string" && callMeta.timezone) || null,
    },
    recentContext: {
      summary: call.conversation.aiSummary || null,
      knownRequirements: toKnownRequirements({
        aiSummary: call.conversation.aiSummary,
        messages,
      }),
    },
  };

  assertBoundedCallContext(payload);
  return payload;
}

export function assertBoundedCallContext(payload: AiradeskCallContextPayload) {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > AIRADESK_CALL_CONTEXT_MAX_BYTES) {
    throw new Error("call_context_payload_too_large");
  }

  const forbiddenPatterns = [
    /postgresql:\/\//i,
    /HUME_API_KEY/i,
    /TWILIO_AUTH_TOKEN/i,
    /JWT_SECRET/i,
    /sk-[a-z0-9]{10,}/i,
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(serialized))) {
    throw new Error("call_context_contains_forbidden_content");
  }
}
