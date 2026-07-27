import { Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import { pickLatestCompletedCallAnalysis } from "../services/postCallAnalysisApi.service";

const leadQuerySchema = z.object({
  filter: z
    .enum([
      "ALL",
      "NEW",
      "HOT",
      "FOLLOW_UP_DUE",
      "MEETING_BOOKED",
      "QUOTATION_SENT",
      "WON",
      "LOST",
    ])
    .default("ALL"),
  source: z.string().default("ALL"),
  owner: z.string().default("ALL"),
  view: z.enum(["LIST", "PIPELINE"]).default("LIST"),
  search: z.string().optional(),
});

const createLeadSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().min(5),
  email: z.string().email().optional().nullable(),
  source: z.string().optional().nullable(),
  requirement: z.string().optional().nullable(),
});

const updateLeadSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().min(5).optional(),
  email: z.string().email().nullable().optional(),
  source: z.string().nullable().optional(),

  stage: z
    .enum([
      "NEW",
      "QUALIFIED",
      "FOLLOW_UP",
      "MEETING_BOOKED",
      "QUOTATION_SENT",
      "WON",
      "LOST",
    ])
    .optional(),

  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  nextAction: z.string().nullable().optional(),
  intent: z.string().nullable().optional(),
  aiSummary: z.string().nullable().optional(),
  humanNeeded: z.boolean().optional(),
});

const leadActionSchema = z.object({
  action: z.enum([
    "QUALIFY",
    "TAKE_OVER",
    "RETURN_TO_AI",
    "SET_FOLLOW_UP",
    "BOOK_MEETING",
    "MARK_WON",
    "MARK_LOST",
  ]),
  note: z.string().optional().nullable(),
  dueAt: z.string().datetime().optional().nullable(),
});

const createLeadTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  dueAt: z.string().datetime().optional().nullable(),
  assignedUserId: z.string().optional().nullable(),
});

const createLeadBookingSchema = z.object({
  title: z.string().min(1),
  dateTime: z.string().datetime().optional().nullable(),
});

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getTomorrowEnd() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  date.setDate(date.getDate() + 1);
  return date;
}

function isTaskDelayed(task: { dueAt?: Date | null; status: string }) {
  if (!task.dueAt || task.status === "DONE") return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function getSourceLabel(source?: string | null, channel?: string | null) {
  if (source) return source;
  if (channel === "WHATSAPP") return "WhatsApp";
  if (channel === "AI_CALL") return "Call";
  if (channel === "WEBSITE_CHAT") return "Website";
  return "Manual";
}

function getLatestConversation(customer: any) {
  return customer.conversations?.[0] || null;
}

function getLeadStage(customer: any) {
  const conversation = getLatestConversation(customer);

  if (!conversation) return "NEW";

  if (conversation.status === "CONVERTED") return "WON";
  if (conversation.status === "LOST") return "LOST";

  if (conversation.bookings?.length > 0 || conversation.bookingCreated) {
    return "MEETING_BOOKED";
  }

  if (conversation.status === "FOLLOW_UP") return "FOLLOW_UP";

  if (
    conversation.status === "IN_PROGRESS" ||
    conversation.status === "HUMAN_REQUIRED"
  ) {
    return "QUALIFIED";
  }

  return "NEW";
}

function getStageLabel(stage: string) {
  const labels: Record<string, string> = {
    NEW: "New Inquiry",
    QUALIFIED: "Qualified",
    FOLLOW_UP: "Follow-up",
    MEETING_BOOKED: "Meeting Booked",
    QUOTATION_SENT: "Quotation Sent",
    WON: "Won",
    LOST: "Lost",
  };

  return labels[stage] || stage;
}

function getHandlingStatus(customer: any) {
  const conversation = getLatestConversation(customer);

  if (!conversation) return "Unassigned";

  if (conversation.status === "CONVERTED" || conversation.status === "LOST") {
    return "Closed";
  }

  if (conversation.humanNeeded || conversation.status === "HUMAN_REQUIRED") {
    return "Human Needed";
  }

  return "AI Handling";
}

function getOwner(customer: any) {
  const conversation = getLatestConversation(customer);

  const activeTask = conversation?.tasks?.find((task: any) =>
    ["OPEN", "DOING", "BLOCKED"].includes(task.status)
  );

  if (activeTask?.assignedUser?.name) {
    return {
      label: activeTask.assignedUser.name,
      type: "STAFF",
      id: activeTask.assignedUser.id,
    };
  }

  if (activeTask?.owner) {
    return {
      label: activeTask.owner,
      type: "STAFF",
      id: null,
    };
  }

  if (
    conversation?.humanNeeded ||
    conversation?.status === "HUMAN_REQUIRED"
  ) {
    return {
      label: "Unassigned",
      type: "UNASSIGNED",
      id: null,
    };
  }

  if (
    conversation?.status === "CONVERTED" ||
    conversation?.status === "LOST"
  ) {
    return {
      label: "Closed",
      type: "CLOSED",
      id: null,
    };
  }

  return {
    label: "AI",
    type: "AI",
    id: null,
  };
}

function getFollowUpTask(customer: any) {
  const conversation = getLatestConversation(customer);

  const allTasks = [
    ...(customer.tasks || []),
    ...(conversation?.tasks || []),
  ];

  const openTasks = allTasks
    .filter((task: any) => ["OPEN", "DOING", "BLOCKED"].includes(task.status))
    .sort((a: any, b: any) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });

  return openTasks[0] || null;
}

function getNextAction(customer: any) {
  const conversation = getLatestConversation(customer);
  const stage = getLeadStage(customer);
  const followUpTask = getFollowUpTask(customer);

  if (conversation?.nextAction) return conversation.nextAction;

  if (followUpTask?.title) return followUpTask.title;

  if (stage === "FOLLOW_UP") return "Follow up with customer";
  if (stage === "MEETING_BOOKED") return "Prepare for meeting";
  if (stage === "WON") return "No action needed";
  if (stage === "LOST") return "No action needed";

  if (
    conversation?.humanNeeded ||
    conversation?.status === "HUMAN_REQUIRED"
  ) {
    return "Human should review this lead";
  }

  if (
    conversation?.priority === "CRITICAL" ||
    conversation?.priority === "HIGH"
  ) {
    return "Review this lead today";
  }

  return "Qualify this inquiry";
}

function getLastActivity(customer: any) {
  const conversation = getLatestConversation(customer);

  return (
    conversation?.lastMessageAt ||
    conversation?.updatedAt ||
    customer.updatedAt ||
    customer.createdAt
  );
}

function getLeadScore(customer: any) {
  const conversation = getLatestConversation(customer);
  const stage = getLeadStage(customer);
  const followUpTask = getFollowUpTask(customer);

  let score = conversation?.aiConfidence || 0;
  const reasons: string[] = [];

  if (!score) {
    score = 35;
    reasons.push("Basic lead created but AI confidence is not available yet");
  }

  if (
    conversation?.priority === "CRITICAL" ||
    conversation?.priority === "HIGH"
  ) {
    score += 12;
    reasons.push("Marked as high-priority lead");
  }

  if (stage === "MEETING_BOOKED") {
    score += 18;
    reasons.push("Meeting or booking is already created");
  }

  if (stage === "FOLLOW_UP") {
    score += 8;
    reasons.push("Lead is active and needs follow-up");
  }

  if (followUpTask?.dueAt) {
    reasons.push("Follow-up task exists");
  }

  if (conversation?.lastMessageAt) {
    const days =
      (Date.now() - new Date(conversation.lastMessageAt).getTime()) / 86400000;

    if (days <= 2) {
      score += 8;
      reasons.push("Customer activity is recent");
    }
  }

  if (conversation?.intent) {
    score += 5;
    reasons.push(`Intent detected: ${conversation.intent}`);
  }

  if (conversation?.humanNeeded) {
    reasons.push("Needs human attention before the lead gets cold");
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));

  let label = "Weak";
  if (finalScore >= 80) label = "Strong";
  else if (finalScore >= 60) label = "Warm";
  else if (finalScore >= 40) label = "Medium";

  return {
    score: finalScore,
    label,
    reasons,
  };
}

function getWarnings(customer: any, duplicatePhones: Set<string>) {
  const warnings: string[] = [];
  const conversation = getLatestConversation(customer);
  const stage = getLeadStage(customer);
  const followUpTask = getFollowUpTask(customer);

  if (stage === "FOLLOW_UP" && !followUpTask?.dueAt) {
    warnings.push("Follow-up date missing");
  }

  if (followUpTask && isTaskDelayed(followUpTask)) {
    warnings.push("Follow-up overdue");
  }

  if (
    conversation?.priority === "HIGH" ||
    conversation?.priority === "CRITICAL"
  ) {
    const lastActivity = getLastActivity(customer);
    const hours =
      (Date.now() - new Date(lastActivity).getTime()) / 3600000;

    if (hours > 24 && !["CONVERTED", "LOST"].includes(conversation.status)) {
      warnings.push("Hot lead untouched for 24h+");
    }
  }

  if (customer.phone && duplicatePhones.has(customer.phone)) {
    warnings.push("Possible duplicate phone number");
  }

  return warnings;
}

function buildLeadRow(customer: any, duplicatePhones: Set<string>) {
  const conversation = getLatestConversation(customer);
  const stage = getLeadStage(customer);
  const score = getLeadScore(customer);
  const owner = getOwner(customer);
  const followUpTask = getFollowUpTask(customer);
  const warnings = getWarnings(customer, duplicatePhones);

  return {
    id: customer.id,
    name: customer.fullName || customer.phone || "Customer",
    phone: customer.phone,
    email: customer.email,
    source: getSourceLabel(customer.source, conversation?.channel),
    channel: conversation?.channel || null,

    stage,
    stageLabel: getStageLabel(stage),
    handlingStatus: getHandlingStatus(customer),

    priority: conversation?.priority || "MEDIUM",
    ownerLabel: owner.label,
    ownerType: owner.type,
    ownerId: owner.id,

    nextAction: getNextAction(customer),
    followUpAt: followUpTask?.dueAt || null,
    followUpTaskTitle: followUpTask?.title || null,

    estimatedDealValue: null,
    dealValueStatus: "Not set",

    lastActivityAt: getLastActivity(customer),
    summary:
      conversation?.aiSummary ||
      conversation?.lastMessage ||
      "No summary saved yet",
    intent: conversation?.intent || null,

    latestCallAnalysis: pickLatestCompletedCallAnalysis(
      (customer.conversations || []).flatMap(
        (item: any) => item.calls || [],
      ),
    ),

    aiScore: score.score,
    aiScoreLabel: score.label,
    aiScoreReasons: score.reasons,

    warnings,

    meetingBooked:
      stage === "MEETING_BOOKED" ||
      Boolean(conversation?.bookingCreated) ||
      Boolean(conversation?.bookings?.length),

    totalConversations: customer.conversations?.length || 0,
    totalTasks: customer.tasks?.length || 0,
    totalBookings: customer.bookings?.length || 0,

    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

function buildTimeline(customer: any) {
  const items: {
    id: string;
    type: string;
    title: string;
    description: string;
    createdAt: Date;
  }[] = [];

  for (const conversation of customer.conversations || []) {
    items.push({
      id: conversation.id,
      type: "CONVERSATION",
      title: `${conversation.channel.replaceAll("_", " ")} conversation`,
      description:
        conversation.aiSummary ||
        conversation.lastMessage ||
        "Conversation started",
      createdAt: conversation.createdAt,
    });

    for (const message of conversation.messages || []) {
      items.push({
        id: message.id,
        type: "MESSAGE",
        title:
          message.senderType === "CUSTOMER"
            ? "Customer message"
            : message.senderType === "AI"
              ? "AI replied"
              : "Human replied",
        description: message.body,
        createdAt: message.createdAt,
      });
    }

    for (const call of conversation.calls || []) {
      items.push({
        id: call.id,
        type: "CALL",
        title: `Call ${call.status.toLowerCase()}`,
        description:
          call.transcript ||
          call.failureReason ||
          `${call.direction || "INBOUND"} call · ${call.durationSeconds}s`,
        createdAt: call.createdAt,
      });
    }
  }

  for (const task of customer.tasks || []) {
    items.push({
      id: task.id,
      type: "TASK",
      title: `Task ${task.status.toLowerCase()}`,
      description: task.title,
      createdAt: task.createdAt,
    });
  }

  for (const booking of customer.bookings || []) {
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

function conversationStatusFromStage(stage: string) {
  if (stage === "NEW") return "NEW";
  if (stage === "QUALIFIED") return "IN_PROGRESS";
  if (stage === "FOLLOW_UP") return "FOLLOW_UP";
  if (stage === "MEETING_BOOKED") return "IN_PROGRESS";
  if (stage === "WON") return "CONVERTED";
  if (stage === "LOST") return "LOST";

  return "IN_PROGRESS";
}

function buildLeadWhere(
  companyId: string,
  query: z.infer<typeof leadQuerySchema>
) {
  const where: any = {
    companyId,
  };

  const and: any[] = [];

  if (query.search?.trim()) {
    const search = query.search.trim();

    and.push({
      OR: [
        {
          fullName: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          phone: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          source: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          conversations: {
            some: {
              OR: [
                {
                  aiSummary: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  lastMessage: {
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
              ],
            },
          },
        },
      ],
    });
  }

  if (query.source !== "ALL") {
    and.push({
      OR: [
        {
          source: query.source,
        },
        {
          conversations: {
            some: {
              channel: query.source,
            },
          },
        },
      ],
    });
  }

  if (query.filter === "NEW") {
    and.push({
      conversations: {
        some: {
          status: "NEW",
        },
      },
    });
  }

  if (query.filter === "HOT") {
    and.push({
      conversations: {
        some: {
          priority: {
            in: ["CRITICAL", "HIGH"],
          },
          status: {
            notIn: ["CONVERTED", "LOST"],
          },
        },
      },
    });
  }

  if (query.filter === "FOLLOW_UP_DUE") {
    and.push({
      OR: [
        {
          conversations: {
            some: {
              status: "FOLLOW_UP",
            },
          },
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

  if (query.filter === "MEETING_BOOKED") {
    and.push({
      OR: [
        {
          bookings: {
            some: {},
          },
        },
        {
          conversations: {
            some: {
              bookingCreated: true,
            },
          },
        },
      ],
    });
  }

  if (query.filter === "QUOTATION_SENT") {
    and.push({
      OR: [
        { leadStage: "QUOTATION_SENT" },
        {
          bookings: {
            some: {
              proposalSent: true,
            },
          },
        },
      ],
    });
  }

  if (query.filter === "WON") {
    and.push({
      conversations: {
        some: {
          status: "CONVERTED",
        },
      },
    });
  }

  if (query.filter === "LOST") {
    and.push({
      conversations: {
        some: {
          status: "LOST",
        },
      },
    });
  }

  if (and.length) {
    where.AND = and;
  }

  return where;
}

async function getDuplicatePhones(companyId: string) {
  const customers = await prisma.customer.findMany({
    where: {
      companyId,
      phone: {
        not: "",
      },
    },
    select: {
      phone: true,
    },
  });

  const count = new Map<string, number>();

  for (const customer of customers) {
    count.set(customer.phone, (count.get(customer.phone) || 0) + 1);
  }

  return new Set(
    Array.from(count.entries())
      .filter(([, total]) => total > 1)
      .map(([phone]) => phone)
  );
}

async function getCustomerInclude() {
  return {
    conversations: {
      orderBy: {
        updatedAt: "desc" as const,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "desc" as const,
          },
          take: 8,
        },
        calls: {
          orderBy: {
            createdAt: "desc" as const,
          },
          take: 5,
          include: {
            postAnalysis: true,
          },
        },
        tasks: {
          orderBy: {
            updatedAt: "desc" as const,
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
            createdAt: "desc" as const,
          },
        },
      },
    },
    tasks: {
      orderBy: {
        updatedAt: "desc" as const,
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
        createdAt: "desc" as const,
      },
    },
  };
}

function buildSourceBreakdown(leads: any[]) {
  const groups = new Map<
    string,
    {
      source: string;
      leads: number;
      hot: number;
      meetings: number;
      won: number;
      lost: number;
    }
  >();

  for (const lead of leads) {
    const source = lead.source || "Manual";

    const current =
      groups.get(source) ||
      {
        source,
        leads: 0,
        hot: 0,
        meetings: 0,
        won: 0,
        lost: 0,
      };

    current.leads += 1;

    if (lead.priority === "HIGH" || lead.priority === "CRITICAL") {
      current.hot += 1;
    }

    if (lead.stage === "MEETING_BOOKED") {
      current.meetings += 1;
    }

    if (lead.stage === "WON") {
      current.won += 1;
    }

    if (lead.stage === "LOST") {
      current.lost += 1;
    }

    groups.set(source, current);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    conversionRate: group.leads
      ? Math.round((group.won / group.leads) * 100)
      : 0,
  }));
}

export async function getLeads(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const query = leadQuerySchema.parse(req.query);
    const companyId = req.user.companyId;

    const include = await getCustomerInclude();
    const where = buildLeadWhere(companyId, query);

    const [customers, duplicatePhones, teamMembers] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: {
          updatedAt: "desc",
        },
        take: 200,
        include,
      }),

      getDuplicatePhones(companyId),

      prisma.user.findMany({
        where: {
          companyId,
        },
        orderBy: {
          name: "asc",
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      }),
    ]);

    const leads = customers.map((customer) =>
      buildLeadRow(customer, duplicatePhones)
    );

    const visibleLeads =
      query.owner === "ALL"
        ? leads
        : leads.filter((lead) => {
            if (query.owner === "AI") return lead.ownerType === "AI";
            if (query.owner === "UNASSIGNED") {
              return lead.ownerType === "UNASSIGNED";
            }
            return lead.ownerId === query.owner;
          });

    const todayPriority = visibleLeads
      .filter(
        (lead) =>
          lead.warnings.length > 0 ||
          lead.priority === "CRITICAL" ||
          lead.priority === "HIGH" ||
          lead.stage === "FOLLOW_UP"
      )
      .sort((a, b) => b.aiScore - a.aiScore)
      .slice(0, 6);

    const summary = {
      total: visibleLeads.length,
      needsFollowUp: visibleLeads.filter(
        (lead) =>
          lead.stage === "FOLLOW_UP" ||
          lead.warnings.includes("Follow-up overdue") ||
          lead.warnings.includes("Follow-up date missing")
      ).length,
      hot: visibleLeads.filter(
        (lead) => lead.priority === "CRITICAL" || lead.priority === "HIGH"
      ).length,
      meetingsBooked: visibleLeads.filter(
        (lead) => lead.stage === "MEETING_BOOKED"
      ).length,
      wonThisMonth: visibleLeads.filter(
        (lead) =>
          lead.stage === "WON" &&
          new Date(lead.updatedAt).getTime() >=
            startOfMonth(new Date()).getTime()
      ).length,
      pipelineValue: {
        connected: false,
        total: null,
        message: "Deal value fields are not added yet.",
      },
    };

    const pipeline = [
      "NEW",
      "QUALIFIED",
      "FOLLOW_UP",
      "MEETING_BOOKED",
      "QUOTATION_SENT",
      "WON",
      "LOST",
    ].map((stage) => ({
      stage,
      stageLabel: getStageLabel(stage),
      leads: visibleLeads.filter((lead) => lead.stage === stage),
    }));

    return res.json({
      summary,
      leads: visibleLeads,
      todayPriority,
      pipeline,
      sourceBreakdown: buildSourceBreakdown(visibleLeads),
      teamMembers,
      modules: {
        quotationEnabled: false,
        dealValueEnabled: false,
        csvImportEnabled: false,
      },
    });
  } catch (error) {
    console.error("Get leads error:", error);

    return res.status(500).json({
      message: "Failed to fetch leads",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getLeadDetail(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const include = await getCustomerInclude();

    const customer = await prisma.customer.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
      include,
    });

    if (!customer) {
      return res.status(404).json({
        message: "Lead not found",
      });
    }

    const duplicatePhones = await getDuplicatePhones(req.user.companyId);
    const lead = buildLeadRow(customer, duplicatePhones);

    return res.json({
      lead: {
        ...lead,
        customer,
        conversations: customer.conversations,
        tasks: customer.tasks.map((task: any) => ({
          ...task,
          delayed: isTaskDelayed(task),
        })),
        bookings: customer.bookings,
        timeline: buildTimeline(customer),
      },
    });
  } catch (error) {
    console.error("Get lead detail error:", error);

    return res.status(500).json({
      message: "Failed to fetch lead detail",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createLead(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = createLeadSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid lead input",
        errors: result.error.flatten(),
      });
    }

    const customer = await prisma.customer.create({
      data: {
        companyId: req.user.companyId,
        fullName: result.data.fullName,
        phone: result.data.phone,
        email: result.data.email || null,
        source: result.data.source || "Manual",
      },
    });

    await prisma.conversation.create({
      data: {
        companyId: req.user.companyId,
        customerId: customer.id,
        channel: "WEBSITE_CHAT",
        status: "NEW",
        priority: "MEDIUM",
        humanNeeded: true,
        intent: result.data.requirement || "Manual lead",
        aiSummary:
          result.data.requirement ||
          "Manual lead added. Qualification is required.",
        lastMessage:
          result.data.requirement ||
          "Manual lead added. Qualification is required.",
        lastMessageAt: new Date(),
        nextAction: "Qualify this inquiry",
      },
    });

    return res.status(201).json({
      message: "Lead created",
      customer,
    });
  } catch (error) {
    console.error("Create lead error:", error);

    return res.status(500).json({
      message: "Failed to create lead",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateLead(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = updateLeadSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid lead input",
        errors: result.error.flatten(),
      });
    }

    const customer = await prisma.customer.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
      include: {
        conversations: {
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (!customer) {
      return res.status(404).json({
        message: "Lead not found",
      });
    }

    await prisma.customer.update({
      where: {
        id: customer.id,
      },
      data: {
        fullName: result.data.fullName,
        phone: result.data.phone,
        email: result.data.email,
        source: result.data.source,
      },
    });

    const latestConversation = customer.conversations[0];

    if (latestConversation) {
      await prisma.conversation.update({
        where: {
          id: latestConversation.id,
        },
        data: {
          status: result.data.stage
            ? conversationStatusFromStage(result.data.stage)
            : undefined,
          priority: result.data.priority,
          nextAction: result.data.nextAction,
          intent: result.data.intent,
          aiSummary: result.data.aiSummary,
          humanNeeded: result.data.humanNeeded,
          bookingCreated:
            result.data.stage === "MEETING_BOOKED" ? true : undefined,
        },
      });
    }

    return res.json({
      message: "Lead updated",
    });
  } catch (error) {
    console.error("Update lead error:", error);

    return res.status(500).json({
      message: "Failed to update lead",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runLeadAction(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = leadActionSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid lead action",
        errors: result.error.flatten(),
      });
    }

    const customer = await prisma.customer.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
      include: {
        conversations: {
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (!customer) {
      return res.status(404).json({
        message: "Lead not found",
      });
    }

    let conversation = customer.conversations[0];

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          companyId: req.user.companyId,
          customerId: customer.id,
          channel: "WEBSITE_CHAT",
          status: "NEW",
          priority: "MEDIUM",
          humanNeeded: true,
          nextAction: "Qualify this inquiry",
        },
      });
    }

    const data: any = {};

    if (result.data.action === "QUALIFY") {
      data.status = "IN_PROGRESS";
      data.humanNeeded = true;
      data.nextAction = result.data.note || "Continue qualification";
    }

    if (result.data.action === "TAKE_OVER") {
      data.status = "HUMAN_REQUIRED";
      data.humanNeeded = true;
      data.nextAction = result.data.note || "Human should contact this lead";
    }

    if (result.data.action === "RETURN_TO_AI") {
      data.status = "IN_PROGRESS";
      data.humanNeeded = false;
      data.nextAction = result.data.note || "AI can continue handling";
    }

    if (result.data.action === "SET_FOLLOW_UP") {
      data.status = "FOLLOW_UP";
      data.humanNeeded = true;
      data.nextAction = result.data.note || "Follow up with customer";

      await prisma.task.create({
        data: {
          companyId: req.user.companyId,
          customerId: customer.id,
          conversationId: conversation.id,
          title: result.data.note || "Follow up with customer",
          priority: "HIGH",
          dueAt: result.data.dueAt ? new Date(result.data.dueAt) : null,
          status: "OPEN",
          aiNotes: conversation.aiSummary || conversation.lastMessage || null,
        },
      });
    }

    if (result.data.action === "BOOK_MEETING") {
      data.status = "IN_PROGRESS";
      data.bookingCreated = true;
      data.nextAction = result.data.note || "Confirm meeting details";
    }

    if (result.data.action === "MARK_WON") {
      data.status = "CONVERTED";
      data.humanNeeded = false;
      data.nextAction = "No action needed";
    }

    if (result.data.action === "MARK_LOST") {
      data.status = "LOST";
      data.humanNeeded = false;
      data.nextAction = "No action needed";
    }

    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data,
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: "HUMAN",
        body: `CRM update: ${result.data.action.replaceAll("_", " ").toLowerCase()}`,
      },
    });

    return res.json({
      message: "Lead action completed",
    });
  } catch (error) {
    console.error("Lead action error:", error);

    return res.status(500).json({
      message: "Failed to run lead action",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createLeadTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = createLeadTaskSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid task input",
        errors: result.error.flatten(),
      });
    }

    const customer = await prisma.customer.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
      include: {
        conversations: {
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (!customer) {
      return res.status(404).json({
        message: "Lead not found",
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
        customerId: customer.id,
        conversationId: customer.conversations[0]?.id || null,
        assignedUserId: result.data.assignedUserId || null,
        owner: assignedUserName || null,
        title: result.data.title,
        description: result.data.description || null,
        priority: result.data.priority,
        dueAt: result.data.dueAt ? new Date(result.data.dueAt) : null,
        status: "OPEN",
      },
    });

    if (customer.conversations[0]) {
      await prisma.conversation.update({
        where: {
          id: customer.conversations[0].id,
        },
        data: {
          status: "FOLLOW_UP",
          humanNeeded: true,
          nextAction: result.data.title,
        },
      });
    }

    return res.status(201).json({
      message: "Task created",
      task,
    });
  } catch (error) {
    console.error("Create lead task error:", error);

    return res.status(500).json({
      message: "Failed to create task",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createLeadBooking(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = createLeadBookingSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid booking input",
        errors: result.error.flatten(),
      });
    }

    const customer = await prisma.customer.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
      include: {
        conversations: {
          orderBy: {
            updatedAt: "desc",
          },
          take: 1,
        },
      },
    });

    if (!customer) {
      return res.status(404).json({
        message: "Lead not found",
      });
    }

    const booking = await prisma.booking.create({
      data: {
        companyId: req.user.companyId,
        customerId: customer.id,
        conversationId: customer.conversations[0]?.id || null,
        title: result.data.title,
        dateTime: result.data.dateTime ? new Date(result.data.dateTime) : null,
        status: "REQUESTED",
      },
    });

    if (customer.conversations[0]) {
      await prisma.conversation.update({
        where: {
          id: customer.conversations[0].id,
        },
        data: {
          bookingCreated: true,
          status: "IN_PROGRESS",
          nextAction: "Confirm booking with customer",
        },
      });
    }

    return res.status(201).json({
      message: "Booking created",
      booking,
    });
  } catch (error) {
    console.error("Create lead booking error:", error);

    return res.status(500).json({
      message: "Failed to create booking",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}