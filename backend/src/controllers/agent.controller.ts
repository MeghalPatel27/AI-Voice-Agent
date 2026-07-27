import { Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const channelSchema = z.enum(["AI_CALL", "WHATSAPP", "WEBSITE_CHAT"]);
const statusSchema = z.enum(["LIVE", "TESTING", "PAUSED", "NOT_CONNECTED"]);

const createAgentSchema = z.object({
  name: z.string().min(1),
  channel: channelSchema,
  status: statusSchema.optional(),
  language: z.string().optional(),
  instructions: z.string().optional(),
});

const updateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  channel: channelSchema.optional(),
  status: statusSchema.optional(),
  language: z.string().optional(),
  instructions: z.string().optional(),
});

export async function getAgents(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const where: Prisma.AiAgentWhereInput = {
      companyId: req.user.companyId,
    };

    const agents = await prisma.aiAgent.findMany({
      where,
      orderBy: [
        {
          status: "asc",
        },
        {
          createdAt: "desc",
        },
      ],
    });

    return res.json({
      agents,
    });
  } catch (error) {
    console.error("Get agents error:", error);

    return res.status(500).json({
      message: "Failed to fetch agents",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createAgent(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = createAgentSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { name, channel, status, language, instructions } = result.data;

    const agent = await prisma.aiAgent.create({
      data: {
        companyId: req.user.companyId,
        name,
        channel,
        status: status || "NOT_CONNECTED",
        language: language || "en-IN",
        instructions,
      },
    });

    return res.status(201).json({
      message: "Agent created",
      agent,
    });
  } catch (error) {
    console.error("Create agent error:", error);

    return res.status(500).json({
      message: "Failed to create agent",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateAgent(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const result = updateAgentSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const { id } = req.params;

    const existingAgent = await prisma.aiAgent.findFirst({
      where: {
        id,
        companyId: req.user.companyId,
      },
    });

    if (!existingAgent) {
      return res.status(404).json({
        message: "Agent not found",
      });
    }

    const agent = await prisma.aiAgent.update({
      where: {
        id,
      },
      data: result.data,
    });

    return res.json({
      message: "Agent updated",
      agent,
    });
  } catch (error) {
    console.error("Update agent error:", error);

    return res.status(500).json({
      message: "Failed to update agent",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}