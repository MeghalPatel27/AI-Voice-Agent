import { Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const statuses = [
  "NEW",
  "IN_PROGRESS",
  "FOLLOW_UP",
  "HUMAN_REQUIRED",
  "CONVERTED",
  "LOST",
] as const;

const updatePipelineSchema = z.object({
  status: z.enum(statuses),
  nextAction: z.string().optional(),
});

type PipelineStatus = (typeof statuses)[number];

const statusOrder: Record<PipelineStatus, number> = {
  NEW: 1,
  IN_PROGRESS: 2,
  FOLLOW_UP: 3,
  HUMAN_REQUIRED: 4,
  CONVERTED: 5,
  LOST: 6,
};

export async function getPipeline(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { search, channel } = req.query;

    const where: Prisma.ConversationWhereInput = {
      companyId: req.user.companyId,
    };

    if (channel && typeof channel === "string" && channel !== "ALL") {
      where.channel = channel as any;
    }

    if (search && typeof search === "string") {
      where.OR = [
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
          intent: {
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
          lastMessage: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: [
        {
          updatedAt: "desc",
        },
      ],
      include: {
        customer: true,
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 3,
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
            bookings: true,
            calls: true,
          },
        },
      },
      take: 300,
    });

    const columns = statuses.map((status) => {
      const items = conversations.filter(
        (conversation) => conversation.status === status
      );

      return {
        status,
        title: formatStatus(status),
        count: items.length,
        conversations: items,
      };
    });

    const summary = {
      total: conversations.length,
      new: conversations.filter((item) => item.status === "NEW").length,
      inProgress: conversations.filter((item) => item.status === "IN_PROGRESS")
        .length,
      followUp: conversations.filter((item) => item.status === "FOLLOW_UP")
        .length,
      humanRequired: conversations.filter(
        (item) => item.status === "HUMAN_REQUIRED" || item.humanNeeded
      ).length,
      converted: conversations.filter((item) => item.status === "CONVERTED")
        .length,
      lost: conversations.filter((item) => item.status === "LOST").length,
      conversionRate:
        conversations.length > 0
          ? Math.round(
              (conversations.filter((item) => item.status === "CONVERTED")
                .length /
                conversations.length) *
                100
            )
          : 0,
    };

    return res.json({
      columns,
      summary,
      statuses,
    });
  } catch (error) {
    console.error("Get pipeline error:", error);

    return res.status(500).json({
      message: "Failed to fetch pipeline",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updatePipelineConversation(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = updatePipelineSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { id } = req.params;

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        id,
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
        id,
      },
      data: {
        status: result.data.status,
        humanNeeded: result.data.status === "HUMAN_REQUIRED",
        nextAction:
          result.data.nextAction ||
          getDefaultNextAction(result.data.status, existingConversation.nextAction),
        updatedAt: new Date(),
      },
      include: {
        customer: true,
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 3,
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
            bookings: true,
            calls: true,
          },
        },
      },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: "HUMAN",
        body: `Pipeline status changed to ${formatStatus(result.data.status)}.`,
      },
    });

    return res.json({
      message: "Pipeline conversation updated",
      conversation,
    });
  } catch (error) {
    console.error("Update pipeline conversation error:", error);

    return res.status(500).json({
      message: "Failed to update pipeline conversation",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function getDefaultNextAction(status: PipelineStatus, current?: string | null) {
  if (status === "NEW") return "Review new lead.";
  if (status === "IN_PROGRESS") return "Team is actively handling this lead.";
  if (status === "FOLLOW_UP") return "Follow up with the customer.";
  if (status === "HUMAN_REQUIRED") return "Human team must handle this lead.";
  if (status === "CONVERTED") return "Lead converted successfully.";
  if (status === "LOST") return "Lead marked as lost.";

  return current || "Review lead.";
}

function formatStatus(status: string) {
  return status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}