import type { Prisma, Priority } from "@prisma/client";
import { prisma } from "../db/prisma";
import { buildHumeTwilioUrl } from "../integrations/hume/hume.config";
import {
  noDialScheduledCallAdapter,
  twilioScheduledCallDialAdapter,
  type ScheduledCallDialAdapter,
} from "./aiScheduledCallDial";
import {
  AI_CALL_OWNER,
  AI_CALL_TASK_KIND,
  normalizeLanguage as normalizeAiCallLanguage,
  normalizePhoneNumber,
  parseScheduledCallContext,
  stringifyScheduledCallContext,
} from "./aiScheduledCallContext";

type DbClient = Prisma.TransactionClient | typeof prisma;

function getAiCallLanguageLabel(value?: string | null) {
  const language = normalizeAiCallLanguage(value);

  if (language === "HINDI") return "Hindi";
  if (language === "GUJARATI") return "Gujarati";
  if (language === "ENGLISH") return "English";

  return "Auto-detect customer language";
}

function formatDateTimeLabel(value?: string | Date | null) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPublicWebhookUrl() {
  return String(process.env.PUBLIC_WEBHOOK_URL || "")
    .trim()
    .replace(/\/$/, "");
}

const parseAiCallNotes = parseScheduledCallContext;

async function createOrUpdateOutboundCustomer(
  input: {
    companyId: string;
    name?: string | null;
    phone: string;
    notes?: string | null;
  },
  client: DbClient = prisma,
) {
  const existing = await client.customer.findFirst({
    where: {
      companyId: input.companyId,
      phone: input.phone,
    },
  });

  if (existing) {
    return client.customer.update({
      where: {
        id: existing.id,
      },
      data: {
        fullName: input.name || existing.fullName || input.phone,
        notes:
          [existing.notes, input.notes].filter(Boolean).join("\n\n") ||
          existing.notes,
        lastContactAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  }

  return client.customer.create({
    data: {
      companyId: input.companyId,
      fullName: input.name || input.phone,
      phone: input.phone,
      source: "AI Scheduled Call",
      leadStage: "NEW",
      leadScore: 55,
      notes: input.notes || null,
      lastContactAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

async function failTask(
  input: {
    taskId: string;
    notes: ReturnType<typeof parseScheduledCallContext>;
    message: string;
    conversationId?: string;
  },
  client: DbClient = prisma,
) {
  if (!input.notes) return;

  await client.task.update({
    where: {
      id: input.taskId,
    },
    data: {
      status: "BLOCKED",
      blockedReason: input.message.slice(0, 450),
      conversationId: input.conversationId || undefined,
      aiNotes: stringifyScheduledCallContext({
        ...input.notes,
        status: "FAILED",
        failedAt: new Date().toISOString(),
        error: input.message,
      }),
    },
  });
}

export type PrepareScheduledAiCallResult =
  | { skipped: true; reason: string }
  | { skipped: false; failed: true; reason: string }
  | {
      skipped: false;
      failed: false;
      taskId: string;
      conversationId: string;
      callId: string;
      phone: string;
      notes: NonNullable<ReturnType<typeof parseScheduledCallContext>>;
    };

export async function prepareScheduledAiCallForTask(
  task: {
    id: string;
    companyId: string;
    customerId?: string | null;
    dueAt?: Date | null;
    priority?: string | null;
    aiNotes?: string | null;
    customer?: { id: string; phone?: string | null; fullName?: string | null } | null;
  },
  options?: {
    client?: DbClient;
    verificationOnly?: boolean;
  },
): Promise<PrepareScheduledAiCallResult> {
  const client = options?.client || prisma;
  const notes = parseAiCallNotes(task.aiNotes);

  if (!notes) return { skipped: true, reason: "Not an AI scheduled call task" };

  if (!["SCHEDULED", "RETRY"].includes(String(notes.status || "SCHEDULED"))) {
    return { skipped: true, reason: `Task status is ${notes.status}` };
  }

  if (notes.callSid || notes.conversationId) {
    const existingCall = await client.call.findFirst({
      where: {
        OR: [
          notes.callSid ? { twilioCallSid: notes.callSid } : undefined,
          notes.conversationId ? { conversationId: notes.conversationId } : undefined,
        ].filter(Boolean) as Array<{ twilioCallSid?: string; conversationId?: string }>,
      },
      select: { id: true },
    });
    if (existingCall) {
      return { skipped: true, reason: "Call already created for task" };
    }
  }

  const phone = normalizePhoneNumber(notes.phone || task.customer?.phone || "");

  if (!phone || !phone.startsWith("+")) {
    await failTask(
      {
        taskId: task.id,
        notes,
        message:
          "Customer phone number must include country code, example: +919586410399.",
      },
      client,
    );

    return { skipped: false, failed: true, reason: "Invalid phone" };
  }

  const customer = task.customerId
    ? await client.customer.findFirst({
        where: {
          id: task.customerId,
          companyId: task.companyId,
        },
      })
    : await createOrUpdateOutboundCustomer(
        {
          companyId: task.companyId,
          name: notes.fullName,
          phone,
          notes: [
            notes.collectionGoal || notes.callPurpose,
            notes.extraNotes,
            `Preferred AI call language: ${getAiCallLanguageLabel(notes.preferredLanguage)}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
        client,
      );

  const finalCustomer =
    customer ||
    (await createOrUpdateOutboundCustomer(
      {
        companyId: task.companyId,
        name: notes.fullName,
        phone,
        notes: [
          notes.collectionGoal || notes.callPurpose,
          notes.extraNotes,
          `Preferred AI call language: ${getAiCallLanguageLabel(notes.preferredLanguage)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
      client,
    ));

  const preferredLanguage = normalizeAiCallLanguage(notes.preferredLanguage);
  const preferredLanguageLabel = getAiCallLanguageLabel(preferredLanguage);
  const scheduledAtLabel = formatDateTimeLabel(notes.scheduledAt || task.dueAt);

  const conversation = await client.conversation.create({
    data: {
      companyId: task.companyId,
      customerId: finalCustomer.id,
      channel: "AI_CALL",
      status: "IN_PROGRESS",
      priority: (task.priority as Priority | null) || "HIGH",
      intent: notes.callPurpose || notes.collectionGoal || "Scheduled AI requirement call",
      aiSummary: `Scheduled AI call for ${scheduledAtLabel}. Preferred language: ${preferredLanguageLabel}. Objective: ${notes.collectionGoal || notes.callPurpose || "Collect requirements"}.`,
      nextAction: `AI is calling this lead in ${preferredLanguageLabel} to collect requirements and create a meeting request.`,
      lastMessage: `Scheduled AI call prepared for ${phone} at ${scheduledAtLabel}`,
      lastMessageAt: new Date(),
      humanNeeded: false,
    },
  });

  await client.message.create({
    data: {
      conversationId: conversation.id,
      senderType: "AI",
      body: [
        "Scheduled AI call task started.",
        notes.fullName ? `Client name: ${notes.fullName}` : "",
        `Phone: ${phone}`,
        `Scheduled call time: ${scheduledAtLabel}`,
        notes.collectionGoal ? `Collection goal: ${notes.collectionGoal}` : "",
        notes.callPurpose ? `Call purpose: ${notes.callPurpose}` : "",
        notes.extraNotes ? `Private notes: ${notes.extraNotes}` : "",
        `Preferred language: ${preferredLanguageLabel}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  });

  const call = await client.call.create({
    data: {
      conversationId: conversation.id,
      phone,
      provider: "twilio",
      providerCallId: null,
      twilioCallSid: null,
      telephonyProvider: "TWILIO",
      voiceAgentProvider: "HUME_EVI",
      humeConfigId: process.env.HUME_CONFIG_ID || null,
      direction: "OUTBOUND",
      status: "RINGING",
      durationSeconds: 0,
      startedAt: new Date(),
      recordingSource: "HUME",
      recordingReconstructionStatus: "NOT_REQUESTED",
      purpose: notes.collectionGoal || notes.callPurpose || null,
      notes: notes.extraNotes || null,
      preferredLanguage,
      preferredCallTime: notes.scheduledAt ? new Date(notes.scheduledAt) : null,
      summary: `Scheduled AI call objective: ${notes.collectionGoal || notes.callPurpose || "Collect requirements"}`.slice(
        0,
        500,
      ),
      metadata: {
        source: options?.verificationOnly
          ? "DEV_SCHEDULED_CONTEXT_VERIFICATION"
          : "AI_SCHEDULED_CALL_TASK",
        taskId: task.id,
        collectionGoal: notes.collectionGoal || null,
        callPurpose: notes.callPurpose || null,
        extraNotes: notes.extraNotes || null,
        timezone: notes.timezone || "Asia/Kolkata",
        preferredLanguage,
        preferredLanguageLabel,
        scheduledAt: notes.scheduledAt || task.dueAt || null,
        scheduledAtLabel,
        verificationOnly: Boolean(options?.verificationOnly),
      },
    },
  });

  await client.task.update({
    where: {
      id: task.id,
    },
    data: {
      status: "DOING",
      customerId: finalCustomer.id,
      conversationId: conversation.id,
      aiNotes: stringifyScheduledCallContext({
        ...notes,
        status: "CALLING",
        preferredLanguage,
        conversationId: conversation.id,
        startedAt: new Date().toISOString(),
      }),
    },
  });

  return {
    skipped: false,
    failed: false,
    taskId: task.id,
    conversationId: conversation.id,
    callId: call.id,
    phone,
    notes,
  };
}

async function dialPreparedScheduledAiCall(input: {
  taskId: string;
  conversationId: string;
  callId: string;
  phone: string;
  notes: NonNullable<ReturnType<typeof parseScheduledCallContext>>;
  dialAdapter: ScheduledCallDialAdapter;
  client?: DbClient;
}) {
  const client = input.client || prisma;
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const twilioFromNumber = process.env.TWILIO_PHONE_NUMBER || "";
  const publicUrl = getPublicWebhookUrl();

  if (!accountSid || !authToken || !twilioFromNumber || !publicUrl) {
    await failTask(
      {
        taskId: input.taskId,
        notes: input.notes,
        conversationId: input.conversationId,
        message:
          "Twilio outbound calling is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER and PUBLIC_WEBHOOK_URL.",
      },
      client,
    );

    return { failed: true, reason: "Twilio not configured" };
  }

  const answerUrl = buildHumeTwilioUrl();
  const dialResult = await input.dialAdapter.dial({
    phone: input.phone,
    fromNumber: twilioFromNumber,
    answerUrl,
    statusCallbackUrl: `${publicUrl}/api/voice/twilio/status`,
    accountSid,
    authToken,
  });

  if (!dialResult.ok) {
    await client.conversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        status: "FOLLOW_UP",
        humanNeeded: true,
        nextAction:
          "Scheduled AI call failed. Human should call this lead manually.",
        aiSummary: `Scheduled AI call failed: ${dialResult.error}`.slice(0, 500),
      },
    });

    await failTask(
      {
        taskId: input.taskId,
        notes: input.notes,
        conversationId: input.conversationId,
        message: dialResult.error,
      },
      client,
    );

    return { failed: true, reason: dialResult.error };
  }

  const callSid = dialResult.callSid;
  const initialTwilioStatus = dialResult.initialStatus;
  const initialCallStatus = "RINGING";

  await client.call.update({
    where: { id: input.callId },
    data: {
      providerCallId: callSid || null,
      twilioCallSid: callSid || null,
      status: initialCallStatus,
    },
  });

  const existingCall = await client.call.findUnique({
    where: { id: input.callId },
    select: { metadata: true },
  });
  const existingMeta = (existingCall?.metadata as Record<string, unknown> | null) || {};

  await client.call.update({
    where: { id: input.callId },
    data: {
      metadata: {
        ...existingMeta,
        twilioInitialStatus: initialTwilioStatus,
        twilioStatus: initialTwilioStatus,
      },
    },
  });

  console.log(
    JSON.stringify({
      scope: "voice_lifecycle",
      event: "call_initiated",
      at: new Date().toISOString(),
      callSid,
      conversationId: input.conversationId,
      direction: "OUTBOUND",
      source: "AI_SCHEDULED_CALL_TASK",
      status: initialCallStatus,
    }),
  );

  await client.task.update({
    where: {
      id: input.taskId,
    },
    data: {
      status: "DOING",
      aiNotes: stringifyScheduledCallContext({
        ...input.notes,
        status: "RINGING",
        preferredLanguage: normalizeAiCallLanguage(input.notes.preferredLanguage),
        conversationId: input.conversationId,
        callSid,
        startedAt: new Date().toISOString(),
      }),
    },
  });

  return {
    failed: false,
    taskId: input.taskId,
    conversationId: input.conversationId,
    callSid,
  };
}

async function startScheduledAiCallForTask(
  task: Parameters<typeof prepareScheduledAiCallForTask>[0],
  dialAdapter: ScheduledCallDialAdapter = twilioScheduledCallDialAdapter,
) {
  const prepared = await prepareScheduledAiCallForTask(task);
  if (prepared.skipped) {
    return prepared;
  }
  if (prepared.failed) {
    return prepared;
  }

  const dial = await dialPreparedScheduledAiCall({
    taskId: prepared.taskId,
    conversationId: prepared.conversationId,
    callId: prepared.callId,
    phone: prepared.phone,
    notes: prepared.notes,
    dialAdapter,
  });

  if (dial.failed) {
    return { skipped: false, failed: true, reason: dial.reason };
  }

  return {
    skipped: false,
    failed: false,
    taskId: dial.taskId,
    conversationId: dial.conversationId,
    callSid: dial.callSid,
  };
}

export async function runAiScheduledCallWorkerOnce(limit = 10) {
  const dueTasks = await prisma.task.findMany({
    where: {
      status: "OPEN",
      owner: AI_CALL_OWNER,
      dueAt: {
        lte: new Date(),
      },
      aiNotes: {
        contains: AI_CALL_TASK_KIND,
      },
    },
    orderBy: {
      dueAt: "asc",
    },
    take: limit,
    include: {
      customer: true,
    },
  });

  let started = 0;
  let failed = 0;
  let skipped = 0;

  for (const task of dueTasks) {
    try {
      const result = await startScheduledAiCallForTask(task);

      if ("skipped" in result && result.skipped) {
        skipped += 1;
      } else if ("failed" in result && result.failed) {
        failed += 1;
      } else {
        started += 1;
      }
    } catch (error) {
      failed += 1;
      console.error("[AI Scheduled Call Worker] Task failed:", task.id, error);
    }
  }

  return {
    totalPicked: dueTasks.length,
    started,
    failed,
    skipped,
  };
}

export {
  AI_CALL_TASK_KIND,
  AI_CALL_OWNER,
  noDialScheduledCallAdapter,
  prepareScheduledAiCallForTask as prepareScheduledAiCallRecords,
};
