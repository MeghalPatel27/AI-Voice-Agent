import { Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const updateHandoverSchema = z.object({
  status: z.enum([
    "NEW",
    "IN_PROGRESS",
    "FOLLOW_UP",
    "CONVERTED",
    "HUMAN_REQUIRED",
    "LOST",
  ]),
  humanNeeded: z.boolean().optional(),
  note: z.string().optional(),
});

const addHumanNoteSchema = z.object({
  note: z.string().min(1),
});

type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

const priorityRank: Record<Priority, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export async function getHandoverQueue(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        companyId: req.user.companyId,
        OR: [
          {
            humanNeeded: true,
          },
          {
            status: "HUMAN_REQUIRED",
          },
          {
            priority: {
              in: ["CRITICAL", "HIGH"],
            },
          },
        ],
      },
      orderBy: [
        {
          priority: "asc",
        },
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
          take: 12,
        },
        tasks: {
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
        },
        bookings: {
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
        },
        calls: {
          orderBy: {
            createdAt: "desc",
          },
          take: 3,
        },
      },
    });

    const sortedConversations = [...conversations].sort((a, b) => {
      const priorityDifference =
        priorityRank[b.priority as Priority] -
        priorityRank[a.priority as Priority];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    });

    const summary = {
      total: sortedConversations.length,
      critical: sortedConversations.filter(
        (conversation) => conversation.priority === "CRITICAL"
      ).length,
      high: sortedConversations.filter(
        (conversation) => conversation.priority === "HIGH"
      ).length,
      humanRequired: sortedConversations.filter(
        (conversation) =>
          conversation.humanNeeded || conversation.status === "HUMAN_REQUIRED"
      ).length,
      converted: sortedConversations.filter(
        (conversation) => conversation.status === "CONVERTED"
      ).length,
      lost: sortedConversations.filter(
        (conversation) => conversation.status === "LOST"
      ).length,
    };

    return res.json({
      conversations: sortedConversations,
      summary,
    });
  } catch (error) {
    console.error("Get handover queue error:", error);

    return res.status(500).json({
      message: "Failed to fetch handover queue",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateHandoverConversation(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = updateHandoverSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        message: "Conversation id is required",
      });
    }

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

    const shouldNeedHuman =
      typeof result.data.humanNeeded === "boolean"
        ? result.data.humanNeeded
        : result.data.status === "HUMAN_REQUIRED";

    const conversation = await prisma.$transaction(async (tx) => {
      const updatedConversation = await tx.conversation.update({
        where: {
          id,
        },
        data: {
          status: result.data.status,
          humanNeeded: shouldNeedHuman,
          nextAction:
            result.data.note ||
            (result.data.status === "CONVERTED"
              ? "Customer marked as converted by human."
              : result.data.status === "LOST"
                ? "Customer marked as lost by human."
                : result.data.status === "IN_PROGRESS"
                  ? "Human team is handling this conversation."
                  : existingConversation.nextAction),
          updatedAt: new Date(),
        },
        include: {
          customer: true,
          messages: {
            orderBy: {
              createdAt: "desc",
            },
            take: 12,
          },
          tasks: {
            orderBy: {
              createdAt: "desc",
            },
            take: 5,
          },
          bookings: {
            orderBy: {
              createdAt: "desc",
            },
            take: 5,
          },
          calls: {
            orderBy: {
              createdAt: "desc",
            },
            take: 3,
          },
        },
      });

      if (result.data.note?.trim()) {
        await tx.message.create({
          data: {
            conversationId: id,
            senderType: "HUMAN",
            body: result.data.note.trim(),
          },
        });
      }

      return updatedConversation;
    });

    return res.json({
      message: "Handover conversation updated",
      conversation,
    });
  } catch (error) {
    console.error("Update handover conversation error:", error);

    return res.status(500).json({
      message: "Failed to update handover conversation",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function addHumanNote(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = addHumanNoteSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        message: "Conversation id is required",
      });
    }

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

    const note = await prisma.message.create({
      data: {
        conversationId: id,
        senderType: "HUMAN",
        body: result.data.note.trim(),
      },
    });

    await prisma.conversation.update({
      where: {
        id,
      },
      data: {
        nextAction: result.data.note.trim(),
        updatedAt: new Date(),
      },
    });

    return res.status(201).json({
      message: "Human note added",
      note,
    });
  } catch (error) {
    console.error("Add human note error:", error);

    return res.status(500).json({
      message: "Failed to add human note",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}