import { Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const reportQuerySchema = z.object({
  range: z
    .enum(["TODAY", "YESTERDAY", "LAST_7_DAYS", "LAST_30_DAYS", "THIS_MONTH", "CUSTOM"])
    .default("LAST_7_DAYS"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  compare: z.enum(["true", "false"]).default("true"),
});

type Period = {
  start: Date;
  end: Date;
  label: string;
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function resolvePeriod(query: z.infer<typeof reportQuerySchema>): Period {
  const now = new Date();

  if (query.range === "TODAY") {
    return {
      start: startOfDay(now),
      end: endOfDay(now),
      label: "Today",
    };
  }

  if (query.range === "YESTERDAY") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    return {
      start: startOfDay(yesterday),
      end: endOfDay(yesterday),
      label: "Yesterday",
    };
  }

  if (query.range === "LAST_30_DAYS") {
    const start = startOfDay(now);
    start.setDate(now.getDate() - 29);

    return {
      start,
      end: endOfDay(now),
      label: "Last 30 days",
    };
  }

  if (query.range === "THIS_MONTH") {
    return {
      start: startOfMonth(now),
      end: endOfDay(now),
      label: "This month",
    };
  }

  if (query.range === "CUSTOM" && query.startDate && query.endDate) {
    return {
      start: startOfDay(new Date(query.startDate)),
      end: endOfDay(new Date(query.endDate)),
      label: "Custom range",
    };
  }

  const start = startOfDay(now);
  start.setDate(now.getDate() - 6);

  return {
    start,
    end: endOfDay(now),
    label: "Last 7 days",
  };
}

function previousPeriod(period: Period): Period {
  const duration = period.end.getTime() - period.start.getTime();

  const end = new Date(period.start.getTime() - 1);
  const start = new Date(end.getTime() - duration);

  return {
    start,
    end,
    label: "Previous period",
  };
}

function inPeriodDateFilter(period: Period) {
  return {
    gte: period.start,
    lte: period.end,
  };
}

function percentChange(current: number, previous: number) {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return 100;

  return Math.round(((current - previous) / previous) * 100);
}

function metricWithCompare(current: number, previous: number) {
  const change = percentChange(current, previous);

  return {
    value: current,
    previous,
    change,
    direction: change > 0 ? "UP" : change < 0 ? "DOWN" : "FLAT",
  };
}

function cleanText(value?: string | null, fallback = "Customer work") {
  if (!value) return fallback;

  const lower = value.toLowerCase();

  if (
    lower.includes("test customer") ||
    lower.includes("llm test") ||
    lower.includes("real whatsapp customer") ||
    lower.includes("call test customer") ||
    lower.includes("live/testing")
  ) {
    return fallback;
  }

  return value;
}

function sourceLabel(customer: any, conversation?: any) {
  if (customer?.source) return customer.source;
  if (conversation?.channel === "WHATSAPP") return "WhatsApp";
  if (conversation?.channel === "AI_CALL") return "Calls";
  if (conversation?.channel === "WEBSITE_CHAT") return "Website";
  return "Manual";
}

function isHotConversation(conversation: any) {
  return (
    ["CRITICAL", "HIGH"].includes(conversation.priority) &&
    !["CONVERTED", "LOST"].includes(conversation.status)
  );
}

function isDelayedTask(task: any) {
  if (!task.dueAt || task.status === "DONE") return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function uniqueCount(values: Array<string | null | undefined>) {
  return new Set(values.filter(Boolean)).size;
}

function getCustomerName(customer?: any) {
  return cleanText(customer?.fullName || customer?.phone, "Customer Inquiry");
}

function getConversationText(conversation: any) {
  return `${conversation.intent || ""} ${conversation.aiSummary || ""} ${
    conversation.lastMessage || ""
  }`.toLowerCase();
}

function qualityLabel({
  leads,
  hot,
  meetings,
  won,
}: {
  leads: number;
  hot: number;
  meetings: number;
  won: number;
}) {
  if (leads === 0) return "No data";

  const hotRate = hot / leads;
  const meetingRate = meetings / leads;
  const winRate = won / leads;

  if (winRate > 0.08 || meetingRate > 0.2 || hotRate > 0.25) return "Strong";
  if (meetingRate > 0.08 || hotRate > 0.12) return "Good";
  if (leads >= 5 && hotRate < 0.08 && meetingRate < 0.05) return "Low quality";

  return "Needs more data";
}

async function loadPeriodData(companyId: string, period: Period) {
  const [customers, conversations, tasks, bookings, users, settings] =
    await Promise.all([
      prisma.customer.findMany({
        where: {
          companyId,
          createdAt: inPeriodDateFilter(period),
        },
        include: {
          conversations: {
            include: {
              bookings: true,
              tasks: true,
              calls: true,
            },
          },
          tasks: true,
          bookings: true,
        },
      }),

      prisma.conversation.findMany({
        where: {
          companyId,
          createdAt: inPeriodDateFilter(period),
        },
        include: {
          customer: true,
          bookings: true,
          tasks: true,
          calls: true,
          messages: {
            orderBy: {
              createdAt: "asc",
            },
            take: 10,
          },
        },
      }),

      prisma.task.findMany({
        where: {
          companyId,
          OR: [
            {
              createdAt: inPeriodDateFilter(period),
            },
            {
              updatedAt: inPeriodDateFilter(period),
            },
          ],
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
          customer: true,
          conversation: {
            include: {
              customer: true,
            },
          },
        },
      }),

      prisma.booking.findMany({
        where: {
          companyId,
          createdAt: inPeriodDateFilter(period),
        },
        include: {
          customer: true,
          conversation: true,
        },
      }),

      prisma.user.findMany({
        where: {
          companyId,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          workloadCapacity: true,
        },
      }),

      prisma.companySettings.findUnique({
        where: {
          companyId,
        },
      }),
    ]);

  return {
    customers,
    conversations,
    tasks,
    bookings,
    users,
    settings: settings as any,
  };
}

function buildMetrics(data: Awaited<ReturnType<typeof loadPeriodData>>) {
  const hotConversations = data.conversations.filter(isHotConversation);

  const wonCustomerIds = data.conversations
    .filter((conversation) => conversation.status === "CONVERTED")
    .map((conversation) => conversation.customerId);

  const lostCustomerIds = data.conversations
    .filter((conversation) => conversation.status === "LOST")
    .map((conversation) => conversation.customerId);

  const followUpConversationIds = data.conversations
    .filter((conversation) => conversation.status === "FOLLOW_UP")
    .map((conversation) => conversation.id);

  const followUpTaskCount = data.tasks.filter(
    (task) => ["OPEN", "DOING"].includes(task.status) && task.dueAt
  ).length;

  const missedCallCount = data.conversations.reduce((sum, conversation) => {
    return sum + conversation.calls.filter((call) => call.status === "MISSED").length;
  }, 0);

  const missedOpportunityCount =
    missedCallCount +
    data.conversations.filter((conversation) => {
      const hasFollowUpTask = conversation.tasks.some((task) => task.dueAt);
      return (
        (conversation.status === "FOLLOW_UP" || isHotConversation(conversation)) &&
        !hasFollowUpTask &&
        !["CONVERTED", "LOST"].includes(conversation.status)
      );
    }).length;

  const conversionRate = data.customers.length
    ? Math.round((uniqueCount(wonCustomerIds) / data.customers.length) * 100)
    : 0;

  return {
    newLeads: data.customers.length,
    hotLeads: uniqueCount(hotConversations.map((conversation) => conversation.customerId)),
    followUpsDue: followUpConversationIds.length + followUpTaskCount,
    meetingsBooked: data.bookings.length,
    missedOpportunities: missedOpportunityCount,
    delayedTasks: data.tasks.filter(isDelayedTask).length,
    conversionRate,
    won: uniqueCount(wonCustomerIds),
    lost: uniqueCount(lostCustomerIds),
  };
}

function buildSalesFunnel(data: Awaited<ReturnType<typeof loadPeriodData>>) {
  const newLeads = data.customers.length;

  const qualified = uniqueCount(
    data.conversations
      .filter((conversation) =>
        ["IN_PROGRESS", "FOLLOW_UP", "HUMAN_REQUIRED", "CONVERTED", "LOST"].includes(
          conversation.status
        )
      )
      .map((conversation) => conversation.customerId)
  );

  const meetingsBooked = uniqueCount(
    [
      ...data.bookings.map((booking) => booking.customerId),
      ...data.conversations
        .filter((conversation) => conversation.bookingCreated)
        .map((conversation) => conversation.customerId),
    ].filter(Boolean)
  );

  const quotationSent = 0;

  const won = uniqueCount(
    data.conversations
      .filter((conversation) => conversation.status === "CONVERTED")
      .map((conversation) => conversation.customerId)
  );

  const lost = uniqueCount(
    data.conversations
      .filter((conversation) => conversation.status === "LOST")
      .map((conversation) => conversation.customerId)
  );

  const stages = [
    {
      key: "NEW",
      label: "New Leads",
      value: newLeads,
    },
    {
      key: "QUALIFIED",
      label: "Qualified",
      value: qualified,
    },
    {
      key: "MEETING_BOOKED",
      label: "Meetings Booked",
      value: meetingsBooked,
    },
    {
      key: "QUOTATION_SENT",
      label: "Quotation Sent",
      value: quotationSent,
      notConnected: true,
    },
    {
      key: "WON",
      label: "Won",
      value: won,
    },
    {
      key: "LOST",
      label: "Lost",
      value: lost,
    },
  ];

  let biggestDrop = "No clear drop-off yet.";

  if (newLeads > 0 && qualified / newLeads < 0.5) {
    biggestDrop = "Main drop-off is from new lead to qualified lead.";
  } else if (qualified > 0 && meetingsBooked / qualified < 0.4) {
    biggestDrop = "Main drop-off is between qualified leads and booked meetings.";
  } else if (meetingsBooked > 0 && won / meetingsBooked < 0.3) {
    biggestDrop = "Meetings are not converting into wins yet.";
  }

  return {
    stages,
    insight: biggestDrop,
    quotationConnected: false,
  };
}

function buildSourcePerformance(data: Awaited<ReturnType<typeof loadPeriodData>>) {
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

  for (const customer of data.customers) {
    const conversation = customer.conversations?.[0];
    const source = sourceLabel(customer, conversation);

    const row =
      groups.get(source) ||
      {
        source,
        leads: 0,
        hot: 0,
        meetings: 0,
        won: 0,
        lost: 0,
      };

    row.leads += 1;

    if (customer.conversations.some(isHotConversation)) row.hot += 1;

    if (
      customer.bookings.length > 0 ||
      customer.conversations.some((conversation) => conversation.bookingCreated)
    ) {
      row.meetings += 1;
    }

    if (customer.conversations.some((conversation) => conversation.status === "CONVERTED")) {
      row.won += 1;
    }

    if (customer.conversations.some((conversation) => conversation.status === "LOST")) {
      row.lost += 1;
    }

    groups.set(source, row);
  }

  const rows = Array.from(groups.values()).map((row) => ({
    ...row,
    conversionRate: row.leads ? Math.round((row.won / row.leads) * 100) : 0,
    quality: qualityLabel(row),
    avgResponseTime: "Not enough data",
  }));

  const strongest = [...rows].sort((a, b) => {
    const score = (row: any) => row.hot * 3 + row.meetings * 5 + row.won * 10;
    return score(b) - score(a);
  })[0];

  return {
    rows,
    insight: strongest
      ? `${strongest.source} is currently the strongest source based on hot leads, meetings and wins.`
      : "No source quality data yet.",
  };
}

function buildFollowUpReport(data: Awaited<ReturnType<typeof loadPeriodData>>) {
  const dueTasks = data.tasks.filter(
    (task) => ["OPEN", "DOING"].includes(task.status) && task.dueAt
  );

  const overdueTasks = dueTasks.filter(isDelayedTask);

  const hotWithoutFollowUp = data.conversations.filter((conversation) => {
    if (!isHotConversation(conversation)) return false;
    return !conversation.tasks.some((task) => task.dueAt);
  });

  const followUpWithoutDate = data.conversations.filter((conversation) => {
    if (conversation.status !== "FOLLOW_UP") return false;
    return !conversation.tasks.some((task) => task.dueAt);
  });

  return {
    due: dueTasks.length,
    overdue: overdueTasks.length,
    hotWithoutFollowUp: hotWithoutFollowUp.length,
    followUpWithoutDate: followUpWithoutDate.length,
    completed: data.tasks.filter(
      (task) => task.status === "DONE" && task.title.toLowerCase().includes("follow")
    ).length,
    insight:
      overdueTasks.length > 0 || hotWithoutFollowUp.length > 0
        ? "Follow-up discipline needs attention. Hot leads and overdue follow-ups should be handled first."
        : "No major follow-up leak detected in this period.",
  };
}

function buildMissedOpportunities(data: Awaited<ReturnType<typeof loadPeriodData>>) {
  const items: {
    type: string;
    title: string;
    description: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
    actionLabel: string;
    actionPath: string;
  }[] = [];

  const missedCalls = data.conversations.filter((conversation) =>
    conversation.calls.some((call) => call.status === "MISSED")
  );

  if (missedCalls.length > 0) {
    items.push({
      type: "MISSED_CALL",
      title: `${missedCalls.length} missed call${missedCalls.length === 1 ? "" : "s"} need review`,
      description: "Missed calls can become lost customers if nobody calls back quickly.",
      severity: "HIGH",
      actionLabel: "View Inbox",
      actionPath: "/inbox",
    });
  }

  const hotWithoutNextAction = data.conversations.filter(
    (conversation) => isHotConversation(conversation) && !conversation.nextAction
  );

  if (hotWithoutNextAction.length > 0) {
    items.push({
      type: "HOT_NO_ACTION",
      title: `${hotWithoutNextAction.length} hot lead${hotWithoutNextAction.length === 1 ? "" : "s"} have no next action`,
      description: "Hot leads should always have a clear next step.",
      severity: "HIGH",
      actionLabel: "View Leads",
      actionPath: "/leads",
    });
  }

  const followUpWithoutDate = data.conversations.filter(
    (conversation) =>
      conversation.status === "FOLLOW_UP" &&
      !conversation.tasks.some((task) => task.dueAt)
  );

  if (followUpWithoutDate.length > 0) {
    items.push({
      type: "FOLLOWUP_NO_DATE",
      title: `${followUpWithoutDate.length} follow-up lead${followUpWithoutDate.length === 1 ? "" : "s"} have no follow-up date`,
      description: "Follow-ups without dates usually get forgotten.",
      severity: "MEDIUM",
      actionLabel: "Set Follow-ups",
      actionPath: "/leads",
    });
  }

  const pricingSilent = data.conversations.filter((conversation) => {
    const text = getConversationText(conversation);
    return (
      (text.includes("price") ||
        text.includes("pricing") ||
        text.includes("cost") ||
        text.includes("charge")) &&
      !["CONVERTED", "LOST"].includes(conversation.status)
    );
  });

  if (pricingSilent.length > 0) {
    items.push({
      type: "PRICE_SILENT",
      title: `${pricingSilent.length} customer${pricingSilent.length === 1 ? "" : "s"} asked about price and have not converted`,
      description: "Pricing replies may need better follow-up or stronger offer handling.",
      severity: "MEDIUM",
      actionLabel: "View Conversations",
      actionPath: "/inbox",
    });
  }

  return {
    total: items.length,
    items,
  };
}

function buildConversationPerformance(data: Awaited<ReturnType<typeof loadPeriodData>>) {
  const whatsapp = data.conversations.filter(
    (conversation) => conversation.channel === "WHATSAPP"
  );

  const calls = data.conversations.filter(
    (conversation) => conversation.channel === "AI_CALL"
  );

  const website = data.conversations.filter(
    (conversation) => conversation.channel === "WEBSITE_CHAT"
  );

  const allCalls = data.conversations.flatMap((conversation) => conversation.calls);

  const missedCalls = allCalls.filter((call) => call.status === "MISSED");

  const humanHandoffs = data.conversations.filter(
    (conversation) => conversation.humanNeeded || conversation.status === "HUMAN_REQUIRED"
  );

  const aiHandled = data.conversations.filter(
    (conversation) =>
      !conversation.humanNeeded &&
      !["HUMAN_REQUIRED", "CONVERTED", "LOST"].includes(conversation.status)
  );

  const intents = new Map<string, number>();

  for (const conversation of data.conversations) {
    const intent = conversation.intent || "General inquiry";
    intents.set(intent, (intents.get(intent) || 0) + 1);
  }

  const commonIntents = Array.from(intents.entries())
    .map(([intent, count]) => ({
      intent,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const avgCallDuration =
    allCalls.length > 0
      ? Math.round(
          allCalls.reduce((sum, call) => sum + (call.durationSeconds || 0), 0) /
            allCalls.length
        )
      : 0;

  return {
    whatsapp: whatsapp.length,
    calls: calls.length,
    website: website.length,
    missedCalls: missedCalls.length,
    humanHandoffs: humanHandoffs.length,
    aiHandled: aiHandled.length,
    meetingsFromConversations: data.conversations.filter(
      (conversation) => conversation.bookings.length > 0 || conversation.bookingCreated
    ).length,
    avgCallDuration,
    commonIntents,
    insight:
      whatsapp.length >= calls.length && whatsapp.length >= website.length
        ? "WhatsApp is currently the strongest conversation channel."
        : calls.length > 0
          ? "Calls are important, but missed calls and call setup should be watched closely."
          : "Conversation data is still limited.",
  };
}

function buildTeamTaskReport(data: Awaited<ReturnType<typeof loadPeriodData>>) {
  const assigned = data.tasks.filter((task) => task.assignedUserId || task.owner);
  const completed = data.tasks.filter((task) => task.status === "DONE");
  const delayed = data.tasks.filter(isDelayedTask);
  const blocked = data.tasks.filter((task) => task.status === "BLOCKED");

  const employeeRows = data.users.map((user) => {
    const userTasks = data.tasks.filter((task) => task.assignedUserId === user.id);
    const active = userTasks.filter((task) => ["OPEN", "DOING"].includes(task.status));
    const userDelayed = userTasks.filter(isDelayedTask);

    return {
      id: user.id,
      name: user.name,
      active: active.length,
      completed: userTasks.filter((task) => task.status === "DONE").length,
      delayed: userDelayed.length,
      blocked: userTasks.filter((task) => task.status === "BLOCKED").length,
      workloadCapacity: user.workloadCapacity || 8,
      workloadPercent: Math.round(((active.length + blocked.length) / (user.workloadCapacity || 8)) * 100),
    };
  });

  const mostDelayed = [...employeeRows].sort((a, b) => b.delayed - a.delayed)[0];
  const mostOverloaded = [...employeeRows].sort(
    (a, b) => b.workloadPercent - a.workloadPercent
  )[0];

  return {
    assigned: assigned.length,
    completed: completed.length,
    delayed: delayed.length,
    blocked: blocked.length,
    waitingReview: 0,
    employees: employeeRows,
    mostDelayed: mostDelayed?.delayed ? mostDelayed : null,
    mostOverloaded:
      mostOverloaded?.workloadPercent != null && mostOverloaded.workloadPercent > 100
        ? mostOverloaded
        : null,
    insight:
      data.tasks.length === 0
        ? "No task report yet. Assign tasks to start tracking workload and delays."
        : delayed.length > 0
          ? "Task delays need attention. Review overdue tasks and blocked work first."
          : "No major task delay pattern detected.",
  };
}

function buildRevenueReport() {
  return {
    connected: false,
    collected: null,
    pending: null,
    pipelineValue: null,
    expectedRevenue: null,
    overduePayments: null,
    message:
      "Revenue tracking is not active yet. Add manual deal values, invoices, payment status, or a payment integration to see revenue reports.",
    setupOptions: [
      "Manual deal values",
      "Quotation amount",
      "Payment status",
      "Amount received",
      "Amount pending",
      "Expected close date",
    ],
  };
}

function buildNeedsAttention({
  metrics,
  followUp,
  missedOpportunities,
  conversationPerformance,
  teamTaskReport,
  revenue,
  settings,
}: {
  metrics: ReturnType<typeof buildMetrics>;
  followUp: ReturnType<typeof buildFollowUpReport>;
  missedOpportunities: ReturnType<typeof buildMissedOpportunities>;
  conversationPerformance: ReturnType<typeof buildConversationPerformance>;
  teamTaskReport: ReturnType<typeof buildTeamTaskReport>;
  revenue: ReturnType<typeof buildRevenueReport>;
  settings: any;
}) {
  const items: {
    title: string;
    description: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
    actionLabel: string;
    actionPath: string;
  }[] = [];

  if (followUp.followUpWithoutDate > 0 || followUp.hotWithoutFollowUp > 0) {
    items.push({
      title: "Follow-ups are leaking leads",
      description: `${followUp.followUpWithoutDate} follow-up lead(s) have no date and ${followUp.hotWithoutFollowUp} hot lead(s) need follow-up discipline.`,
      severity: "HIGH",
      actionLabel: "View Leads",
      actionPath: "/leads",
    });
  }

  if (metrics.hotLeads > 0) {
    items.push({
      title: "Hot leads need action",
      description: `${metrics.hotLeads} hot lead(s) should be reviewed today.`,
      severity: "HIGH",
      actionLabel: "Open Leads",
      actionPath: "/leads",
    });
  }

  if (conversationPerformance.missedCalls > 0) {
    items.push({
      title: "Missed calls need callback",
      description: `${conversationPerformance.missedCalls} missed call(s) were found in this period.`,
      severity: "HIGH",
      actionLabel: "Open Inbox",
      actionPath: "/inbox",
    });
  }

  const callAgentActive = Boolean(
    settings?.voiceProviderMode && settings.voiceProviderMode !== "mock"
  );

  if (!callAgentActive) {
    items.push({
      title: "Call agent is not active",
      description:
        "Call reporting is limited until your live call provider is connected.",
      severity: "MEDIUM",
      actionLabel: "Open Settings",
      actionPath: "/settings",
    });
  }

  if (teamTaskReport.assigned === 0) {
    items.push({
      title: "No task performance data yet",
      description:
        "Assign tasks to start tracking workload, delays, blocked work, and execution quality.",
      severity: "LOW",
      actionLabel: "Create Task",
      actionPath: "/tasks",
    });
  }

  if (!revenue.connected) {
    items.push({
      title: "Revenue tracking is not connected",
      description:
        "Add deal values, invoices or payment status to see revenue, pending payments and expected revenue.",
      severity: "MEDIUM",
      actionLabel: "Set Up Revenue",
      actionPath: "/settings",
    });
  }

  for (const item of missedOpportunities.items.slice(0, 3)) {
    items.push({
      title: item.title,
      description: item.description,
      severity: item.severity,
      actionLabel: item.actionLabel,
      actionPath: item.actionPath,
    });
  }

  return items.slice(0, 8);
}

function buildAiSummary(input: {
  period: Period;
  metrics: ReturnType<typeof buildMetrics>;
  followUp: ReturnType<typeof buildFollowUpReport>;
  missedOpportunities: ReturnType<typeof buildMissedOpportunities>;
  conversationPerformance: ReturnType<typeof buildConversationPerformance>;
  sourcePerformance: ReturnType<typeof buildSourcePerformance>;
  teamTaskReport: ReturnType<typeof buildTeamTaskReport>;
  revenue: ReturnType<typeof buildRevenueReport>;
}) {
  const lines: string[] = [];

  lines.push(
    `In ${input.period.label.toLowerCase()}, your business received ${input.metrics.newLeads} new lead(s), with ${input.metrics.hotLeads} hot lead(s), ${input.metrics.meetingsBooked} meeting(s), and ${input.metrics.conversionRate}% conversion.`
  );

  if (input.followUp.hotWithoutFollowUp > 0 || input.followUp.overdue > 0) {
    lines.push(
      `Follow-up discipline needs attention: ${input.followUp.hotWithoutFollowUp} hot lead(s) have no follow-up and ${input.followUp.overdue} follow-up task(s) are overdue.`
    );
  } else {
    lines.push("No major follow-up leak was detected in this period.");
  }

  if (input.conversationPerformance.whatsapp > 0) {
    lines.push(
      `WhatsApp generated ${input.conversationPerformance.whatsapp} conversation(s), making it an important customer channel right now.`
    );
  }

  if (input.conversationPerformance.missedCalls > 0) {
    lines.push(
      `${input.conversationPerformance.missedCalls} missed call(s) need review because missed calls can become lost customers.`
    );
  }

  if (input.teamTaskReport.assigned === 0) {
    lines.push(
      "Team reporting is limited because no tasks have been assigned yet."
    );
  }

  if (!input.revenue.connected) {
    lines.push(
      "Revenue tracking is not active yet, so revenue, pending payments and profit reporting are incomplete."
    );
  }

  const actions: string[] = [];

  if (input.followUp.hotWithoutFollowUp > 0 || input.followUp.followUpWithoutDate > 0) {
    actions.push("Set follow-up dates for warm and hot leads.");
  }

  if (input.metrics.hotLeads > 0) {
    actions.push(`Review and contact the ${input.metrics.hotLeads} hot lead(s).`);
  }

  if (input.conversationPerformance.missedCalls > 0) {
    actions.push("Call back missed calls from the Inbox.");
  }

  if (!input.revenue.connected) {
    actions.push("Set up revenue tracking or add manual deal values.");
  }

  if (input.teamTaskReport.assigned === 0) {
    actions.push("Create tasks so team and delay reports become meaningful.");
  }

  return {
    title: "AI CEO Summary",
    summary: lines.join(" "),
    actions: actions.length ? actions : ["Keep tracking activity and review reports regularly."],
  };
}

export async function getReportsOverview(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const query = reportQuerySchema.parse(req.query);
    const period = resolvePeriod(query);
    const prevPeriod = previousPeriod(period);

    const [currentData, previousData] = await Promise.all([
      loadPeriodData(req.user.companyId, period),
      loadPeriodData(req.user.companyId, prevPeriod),
    ]);

    const currentMetrics = buildMetrics(currentData);
    const previousMetrics = buildMetrics(previousData);

    const salesFunnel = buildSalesFunnel(currentData);
    const sourcePerformance = buildSourcePerformance(currentData);
    const followUp = buildFollowUpReport(currentData);
    const missedOpportunities = buildMissedOpportunities(currentData);
    const conversationPerformance = buildConversationPerformance(currentData);
    const teamTaskReport = buildTeamTaskReport(currentData);
    const revenue = buildRevenueReport();

    const needsAttention = buildNeedsAttention({
      metrics: currentMetrics,
      followUp,
      missedOpportunities,
      conversationPerformance,
      teamTaskReport,
      revenue,
      settings: currentData.settings,
    });

    const aiSummary = buildAiSummary({
      period,
      metrics: currentMetrics,
      followUp,
      missedOpportunities,
      conversationPerformance,
      sourcePerformance,
      teamTaskReport,
      revenue,
    });

    return res.json({
      period: {
        start: period.start,
        end: period.end,
        label: period.label,
        compareLabel: prevPeriod.label,
      },

      compareEnabled: query.compare === "true",

      aiSummary,

      businessHealth: {
        newLeads: metricWithCompare(currentMetrics.newLeads, previousMetrics.newLeads),
        hotLeads: metricWithCompare(currentMetrics.hotLeads, previousMetrics.hotLeads),
        followUpsDue: metricWithCompare(
          currentMetrics.followUpsDue,
          previousMetrics.followUpsDue
        ),
        meetingsBooked: metricWithCompare(
          currentMetrics.meetingsBooked,
          previousMetrics.meetingsBooked
        ),
        missedOpportunities: metricWithCompare(
          currentMetrics.missedOpportunities,
          previousMetrics.missedOpportunities
        ),
        delayedTasks: metricWithCompare(
          currentMetrics.delayedTasks,
          previousMetrics.delayedTasks
        ),
        conversionRate: metricWithCompare(
          currentMetrics.conversionRate,
          previousMetrics.conversionRate
        ),
      },

      needsAttention,
      salesFunnel,
      sourcePerformance,
      followUp,
      missedOpportunities,
      conversationPerformance,
      teamTaskReport,
      revenue,

      modules: {
        exportPdfEnabled: true,
        scheduleReportEnabled: false,
        revenueConnected: false,
        quotationConnected: false,
      },
    });
  } catch (error) {
    console.error("Reports overview error:", error);

    return res.status(500).json({
      message: "Failed to load reports",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}