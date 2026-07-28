import "dotenv/config";
import { prisma } from "../src/db/prisma";
import {
  persistHumeChatCorrelation,
  resolveHumeChatForCall,
} from "../src/integrations/hume/humeChatCorrelation.service";
import { enqueueHumeSyncJob } from "../src/integrations/hume/humeChatSync.service";
import { getHumeChatHistoryConfig } from "../src/integrations/hume/humeChatHistory.config";

function redactId(id?: string | null) {
  if (!id) return null;
  if (id.length <= 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

function redactSid(sid?: string | null) {
  if (!sid) return null;
  if (sid.length <= 10) return "***";
  return `${sid.slice(0, 6)}…${sid.slice(-4)}`;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply || hasFlag("--dry-run");
  const runtime = getHumeChatHistoryConfig();
  const since = new Date(Date.now() - runtime.reconcileLookbackDays * 24 * 60 * 60 * 1000);

  const calls = await prisma.call.findMany({
    where: {
      createdAt: { gte: since },
      OR: [
        { humeChatId: null },
        { transcriptSyncStatus: { in: ["PENDING", "FAILED"] } },
        { humeSyncStatus: { in: ["PENDING", "FAILED"] } },
      ],
      status: { in: ["COMPLETED", "FAILED", "MISSED", "NO_ANSWER", "BUSY", "CANCELED"] },
      providerCallId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { conversation: true },
  });

  const report = {
    mode: dryRun ? "dry-run" : "apply",
    inspected: calls.length,
    exactMatches: 0,
    ambiguous: 0,
    notFound: 0,
    applied: 0,
    proposals: [] as Array<Record<string, unknown>>,
  };

  for (const call of calls) {
    const correlation = await resolveHumeChatForCall(call);
    if (correlation.status === "NOT_FOUND") {
      report.notFound += 1;
      report.proposals.push({
        callId: redactId(call.id),
        twilioCallSid: redactSid(call.providerCallId),
        status: "NOT_FOUND",
        reason: correlation.reason,
        candidateCount: correlation.candidateCount,
      });
      continue;
    }
    if (correlation.status === "NEEDS_REVIEW") {
      report.ambiguous += 1;
      report.proposals.push({
        callId: redactId(call.id),
        twilioCallSid: redactSid(call.providerCallId),
        status: "NEEDS_REVIEW",
        reason: correlation.reason,
        candidateCount: correlation.candidateCount,
        candidates: correlation.candidates,
      });
      continue;
    }

    report.exactMatches += 1;
    const proposal = {
      callId: redactId(call.id),
      twilioCallSid: redactSid(call.providerCallId),
      status: "EXACT_MATCH",
      humeChatId: redactId(correlation.chat.id),
      humeChatGroupId: redactId(correlation.chat.chatGroupId),
      configIdMatch: correlation.evidence.configIdMatch,
      timestampDeltaMs: correlation.evidence.timestampDeltaMs,
      eventCount: correlation.chat.eventCount,
      transcriptAvailable: (correlation.chat.eventCount || 0) > 0,
      audioLikely: true,
      expressionLikely: (correlation.chat.eventCount || 0) > 0,
      functionCallsLikely: (correlation.chat.eventCount || 0) > 0,
    };
    report.proposals.push(proposal);

    if (!dryRun) {
      await persistHumeChatCorrelation({
        callId: call.id,
        chat: correlation.chat,
        evidence: correlation.evidence,
      });
      await enqueueHumeSyncJob(call.id, correlation.chat.id, call.conversation.companyId);
      report.applied += 1;
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
