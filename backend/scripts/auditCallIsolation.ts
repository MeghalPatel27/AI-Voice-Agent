import "dotenv/config";
import { prisma } from "../src/db/prisma";

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply || hasFlag("--dry-run");

  const report = {
    mode: dryRun ? "dry-run" : "apply",
    duplicateProviderCallIds: [] as Array<Record<string, unknown>>,
    duplicateHumeChatIds: [] as Array<Record<string, unknown>>,
    syncJobMismatches: [] as Array<Record<string, unknown>>,
    messageOwnershipIssues: [] as Array<Record<string, unknown>>,
    bookingMissingCall: [] as Array<Record<string, unknown>>,
    repairsApplied: 0,
    repairsSkipped: 0,
  };

  const dupProvider = await prisma.$queryRaw<
    Array<{ providerCallId: string; count: bigint }>
  >`
    SELECT "providerCallId", COUNT(*)::bigint AS count
    FROM "Call"
    WHERE "providerCallId" IS NOT NULL
    GROUP BY "providerCallId"
    HAVING COUNT(*) > 1
  `;
  report.duplicateProviderCallIds = dupProvider.map((row) => ({
    providerCallId: redactId(row.providerCallId),
    count: Number(row.count),
  }));

  const dupChat = await prisma.$queryRaw<
    Array<{ humeChatId: string; count: bigint }>
  >`
    SELECT "humeChatId", COUNT(*)::bigint AS count
    FROM "Call"
    WHERE "humeChatId" IS NOT NULL
    GROUP BY "humeChatId"
    HAVING COUNT(*) > 1
  `;
  report.duplicateHumeChatIds = dupChat.map((row) => ({
    humeChatId: redactId(row.humeChatId),
    count: Number(row.count),
  }));

  const syncJobs = await prisma.humeChatSyncJob.findMany({
    take: 500,
    orderBy: { createdAt: "desc" },
    include: { call: { select: { humeChatId: true, id: true } } },
  });
  for (const job of syncJobs) {
    if (job.call.humeChatId && job.call.humeChatId !== job.chatId) {
      report.syncJobMismatches.push({
        jobId: redactId(job.id),
        callId: redactId(job.callId),
        jobChatId: redactId(job.chatId),
        callChatId: redactId(job.call.humeChatId),
      });
    }
  }

  const orphanMessages = await prisma.message.findMany({
    where: {
      callId: { not: null },
      call: { is: { conversationId: { not: undefined } } },
    },
    select: {
      id: true,
      callId: true,
      conversationId: true,
      call: { select: { conversationId: true } },
    },
    take: 500,
  });
  for (const message of orphanMessages) {
    if (
      message.callId &&
      message.call &&
      message.conversationId !== message.call.conversationId
    ) {
      report.messageOwnershipIssues.push({
        messageId: redactId(message.id),
        callId: redactId(message.callId),
      });
    }
  }

  const bookings = await prisma.booking.findMany({
    where: {
      conversationId: { not: null },
      callId: null,
    },
    select: { id: true, conversationId: true },
    take: 200,
  });
  for (const booking of bookings) {
    if (!booking.conversationId) continue;
    const calls = await prisma.call.findMany({
      where: { conversationId: booking.conversationId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    if (calls.length === 1) {
      report.bookingMissingCall.push({
        bookingId: redactId(booking.id),
        candidateCallId: redactId(calls[0]?.id),
        deterministic: true,
      });
      if (!dryRun && calls[0]) {
        await prisma.booking.update({
          where: { id: booking.id },
          data: { callId: calls[0].id },
        });
        report.repairsApplied += 1;
      }
    } else {
      report.bookingMissingCall.push({
        bookingId: redactId(booking.id),
        candidateCount: calls.length,
        deterministic: false,
      });
      report.repairsSkipped += 1;
    }
  }

  if (!dryRun) {
    const singleCallConversations = await prisma.$queryRaw<
      Array<{ conversationId: string; callId: string }>
    >`
      SELECT c."conversationId", MIN(c."id") AS "callId"
      FROM "Call" c
      GROUP BY c."conversationId"
      HAVING COUNT(*) = 1
    `;

    for (const row of singleCallConversations) {
      const updated = await prisma.message.updateMany({
        where: {
          conversationId: row.conversationId,
          callId: null,
        },
        data: { callId: row.callId },
      });
      if (updated.count > 0) {
        report.repairsApplied += updated.count;
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
