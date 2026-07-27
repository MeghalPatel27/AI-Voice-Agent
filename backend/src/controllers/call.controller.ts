import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

function parseDate(value: unknown) {
  if (!value || typeof value !== "string") return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function buildDateRange(query: AuthRequest["query"]) {
  const from = parseDate(query.from);
  const to = parseDate(query.to);

  if (!from && !to) return undefined;

  const range: Prisma.DateTimeFilter = {};

  if (from) {
    range.gte = from;
  }

  if (to) {
    range.lte = to;
  }

  return range;
}

function normalizeSearch(value: unknown) {
  if (!value || typeof value !== "string") return "";

  return value.trim();
}

function buildConversationWhere(req: AuthRequest) {
  const { status, search, provider, recording } = req.query;
  const dateRange = buildDateRange(req.query);
  const searchText = normalizeSearch(search);

  const where: Prisma.ConversationWhereInput = {
    companyId: req.user!.companyId,
    channel: "AI_CALL",
  };

  if (status && typeof status === "string" && status !== "ALL") {
    where.status = status as any;
  }

  if (dateRange) {
    where.createdAt = dateRange;
  }

  if (provider && typeof provider === "string" && provider !== "ALL") {
    where.provider = provider;
  }

  if (recording === "WITH_RECORDING") {
    where.calls = {
      some: {
        recordingUrl: {
          not: null,
        },
      },
    };
  }

  if (recording === "WITHOUT_RECORDING") {
    where.calls = {
      none: {
        recordingUrl: {
          not: null,
        },
      },
    };
  }

  if (searchText) {
    where.OR = [
      {
        intent: {
          contains: searchText,
          mode: "insensitive",
        },
      },
      {
        aiSummary: {
          contains: searchText,
          mode: "insensitive",
        },
      },
      {
        nextAction: {
          contains: searchText,
          mode: "insensitive",
        },
      },
      {
        lastMessage: {
          contains: searchText,
          mode: "insensitive",
        },
      },
      {
        customer: {
          fullName: {
            contains: searchText,
            mode: "insensitive",
          },
        },
      },
      {
        customer: {
          phone: {
            contains: searchText,
            mode: "insensitive",
          },
        },
      },
      {
        customer: {
          email: {
            contains: searchText,
            mode: "insensitive",
          },
        },
      },
      {
        messages: {
          some: {
            body: {
              contains: searchText,
              mode: "insensitive",
            },
          },
        },
      },
      {
        calls: {
          some: {
            transcript: {
              contains: searchText,
              mode: "insensitive",
            },
          },
        },
      },
      {
        calls: {
          some: {
            phone: {
              contains: searchText,
              mode: "insensitive",
            },
          },
        },
      },
    ];
  }

  return where;
}

function buildCallWhere(req: AuthRequest) {
  const { callStatus, provider, recording, search } = req.query;
  const dateRange = buildDateRange(req.query);
  const searchText = normalizeSearch(search);

  const where: Prisma.CallWhereInput = {
    conversation: {
      companyId: req.user!.companyId,
      channel: "AI_CALL",
    },
  };

  if (callStatus && typeof callStatus === "string" && callStatus !== "ALL") {
    where.status = callStatus as any;
  }

  if (provider && typeof provider === "string" && provider !== "ALL") {
    where.provider = provider;
  }

  if (dateRange) {
    where.createdAt = dateRange;
  }

  if (recording === "WITH_RECORDING") {
    where.recordingUrl = {
      not: null,
    };
  }

  if (recording === "WITHOUT_RECORDING") {
    where.recordingUrl = null;
  }

  if (searchText) {
    where.OR = [
      {
        phone: {
          contains: searchText,
          mode: "insensitive",
        },
      },
      {
        transcript: {
          contains: searchText,
          mode: "insensitive",
        },
      },
      {
        providerCallId: {
          contains: searchText,
          mode: "insensitive",
        },
      },
      {
        recordingSid: {
          contains: searchText,
          mode: "insensitive",
        },
      },
      {
        conversation: {
          customer: {
            fullName: {
              contains: searchText,
              mode: "insensitive",
            },
          },
        },
      },
      {
        conversation: {
          customer: {
            phone: {
              contains: searchText,
              mode: "insensitive",
            },
          },
        },
      },
      {
        conversation: {
          messages: {
            some: {
              body: {
                contains: searchText,
                mode: "insensitive",
              },
            },
          },
        },
      },
    ];
  }

  return where;
}

function buildTranscriptFromMessages(
  messages: Array<{
    senderType: string;
    body: string;
    createdAt: Date;
  }>
) {
  return messages
    .map((message) => {
      const speaker =
        message.senderType === "CUSTOMER"
          ? "Customer"
          : message.senderType === "AI"
            ? "AI"
            : "Human";

      return `[${message.createdAt.toISOString()}] ${speaker}: ${message.body}`;
    })
    .join("\n");
}

function summarizeCallRows(
  calls: Array<{
    status: string;
    durationSeconds: number;
    recordingUrl: string | null;
    transcript: string | null;
  }>
) {
  const totalDurationSeconds = calls.reduce((sum, call) => {
    return sum + (call.durationSeconds || 0);
  }, 0);

  const recorded = calls.filter((call) => Boolean(call.recordingUrl)).length;
  const transcribed = calls.filter((call) => Boolean(call.transcript)).length;

  return {
    totalCalls: calls.length,
    live: calls.filter((call) =>
      ["LIVE", "RINGING", "IN_PROGRESS"].includes(call.status),
    ).length,
    completed: calls.filter((call) => call.status === "COMPLETED").length,
    missed: calls.filter((call) =>
      ["MISSED", "NO_ANSWER", "BUSY", "CANCELED", "FAILED"].includes(call.status),
    ).length,
    transferred: calls.filter((call) => call.status === "TRANSFERRED").length,
    recorded,
    transcribed,
    totalDurationSeconds,
    totalDurationMinutes: Math.round(totalDurationSeconds / 60),
    averageDurationSeconds: calls.length
      ? Math.round(totalDurationSeconds / calls.length)
      : 0,
  };
}


function buildRecordingMediaUrl(call: {
  id: string;
  recordingUrl?: string | null;
  recordingSid?: string | null;
}) {
  if (!call.recordingUrl && !call.recordingSid) return null;

  return `/api/calls/${call.id}/recording/media`;
}

function withRecordingMediaUrl<
  T extends {
    id: string;
    recordingUrl?: string | null;
    recordingSid?: string | null;
  },
>(call: T) {
  return {
    ...call,
    recordingMediaUrl: buildRecordingMediaUrl(call),
  };
}

function withConversationRecordingUrls<
  T extends {
    calls?: Array<{
      id: string;
      recordingUrl?: string | null;
      recordingSid?: string | null;
      [key: string]: any;
    }>;
    [key: string]: any;
  },
>(conversation: T) {
  return {
    ...conversation,
    calls: Array.isArray(conversation.calls)
      ? conversation.calls.map((call) => withRecordingMediaUrl(call))
      : conversation.calls,
  };
}

export async function getCallConversations(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const skip = (page - 1) * limit;

    const conversationWhere = buildConversationWhere(req);
    const callWhere = buildCallWhere(req);

    const [conversations, totalConversations, allCalls, latestCalls] =
      await Promise.all([
        prisma.conversation.findMany({
          where: conversationWhere,
          orderBy: {
            updatedAt: "desc",
          },
          skip,
          take: limit,
          include: {
            customer: true,
            calls: {
              orderBy: {
                createdAt: "desc",
              },
              take: 3,
            },
            messages: {
              orderBy: {
                createdAt: "desc",
              },
              take: 5,
            },
            tasks: {
              orderBy: {
                createdAt: "desc",
              },
              take: 3,
            },
            bookings: {
              orderBy: {
                createdAt: "desc",
              },
              take: 3,
            },
            _count: {
              select: {
                messages: true,
                tasks: true,
                calls: true,
                bookings: true,
              },
            },
          },
        }),

        prisma.conversation.count({
          where: conversationWhere,
        }),

        prisma.call.findMany({
          where: callWhere,
          select: {
            status: true,
            durationSeconds: true,
            recordingUrl: true,
            transcript: true,
          },
        }),

        prisma.call.findMany({
          where: callWhere,
          orderBy: {
            createdAt: "desc",
          },
          take: 10,
          include: {
            conversation: {
              include: {
                customer: true,
              },
            },
          },
        }),
      ]);

    const summary = {
      totalConversations,
      humanRequired: conversations.filter(
        (conversation) => conversation.humanNeeded
      ).length,
      followUpNeeded: conversations.filter(
        (conversation) => conversation.status === "FOLLOW_UP"
      ).length,
      ...summarizeCallRows(allCalls),
    };

    return res.json({
      conversations: conversations.map((conversation) =>
        withConversationRecordingUrls(conversation)
      ),
      latestCalls: latestCalls.map((call) => withRecordingMediaUrl(call)),
      summary,
      pagination: {
        page,
        limit,
        total: totalConversations,
        totalPages: Math.ceil(totalConversations / limit),
      },
    });
  } catch (error) {
    console.error("Get call conversations error:", error);

    return res.status(500).json({
      message: "Failed to fetch call conversations",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getCallConversationById(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        channel: "AI_CALL",
      },
      include: {
        customer: true,
        calls: {
          orderBy: {
            createdAt: "desc",
          },
        },
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
        tasks: {
          orderBy: {
            createdAt: "desc",
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
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Call conversation not found",
      });
    }

    const computedTranscript = buildTranscriptFromMessages(
      conversation.messages
    );

    const latestCall = conversation.calls[0] || null;

    return res.json({
      conversation: withConversationRecordingUrls({
        ...conversation,
        computedTranscript,
        latestCall: latestCall ? withRecordingMediaUrl(latestCall) : null,
      }),
    });
  } catch (error) {
    console.error("Get call conversation error:", error);

    return res.status(500).json({
      message: "Failed to fetch call conversation",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getCallById(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    const call = await prisma.call.findFirst({
      where: {
        id,
        conversation: {
          companyId: req.user.companyId,
          channel: "AI_CALL",
        },
      },
      include: {
        conversation: {
          include: {
            customer: true,
            messages: {
              orderBy: {
                createdAt: "asc",
              },
            },
            tasks: {
              orderBy: {
                createdAt: "desc",
              },
            },
            bookings: {
              orderBy: {
                createdAt: "desc",
              },
            },
          },
        },
      },
    });

    if (!call) {
      return res.status(404).json({
        message: "Call not found",
      });
    }

    return res.json({
      call: withRecordingMediaUrl({
        ...call,
        computedTranscript: buildTranscriptFromMessages(
          call.conversation.messages
        ),
      }),
    });
  } catch (error) {
    console.error("Get call by id error:", error);

    return res.status(500).json({
      message: "Failed to fetch call",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getCallRecordings(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const skip = (page - 1) * limit;

    const where: Prisma.CallWhereInput = {
      conversation: {
        companyId: req.user.companyId,
        channel: "AI_CALL",
      },
      recordingUrl: {
        not: null,
      },
    };

    const [recordings, total] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
        include: {
          conversation: {
            include: {
              customer: true,
            },
          },
        },
      }),

      prisma.call.count({
        where,
      }),
    ]);

    return res.json({
      recordings: recordings.map((recording) => withRecordingMediaUrl(recording)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get call recordings error:", error);

    return res.status(500).json({
      message: "Failed to fetch call recordings",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateCallTranscript(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;
    const transcript = String(req.body.transcript || "").trim();

    const call = await prisma.call.findFirst({
      where: {
        id,
        conversation: {
          companyId: req.user.companyId,
          channel: "AI_CALL",
        },
      },
      include: {
        conversation: true,
      },
    });

    if (!call) {
      return res.status(404).json({
        message: "Call not found",
      });
    }

    const updated = await prisma.call.update({
      where: {
        id: call.id,
      },
      data: {
        transcript,
      },
    });

    await prisma.conversation.update({
      where: {
        id: call.conversationId,
      },
      data: {
        aiSummary: transcript.slice(0, 500) || call.conversation.aiSummary,
        lastMessage: transcript.slice(0, 300) || call.conversation.lastMessage,
        lastMessageAt: new Date(),
      },
    });

    return res.json({
      message: "Call transcript updated",
      call: updated,
    });
  } catch (error) {
    console.error("Update call transcript error:", error);

    return res.status(500).json({
      message: "Failed to update call transcript",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function markCallConversationHumanRequired(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;
    const reason = String(req.body.reason || "Human follow-up required").trim();

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        channel: "AI_CALL",
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Call conversation not found",
      });
    }

    const updated = await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        humanNeeded: true,
        status: "HUMAN_REQUIRED",
        nextAction: reason,
        lastMessageAt: new Date(),
      },
    });

    await prisma.task.create({
      data: {
        companyId: req.user.companyId,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        title: "Follow up voice call lead",
        description: reason,
        priority: "HIGH",
        status: "OPEN",
        aiNotes:
          "Created from AI call conversation because human follow-up was requested.",
      },
    });

    return res.json({
      message: "Marked as human required and task created",
      conversation: updated,
    });
  } catch (error) {
    console.error("Mark call human required error:", error);

    return res.status(500).json({
      message: "Failed to mark call conversation",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function markCallConversationResolved(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
        channel: "AI_CALL",
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Call conversation not found",
      });
    }

    const updated = await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        humanNeeded: false,
        status: "CONVERTED",
        nextAction: "Call conversation resolved.",
        lastMessageAt: new Date(),
      },
    });

    return res.json({
      message: "Call conversation resolved",
      conversation: updated,
    });
  } catch (error) {
    console.error("Resolve call conversation error:", error);

    return res.status(500).json({
      message: "Failed to resolve call conversation",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}