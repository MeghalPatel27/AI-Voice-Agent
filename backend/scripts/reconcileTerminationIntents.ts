import "dotenv/config";
import { prisma } from "../src/db/prisma";
import {
  runPostMeetingTerminationWatchdog,
  getPostMeetingTerminationConfig,
} from "../src/services/callTermination.service";

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply || process.argv.includes("--dry-run");
  const config = getPostMeetingTerminationConfig();

  const stale = await prisma.callTerminationIntent.findMany({
    where: {
      reason: "MEETING_SCHEDULED",
      state: "ARMED",
      graceDeadlineAt: { lt: new Date() },
      call: {
        providerCallId: { not: null },
        status: { in: ["RINGING", "IN_PROGRESS", "LIVE"] },
        bookings: { some: {} },
      },
    },
    orderBy: { graceDeadlineAt: "asc" },
    take: 100,
    include: {
      call: {
        select: {
          id: true,
          direction: true,
          status: true,
          providerCallId: true,
          humeChatId: true,
          metadata: true,
          createdAt: true,
        },
      },
      booking: {
        select: { createdAt: true },
      },
    },
  });

  const report = stale.map((intent) => {
    const meta = (intent.call.metadata as Record<string, unknown> | null) || {};
    return {
      callId: redactId(intent.call.id),
      direction: intent.call.direction || "UNKNOWN",
      meetingSuccessTime: intent.booking?.createdAt?.toISOString() || null,
      graceDeadline: intent.graceDeadlineAt.toISOString(),
      localCallStatus: intent.call.status,
      humeChatState: meta.humeChatEndedAt ? "ended" : "active_or_unknown",
      fallbackAttempts: intent.attemptCount,
      proposedAction: dryRun ? "would_check_or_hangup_exact_sid" : "apply_check_or_hangup_exact_sid",
    };
  });

  console.log(
    JSON.stringify(
      {
        mode: dryRun ? "dry-run" : "apply",
        config,
        count: stale.length,
        intents: report,
      },
      null,
      2,
    ),
  );

  if (dryRun) return;
  for (const intent of stale) {
    await runPostMeetingTerminationWatchdog(intent.call.id);
  }
}

void main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
