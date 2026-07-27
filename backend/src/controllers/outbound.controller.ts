import { Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  deliverOutboundMessageById,
  deliverPendingOutboundMessages,
} from "../services/outboundDelivery.service";

const updateOutboundSchema = z.object({
  status: z.enum(["PENDING", "SENT", "FAILED"]).optional(),
  providerMessageId: z.string().optional().nullable(),
  errorMessage: z.string().optional().nullable(),
});

export async function getOutboundMessages(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { channel, status, search } = req.query;

    const where: Prisma.OutboundMessageWhereInput = {
      companyId: req.user.companyId,
    };

    if (channel && typeof channel === "string" && channel !== "ALL") {
      where.channel = channel as any;
    }

    if (status && typeof status === "string" && status !== "ALL") {
      where.status = status as any;
    }

    if (search && typeof search === "string") {
      where.OR = [
        {
          toPhone: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          body: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          errorMessage: {
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
      ];
    }

    const messages = await prisma.outboundMessage.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      include: {
        customer: true,
        conversation: {
          select: {
            id: true,
            channel: true,
            status: true,
            intent: true,
            aiSummary: true,
          },
        },
      },
      take: 200,
    });

    const summary = {
      total: messages.length,
      pending: messages.filter((message) => message.status === "PENDING")
        .length,
      sent: messages.filter((message) => message.status === "SENT").length,
      failed: messages.filter((message) => message.status === "FAILED").length,
      whatsapp: messages.filter((message) => message.channel === "WHATSAPP")
        .length,
      calls: messages.filter((message) => message.channel === "AI_CALL").length,
    };

    return res.json({
      messages,
      summary,
    });
  } catch (error) {
    console.error("Get outbound messages error:", error);

    return res.status(500).json({
      message: "Failed to fetch outbound messages",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getPendingOutboundMessages(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const messages = await prisma.outboundMessage.findMany({
      where: {
        companyId: req.user.companyId,
        status: "PENDING",
      },
      orderBy: {
        createdAt: "asc",
      },
      include: {
        customer: true,
        conversation: {
          select: {
            id: true,
            channel: true,
            status: true,
            intent: true,
            aiSummary: true,
          },
        },
      },
      take: 100,
    });

    return res.json({
      messages,
      count: messages.length,
    });
  } catch (error) {
    console.error("Get pending outbound messages error:", error);

    return res.status(500).json({
      message: "Failed to fetch pending outbound messages",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendPendingOutboundMessages(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = await deliverPendingOutboundMessages({
      companyId: req.user.companyId,
      channel: "WHATSAPP",
      limit: 50,
    });

    return res.json({
      message: "Pending WhatsApp outbound messages processed",
      ...result,
    });
  } catch (error) {
    console.error("Send pending outbound messages error:", error);

    return res.status(500).json({
      message: "Failed to send pending outbound messages",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function sendSingleOutboundMessage(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        message: "Outbound message id is required",
      });
    }

    const result = await deliverOutboundMessageById(id, req.user.companyId);

    return res.json({
      message: "Outbound message processed",
      result,
    });
  } catch (error) {
    console.error("Send outbound message error:", error);

    return res.status(500).json({
      message: "Failed to send outbound message",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateOutboundMessage(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = updateOutboundSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { id } = req.params;

    const existingMessage = await prisma.outboundMessage.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!existingMessage) {
      return res.status(404).json({
        message: "Outbound message not found",
      });
    }

    const outboundMessage = await prisma.outboundMessage.update({
      where: {
        id,
      },
      data: result.data,
    });

    return res.json({
      message: "Outbound message updated",
      outboundMessage,
    });
  } catch (error) {
    console.error("Update outbound message error:", error);

    return res.status(500).json({
      message: "Failed to update outbound message",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}