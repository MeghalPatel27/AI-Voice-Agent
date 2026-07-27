import { Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  isWhatsAppCloudConfigured,
  sendWhatsAppTextMessage,
} from "../services/whatsappProvider.service";

const updateWhatsAppIntegrationSchema = z.object({
  whatsappProviderMode: z.enum(["mock", "cloud"]).optional(),
  businessWhatsappNumber: z.string().optional().nullable(),
  mainWhatsappNumber: z.string().optional().nullable(),
  whatsappNumber: z.string().optional().nullable(),
  whatsappPhoneNumberId: z.string().optional().nullable(),
  whatsappAccessToken: z.string().optional().nullable(),
  whatsappBusinessAccountId: z.string().optional().nullable(),
  whatsappGraphApiVersion: z.string().optional().nullable(),
  whatsappWebhookVerifyToken: z.string().optional().nullable(),
});

const testSendSchema = z.object({
  to: z.string().min(3),
  body: z.string().min(1),
});

function maskSecret(value?: string | null) {
  if (!value) return "";

  if (value.length <= 12) {
    return "••••••";
  }

  return `${value.slice(0, 6)}••••••${value.slice(-4)}`;
}

function normalizePublicUrl(value?: string | null) {
  return String(value || "").trim().replace(/\/$/, "");
}

function getWebhookUrl() {
  const publicUrl = normalizePublicUrl(process.env.PUBLIC_WEBHOOK_URL);
  return publicUrl ? `${publicUrl}/api/webhooks/meta/whatsapp` : "";
}

function getBusinessNumber(settings: any) {
  return settings.mainWhatsappNumber || settings.whatsappNumber || "";
}

function buildRuntimeConfig(settings: any) {
  const connected = isWhatsAppCloudConfigured({
    providerMode: settings.whatsappProviderMode,
    accessToken: settings.whatsappAccessToken,
    phoneNumberId: settings.whatsappPhoneNumberId,
  });

  return {
    status: connected ? "CONNECTED" : "NOT_CONNECTED",
    mode: connected ? "LIVE" : "DEMO",
    provider: "whatsapp_cloud",
    businessNumber: getBusinessNumber(settings),
    displayName: "WhatsApp Cloud API",
    phoneNumberId: settings.whatsappPhoneNumberId || "",
    businessAccountId: settings.whatsappBusinessAccountId || "",
    graphApiVersion: settings.whatsappGraphApiVersion || "v20.0",
    accessTokenMasked: maskSecret(settings.whatsappAccessToken),
    webhookVerifyTokenMasked: maskSecret(settings.whatsappWebhookVerifyToken),
    webhookUrl: getWebhookUrl(),
    webhookStatus: getWebhookUrl() ? "READY" : "PUBLIC_URL_MISSING",
    aiReplyMode: settings.aiReplyMode || "DRAFT_ONLY",
  };
}

async function getOrCreateSettings(companyId: string) {
  const existingSettings = await prisma.companySettings.findUnique({
    where: {
      companyId,
    },
  });

  if (existingSettings) {
    return existingSettings;
  }

  return prisma.companySettings.create({
    data: {
      companyId,
      whatsappProviderMode: "mock",
      whatsappGraphApiVersion: "v20.0",
      whatsappWebhookVerifyToken: "airadesk_verify_token",
    },
  });
}

function asObject(value: any) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  return {};
}

async function syncWhatsAppRuntime(companyId: string, settings: any) {
  const runtime = buildRuntimeConfig(settings);
  const existingChannelSettings = asObject(settings.channelSettings);

  await prisma.companySettings.update({
    where: {
      companyId,
    },
    data: {
      channelSettings: {
        ...existingChannelSettings,
        whatsapp: runtime,
      },
    },
  });

  await prisma.integrationConnection.upsert({
    where: {
      companyId_provider: {
        companyId,
        provider: "whatsapp_cloud",
      },
    },
    create: {
      companyId,
      provider: "whatsapp_cloud",
      channel: "WHATSAPP",
      status: runtime.status === "CONNECTED" ? "LIVE" : "NOT_CONNECTED",
      displayName: "WhatsApp Cloud API",
      accountId: runtime.businessAccountId || null,
      phoneNumber: runtime.businessNumber || null,
      webhookUrl: runtime.webhookUrl || null,
      mode: runtime.mode,
      lastCheckedAt: new Date(),
      metadata: runtime,
    },
    update: {
      channel: "WHATSAPP",
      status: runtime.status === "CONNECTED" ? "LIVE" : "NOT_CONNECTED",
      displayName: "WhatsApp Cloud API",
      accountId: runtime.businessAccountId || null,
      phoneNumber: runtime.businessNumber || null,
      webhookUrl: runtime.webhookUrl || null,
      mode: runtime.mode,
      lastCheckedAt: new Date(),
      lastError: runtime.status === "CONNECTED" ? null : "WhatsApp Cloud API credentials missing",
      metadata: runtime,
    },
  });

  return runtime;
}

function buildResponseConfig(settings: any, runtime = buildRuntimeConfig(settings)) {
  return {
    whatsappProviderMode: settings.whatsappProviderMode || "mock",
    businessWhatsappNumber: getBusinessNumber(settings),
    mainWhatsappNumber: settings.mainWhatsappNumber || "",
    whatsappNumber: settings.whatsappNumber || "",
    whatsappPhoneNumberId: settings.whatsappPhoneNumberId || "",
    whatsappAccessTokenSet: Boolean(settings.whatsappAccessToken),
    whatsappAccessTokenPreview: maskSecret(settings.whatsappAccessToken),
    whatsappBusinessAccountId: settings.whatsappBusinessAccountId || "",
    whatsappGraphApiVersion: settings.whatsappGraphApiVersion || "v20.0",
    whatsappWebhookVerifyToken:
      settings.whatsappWebhookVerifyToken || "airadesk_verify_token",
    webhookUrl: runtime.webhookUrl,
    status: runtime.status,
    mode: runtime.mode,
    connected: runtime.status === "CONNECTED",
  };
}

export async function getWhatsAppIntegration(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const settings = await getOrCreateSettings(req.user.companyId);
    const runtime = await syncWhatsAppRuntime(req.user.companyId, settings);

    return res.json({
      config: buildResponseConfig(settings, runtime),
    });
  } catch (error) {
    console.error("Get WhatsApp integration error:", error);

    return res.status(500).json({
      message: "Failed to fetch WhatsApp integration",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateWhatsAppIntegration(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = updateWhatsAppIntegrationSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const existingSettings = await getOrCreateSettings(req.user.companyId);
    const data = result.data;
    const updateData: Record<string, any> = {};

    if (typeof data.whatsappProviderMode === "string") {
      updateData.whatsappProviderMode = data.whatsappProviderMode;
    }

    const businessNumber =
      data.businessWhatsappNumber ?? data.mainWhatsappNumber ?? data.whatsappNumber;

    if (typeof businessNumber !== "undefined") {
      updateData.mainWhatsappNumber = businessNumber || null;
      updateData.whatsappNumber = businessNumber || null;
    }

    if (typeof data.whatsappPhoneNumberId !== "undefined") {
      updateData.whatsappPhoneNumberId = data.whatsappPhoneNumberId || null;
    }

    if (typeof data.whatsappBusinessAccountId !== "undefined") {
      updateData.whatsappBusinessAccountId =
        data.whatsappBusinessAccountId || null;
    }

    if (typeof data.whatsappGraphApiVersion !== "undefined") {
      updateData.whatsappGraphApiVersion =
        data.whatsappGraphApiVersion || "v20.0";
    }

    if (typeof data.whatsappWebhookVerifyToken !== "undefined") {
      updateData.whatsappWebhookVerifyToken =
        data.whatsappWebhookVerifyToken || "airadesk_verify_token";
    }

    if (
      typeof data.whatsappAccessToken === "string" &&
      data.whatsappAccessToken.trim()
    ) {
      updateData.whatsappAccessToken = data.whatsappAccessToken.trim();
    }

    if (data.whatsappProviderMode === "mock") {
      updateData.whatsappProviderMode = "mock";
    }

    const settings = await prisma.companySettings.update({
      where: {
        id: existingSettings.id,
      },
      data: updateData,
    });

    const runtime = await syncWhatsAppRuntime(req.user.companyId, settings);

    return res.json({
      message:
        runtime.status === "CONNECTED"
          ? "WhatsApp Cloud API connected"
          : "WhatsApp integration saved, but live sending is not connected yet",
      config: buildResponseConfig(settings, runtime),
    });
  } catch (error) {
    console.error("Update WhatsApp integration error:", error);

    return res.status(500).json({
      message: "Failed to update WhatsApp integration",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function testWhatsAppIntegrationSend(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = testSendSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const settings = await getOrCreateSettings(req.user.companyId);
    const runtime = await syncWhatsAppRuntime(req.user.companyId, settings);

    if (runtime.status !== "CONNECTED") {
      return res.status(400).json({
        message:
          "WhatsApp is not connected. Add real Meta Cloud API credentials before sending.",
        config: buildResponseConfig(settings, runtime),
      });
    }

    const sendResult = await sendWhatsAppTextMessage({
      to: result.data.to,
      body: result.data.body,
      providerMode: settings.whatsappProviderMode,
      accessToken: settings.whatsappAccessToken,
      phoneNumberId: settings.whatsappPhoneNumberId,
      graphApiVersion: settings.whatsappGraphApiVersion,
    });

    if (!sendResult.ok) {
      return res.status(502).json({
        message: sendResult.errorMessage || "WhatsApp test message failed",
        result: sendResult,
      });
    }

    return res.json({
      message: "WhatsApp test message sent",
      result: sendResult,
    });
  } catch (error) {
    console.error("Test WhatsApp integration send error:", error);

    return res.status(500).json({
      message: "Failed to send WhatsApp test message",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}