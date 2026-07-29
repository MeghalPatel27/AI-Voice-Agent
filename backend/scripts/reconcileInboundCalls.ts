import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { listHumeChats } from "../src/integrations/hume/humeChatHistory.client";
import { bootstrapInboundVoiceCall } from "../src/services/bootstrapInboundVoiceCall.service";
import { applyHumeChatEndedLifecycle } from "../src/services/callLifecycle.service";
import {
  normalizePhoneToE164,
  redactPhone,
} from "../src/services/inboundVoiceRouting.service";

const TARGET_ROUTING_KEY = "+15716095892";

function parseArgs(argv: string[]) {
  return {
    apply: argv.includes("--apply"),
    dryRun: !argv.includes("--apply"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const page = await listHumeChats({ pageNumber: 0, pageSize: 30 });
  const matches: Array<Record<string, unknown>> = [];
  const applied: Array<Record<string, unknown>> = [];

  for (const chat of page.chats) {
    const to = normalizePhoneToE164(chat.twilioToNumber);
    const from = normalizePhoneToE164(chat.twilioFromNumber);
    const sid = String(chat.twilioCallSid || "").trim();
    if (!to || to !== TARGET_ROUTING_KEY) continue;
    if (!from || !sid || !chat.id) {
      matches.push({
        chatId: chat.id || null,
        status: "skipped_non_deterministic",
        to: redactPhone(to),
      });
      continue;
    }

    const existingBySid = await prisma.call.findFirst({
      where: { providerCallId: sid },
      select: { id: true, humeChatId: true, conversationId: true },
    });

    if (existingBySid?.humeChatId && existingBySid.humeChatId !== chat.id) {
      matches.push({
        chatId: chat.id,
        callSid: `${sid.slice(0, 6)}***`,
        status: "skipped_sid_chat_conflict",
      });
      continue;
    }

    if (existingBySid?.humeChatId === chat.id) {
      if (
        args.apply &&
        (chat.endTimestampMs || String(chat.status || "").toLowerCase() === "ended")
      ) {
        await applyHumeChatEndedLifecycle({
          chatId: chat.id,
          endReason: "reconciled_hume_chat_ended",
          endTimestamp: chat.endTimestampMs
            ? Math.floor(chat.endTimestampMs / 1000)
            : null,
        });
      }
      continue;
    }

    if (!args.apply) {
      matches.push({
        chatId: chat.id,
        callSid: `${sid.slice(0, 6)}***`,
        to: redactPhone(to),
        from: redactPhone(from),
        status: existingBySid ? "would_update_existing_call" : "would_create_call",
      });
      continue;
    }

    const result = await bootstrapInboundVoiceCall({
      providerCallId: sid,
      callerPhone: from,
      calledNumber: to,
      direction: "INBOUND",
      humeChatId: chat.id,
      humeChatGroupId: chat.chatGroupId,
      humeConfigId: chat.configId,
      startedAt: chat.startTimestampMs ? new Date(chat.startTimestampMs) : new Date(),
    });

    applied.push({
      chatId: chat.id,
      callId: result.call.id,
      created: result.created,
      companyId: result.companyId,
      status: "applied",
    });

    if (chat.endTimestampMs || String(chat.status || "").toLowerCase() === "ended") {
      await applyHumeChatEndedLifecycle({
        chatId: chat.id,
        endReason: "reconciled_hume_chat_ended",
        endTimestamp: chat.endTimestampMs
          ? Math.floor(chat.endTimestampMs / 1000)
          : null,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: args.dryRun,
        targetRoutingKey: redactPhone(TARGET_ROUTING_KEY),
        scannedChats: page.chats.length,
        deterministicMatches: matches,
        applied,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        scope: "inbound_reconcile_calls",
        event: "failed",
        error: error instanceof Error ? error.message : "unknown_error",
      }),
    );
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
