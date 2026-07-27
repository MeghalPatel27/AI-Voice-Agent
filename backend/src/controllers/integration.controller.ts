import crypto from "crypto";
import { Response } from "express";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

function createSecret() {
  return crypto.randomBytes(32).toString("hex");
}

export async function getIntegrationSecret(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let settings = await prisma.companySettings.findUnique({
      where: {
        companyId: req.user.companyId,
      },
    });

    if (!settings) {
      settings = await prisma.companySettings.create({
        data: {
          companyId: req.user.companyId,
          webhookSecret: createSecret(),
        },
      });
    }

    if (!settings.webhookSecret) {
      settings = await prisma.companySettings.update({
        where: {
          companyId: req.user.companyId,
        },
        data: {
          webhookSecret: createSecret(),
        },
      });
    }

    return res.json({
      companyId: req.user.companyId,
      webhookSecret: settings.webhookSecret,
    });
  } catch (error) {
    console.error("Get integration secret error:", error);

    return res.status(500).json({
      message: "Failed to get integration secret",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function rotateIntegrationSecret(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const settings = await prisma.companySettings.upsert({
      where: {
        companyId: req.user.companyId,
      },
      create: {
        companyId: req.user.companyId,
        webhookSecret: createSecret(),
      },
      update: {
        webhookSecret: createSecret(),
      },
    });

    return res.json({
      companyId: req.user.companyId,
      webhookSecret: settings.webhookSecret,
    });
  } catch (error) {
    console.error("Rotate integration secret error:", error);

    return res.status(500).json({
      message: "Failed to rotate integration secret",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}