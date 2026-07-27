import { Response } from "express";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function isDelayed(task: {
  dueAt?: Date | null;
  status: string;
}) {
  if (!task.dueAt || task.status === "DONE") return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function getDelayText(task: {
  dueAt?: Date | null;
  status: string;
}) {
  if (!task.dueAt || task.status === "DONE") return "Not delayed";

  const diffMs = Date.now() - new Date(task.dueAt).getTime();

  if (diffMs <= 0) return "Not delayed";

  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days === 1 ? "" : "s"} delayed`;
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} delayed`;

  const minutes = Math.floor(diffMs / 60000);
  return `${minutes} minute${minutes === 1 ? "" : "s"} delayed`;
}

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY;
}

function getOpenAiModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function extractOutputText(data: any) {
  if (typeof data?.output_text === "string") return data.output_text;

  const output = data?.output;

  if (!Array.isArray(output)) return "";

  for (const item of output) {
    const content = item?.content;

    if (!Array.isArray(content)) continue;

    for (const contentItem of content) {
      if (
        contentItem?.type === "output_text" &&
        typeof contentItem?.text === "string"
      ) {
        return contentItem.text;
      }
    }
  }

  return "";
}

function buildSystemPrompt() {
  return `
You are AiraDesk AI CEO, a business intelligence assistant inside a company's operating dashboard.

Your job:
- Answer owner, manager, or employee questions using ONLY the provided real company data.
- Explain what to focus on today.
- Identify hot leads, delayed tasks, weak follow-ups, missed calls, team workload, and business risks.
- If asked about payments or revenue and payment data is not connected, clearly say it is not connected yet.
- Never invent leads, employees, tasks, payments, revenue, calls, or messages.
- Keep answers simple, direct, and action-focused.
- Use short sections and bullets when useful.
- If an employee asks what to do, prioritize their assigned/open/delayed tasks.
- If the data is missing, say what is missing and what setup is needed.
- Do not expose technical database names unless needed.
`;
}

async function buildCompanySnapshot(companyId: string, userId: string) {
  const now = new Date();
  const todayStart = startOfDay(now);

  const [
    company,
    currentUser,
    totalLeads,
    hotLeads,
    missedCallsToday,
    callsToday,
    whatsappToday,
    websiteToday,
    humanRequired,
    bookingsToday,
    activeTasks,
    delayedTasks,
    blockedTasks,
    recentHotLeads,
    recentTasks,
    teamMembers,
    recentConversations,
  ] = await Promise.all([
    prisma.company.findUnique({
      where: {
        id: companyId,
      },
      include: {
        settings: true,
      },
    }),

    prisma.user.findFirst({
      where: {
        id: userId,
        companyId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    }),

    prisma.customer.count({
      where: {
        companyId,
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

    prisma.call.count({
      where: {
        conversation: {
          companyId,
        },
        status: "MISSED",
        createdAt: {
          gte: todayStart,
        },
      },
    }),

    prisma.call.count({
      where: {
        conversation: {
          companyId,
        },
        createdAt: {
          gte: todayStart,
        },
      },
    }),

    prisma.conversation.count({
      where: {
        companyId,
        channel: "WHATSAPP",
        createdAt: {
          gte: todayStart,
        },
      },
    }),

    prisma.conversation.count({
      where: {
        companyId,
        channel: "WEBSITE_CHAT",
        createdAt: {
          gte: todayStart,
        },
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

    prisma.booking.count({
      where: {
        companyId,
        createdAt: {
          gte: todayStart,
        },
      },
    }),

    prisma.task.count({
      where: {
        companyId,
        status: {
          in: ["OPEN", "DOING"],
        },
      },
    }),

    prisma.task.findMany({
      where: {
        companyId,
        status: {
          in: ["OPEN", "DOING", "BLOCKED"],
        },
        dueAt: {
          lt: now,
        },
      },
      orderBy: {
        dueAt: "asc",
      },
      take: 12,
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        customer: {
          select: {
            fullName: true,
            phone: true,
          },
        },
        conversation: {
          select: {
            channel: true,
            aiSummary: true,
            lastMessage: true,
            customer: {
              select: {
                fullName: true,
                phone: true,
              },
            },
          },
        },
      },
    }),

    prisma.task.findMany({
      where: {
        companyId,
        status: "BLOCKED",
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 12,
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
    }),

    prisma.conversation.findMany({
      where: {
        companyId,
        priority: {
          in: ["CRITICAL", "HIGH"],
        },
        status: {
          notIn: ["CONVERTED", "LOST"],
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 12,
      include: {
        customer: {
          select: {
            fullName: true,
            phone: true,
            email: true,
            source: true,
          },
        },
      },
    }),

    prisma.task.findMany({
      where: {
        companyId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 25,
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        customer: {
          select: {
            fullName: true,
            phone: true,
          },
        },
        conversation: {
          select: {
            channel: true,
            aiSummary: true,
            lastMessage: true,
            customer: {
              select: {
                fullName: true,
                phone: true,
              },
            },
          },
        },
      },
    }),

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
        assignedTasks: {
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueAt: true,
            completedAt: true,
            updatedAt: true,
          },
        },
      },
    }),

    prisma.conversation.findMany({
      where: {
        companyId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 15,
      include: {
        customer: {
          select: {
            fullName: true,
            phone: true,
            email: true,
            source: true,
          },
        },
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 3,
          select: {
            senderType: true,
            body: true,
            createdAt: true,
          },
        },
        calls: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            status: true,
            durationSeconds: true,
            transcript: true,
            createdAt: true,
          },
        },
      },
    }),
  ]);

  const currentUserTasks = recentTasks.filter((task) => {
    if (task.assignedUser?.id === userId) return true;
    if (!currentUser?.name) return false;
    return task.owner?.toLowerCase() === currentUser.name.toLowerCase();
  });

  const teamSummary = teamMembers.map((member) => {
    const active = member.assignedTasks.filter((task) =>
      ["OPEN", "DOING"].includes(task.status)
    );

    const done = member.assignedTasks.filter((task) => task.status === "DONE");
    const blocked = member.assignedTasks.filter(
      (task) => task.status === "BLOCKED"
    );
    const delayed = member.assignedTasks.filter((task) => isDelayed(task));

    return {
      name: member.name,
      email: member.email,
      role: member.role,
      activeTasks: active.length,
      completedTasks: done.length,
      blockedTasks: blocked.length,
      delayedTasks: delayed.length,
      needsAttention:
        delayed.length > 0 || blocked.length > 0 || active.length >= 8,
    };
  });

  return {
    generatedAt: new Date().toISOString(),

    company: {
      id: company?.id,
      name: company?.name || "Company",
      industry: company?.industry || "OTHER",
      businessHours: company?.settings?.businessHours || null,
      aiTone: company?.settings?.aiTone || null,
      handoverRules: company?.settings?.handoverRules || null,
    },

    currentUser,

    today: {
      totalLeads,
      hotLeads,
      missedCallsToday,
      callsToday,
      whatsappToday,
      websiteToday,
      humanRequired,
      bookingsToday,
      activeTasks,
      delayedTasks: delayedTasks.length,
      blockedTasks: blockedTasks.length,
    },

    paymentsAndRevenue: {
      connected: false,
      pendingPayments: null,
      revenue: null,
      message:
        "Payment/revenue data is not connected yet. Do not invent pending payment or revenue numbers.",
    },

    hotLeads: recentHotLeads.map((conversation) => ({
      customerName: conversation.customer?.fullName || "Unknown Customer",
      phone: conversation.customer?.phone || null,
      email: conversation.customer?.email || null,
      source: conversation.customer?.source || null,
      channel: conversation.channel,
      status: conversation.status,
      priority: conversation.priority,
      intent: conversation.intent,
      aiConfidence: conversation.aiConfidence,
      summary: conversation.aiSummary || conversation.lastMessage,
      nextAction: conversation.nextAction,
      updatedAt: conversation.updatedAt,
    })),

    delayedTasks: delayedTasks.map((task) => ({
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignedTo: task.assignedUser?.name || task.owner || "Unassigned",
      dueAt: task.dueAt,
      delay: getDelayText(task),
      customerName:
        task.customer?.fullName ||
        task.conversation?.customer?.fullName ||
        null,
      customerPhone:
        task.customer?.phone || task.conversation?.customer?.phone || null,
      aiNotes: task.aiNotes,
      blockedReason: task.blockedReason,
      conversationSummary:
        task.conversation?.aiSummary || task.conversation?.lastMessage || null,
    })),

    blockedTasks: blockedTasks.map((task) => ({
      title: task.title,
      priority: task.priority,
      assignedTo: task.assignedUser?.name || task.owner || "Unassigned",
      blockedReason: task.blockedReason || "No blocked reason saved",
      updatedAt: task.updatedAt,
    })),

    recentTasks: recentTasks.map((task) => ({
      title: task.title,
      status: task.status,
      priority: task.priority,
      assignedTo: task.assignedUser?.name || task.owner || "Unassigned",
      dueAt: task.dueAt,
      delayed: isDelayed(task),
      delay: getDelayText(task),
      customerName:
        task.customer?.fullName ||
        task.conversation?.customer?.fullName ||
        null,
      aiNotes: task.aiNotes,
      blockedReason: task.blockedReason,
      updatedAt: task.updatedAt,
    })),

    currentUserTasks: currentUserTasks.map((task) => ({
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueAt: task.dueAt,
      delayed: isDelayed(task),
      delay: getDelayText(task),
      aiNotes: task.aiNotes,
      blockedReason: task.blockedReason,
      customerName:
        task.customer?.fullName ||
        task.conversation?.customer?.fullName ||
        null,
    })),

    teamSummary,

    recentConversations: recentConversations.map((conversation) => ({
      customerName: conversation.customer?.fullName || "Unknown Customer",
      phone: conversation.customer?.phone || null,
      source: conversation.customer?.source || null,
      channel: conversation.channel,
      status: conversation.status,
      priority: conversation.priority,
      humanNeeded: conversation.humanNeeded,
      intent: conversation.intent,
      aiConfidence: conversation.aiConfidence,
      summary: conversation.aiSummary || conversation.lastMessage,
      latestMessages: conversation.messages.map((message) => ({
        sender: message.senderType,
        body: message.body,
        createdAt: message.createdAt,
      })),
      latestCall: conversation.calls[0]
        ? {
            status: conversation.calls[0].status,
            durationSeconds: conversation.calls[0].durationSeconds,
            transcript: conversation.calls[0].transcript,
            createdAt: conversation.calls[0].createdAt,
          }
        : null,
      updatedAt: conversation.updatedAt,
    })),
  };
}

function buildFallbackAnswer(question: string, snapshot: any) {
  const hotLeads = snapshot.today.hotLeads;
  const delayedTasks = snapshot.today.delayedTasks;
  const missedCalls = snapshot.today.missedCallsToday;
  const blockedTasks = snapshot.today.blockedTasks;
  const activeTasks = snapshot.today.activeTasks;

  return `AI CEO is using real company data, but OpenAI is not configured on the backend yet.

Based on real data right now:

- Hot leads: ${hotLeads}
- Delayed tasks: ${delayedTasks}
- Blocked tasks: ${blockedTasks}
- Missed calls today: ${missedCalls}
- Active tasks: ${activeTasks}
- Human-required conversations: ${snapshot.today.humanRequired}

What to focus on:
1. Clear delayed tasks first.
2. Call back missed callers.
3. Review hot leads with high or critical priority.
4. Check blocked work and remove the blocker.
5. Do not rely on payment/revenue answers yet because payments are not connected.

Question asked: "${question}"`;
}

async function callOpenAi(input: {
  question: string;
  snapshot: any;
  history: ChatMessage[];
}) {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    return buildFallbackAnswer(input.question, input.snapshot);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getOpenAiModel(),
      instructions: buildSystemPrompt(),
      input: JSON.stringify({
        question: input.question,
        previousChat: input.history.slice(-8),
        companySnapshot: input.snapshot,
      }),
      max_output_tokens: 900,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("AI CEO OpenAI error:", data);
    return buildFallbackAnswer(input.question, input.snapshot);
  }

  const outputText = extractOutputText(data);

  if (!outputText) {
    return buildFallbackAnswer(input.question, input.snapshot);
  }

  return outputText;
}

export async function askAiCeo(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const question =
      typeof req.body?.question === "string" ? req.body.question.trim() : "";

    const history = Array.isArray(req.body?.history)
      ? (req.body.history as ChatMessage[])
      : [];

    if (!question) {
      return res.status(400).json({
        message: "Question is required",
      });
    }

    const snapshot = await buildCompanySnapshot(
      req.user.companyId,
      req.user.userId
    );

    const answer = await callOpenAi({
      question,
      history,
      snapshot,
    });

    return res.json({
      answer,
      snapshotMeta: {
        generatedAt: snapshot.generatedAt,
        companyName: snapshot.company.name,
        paymentDataConnected: snapshot.paymentsAndRevenue.connected,
      },
    });
  } catch (error) {
    console.error("AI CEO error:", error);

    return res.status(500).json({
      message: "Failed to ask AI CEO",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}