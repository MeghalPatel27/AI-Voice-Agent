import { Response } from "express";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

function startOfDay(date: Date) {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

function getLast7Days() {
  const days: { label: string; date: Date; count: number }[] = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);

    const dayStart = startOfDay(date);

    days.push({
      label: dayStart.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      }),
      date: dayStart,
      count: 0,
    });
  }

  return days;
}

export async function getAnalyticsOverview(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const companyId = req.user.companyId;

    const sevenDays = getLast7Days();
    const firstDay = sevenDays[0];
    if (!firstDay) {
      return res.status(500).json({
        message: "Failed to compute analytics date range",
      });
    }
    const sevenDaysAgo = firstDay.date;

    const [
      totalCustomers,
      totalConversations,
      totalTasks,
      openTasks,
      doneTasks,
      humanRequiredConversations,
      convertedConversations,
      bookingCreatedConversations,
      whatsappConversations,
      callConversations,
      websiteChatConversations,
      liveAgents,
      recentConversations,
      recentCreatedConversations,
      priorityBreakdown,
      statusBreakdown,
      taskStatusBreakdown,
    ] = await Promise.all([
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

      prisma.task.count({
        where: {
          companyId,
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
          status: "DONE",
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
          status: "CONVERTED",
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          bookingCreated: true,
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          channel: "WHATSAPP",
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          channel: "AI_CALL",
        },
      }),

      prisma.conversation.count({
        where: {
          companyId,
          channel: "WEBSITE_CHAT",
        },
      }),

      prisma.aiAgent.count({
        where: {
          companyId,
          status: "LIVE",
        },
      }),

      prisma.conversation.findMany({
        where: {
          companyId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 8,
        include: {
          customer: {
            select: {
              fullName: true,
              phone: true,
            },
          },
        },
      }),

      prisma.conversation.findMany({
        where: {
          companyId,
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
        select: {
          createdAt: true,
        },
      }),

      prisma.conversation.groupBy({
        by: ["priority"],
        where: {
          companyId,
        },
        _count: {
          priority: true,
        },
      }),

      prisma.conversation.groupBy({
        by: ["status"],
        where: {
          companyId,
        },
        _count: {
          status: true,
        },
      }),

      prisma.task.groupBy({
        by: ["status"],
        where: {
          companyId,
        },
        _count: {
          status: true,
        },
      }),
    ]);

    const aiHandledConversations =
      totalConversations - humanRequiredConversations;

    const aiHandledRate =
      totalConversations === 0
        ? 0
        : Math.round((aiHandledConversations / totalConversations) * 100);

    const humanHandoverRate =
      totalConversations === 0
        ? 0
        : Math.round((humanRequiredConversations / totalConversations) * 100);

    const conversionRate =
      totalConversations === 0
        ? 0
        : Math.round((convertedConversations / totalConversations) * 100);

    const trend = sevenDays.map((day) => {
      const count = recentCreatedConversations.filter((conversation) => {
        const createdDate = startOfDay(conversation.createdAt);
        return createdDate.getTime() === day.date.getTime();
      }).length;

      return {
        label: day.label,
        count,
      };
    });

    return res.json({
      summary: {
        totalCustomers,
        totalConversations,
        totalTasks,
        openTasks,
        doneTasks,
        humanRequiredConversations,
        aiHandledConversations,
        convertedConversations,
        bookingCreatedConversations,
        whatsappConversations,
        callConversations,
        websiteChatConversations,
        liveAgents,
        aiHandledRate,
        humanHandoverRate,
        conversionRate,
      },
      channelBreakdown: [
        {
          label: "WhatsApp",
          value: whatsappConversations,
        },
        {
          label: "AI Calls",
          value: callConversations,
        },
        {
          label: "Website Chat",
          value: websiteChatConversations,
        },
      ],
      priorityBreakdown: priorityBreakdown.map((item) => ({
        label: item.priority,
        value: item._count.priority,
      })),
      statusBreakdown: statusBreakdown.map((item) => ({
        label: item.status,
        value: item._count.status,
      })),
      taskStatusBreakdown: taskStatusBreakdown.map((item) => ({
        label: item.status,
        value: item._count.status,
      })),
      trend,
      recentConversations: recentConversations.map((conversation) => ({
        id: conversation.id,
        customerName: conversation.customer?.fullName || "Unknown Customer",
        customerPhone: conversation.customer?.phone || "-",
        channel: conversation.channel,
        status: conversation.status,
        priority: conversation.priority,
        intent: conversation.intent,
        aiSummary: conversation.aiSummary,
        humanNeeded: conversation.humanNeeded,
        createdAt: conversation.createdAt,
      })),
    });
  } catch (error) {
    console.error("Analytics overview error:", error);

    return res.status(500).json({
      message: "Failed to load analytics",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}