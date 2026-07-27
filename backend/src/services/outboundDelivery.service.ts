import { prisma } from "../db/prisma";
import { sendWhatsAppTextMessage } from "./whatsappProvider.service";

type DeliverPendingInput = {
  channel?: "WHATSAPP";
  limit?: number;
};

function safeLimit(value?: number) {
  if (!Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(100, Math.floor(Number(value))));
}

function normalizeChannel(value?: string) {
  return value === "WHATSAPP" ? "WHATSAPP" : "WHATSAPP";
}

export async function deliverOutboundMessageById(id: string) {
  const outbound = await prisma.outboundMessage.findUnique({
    where: {
      id,
    },
    include: {
      company: {
        include: {
          settings: true,
        },
      },
    },
  });

  if (!outbound) {
    return {
      skipped: true,
      sent: false,
      failed: false,
      reason: "Outbound message not found",
    };
  }

  if (outbound.status !== "PENDING") {
    return {
      skipped: true,
      sent: outbound.status === "SENT",
      failed: outbound.status === "FAILED",
      reason: `Outbound message is already ${outbound.status}`,
    };
  }

  if (outbound.channel !== "WHATSAPP") {
    await prisma.outboundMessage.update({
      where: {
        id: outbound.id,
      },
      data: {
        status: "FAILED",
        errorMessage: `Unsupported outbound channel: ${outbound.channel}`,
      },
    });

    return {
      skipped: false,
      sent: false,
      failed: true,
      reason: `Unsupported outbound channel: ${outbound.channel}`,
    };
  }

  const settings = outbound.company.settings;

  const result = await sendWhatsAppTextMessage({
    to: outbound.toPhone,
    body: outbound.body,
    providerMode: settings?.whatsappProviderMode,
    accessToken: settings?.whatsappAccessToken,
    phoneNumberId: settings?.whatsappPhoneNumberId || settings?.whatsappNumber,
    graphApiVersion: settings?.whatsappGraphApiVersion,
  });

  const nextStatus = result.ok ? "SENT" : "FAILED";

  await prisma.outboundMessage.update({
    where: {
      id: outbound.id,
    },
    data: {
      status: nextStatus,
      provider: result.provider,
      providerMessageId: result.providerMessageId || outbound.providerMessageId,
      errorMessage: result.ok ? null : result.errorMessage || "WhatsApp send failed",
      metadata: {
        ...(outbound.metadata && typeof outbound.metadata === "object"
          ? (outbound.metadata as Record<string, any>)
          : {}),
        delivery: {
          attemptedAt: new Date().toISOString(),
          result,
        },
      },
    },
  });

  return {
    skipped: false,
    sent: result.ok,
    failed: !result.ok,
    result,
  };
}

export async function deliverPendingOutboundMessages(input: DeliverPendingInput = {}) {
  const channel = normalizeChannel(input.channel);
  const limit = safeLimit(input.limit);

  const pending = await prisma.outboundMessage.findMany({
    where: {
      channel,
      status: "PENDING",
    },
    orderBy: {
      createdAt: "asc",
    },
    take: limit,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const results: any[] = [];

  for (const outbound of pending) {
    const result = await deliverOutboundMessageById(outbound.id);

    if (result.skipped) skipped += 1;
    else if (result.sent) sent += 1;
    else if (result.failed) failed += 1;

    results.push({
      id: outbound.id,
      ...result,
    });
  }

  return {
    totalPicked: pending.length,
    sent,
    failed,
    skipped,
    skippedCount: skipped,
    results,
  };
}