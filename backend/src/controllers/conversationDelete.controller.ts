import { Response } from "express";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

export async function deleteConversation(req: AuthRequest, res: Response) {
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
      },
      include: {
        customer: true,
        _count: {
          select: {
            messages: true,
            calls: true,
            tasks: true,
            bookings: true,
            outboundMessages: true,
          },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.outboundMessage.deleteMany({
        where: {
          companyId: req.user!.companyId,
          conversationId: conversation.id,
        },
      });

      await tx.booking.deleteMany({
        where: {
          companyId: req.user!.companyId,
          conversationId: conversation.id,
        },
      });

      await tx.task.deleteMany({
        where: {
          companyId: req.user!.companyId,
          conversationId: conversation.id,
        },
      });

      await tx.call.deleteMany({
        where: {
          conversationId: conversation.id,
        },
      });

      await tx.message.deleteMany({
        where: {
          conversationId: conversation.id,
        },
      });

      await tx.conversation.delete({
        where: {
          id: conversation.id,
        },
      });
    });

    return res.json({
      message: "Conversation deleted",
      deleted: {
        conversationId: conversation.id,
        channel: conversation.channel,
        customerId: conversation.customerId,
        customerName: conversation.customer?.fullName || null,
        customerPhone: conversation.customer?.phone || null,
        counts: conversation._count,
      },
    });
  } catch (error) {
    console.error("Delete conversation error:", error);

    return res.status(500).json({
      message: "Failed to delete conversation",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}