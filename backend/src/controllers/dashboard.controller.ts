import { Response } from "express";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function buildRiskStatus(input: {
  criticalOpenTasks: number;
  highOpenTasks: number;
  delayedTasks: number;
  hotLeads: number;
  missedCallsToday: number;
}) {
  if (
    input.criticalOpenTasks > 0 ||
    input.delayedTasks > 3 ||
    input.missedCallsToday > 5
  ) {
    return "Critical";
  }

  if (input.highOpenTasks > 0 || input.hotLeads > 0 || input.delayedTasks > 0) {
    return "High";
  }

  return "Low";
}

function buildAiCeoReport(input: {
  totalLeads: number;
  hotLeads: number;
  missedCallsToday: number;
  pendingFollowUps: number;
  delayedTasks: number;
  bookingsMadeToday: number;
  aiSolvedPercent: number;
}) {
  const parts: string[] = [];

  if (input.hotLeads > 0) {
    parts.push(`${input.hotLeads} hot lead${input.hotLeads === 1 ? "" : "s"} need attention`);
  }

  if (input.missedCallsToday > 0) {
    parts.push(`${input.missedCallsToday} missed call${input.missedCallsToday === 1 ? "" : "s"} today`);
  }

  if (input.delayedTasks > 0) {
    parts.push(`${input.delayedTasks} delayed task${input.delayedTasks === 1 ? "" : "s"}`);
  }

  if (input.pendingFollowUps > 0) {
    parts.push(`${input.pendingFollowUps} pending follow-up${input.pendingFollowUps === 1 ? "" : "s"}`);
  }

  if (parts.length === 0) {
    return "Everything looks stable right now. No urgent leads, missed calls or delayed tasks are waiting.";
  }

  return `Today needs focus: ${parts.join(", ")}. AI handled ${input.aiSolvedPercent}% of conversations without human handover.`;
}

function buildOwnerFocus(input: {
  hotLeads: number;
  missedCallsToday: number;
  pendingFollowUps: number;
  delayedTasks: number;
  humanRequiredConversations: number;
}) {
  const focus: {
    title: string;
    detail: string;
    priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  }[] = [];

  if (input.delayedTasks > 0) {
    focus.push({
      title: "Clear delayed tasks",
      detail: `${input.delayedTasks} task${input.delayedTasks === 1 ? " is" : "s are"} past due and still not completed.`,
      priority: "CRITICAL",
    });
  }

  if (input.missedCallsToday > 0) {
    focus.push({
      title: "Call back missed callers",
      detail: `${input.missedCallsToday} call${input.missedCallsToday === 1 ? " was" : "s were"} missed today.`,
      priority: "HIGH",
    });
  }

  if (input.hotLeads > 0) {
    focus.push({
      title: "Close hot leads",
      detail: `${input.hotLeads} high-priority lead${input.hotLeads === 1 ? "" : "s"} should be reviewed by the owner or sales team.`,
      priority: "HIGH",
    });
  }

  if (input.humanRequiredConversations > 0) {
    focus.push({
      title: "Handle human-required chats",
      detail: `${input.humanRequiredConversations} conversation${input.humanRequiredConversations === 1 ? " needs" : "s need"} staff attention.`,
      priority: "MEDIUM",
    });
  }

  if (input.pendingFollowUps > 0) {
    focus.push({
      title: "Finish follow-ups",
      detail: `${input.pendingFollowUps} open follow-up task${input.pendingFollowUps === 1 ? "" : "s"} remain.`,
      priority: "MEDIUM",
    });
  }

  if (focus.length === 0) {
    focus.push({
      title: "Keep monitoring today",
      detail: "No urgent action is required right now. Keep checking new leads and customer messages.",
      priority: "LOW",
    });
  }

  return focus.slice(0, 5);
}

export async function getDashboardSummary(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const companyId = req.user.companyId;
    const now = new Date();
    const todayStart = startOfDay(now);

    const [
      company,
      totalLeads,
      totalConversations,
      humanRequiredConversations,
      hotLeads,
      missedCallsToday,
      callsHandledToday,
      whatsappChatsToday,
      pendingFollowUps,
      delayedTasks,
      bookingsMadeToday,
      liveAiCalls,
      liveAiChats,
      emergencyTransfers,
      criticalOpenTasks,
      highOpenTasks,
      recentHotLeads,
      delayedTaskList,
      pendingFollowUpList,
    ] = await Promise.all([
      prisma.company.findUnique({
        where: {
          id: companyId,
        },
        select: {
          id: true,
          name: true,
          industry: true,
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
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          humanNeeded: true,
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

      prisma.task.count({
        where: {
          companyId,
          status: {
            in: ["OPEN", "DOING"],
          },
        },
      }),

      prisma.task.count({
        where: {
          companyId,
          status: {
            in: ["OPEN", "DOING"],
          },
          dueAt: {
            lt: now,
          },
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

      prisma.call.count({
        where: {
          conversation: {
            companyId,
          },
          status: {
            in: ["LIVE", "IN_PROGRESS", "RINGING"],
          },
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          channel: {
            in: ["WHATSAPP", "WEBSITE_CHAT"],
          },
          status: "IN_PROGRESS",
        },
      }),

      prisma.call.count({
        where: {
          conversation: {
            companyId,
          },
          status: "TRANSFERRED",
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
          priority: "CRITICAL",
        },
      }),

      prisma.task.count({
        where: {
          companyId,
          status: {
            in: ["OPEN", "DOING"],
          },
          priority: "HIGH",
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
        take: 6,
        include: {
          customer: {
            select: {
              fullName: true,
              phone: true,
            },
          },
        },
      }),

      prisma.task.findMany({
        where: {
          companyId,
          status: {
            in: ["OPEN", "DOING"],
          },
          dueAt: {
            lt: now,
          },
        },
        orderBy: {
          dueAt: "asc",
        },
        take: 6,
        include: {
          customer: {
            select: {
              fullName: true,
              phone: true,
            },
          },
          conversation: {
            select: {
              id: true,
              channel: true,
              priority: true,
              status: true,
            },
          },
        },
      }),

      prisma.task.findMany({
        where: {
          companyId,
          status: {
            in: ["OPEN", "DOING"],
          },
        },
        orderBy: [
          {
            priority: "asc",
          },
          {
            createdAt: "desc",
          },
        ],
        take: 6,
        include: {
          customer: {
            select: {
              fullName: true,
              phone: true,
            },
          },
          conversation: {
            select: {
              id: true,
              channel: true,
              priority: true,
              status: true,
            },
          },
        },
      }),
    ]);

    const aiHandledConversations =
      totalConversations - humanRequiredConversations;

    const aiSolvedPercent =
      totalConversations === 0
        ? 0
        : Math.round((aiHandledConversations / totalConversations) * 100);

    const handoverPercent =
      totalConversations === 0
        ? 0
        : Math.round((humanRequiredConversations / totalConversations) * 100);

    const riskStatus = buildRiskStatus({
      criticalOpenTasks,
      highOpenTasks,
      delayedTasks,
      hotLeads,
      missedCallsToday,
    });

    const aiCeoReport = buildAiCeoReport({
      totalLeads,
      hotLeads,
      missedCallsToday,
      pendingFollowUps,
      delayedTasks,
      bookingsMadeToday,
      aiSolvedPercent,
    });

    const ownerFocus = buildOwnerFocus({
      hotLeads,
      missedCallsToday,
      pendingFollowUps,
      delayedTasks,
      humanRequiredConversations,
    });

    return res.json({
      company: {
        id: company?.id || companyId,
        name: company?.name || "Company",
        industry: company?.industry || "OTHER",
      },

      industry: company?.industry || "OTHER",

      aiCeoReport,

      totalLeads,
      hotLeads,
      missedCalls: missedCallsToday,
      pendingFollowUps,
      delayedTasks,

      pendingPayments: {
        connected: false,
        value: null,
        count: null,
        currency: "INR",
        message:
          "Payment system is not connected yet. No fake pending payment value is shown.",
      },

      revenueEstimate: {
        connected: false,
        value: null,
        currency: "INR",
        message:
          "Revenue source is not connected yet. Connect real invoices/payments before showing revenue.",
      },

      ownerFocus,

      callsHandledToday,
      whatsappChatsToday,
      staffFollowUps: pendingFollowUps,
      bookingsMadeToday,
      liveAiCalls,
      liveAiChats,
      emergencyTransfers,
      aiSolvedPercent,
      handoverPercent,
      riskStatus,

      recentHotLeads: recentHotLeads.map((conversation) => ({
        id: conversation.id,
        customerName: conversation.customer?.fullName || "Unknown Customer",
        customerPhone: conversation.customer?.phone || "-",
        channel: conversation.channel,
        status: conversation.status,
        priority: conversation.priority,
        intent: conversation.intent,
        aiSummary: conversation.aiSummary,
        lastMessage: conversation.lastMessage,
        updatedAt: conversation.updatedAt,
      })),

      delayedTaskList: delayedTaskList.map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        dueAt: task.dueAt,
        customerName: task.customer?.fullName || "Unknown Customer",
        customerPhone: task.customer?.phone || "-",
        channel: task.conversation?.channel || null,
      })),

      pendingFollowUpList: pendingFollowUpList.map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        dueAt: task.dueAt,
        customerName: task.customer?.fullName || "Unknown Customer",
        customerPhone: task.customer?.phone || "-",
        channel: task.conversation?.channel || null,
      })),
    });
  } catch (error) {
    console.error("Dashboard summary error:", error);

    return res.status(500).json({
      message: "Failed to fetch dashboard summary",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}