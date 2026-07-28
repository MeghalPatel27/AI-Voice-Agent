import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { fetchAllHumeChatEvents } from "../src/integrations/hume/humeChatHistory.client";
import { scheduleMeetingForVerifiedCall } from "../src/services/humeMeetingScheduling.service";

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function redact(value?: string | null) {
  if (!value) return null;
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function toIsoFromMs(ms: unknown) {
  const n = typeof ms === "number" ? ms : Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

function parseFunctionPayload(evt: Record<string, unknown>) {
  const text = typeof evt.message_text === "string" ? evt.message_text : "";
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply || hasFlag("--dry-run");
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

  const calls = await prisma.call.findMany({
    where: {
      createdAt: { gte: since },
      humeChatId: { not: null },
      status: { in: ["COMPLETED", "FAILED", "MISSED", "NO_ANSWER", "BUSY", "CANCELED"] },
      bookings: { none: {} },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      conversation: { select: { companyId: true, customerId: true } },
      bookings: { select: { id: true } },
    },
  });

  const report: Record<string, unknown> = {
    mode: dryRun ? "dry-run" : "apply",
    inspected: calls.length,
    proposals: [] as Array<Record<string, unknown>>,
    applied: 0,
    skipped: 0,
  };
  const proposals = report.proposals as Array<Record<string, unknown>>;

  for (const call of calls) {
    const chatId = call.humeChatId;
    if (!chatId) continue;
    const { events } = await fetchAllHumeChatEvents(chatId);
    const fnEvents = events.filter(
      (evt) => String((evt as { type?: string }).type || "") === "FUNCTION_CALL",
    ) as Array<Record<string, unknown>>;
    const scheduleEvents = fnEvents
      .map((evt) => ({ evt, payload: parseFunctionPayload(evt) }))
      .filter(
        (row) => String(row.payload?.name || "") === "airadesk_schedule_meeting",
      );
    const responseEvents = events.filter((evt) =>
      ["FUNCTION_CALL_RESPONSE", "TOOL_RESPONSE", "FUNCTION_RESPONSE"].includes(
        String((evt as { type?: string }).type || ""),
      ),
    ) as Array<Record<string, unknown>>;

    if (scheduleEvents.length !== 1) {
      proposals.push({
        callId: redact(call.id),
        chatId: redact(chatId),
        status: "SKIPPED",
        reason:
          scheduleEvents.length === 0
            ? "no_schedule_function_call"
            : "multiple_schedule_function_calls",
      });
      report.skipped = Number(report.skipped) + 1;
      continue;
    }

    const scheduleEvent = scheduleEvents[0]!;
    const payload = scheduleEvent.payload!;
    const toolCallId = String(payload.tool_call_id || "").trim();
    const paramsRaw = String(payload.parameters || "{}");
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(paramsRaw) as Record<string, unknown>;
    } catch {
      proposals.push({
        callId: redact(call.id),
        chatId: redact(chatId),
        toolCallId: redact(toolCallId),
        status: "SKIPPED",
        reason: "invalid_tool_parameters_json",
      });
      report.skipped = Number(report.skipped) + 1;
      continue;
    }

    const preferredTimeText = String(params.preferredTimeText || "").trim();
    const timezone = String(params.timezone || "").trim() || null;
    if (!toolCallId || !preferredTimeText) {
      proposals.push({
        callId: redact(call.id),
        chatId: redact(chatId),
        toolCallId: redact(toolCallId),
        status: "SKIPPED",
        reason: "missing_tool_call_id_or_preferred_time",
      });
      report.skipped = Number(report.skipped) + 1;
      continue;
    }

    const functionTs = toIsoFromMs(scheduleEvent.evt.timestamp);
    const userMeetingTs = toIsoFromMs(
      events.find((evt) => {
        const e = evt as Record<string, unknown>;
        if (String(e.type || "") !== "USER_MESSAGE") return false;
        const txt = String(e.message_text || "");
        return /tomorrow|today|pm|am|meeting|schedule|call/i.test(txt);
      })?.timestamp,
    );
    const referenceInstant = new Date(
      functionTs || userMeetingTs || call.startedAt || call.createdAt,
    );

    const existingForTool = await prisma.booking.findFirst({
      where: {
        companyId: call.conversation.companyId,
        callId: call.id,
        notes: { contains: `[HUME_TOOL_CALL_ID:${toolCallId}]` },
      },
    });

    const proposal = {
      callId: redact(call.id),
      chatId: redact(chatId),
      toolCallId: redact(toolCallId),
      toolName: "airadesk_schedule_meeting",
      preferredTimeText,
      timezone,
      referenceInstant: referenceInstant.toISOString(),
      responseEventState: responseEvents.length > 0 ? "present" : "missing",
      existingBookingCount: call.bookings.length,
      alreadyRecovered: Boolean(existingForTool),
      proposedAction: existingForTool ? "none_already_recovered" : "recover_via_service",
    };
    proposals.push(proposal);

    if (dryRun || existingForTool) continue;

    const result = await scheduleMeetingForVerifiedCall({
      call: {
        id: call.id,
        conversationId: call.conversationId,
        metadata: call.metadata,
        conversation: {
          companyId: call.conversation.companyId,
          customerId: call.conversation.customerId,
        },
      },
      preferredTimeText,
      timezone,
      purpose: typeof params.purpose === "string" ? params.purpose : null,
      notes: typeof params.notes === "string" ? params.notes : null,
      modelResolvedIso: typeof params.modelResolvedIso === "string" ? params.modelResolvedIso : null,
      toolCallId,
      humeChatId: chatId,
      referenceInstant,
      source: "HUME_HISTORY_RECOVERY",
    });

    if (result.success) {
      report.applied = Number(report.applied) + 1;
      proposal["applyResult"] = "scheduled";
      proposal["resolvedLocal"] = `${result.localDate} ${result.localTime} ${result.timezone}`;
      proposal["resolvedUtc"] = result.utcTimestamp;
      proposal["bookingId"] = redact(result.booking.id);
    } else {
      proposal["applyResult"] = "skipped";
      proposal["applyReason"] = result.safeErrorCategory;
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
