import { Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { deliverOutboundMessageById } from "../services/outboundDelivery.service";
import {
  pickLatestCompletedCallAnalysis,
  withPostCallAnalysis,
} from "../services/postCallAnalysisApi.service";

const inboxQuerySchema = z.object({
  filter: z
    .enum([
      "ALL",
      "NEEDS_HUMAN",
      "HOT",
      "MISSED",
      "FOLLOW_UP",
      "AI_HANDLING",
      "RESOLVED",
    ])
    .default("ALL"),
  channel: z
    .enum(["ALL", "WHATSAPP", "AI_CALL", "WEBSITE_CHAT", "EMAIL"])
    .default("ALL"),
  search: z.string().optional(),
});

const sendMessageSchema = z.object({
  body: z.string().min(1),
});

const createWhatsAppConversationSchema = z.object({
  fullName: z.string().trim().nullable().optional(),
  phone: z.string().min(5),
  initialMessage: z.string().trim().nullable().optional(),
});

const updateConversationSchema = z.object({
  status: z
    .enum([
      "NEW",
      "IN_PROGRESS",
      "FOLLOW_UP",
      "CONVERTED",
      "HUMAN_REQUIRED",
      "LOST",
    ])
    .optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  humanNeeded: z.boolean().optional(),
  aiSummary: z.string().nullable().optional(),
  nextAction: z.string().nullable().optional(),
  intent: z.string().nullable().optional(),
});

const conversationActionSchema = z.object({
  action: z.enum([
    "TAKE_OVER",
    "RETURN_TO_AI",
    "FOLLOW_UP",
    "MARK_WON",
    "MARK_LOST",
  ]),
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  dueAt: z.string().datetime().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
});

const createBookingSchema = z.object({
  title: z.string().min(1),
  dateTime: z.string().datetime().nullable().optional(),
});

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function getTomorrowEnd() {
  const date = startOfDay(new Date());
  date.setDate(date.getDate() + 2);
  return date;
}

function normalizePhone(value: string) {
  return String(value || "")
    .trim()
    .replace(/[\s()-]/g, "");
}


type AiScheduledCallData = {
  kind?: string;
  status?: string;
  phone?: string;
  fullName?: string | null;
  purpose?: string | null;
  notes?: string | null;
  preferredLanguage?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  conversationId?: string | null;
  callSid?: string | null;
  error?: string | null;
  leadRequirements?: {
    summary?: string | null;
    meetingTime?: string | null;
    meetingScheduledAt?: string | null;
    meetingStatus?: string | null;
    bookingTitle?: string | null;
    capturedAt?: string | null;
  } | null;
};

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

function parseAiScheduledCallData(value?: string | null): AiScheduledCallData | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind !== "AI_SCHEDULED_CALL") return null;
    return parsed as AiScheduledCallData;
  } catch {
    return null;
  }
}

function getScheduledCallFromConversation(conversation: any) {
  const task = [...(conversation.tasks || [])]
    .map((item: any) => ({ task: item, data: parseAiScheduledCallData(item.aiNotes) }))
    .find((item: any) => item.data);

  if (!task?.data) return null;

  const scheduledAt = task.data.scheduledAt || task.task?.dueAt || null;

  return {
    taskId: task.task.id,
    status: task.data.status || task.task.status || "SCHEDULED",
    scheduledAt,
    scheduledLabel: formatDateTimeLabel(scheduledAt),
    phone: task.data.phone || conversation.customer?.phone || null,
    fullName: task.data.fullName || conversation.customer?.fullName || null,
    purpose: task.data.purpose || task.task.description || null,
    notes: task.data.notes || null,
    preferredLanguage: task.data.preferredLanguage || null,
    startedAt: task.data.startedAt || null,
    completedAt: task.data.completedAt || null,
    callSid: task.data.callSid || null,
    error: task.data.error || null,
    meetingTime: task.data.leadRequirements?.meetingTime || null,
  };
}

function cleanRequirementLine(value?: string | null) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPreferredMeetingTimeFromText(text: string) {
  const lines = text
    .split(/\n|\.|\?|!/)
    .map(cleanRequirementLine)
    .filter(Boolean);

  // Day/time signals only — do not treat "meeting"/"schedule"/"book" as a time.
  const dayOrTimeWords = [
    "tomorrow",
    "today",
    "morning",
    "afternoon",
    "evening",
    "night",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "kal",
    "aaj",
    "subah",
    "shaam",
    "dopahar",
    "કાલે",
    "આજે",
    "સવારે",
    "સાંજે",
    "બપોરે",
    "कल",
    "आज",
    "सुबह",
    "शाम",
    "दोपहर",
  ];

  const explicitTime =
    /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?|am|pm|[ap])\b/i;

  const match = [...lines]
    .reverse()
    .find((line) => {
      const lower = line.toLowerCase();
      return (
        explicitTime.test(lower) ||
        dayOrTimeWords.some((word) => lower.includes(word))
      );
    });

  return match ? match.slice(0, 180) : null;
}

/** Parse spoken availability (incl. STT "5 p") into a concrete Date. */
function resolveMeetingDateTime(text: string | null | undefined): Date | null {
  const raw = cleanRequirementLine(text || "");
  if (!raw) return null;

  const lower = raw.toLowerCase().replace(/\./g, "");
  const now = new Date();
  const result = new Date(now);

  const timeMatch =
    lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i) ||
    lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])(?=\s|$|[,;])/i) ||
    lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i);

  let hours: number | null = null;
  let minutes = 0;
  let meridiem: string | null = null;

  if (timeMatch) {
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2] || 0);
    meridiem = timeMatch[3] ? String(timeMatch[3]).toLowerCase() : null;
  }

  if (hours !== null) {
    if (meridiem) {
      const isPm = meridiem.startsWith("p");
      const isAm = meridiem.startsWith("a");
      hours = hours % 12;
      if (isPm) hours += 12;
      if (isAm && hours === 12) hours = 0;
    } else if (hours >= 1 && hours <= 6) {
      hours += 12;
    }
  } else if (
    /morning|subah|સવારે|सुबह/.test(lower)
  ) {
    hours = 10;
  } else if (/afternoon|dopahar|બપોરે|दोपहर/.test(lower)) {
    hours = 14;
  } else if (/evening|shaam|સાંજે|शाम|night/.test(lower)) {
    hours = 17;
  } else {
    // No clock time — keep spoken text for display instead of inventing 11:00.
    return null;
  }

  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const weekdayIdx = weekdays.findIndex((day) => lower.includes(day));

  if (/tomorrow|kal|કાલે|कल/.test(lower)) {
    result.setDate(result.getDate() + 1);
  } else if (/today|aaj|આજે|आज/.test(lower)) {
    // keep today
  } else if (weekdayIdx >= 0) {
    const current = result.getDay();
    let delta = (weekdayIdx - current + 7) % 7;
    if (delta === 0) delta = 7;
    result.setDate(result.getDate() + delta);
  }

  result.setSeconds(0, 0);
  result.setHours(hours, minutes, 0, 0);

  if (result.getTime() <= now.getTime() + 30 * 60 * 1000) {
    result.setDate(result.getDate() + (weekdayIdx >= 0 ? 7 : 1));
  }

  return result;
}

function buildLeadRequirements(conversation: any) {
  const messageLines = (conversation.messages || [])
    .filter((message: any) => message.senderType === "CUSTOMER")
    .map((message: any) => cleanRequirementLine(message.body))
    .filter((body: string) => body && !body.toLowerCase().includes("incoming call started"));

  const callTranscriptLines = (conversation.calls || [])
    .map((call: any) => cleanRequirementLine(call.transcript))
    .filter(Boolean);

  const aiTaskRequirements = (conversation.tasks || [])
    .map((task: any) => parseAiScheduledCallData(task.aiNotes)?.leadRequirements?.summary)
    .filter(Boolean)
    .map((value: any) => cleanRequirementLine(value));

  const requirementCandidates = [
    ...aiTaskRequirements,
    ...messageLines,
    ...callTranscriptLines,
  ]
    .filter(Boolean)
    .filter((line: string) => {
      // Keep requirement text out of the meeting-time slot by excluding
      // pure availability lines from the requirements summary bullets.
      const asTime = extractPreferredMeetingTimeFromText(line);
      return !asTime || asTime !== line;
    })
    .slice(-10);

  const summary =
    (conversation.aiSummary &&
    !/^Lead requirements:/i.test(String(conversation.aiSummary))
      ? cleanRequirementLine(conversation.aiSummary)
      : null) ||
    requirementCandidates.slice(-6).join(" · ") ||
    "Requirements not captured yet. After the AI call, the lead requirements will appear here.";

  const allText = [...messageLines, ...callTranscriptLines].join("\n");
  const scheduledCall = getScheduledCallFromConversation(conversation);
  const bookingWithTime = (conversation.bookings || []).find(
    (booking: any) => booking.dateTime,
  );
  const latestBooking = (conversation.bookings || [])[0] || null;

  const spokenMeetingText =
    extractPreferredMeetingTimeFromText(allText) ||
    (scheduledCall?.meetingTime
      ? extractPreferredMeetingTimeFromText(String(scheduledCall.meetingTime)) ||
        null
      : null);
  const spokenResolved = resolveMeetingDateTime(spokenMeetingText);
  const meetingTimeFromSpoken = spokenResolved
    ? formatDateTimeLabel(spokenResolved)
    : spokenMeetingText;
  const meetingTimeFromBooking = bookingWithTime
    ? formatDateTimeLabel(bookingWithTime.dateTime)
    : null;

  return {
    summary,
    raw: requirementCandidates,
    // Prefer what the customer said over a stale default booking slot (e.g. 11:00).
    meetingTime: meetingTimeFromSpoken || meetingTimeFromBooking || null,
    meetingScheduledAt: spokenResolved
      ? spokenResolved.toISOString()
      : bookingWithTime?.dateTime
        ? new Date(bookingWithTime.dateTime).toISOString()
        : null,
    meetingStatus: latestBooking?.status || null,
    bookingTitle: latestBooking?.title || null,
    source:
      conversation.channel === "AI_CALL"
        ? "AI call"
        : getChannelLabel(conversation.channel),
    captured:
      requirementCandidates.length > 0 || Boolean(conversation.aiSummary),
  };
}

async function getWhatsAppSendSettings(companyId: string) {
  const settings = await prisma.companySettings.findUnique({
    where: {
      companyId,
    },
  });

  const connected = Boolean(
    settings?.whatsappProviderMode === "cloud" &&
      settings.whatsappAccessToken &&
      settings.whatsappPhoneNumberId
  );

  return {
    settings,
    connected,
  };
}

function isDelayedTask(task: { dueAt?: Date | null; status: string }) {
  if (!task.dueAt || task.status === "DONE") return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function formatCustomerName(conversation: any) {
  if (conversation.customer?.fullName) return conversation.customer.fullName;
  if (conversation.customer?.phone) return conversation.customer.phone;

  if (conversation.channel === "AI_CALL") return "Caller";
  if (conversation.channel === "WHATSAPP") return "Customer Inquiry";
  if (conversation.channel === "WEBSITE_CHAT") return "Website Visitor";

  return "Customer";
}

function getChannelLabel(channel: string) {
  if (channel === "WHATSAPP") return "WhatsApp";
  if (channel === "AI_CALL") return "Call";
  if (channel === "WEBSITE_CHAT") return "Website";
  return channel;
}

function getOwnerLabel(conversation: any) {
  const activeTask = conversation.tasks?.find((task: any) =>
    ["OPEN", "DOING", "BLOCKED"].includes(task.status)
  );

  if (activeTask?.assignedUser?.name) {
    return activeTask.assignedUser.name;
  }

  if (activeTask?.owner) {
    return activeTask.owner;
  }

  if (conversation.humanNeeded || conversation.status === "HUMAN_REQUIRED") {
    return "Unassigned";
  }

  if (["CONVERTED", "LOST"].includes(conversation.status)) {
    return "Closed";
  }

  return "AI";
}

function getOwnerType(conversation: any) {
  const activeTask = conversation.tasks?.find((task: any) =>
    ["OPEN", "DOING", "BLOCKED"].includes(task.status)
  );

  if (activeTask?.assignedUser?.name || activeTask?.owner) return "STAFF";
  if (conversation.humanNeeded || conversation.status === "HUMAN_REQUIRED") {
    return "UNASSIGNED";
  }
  if (["CONVERTED", "LOST"].includes(conversation.status)) return "CLOSED";
  return "AI";
}

function getNextAction(conversation: any) {
  if (conversation.nextAction) return conversation.nextAction;

  const missedCall = conversation.calls?.find(
    (call: any) => call.status === "MISSED"
  );

  if (missedCall) return "Call back customer";

  if (conversation.status === "HUMAN_REQUIRED" || conversation.humanNeeded) {
    return "Human should review and reply";
  }

  if (conversation.status === "FOLLOW_UP") {
    return "Follow up with customer";
  }

  if (conversation.priority === "CRITICAL" || conversation.priority === "HIGH") {
    return "Review this customer today";
  }

  if (conversation.status === "CONVERTED") return "No action needed";
  if (conversation.status === "LOST") return "No action needed";

  return "AI can continue handling";
}

function getDisplayStatus(conversation: any) {
  const missedCall = conversation.calls?.find(
    (call: any) => call.status === "MISSED"
  );

  if (missedCall) return "MISSED";
  if (conversation.status === "HUMAN_REQUIRED" || conversation.humanNeeded) {
    return "NEEDS_HUMAN";
  }
  if (conversation.status === "FOLLOW_UP") return "FOLLOW_UP";
  if (conversation.status === "CONVERTED") return "WON";
  if (conversation.status === "LOST") return "LOST";

  return "AI_HANDLING";
}

function buildConversationCard(conversation: any) {
  const latestCall = conversation.calls?.[0] || null;
  const latestMessage = conversation.messages?.[0] || null;
  const delayedTask = conversation.tasks?.find((task: any) =>
    isDelayedTask(task)
  );

  return {
    id: conversation.id,
    customerName: formatCustomerName(conversation),
    customerPhone: conversation.customer?.phone || latestCall?.phone || null,
    customerEmail: conversation.customer?.email || null,
    source: conversation.customer?.source || getChannelLabel(conversation.channel),
    channel: conversation.channel,
    channelLabel: getChannelLabel(conversation.channel),
    status: conversation.status,
    displayStatus: getDisplayStatus(conversation),
    priority: conversation.priority,
    intent: conversation.intent,
    aiConfidence: conversation.aiConfidence,
    humanNeeded: conversation.humanNeeded,
    ownerLabel: getOwnerLabel(conversation),
    ownerType: getOwnerType(conversation),
    nextAction: getNextAction(conversation),
    summary:
      conversation.aiSummary ||
      conversation.lastMessage ||
      latestMessage?.body ||
      latestCall?.transcript ||
      "No summary yet",
    lastMessage:
      conversation.lastMessage || latestMessage?.body || latestCall?.transcript || "",
    lastActivityAt:
      conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt,
    hasMissedCall: Boolean(
      conversation.calls?.find((call: any) => call.status === "MISSED")
    ),
    hasRecording: Boolean(
      conversation.calls?.find((call: any) => call.recordingUrl)
    ),
    hasTranscript: Boolean(
      conversation.calls?.find((call: any) => call.transcript)
    ),
    delayed: Boolean(delayedTask),
    delayedTaskTitle: delayedTask?.title || null,
    taskCount: conversation.tasks?.length || 0,
    bookingCount: conversation.bookings?.length || 0,
    scheduledCall: getScheduledCallFromConversation(conversation),
    leadRequirements: buildLeadRequirements(conversation),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function buildTimeline(conversation: any) {
  const items: {
    id: string;
    type: string;
    title: string;
    description: string;
    createdAt: Date;
  }[] = [];

  for (const message of conversation.messages || []) {
    items.push({
      id: message.id,
      type: "MESSAGE",
      title:
        message.senderType === "CUSTOMER"
          ? "Customer message"
          : message.senderType === "AI"
            ? "AI reply"
            : "Human reply",
      description: message.body,
      createdAt: message.createdAt,
    });
  }

  for (const call of conversation.calls || []) {
    items.push({
      id: call.id,
      type: "CALL",
      title: `${getChannelLabel(conversation.channel)} ${call.status.toLowerCase()}`,
      description:
        call.transcript ||
        call.failureReason ||
        `${call.direction || "INBOUND"} call · ${call.durationSeconds || 0}s`,
      createdAt: call.createdAt,
    });
  }

  for (const task of conversation.tasks || []) {
    items.push({
      id: task.id,
      type: "TASK",
      title: `Task ${task.status.toLowerCase()}`,
      description: task.title,
      createdAt: task.createdAt,
    });
  }

  for (const booking of conversation.bookings || []) {
    items.push({
      id: booking.id,
      type: "BOOKING",
      title: "Booking created",
      description: booking.title,
      createdAt: booking.createdAt,
    });
  }

  return items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

async function getIntegrationHealth(companyId: string) {
  const settings = await prisma.companySettings.findUnique({
    where: {
      companyId,
    },
  });

  const whatsappConnected = Boolean(
    settings?.whatsappProviderMode === "cloud" &&
      settings.whatsappPhoneNumberId &&
      settings.whatsappAccessToken
  );

  const callConnected = Boolean(
    settings?.voiceProviderMode && settings.voiceProviderMode !== "mock"
  );

  return {
    whatsapp: {
      connected: whatsappConnected,
      label: whatsappConnected ? "WhatsApp connected" : "Connect WhatsApp",
    },
    calls: {
      connected: callConnected,
      label: callConnected
        ? "Call agent active"
        : "Call agent is not active yet. Connect your call provider to handle calls automatically.",
    },
    website: {
      connected: true,
      label: "Website inbox ready",
    },
    email: {
      connected: false,
      label: "Connect Email Inbox",
    },
  };
}

function buildInboxWhere(companyId: string, query: z.infer<typeof inboxQuerySchema>) {
  const where: any = {
    companyId,
  };

  const and: any[] = [];

  if (query.channel !== "ALL" && query.channel !== "EMAIL") {
    and.push({
      channel: query.channel,
    });
  }

  if (query.search?.trim()) {
    const search = query.search.trim();

    and.push({
      OR: [
        {
          lastMessage: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          aiSummary: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          intent: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          nextAction: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          customer: {
            fullName: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
        {
          customer: {
            phone: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
        {
          customer: {
            email: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
      ],
    });
  }

  if (query.filter === "NEEDS_HUMAN") {
    and.push({
      OR: [
        {
          humanNeeded: true,
        },
        {
          status: "HUMAN_REQUIRED",
        },
      ],
    });
  }

  if (query.filter === "HOT") {
    and.push({
      priority: {
        in: ["CRITICAL", "HIGH"],
      },
      status: {
        notIn: ["CONVERTED", "LOST"],
      },
    });
  }

  if (query.filter === "MISSED") {
    and.push({
      calls: {
        some: {
          status: "MISSED",
        },
      },
    });
  }

  if (query.filter === "FOLLOW_UP") {
    and.push({
      OR: [
        {
          status: "FOLLOW_UP",
        },
        {
          tasks: {
            some: {
              status: {
                in: ["OPEN", "DOING"],
              },
              dueAt: {
                lte: getTomorrowEnd(),
              },
            },
          },
        },
      ],
    });
  }

  if (query.filter === "AI_HANDLING") {
    and.push({
      humanNeeded: false,
      status: {
        notIn: ["HUMAN_REQUIRED", "CONVERTED", "LOST"],
      },
    });
  }

  if (query.filter === "RESOLVED") {
    and.push({
      status: {
        in: ["CONVERTED", "LOST"],
      },
    });
  }

  if (query.channel === "EMAIL") {
    and.push({
      id: "__email_not_connected__",
    });
  }

  if (and.length) {
    where.AND = and;
  }

  return where;
}

export async function getInbox(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const query = inboxQuerySchema.parse(req.query);
    const companyId = req.user.companyId;
    const todayStart = startOfDay(new Date());

    const where = buildInboxWhere(companyId, query);

    const [
      conversations,
      total,
      needsHuman,
      hot,
      missed,
      followUp,
      resolved,
      integrationHealth,
    ] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: [
          {
            priority: "asc",
          },
          {
            updatedAt: "desc",
          },
        ],
        take: 80,
        include: {
          customer: true,
          messages: {
            orderBy: {
              createdAt: "desc",
            },
            take: 8,
          },
          calls: {
            orderBy: {
              createdAt: "desc",
            },
            take: 8,
          },
          tasks: {
            orderBy: {
              updatedAt: "desc",
            },
            take: 4,
            include: {
              assignedUser: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                },
              },
            },
          },
          bookings: {
            orderBy: {
              createdAt: "desc",
            },
            take: 5,
          },
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          OR: [
            {
              humanNeeded: true,
            },
            {
              status: "HUMAN_REQUIRED",
            },
          ],
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          priority: {
            in: ["CRITICAL", "HIGH"],
          },
          status: {
            notIn: ["CONVERTED", "LOST"],
          },
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          calls: {
            some: {
              status: "MISSED",
            },
          },
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          OR: [
            {
              status: "FOLLOW_UP",
            },
            {
              tasks: {
                some: {
                  status: {
                    in: ["OPEN", "DOING"],
                  },
                  dueAt: {
                    lte: getTomorrowEnd(),
                  },
                },
              },
            },
          ],
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          status: {
            in: ["CONVERTED", "LOST"],
          },
        },
      }),

      getIntegrationHealth(companyId),
    ]);

    return res.json({
      summary: {
        total,
        needsHuman,
        hot,
        missed,
        followUp,
        resolved,
        today: {
          newConversations: await prisma.conversation.count({
            where: {
              companyId,
              createdAt: {
                gte: todayStart,
              },
            },
          }),
        },
      },
      integrationHealth,
      conversations: conversations.map(buildConversationCard),
    });
  } catch (error) {
    console.error("Inbox fetch error:", error);

    return res.status(500).json({
      message: "Failed to fetch inbox",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}


export async function createWhatsAppConversation(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = createWhatsAppConversationSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid WhatsApp chat input",
        errors: result.error.flatten(),
      });
    }

    const companyId = req.user.companyId;
    const phone = normalizePhone(result.data.phone);
    const fullName = result.data.fullName?.trim() || null;
    const initialMessage = result.data.initialMessage?.trim() || "";

    if (!phone) {
      return res.status(400).json({
        message: "Phone number is required",
      });
    }

    if (initialMessage) {
      const whatsappSettings = await getWhatsAppSendSettings(companyId);

      if (!whatsappSettings.connected) {
        return res.status(400).json({
          message:
            "Real WhatsApp is not connected. Go to Settings > Channels > WhatsApp and connect Meta Cloud API before sending messages.",
        });
      }
    }

    let customer = await prisma.customer.findFirst({
      where: {
        companyId,
        phone,
      },
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          companyId,
          fullName,
          phone,
          source: "WHATSAPP",
          lastContactAt: new Date(),
        },
      });
    } else {
      customer = await prisma.customer.update({
        where: {
          id: customer.id,
        },
        data: {
          fullName: fullName || customer.fullName,
          source: customer.source || "WHATSAPP",
          lastContactAt: new Date(),
        },
      });
    }

    let conversation = await prisma.conversation.findFirst({
      where: {
        companyId,
        customerId: customer.id,
        channel: "WHATSAPP",
        status: {
          notIn: ["CONVERTED", "LOST"],
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    let created = false;

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          companyId,
          customerId: customer.id,
          channel: "WHATSAPP",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          intent: "Manual WhatsApp chat",
          aiSummary: initialMessage || "WhatsApp chat started from CRM.",
          nextAction: "Continue WhatsApp conversation from CRM.",
          lastMessage: initialMessage || `WhatsApp chat opened with ${phone}`,
          lastMessageAt: new Date(),
          humanNeeded: true,
          provider: "crm",
        },
      });

      created = true;
    }

    let message = null;

    if (initialMessage) {
      message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: "HUMAN",
          body: initialMessage,
        },
      });

      const outboundMessage = await prisma.outboundMessage.create({
        data: {
          companyId,
          conversationId: conversation.id,
          customerId: customer.id,
          channel: "WHATSAPP",
          toPhone: phone,
          body: initialMessage,
          status: "PENDING",
          provider: "whatsapp_cloud",
        },
      });

      const delivery = await deliverOutboundMessageById(outboundMessage.id);

      if (delivery.failed) {
        return res.status(502).json({
          message:
            (delivery.result as any)?.errorMessage ||
            "WhatsApp message failed to send through Meta Cloud API.",
          delivery,
        });
      }

      conversation = await prisma.conversation.update({
        where: {
          id: conversation.id,
        },
        data: {
          status: "IN_PROGRESS",
          humanNeeded: true,
          lastMessage: initialMessage,
          lastMessageAt: new Date(),
          aiSummary:
            conversation.aiSummary && conversation.aiSummary !== "WhatsApp chat started from CRM."
              ? conversation.aiSummary
              : initialMessage,
          nextAction: "Wait for customer reply or continue WhatsApp follow-up.",
        },
      });
    }

    return res.status(created ? 201 : 200).json({
      message: created ? "WhatsApp chat created" : "WhatsApp chat opened",
      created,
      customer,
      conversation,
      initialMessage: message,
    });
  } catch (error) {
    console.error("Create WhatsApp conversation error:", error);

    return res.status(500).json({
      message: "Failed to create WhatsApp chat",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getConversationDetail(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
      include: {
        customer: true,
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
        calls: {
          orderBy: {
            createdAt: "desc",
          },
          include: {
            postAnalysis: true,
          },
        },
        tasks: {
          orderBy: {
            updatedAt: "desc",
          },
          include: {
            assignedUser: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
        bookings: {
          orderBy: {
            createdAt: "desc",
          },
        },
        outboundMessages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 10,
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    return res.json({
      conversation: {
        ...buildConversationCard(conversation),
        customer: conversation.customer,
        messages: conversation.messages,
        calls: conversation.calls.map((call) => withPostCallAnalysis(call)),
        latestCallAnalysis: pickLatestCompletedCallAnalysis(conversation.calls),
        tasks: conversation.tasks.map((task: any) => ({
          ...task,
          delayed: isDelayedTask(task),
        })),
        bookings: conversation.bookings,
        outboundMessages: conversation.outboundMessages,
        timeline: buildTimeline(conversation),
      },
    });
  } catch (error) {
    console.error("Conversation detail error:", error);

    return res.status(500).json({
      message: "Failed to fetch conversation detail",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendHumanMessage(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = sendMessageSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
      include: {
        customer: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    if (conversation.channel === "WHATSAPP") {
      const whatsappSettings = await getWhatsAppSendSettings(req.user.companyId);

      if (!whatsappSettings.connected) {
        return res.status(400).json({
          message:
            "Real WhatsApp is not connected. Go to Settings > Channels > WhatsApp and connect Meta Cloud API before sending messages.",
        });
      }
    }

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: "HUMAN",
        body: result.data.body,
        provider: conversation.channel === "WHATSAPP" ? "whatsapp_cloud" : null,
        providerStatus: conversation.channel === "WHATSAPP" ? "queued" : null,
      },
    });

    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        lastMessage: result.data.body,
        lastMessageAt: new Date(),
        status:
          conversation.status === "NEW" || conversation.status === "HUMAN_REQUIRED"
            ? "IN_PROGRESS"
            : conversation.status,
        humanNeeded: true,
      },
    });

    if (
      conversation.channel === "WHATSAPP" &&
      conversation.customer?.phone
    ) {
      const outboundMessage = await prisma.outboundMessage.create({
        data: {
          companyId: req.user.companyId,
          conversationId: conversation.id,
          customerId: conversation.customerId,
          channel: "WHATSAPP",
          toPhone: conversation.customer.phone,
          body: result.data.body,
          status: "PENDING",
          provider: "whatsapp_cloud",
        },
      });

      const delivery = await deliverOutboundMessageById(outboundMessage.id);

      if (delivery.failed) {
        return res.status(502).json({
          message:
            (delivery.result as any)?.errorMessage ||
            "WhatsApp message failed to send through Meta Cloud API.",
          reply: message,
          delivery,
        });
      }
    }

    return res.status(201).json({
      message: "Reply saved",
      reply: message,
    });
  } catch (error) {
    console.error("Send human message error:", error);

    return res.status(500).json({
      message: "Failed to send reply",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateConversation(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = updateConversationSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existingConversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    const conversation = await prisma.conversation.update({
      where: {
        id: existingConversation.id,
      },
      data: result.data,
    });

    return res.json({
      message: "Conversation updated",
      conversation,
    });
  } catch (error) {
    console.error("Update conversation error:", error);

    return res.status(500).json({
      message: "Failed to update conversation",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runConversationAction(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = conversationActionSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid action",
        errors: result.error.flatten(),
      });
    }

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existingConversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    const actionData: any = {};

    if (result.data.action === "TAKE_OVER") {
      actionData.humanNeeded = true;
      actionData.status = "HUMAN_REQUIRED";
      actionData.nextAction = "Human should review and reply";
    }

    if (result.data.action === "RETURN_TO_AI") {
      actionData.humanNeeded = false;
      actionData.status = "IN_PROGRESS";
      actionData.nextAction = "AI can continue handling";
    }

    if (result.data.action === "FOLLOW_UP") {
      actionData.humanNeeded = true;
      actionData.status = "FOLLOW_UP";
      actionData.nextAction = "Follow up with customer";
    }

    if (result.data.action === "MARK_WON") {
      actionData.humanNeeded = false;
      actionData.status = "CONVERTED";
      actionData.nextAction = "No action needed";
    }

    if (result.data.action === "MARK_LOST") {
      actionData.humanNeeded = false;
      actionData.status = "LOST";
      actionData.nextAction = "No action needed";
    }

    const conversation = await prisma.conversation.update({
      where: {
        id: existingConversation.id,
      },
      data: actionData,
    });

    await prisma.message.create({
      data: {
        conversationId: existingConversation.id,
        senderType: "HUMAN",
        body: `System update: ${result.data.action.replaceAll("_", " ").toLowerCase()}`,
      },
    });

    return res.json({
      message: "Action completed",
      conversation,
    });
  } catch (error) {
    console.error("Conversation action error:", error);

    return res.status(500).json({
      message: "Failed to run action",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createConversationTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = createTaskSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid task input",
        errors: result.error.flatten(),
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
      include: {
        customer: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    let assignedUserName: string | undefined;

    if (result.data.assignedUserId) {
      const assignedUser = await prisma.user.findFirst({
        where: {
          id: result.data.assignedUserId,
          companyId: req.user.companyId,
        },
      });

      if (!assignedUser) {
        return res.status(404).json({
          message: "Assigned user not found",
        });
      }

      assignedUserName = assignedUser.name;
    }

    const task = await prisma.task.create({
      data: {
        companyId: req.user.companyId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        assignedUserId: result.data.assignedUserId || null,
        owner: assignedUserName || null,
        title: result.data.title,
        description: result.data.description || null,
        priority: result.data.priority,
        dueAt: result.data.dueAt ? new Date(result.data.dueAt) : null,
        status: "OPEN",
        aiNotes:
          conversation.aiSummary ||
          conversation.lastMessage ||
          "Created from inbox conversation",
      },
    });

    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        status: "FOLLOW_UP",
        humanNeeded: true,
        nextAction: result.data.title,
      },
    });

    return res.status(201).json({
      message: "Task created",
      task,
    });
  } catch (error) {
    console.error("Create conversation task error:", error);

    return res.status(500).json({
      message: "Failed to create task",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createConversationBooking(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = createBookingSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid booking input",
        errors: result.error.flatten(),
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    const booking = await prisma.booking.create({
      data: {
        companyId: req.user.companyId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        title: result.data.title,
        dateTime: result.data.dateTime ? new Date(result.data.dateTime) : null,
        status: "REQUESTED",
      },
    });

    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        bookingCreated: true,
        status: "IN_PROGRESS",
        nextAction: "Confirm booking with customer",
      },
    });

    return res.status(201).json({
      message: "Booking created",
      booking,
    });
  } catch (error) {
    console.error("Create conversation booking error:", error);

    return res.status(500).json({
      message: "Failed to create booking",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}