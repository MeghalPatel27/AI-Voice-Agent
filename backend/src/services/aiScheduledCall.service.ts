import { prisma } from "../db/prisma";

const AI_CALL_TASK_KIND = "AI_SCHEDULED_CALL";
const AI_CALL_OWNER = "AI Caller";
type AiCallLanguage = "AUTO" | "ENGLISH" | "HINDI" | "GUJARATI";

function normalizeAiCallLanguage(value?: string | null): AiCallLanguage {
  const normalized = String(value || "AUTO")
    .toUpperCase()
    .trim();

  if (["ENGLISH", "HINDI", "GUJARATI"].includes(normalized)) {
    return normalized as AiCallLanguage;
  }

  return "AUTO";
}

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

function cleanText(value?: string | null, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizePhoneNumber(value: string) {
  return String(value || "")
    .replace(/[\s()\-]/g, "")
    .trim();
}

function buildTwilioAuthHeader() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function getPublicWebhookUrl() {
  return String(process.env.PUBLIC_WEBHOOK_URL || "")
    .trim()
    .replace(/\/$/, "");
}

function parseAiCallNotes(value?: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);

    if (parsed?.kind !== AI_CALL_TASK_KIND) return null;

    return parsed as {
      kind: typeof AI_CALL_TASK_KIND;
      version?: number;
      status?: string;
      phone?: string;
      fullName?: string;
      purpose?: string;
      notes?: string;
      preferredLanguage?: AiCallLanguage;
      scheduledAt?: string;
      createdBy?: string | null;
      conversationId?: string;
      callSid?: string;
      startedAt?: string;
      failedAt?: string;
      error?: string;
    };
  } catch {
    return null;
  }
}

async function createOrUpdateOutboundCustomer(input: {
  companyId: string;
  name?: string | null;
  phone: string;
  notes?: string | null;
}) {
  const existing = await prisma.customer.findFirst({
    where: {
      companyId: input.companyId,
      phone: input.phone,
    },
  });

  if (existing) {
    return prisma.customer.update({
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

  return prisma.customer.create({
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

async function failTask(input: {
  taskId: string;
  notes: any;
  message: string;
  conversationId?: string;
}) {
  await prisma.task.update({
    where: {
      id: input.taskId,
    },
    data: {
      status: "BLOCKED",
      blockedReason: input.message.slice(0, 450),
      conversationId: input.conversationId || undefined,
      aiNotes: JSON.stringify(
        {
          ...input.notes,
          status: "FAILED",
          failedAt: new Date().toISOString(),
          error: input.message,
        },
        null,
        2,
      ),
    },
  });
}

async function startScheduledAiCallForTask(task: any) {
  const notes = parseAiCallNotes(task.aiNotes);

  if (!notes) return { skipped: true, reason: "Not an AI scheduled call task" };

  if (!["SCHEDULED", "RETRY"].includes(String(notes.status || "SCHEDULED"))) {
    return { skipped: true, reason: `Task status is ${notes.status}` };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const twilioFromNumber = process.env.TWILIO_PHONE_NUMBER || "";
  const publicUrl = getPublicWebhookUrl();

  if (!accountSid || !authToken || !twilioFromNumber || !publicUrl) {
    await failTask({
      taskId: task.id,
      notes,
      message:
        "Twilio outbound calling is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER and PUBLIC_WEBHOOK_URL.",
    });

    return { skipped: false, failed: true, reason: "Twilio not configured" };
  }

  const phone = normalizePhoneNumber(notes.phone || task.customer?.phone || "");

  if (!phone || !phone.startsWith("+")) {
    await failTask({
      taskId: task.id,
      notes,
      message:
        "Customer phone number must include country code, example: +919586410399.",
    });

    return { skipped: false, failed: true, reason: "Invalid phone" };
  }

  const customer = task.customerId
    ? await prisma.customer.findFirst({
        where: {
          id: task.customerId,
          companyId: task.companyId,
        },
      })
    : await createOrUpdateOutboundCustomer({
        companyId: task.companyId,
        name: notes.fullName,
        phone,
        notes: [
          notes.purpose,
          notes.notes,
          `Preferred AI call language: ${getAiCallLanguageLabel(notes.preferredLanguage)}`,
        ]
          .filter(Boolean)
          .join("\n"),
      });

  const finalCustomer =
    customer ||
    (await createOrUpdateOutboundCustomer({
      companyId: task.companyId,
      name: notes.fullName,
      phone,
      notes: [
        notes.purpose,
        notes.notes,
        `Preferred AI call language: ${getAiCallLanguageLabel(notes.preferredLanguage)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    }));

  const preferredLanguage = normalizeAiCallLanguage(notes.preferredLanguage);
  const preferredLanguageLabel = getAiCallLanguageLabel(preferredLanguage);

  const scheduledAtLabel = formatDateTimeLabel(notes.scheduledAt || task.dueAt);

  const conversation = await prisma.conversation.create({
    data: {
      companyId: task.companyId,
      customerId: finalCustomer.id,
      channel: "AI_CALL",
      status: "IN_PROGRESS",
      priority: task.priority || "HIGH",
      intent: notes.purpose || "Scheduled AI requirement call",
      aiSummary: `Scheduled AI call for ${scheduledAtLabel}. Preferred language: ${preferredLanguageLabel}. Purpose: ${notes.purpose || "Collect requirements"}.`,
      nextAction: `AI is calling this lead in ${preferredLanguageLabel} to collect requirements and create a meeting request.`,
      lastMessage: `Scheduled AI call started for ${phone} at ${scheduledAtLabel}`,
      lastMessageAt: new Date(),
      humanNeeded: false,
    },
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderType: "AI",
      body: [
        "Scheduled AI call task started.",
        notes.fullName ? `Client name: ${notes.fullName}` : "",
        `Phone: ${phone}`,
        `Scheduled call time: ${scheduledAtLabel}`,
        notes.purpose ? `Purpose: ${notes.purpose}` : "",
        notes.notes ? `Notes: ${notes.notes}` : "",
        `Preferred language: ${preferredLanguageLabel}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  });

  await prisma.task.update({
    where: {
      id: task.id,
    },
    data: {
      status: "DOING",
      customerId: finalCustomer.id,
      conversationId: conversation.id,
      aiNotes: JSON.stringify(
        {
          ...notes,
          status: "CALLING",
          preferredLanguage,
          conversationId: conversation.id,
          startedAt: new Date().toISOString(),
          scheduledAtLabel,
          scheduledAtLabel,
        },
        null,
        2,
      ),
    },
  });

  const answerUrl = `${publicUrl}/api/voice/twilio/outbound-answer?conversationId=${encodeURIComponent(
    conversation.id,
  )}&preferredLanguage=${encodeURIComponent(preferredLanguage)}`;

  const body = new URLSearchParams({
    To: phone,
    From: twilioFromNumber,
    Url: answerUrl,
    Method: "POST",
    StatusCallback: `${publicUrl}/api/voice/twilio/status`,
    StatusCallbackMethod: "POST",
    Record: "true",
    RecordingChannels: "dual",
    RecordingStatusCallback: `${publicUrl}/api/voice/twilio/recording`,
    RecordingStatusCallbackMethod: "POST",
  });

  body.append("StatusCallbackEvent", "initiated");
  body.append("StatusCallbackEvent", "ringing");
  body.append("StatusCallbackEvent", "answered");
  body.append("StatusCallbackEvent", "completed");
  body.append("RecordingStatusCallbackEvent", "in-progress");
  body.append("RecordingStatusCallbackEvent", "completed");
  body.append("RecordingStatusCallbackEvent", "absent");

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: buildTwilioAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );

  const json: any = await response.json();

  if (!response.ok) {
    const errorMessage = json?.message || "Twilio outbound call failed.";

    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        status: "FOLLOW_UP",
        humanNeeded: true,
        nextAction:
          "Scheduled AI call failed. Human should call this lead manually.",
        aiSummary: `Scheduled AI call failed: ${errorMessage}`.slice(0, 500),
      },
    });

    await failTask({
      taskId: task.id,
      notes,
      conversationId: conversation.id,
      message: errorMessage,
    });

    return { skipped: false, failed: true, reason: errorMessage };
  }

  const callSid = String(json.sid || "");
  const initialTwilioStatus = String(json.status || "queued").toLowerCase();
  const initialCallStatus =
    initialTwilioStatus === "in-progress" || initialTwilioStatus === "answered"
      ? "RINGING"
      : initialTwilioStatus === "ringing" ||
          initialTwilioStatus === "queued" ||
          initialTwilioStatus === "initiated"
        ? "RINGING"
        : "RINGING";

  await prisma.call.create({
    data: {
      conversationId: conversation.id,
      phone,
      provider: "twilio",
      providerCallId: callSid || null,
      direction: "OUTBOUND",
      status: initialCallStatus,
      durationSeconds: 0,
      startedAt: new Date(),
      metadata: {
        source: "AI_SCHEDULED_CALL_TASK",
        taskId: task.id,
        purpose: notes.purpose || null,
        preferredLanguage,
        preferredLanguageLabel,
        scheduledAt: notes.scheduledAt || task.dueAt || null,
        scheduledAtLabel,
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
      conversationId: conversation.id,
      direction: "OUTBOUND",
      source: "AI_SCHEDULED_CALL_TASK",
      status: initialCallStatus,
    }),
  );

  await prisma.task.update({
    where: {
      id: task.id,
    },
    data: {
      status: "DOING",
      aiNotes: JSON.stringify(
        {
          ...notes,
          status: "RINGING",
          preferredLanguage,
          conversationId: conversation.id,
          callSid,
          startedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    },
  });

  return {
    skipped: false,
    failed: false,
    taskId: task.id,
    conversationId: conversation.id,
    callSid,
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

      if (result.skipped) {
        skipped += 1;
      } else if (result.failed) {
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

export { AI_CALL_TASK_KIND, AI_CALL_OWNER };