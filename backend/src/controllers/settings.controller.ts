import { Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const defaultBusinessHours = days.map((day) => ({
  day,
  open: day !== "Sunday",
  from: "10:00",
  to: "20:00",
}));

const defaultAllowedActions = [
  "Answer FAQs",
  "Send brochure",
  "Book meeting",
  "Create lead",
  "Create task",
  "Collect customer details",
  "Transfer to human",
];

const defaultRestrictedActions = [
  "Cannot give discount",
  "Cannot confirm payment",
  "Cannot make legal claims",
  "Cannot give medical advice",
  "Cannot promise delivery date",
];

const defaultChannelSettings = {
  whatsapp: {
    status: "NOT_CONNECTED",
    mode: "DEMO",
    aiReplyMode: "DRAFT_ONLY",
    businessNumber: "",
    displayName: "",
    phoneNumberId: "",
    businessAccountId: "",
    graphApiVersion: "v20.0",
    accessTokenMasked: "",
    webhookVerifyTokenMasked: "",
    webhookUrl: "",
    webhookStatus: "NOT_CONNECTED",
    lastMessageReceivedAt: null,
  },
  calls: {
    status: "NOT_CONNECTED",
    mode: "DEMO",
    provider: "",
    businessPhoneNumber: "",
    aiVoiceAgent: "",
    transferNumber: "",
    fallbackNumber: "",
    recordingEnabled: true,
    transcriptionEnabled: true,
    missedCallCallbackEnabled: true,
    realtimeEnabled: false,
    businessHoursBehavior: "AI_ANSWERS_AND_TRANSFERS_WHEN_NEEDED",
    afterHoursBehavior: "TAKE_MESSAGE_AND_SCHEDULE_CALLBACK",
    webhookUrl: "",
    websocketUrl: "",
    webhookStatus: "NOT_CONNECTED",
    lastCallAt: null,
  },
  websiteChat: {
    status: "CONNECTED",
    mode: "LIVE",
    widgetEnabled: true,
    greeting: "Hi, how can I help you today?",
  },
  email: {
    status: "NOT_CONNECTED",
    mode: "DEMO",
    fromEmail: "",
    replyMode: "DRAFT_ONLY",
  },
};

const defaultNotificationSettings = {
  quietHoursEnabled: false,
  quietHoursFrom: "22:00",
  quietHoursTo: "08:00",
  dailySummaryEnabled: true,
  dailySummaryTime: "09:00",
  weeklyReportEnabled: false,
};

const defaultTaskWorkflowSettings = {
  managerApprovalRequired: false,
  proofRequired: false,
  overdueReminderHours: 24,
  employeeCanMarkBlocked: true,
  employeeCanCompleteTask: true,
  statuses: [
    "To Do",
    "In Progress",
    "Blocked",
    "Submitted",
    "Completed",
    "Needs Changes",
  ],
};

const defaultSecuritySettings = {
  twoFactorRequired: false,
  sessionTimeoutMinutes: 1440,
  auditLogsEnabled: true,
  dataRetentionDays: 365,
};

const companySchema = z.object({
  companyName: z.string().min(1),
  businessType: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  defaultLanguage: z.string().nullable().optional(),
  supportedLanguages: z.array(z.string()).default([]),
  websiteUrl: z.string().nullable().optional(),
  brandTone: z.string().nullable().optional(),
  mainWhatsappNumber: z.string().nullable().optional(),
  mainCallNumber: z.string().nullable().optional(),
  callForwardingNumber: z.string().nullable().optional(),
  emergencyEscalationNumber: z.string().nullable().optional(),
  businessHours: z.any().optional(),
  closedDays: z.array(z.string()).default([]),
});

const aiBehaviorSchema = z.object({
  aiName: z.string().min(1),
  aiTone: z.string().min(1),
  aiReplyMode: z.enum(["AUTO_REPLY", "DRAFT_ONLY", "HUMAN_APPROVAL", "OFF"]),
  aiReplyLength: z.enum(["SHORT", "MEDIUM", "DETAILED"]),
  aiConfidenceThreshold: z.number().int().min(1).max(100),
  aiAllowedActions: z.array(z.string()).default([]),
  aiRestrictedActions: z.array(z.string()).default([]),
  aiFallbackResponse: z.string().nullable().optional(),
});

const channelSchema = z.object({
  settings: z.any(),
});

const knowledgeSchema = z.object({
  title: z.string().min(1),
  category: z.string().min(1),
  content: z.string().min(1),
  enabled: z.boolean().default(true),
  sourceType: z.string().nullable().optional(),
  fileUrl: z.string().nullable().optional(),
});

const crmStageSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullable().optional(),
  order: z.number().int().default(0),
  isEnabled: z.boolean().default(true),
  requiredFields: z.any().optional(),
  automationRule: z.any().optional(),
});

const handoffRuleSchema = z.object({
  name: z.string().min(1),
  condition: z.string().min(1),
  action: z.string().min(1),
  assignedUserId: z.string().nullable().optional(),
  notificationChannel: z.string().nullable().optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("HIGH"),
  isEnabled: z.boolean().default(true),
});

const notificationRuleSchema = z.object({
  name: z.string().min(1),
  event: z.string().min(1),
  recipients: z.array(z.string()).default([]),
  channels: z.array(z.string()).default(["IN_APP"]),
  isEnabled: z.boolean().default(true),
  quietHours: z.any().optional(),
});

const teamSettingsSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "STAFF"]).optional(),
  department: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  workloadCapacity: z.number().int().min(1).max(50).optional(),
  permissions: z.any().optional(),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6),
});

const genericSettingsSchema = z.object({
  settings: z.any(),
});

function getActorUserId(req: AuthRequest) {
  return (req.user as any)?.userId || (req.user as any)?.id || null;
}

function asObject(value: any, fallback: Record<string, any> = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }

  return fallback;
}

function envValue(name: string) {
  return String(process.env[name] || "").trim();
}

function hasRealValue(value?: string | null) {
  const clean = String(value || "").trim().toLowerCase();

  if (!clean) return false;

  return ![
    "paste_sid_here",
    "paste_auth_token_here",
    "paste_your_real_auth_token_here",
    "paste_your_account_sid_here",
    "paste_your_twilio_number_here",
    "paste_new_ngrok_url_here",
    "your_ngrok_url_later",
    "your_openai_api_key_here",
    "paste_key_here",
    "paste_token_here",
    "mock",
    "demo",
    "none",
    "null",
    "undefined",
  ].some((badValue) => clean.includes(badValue));
}

function maskSecret(value?: string | null) {
  const clean = String(value || "").trim();

  if (!hasRealValue(clean)) return "";

  if (clean.length <= 8) {
    return "••••";
  }

  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

function getPublicWebhookUrl() {
  const publicUrl = envValue("PUBLIC_WEBHOOK_URL");

  if (!hasRealValue(publicUrl)) {
    return "";
  }

  return publicUrl.replace(/\/$/, "");
}

function getRealtimeWebSocketUrl(publicUrl: string) {
  if (!publicUrl) return "";

  if (publicUrl.startsWith("https://")) {
    return publicUrl.replace("https://", "wss://") + "/api/voice/twilio/realtime";
  }

  if (publicUrl.startsWith("http://")) {
    return publicUrl.replace("http://", "ws://") + "/api/voice/twilio/realtime";
  }

  return `wss://${publicUrl}/api/voice/twilio/realtime`;
}

function buildVoiceRuntimeStatus(settings: any) {
  const publicUrl = getPublicWebhookUrl();

  const accountSid = envValue("TWILIO_ACCOUNT_SID");
  const authToken = envValue("TWILIO_AUTH_TOKEN");
  const phoneNumber =
    envValue("TWILIO_PHONE_NUMBER") ||
    envValue("VOICE_FROM_NUMBER") ||
    settings?.voiceFromNumber ||
    "";

  const openAiKey = envValue("OPENAI_API_KEY");
  const realtimeModel =
    envValue("OPENAI_REALTIME_MODEL") || "gpt-realtime-2.1-mini";
  const elevenLabsKey = envValue("ELEVENLABS_API_KEY");
  const ttsProviderRaw = envValue("VOICE_TTS_PROVIDER").toLowerCase();
  const hasElevenLabsKey = hasRealValue(elevenLabsKey);
  const ttsProvider =
    ttsProviderRaw === "openai"
      ? "openai"
      : ttsProviderRaw === "elevenlabs" || hasElevenLabsKey
        ? "elevenlabs"
        : "openai";

  const hasTwilio =
    hasRealValue(accountSid) && hasRealValue(authToken) && hasRealValue(phoneNumber);

  const hasRealtime = hasTwilio && hasRealValue(openAiKey) && hasRealValue(publicUrl);

  const webhookUrl = publicUrl
    ? `${publicUrl}/api/voice/twilio/incoming`
    : "";

  const status = hasRealtime ? "CONNECTED" : hasTwilio ? "TESTING" : "NOT_CONNECTED";

  const aiVoiceAgentLabel = hasRealtime
    ? ttsProvider === "elevenlabs" && hasElevenLabsKey
      ? `OpenAI Realtime (${realtimeModel}) + ElevenLabs ${
          envValue("ELEVENLABS_TTS_TRANSPORT").toLowerCase() === "http"
            ? "HTTP TTS"
            : "WS TTS"
        }`
      : `OpenAI Realtime: ${realtimeModel}`
    : hasTwilio
      ? "Twilio connected, OpenAI realtime not ready"
      : "";

  return {
    connected: hasRealtime,
    hasTwilio,
    hasRealtime,
    channelSettings: {
      status,
      mode: hasRealtime ? "LIVE" : hasTwilio ? "TESTING" : "DEMO",
      provider: hasTwilio ? "twilio" : "",
      businessPhoneNumber: phoneNumber,
      aiVoiceAgent: aiVoiceAgentLabel,
      transferNumber: settings?.voiceTransferNumber || "",
      fallbackNumber: settings?.emergencyEscalationNumber || "",
      recordingEnabled: true,
      transcriptionEnabled: true,
      missedCallCallbackEnabled: true,
      realtimeEnabled: hasRealtime,
      businessHoursBehavior: "AI_ANSWERS_AND_TRANSFERS_WHEN_NEEDED",
      afterHoursBehavior: "TAKE_MESSAGE_AND_SCHEDULE_CALLBACK",
      webhookUrl,
      websocketUrl: getRealtimeWebSocketUrl(publicUrl),
      webhookStatus: hasRealValue(publicUrl) ? "CONNECTED" : "NOT_CONNECTED",
      accountSidMasked: maskSecret(accountSid),
      authTokenMasked: maskSecret(authToken),
      lastCallAt: null,
    },
    connection: {
      provider: "twilio",
      channel: "AI_CALL" as const,
      status: hasRealtime ? "LIVE" : hasTwilio ? "TESTING" : "NOT_CONNECTED",
      displayName: "Twilio Voice",
      accountId: hasRealValue(accountSid) ? accountSid : null,
      phoneNumber: hasRealValue(phoneNumber) ? phoneNumber : null,
      webhookUrl,
      mode: hasRealtime ? "REALTIME" : hasTwilio ? "TESTING" : "DEMO",
      metadata: {
        realtimeEnabled: hasRealtime,
        twilioReady: hasTwilio,
        openAiReady: hasRealValue(openAiKey),
        elevenLabsReady: hasElevenLabsKey,
        ttsProvider,
        ttsTransport:
          ttsProvider === "elevenlabs"
            ? envValue("ELEVENLABS_TTS_TRANSPORT").toLowerCase() === "http"
              ? "http"
              : "websocket"
            : "openai",
        publicWebhookReady: hasRealValue(publicUrl),
        websocketUrl: getRealtimeWebSocketUrl(publicUrl),
        realtimeModel,
        accountSidMasked: maskSecret(accountSid),
      },
    },
  };
}

function buildWhatsappRuntimeStatus(settings: any) {
  const publicUrl = getPublicWebhookUrl();

  const accessToken =
    envValue("WHATSAPP_CLOUD_TOKEN") ||
    envValue("WHATSAPP_ACCESS_TOKEN") ||
    settings?.whatsappAccessToken ||
    "";

  const phoneNumberId =
    envValue("WHATSAPP_PHONE_NUMBER_ID") ||
    settings?.whatsappPhoneNumberId ||
    "";

  const businessAccountId =
    envValue("WHATSAPP_BUSINESS_ACCOUNT_ID") ||
    settings?.whatsappBusinessAccountId ||
    "";

  const verifyToken =
    envValue("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ||
    settings?.whatsappWebhookVerifyToken ||
    "";

  const graphApiVersion =
    envValue("WHATSAPP_GRAPH_API_VERSION") ||
    settings?.whatsappGraphApiVersion ||
    "v20.0";

  const whatsappNumber =
    envValue("WHATSAPP_NUMBER") ||
    envValue("MAIN_WHATSAPP_NUMBER") ||
    settings?.mainWhatsappNumber ||
    settings?.whatsappNumber ||
    "";

  const hasWhatsapp =
    hasRealValue(accessToken) &&
    hasRealValue(phoneNumberId) &&
    hasRealValue(businessAccountId) &&
    hasRealValue(verifyToken) &&
    hasRealValue(publicUrl);

  const webhookUrl = publicUrl ? `${publicUrl}/api/webhooks/whatsapp` : "";

  return {
    connected: hasWhatsapp,
    channelSettings: {
      status: hasWhatsapp ? "CONNECTED" : "NOT_CONNECTED",
      mode: hasWhatsapp ? "LIVE" : "DEMO",
      aiReplyMode: settings?.aiReplyMode || "DRAFT_ONLY",
      businessNumber: whatsappNumber,
      displayName: "WhatsApp Cloud API",
      phoneNumberId,
      businessAccountId,
      graphApiVersion,
      accessTokenMasked: maskSecret(accessToken),
      webhookVerifyTokenMasked: maskSecret(verifyToken),
      webhookUrl,
      webhookStatus: hasWhatsapp ? "CONNECTED" : "NOT_CONNECTED",
      lastMessageReceivedAt: null,
    },
    connection: {
      provider: "whatsapp_cloud",
      channel: "WHATSAPP" as const,
      status: hasWhatsapp ? "LIVE" : "NOT_CONNECTED",
      displayName: "WhatsApp Cloud API",
      accountId: hasRealValue(businessAccountId) ? businessAccountId : null,
      phoneNumber: hasRealValue(whatsappNumber) ? whatsappNumber : null,
      webhookUrl,
      mode: hasWhatsapp ? "LIVE" : "DEMO",
      metadata: {
        phoneNumberId,
        businessAccountId,
        graphApiVersion,
        accessTokenReady: hasRealValue(accessToken),
        verifyTokenReady: hasRealValue(verifyToken),
        publicWebhookReady: hasRealValue(publicUrl),
      },
    },
  };
}

async function audit(
  req: AuthRequest,
  action: string,
  entityType: string,
  message: string,
  entityId?: string,
  metadata?: any
) {
  if (!req.user) return;

  await prisma.auditLog.create({
    data: {
      companyId: req.user.companyId,
      userId: getActorUserId(req),
      action,
      entityType,
      entityId,
      message,
      metadata,
    },
  });
}

async function ensureSettings(companyId: string) {
  return prisma.companySettings.upsert({
    where: {
      companyId,
    },
    update: {},
    create: {
      companyId,
      timezone: "Asia/Kolkata",
      defaultLanguage: "English",
      supportedLanguages: ["English"],
      businessHours: defaultBusinessHours,
      closedDays: [],
      aiName: "AI Assistant",
      aiTone: "Professional",
      aiReplyMode: "DRAFT_ONLY",
      aiReplyLength: "MEDIUM",
      aiConfidenceThreshold: 75,
      aiAllowedActions: defaultAllowedActions,
      aiRestrictedActions: defaultRestrictedActions,
      aiFallbackResponse: "Let me connect you with a team member.",
      channelSettings: defaultChannelSettings,
      notificationSettings: defaultNotificationSettings,
      taskWorkflowSettings: defaultTaskWorkflowSettings,
      securitySettings: defaultSecuritySettings,
      billingSettings: {
        status: "MANUAL",
        message: "Billing is managed manually for this account.",
      },
    },
  });
}

async function syncRuntimeIntegrations(companyId: string, settings: any) {
  const voiceRuntime = buildVoiceRuntimeStatus(settings);
  const whatsappRuntime = buildWhatsappRuntimeStatus(settings);

  const current = asObject(settings.channelSettings, defaultChannelSettings);

  const nextChannelSettings = {
    ...defaultChannelSettings,
    ...current,
    calls: {
      ...defaultChannelSettings.calls,
      ...asObject(current.calls),
      ...voiceRuntime.channelSettings,
    },
    whatsapp: {
      ...defaultChannelSettings.whatsapp,
      ...asObject(current.whatsapp),
      ...whatsappRuntime.channelSettings,
    },
    websiteChat: {
      ...defaultChannelSettings.websiteChat,
      ...asObject(current.websiteChat),
    },
    email: {
      ...defaultChannelSettings.email,
      ...asObject(current.email),
    },
  };

  const updatedSettings = await prisma.companySettings.update({
    where: {
      id: settings.id,
    },
    data: {
      voiceProviderMode: voiceRuntime.connected ? "twilio" : settings.voiceProviderMode,
      voiceProviderName: voiceRuntime.hasTwilio ? "twilio" : settings.voiceProviderName,
      voiceFromNumber:
        voiceRuntime.channelSettings.businessPhoneNumber || settings.voiceFromNumber,
      whatsappProviderMode: whatsappRuntime.connected
        ? "cloud"
        : settings.whatsappProviderMode,
      whatsappPhoneNumberId:
        whatsappRuntime.channelSettings.phoneNumberId ||
        settings.whatsappPhoneNumberId,
      whatsappBusinessAccountId:
        whatsappRuntime.channelSettings.businessAccountId ||
        settings.whatsappBusinessAccountId,
      whatsappGraphApiVersion:
        whatsappRuntime.channelSettings.graphApiVersion ||
        settings.whatsappGraphApiVersion,
      channelSettings: nextChannelSettings,
    },
  });

  await prisma.integrationConnection.upsert({
    where: {
      companyId_provider: {
        companyId,
        provider: voiceRuntime.connection.provider,
      },
    },
    update: {
      channel: voiceRuntime.connection.channel,
      status: voiceRuntime.connection.status as any,
      displayName: voiceRuntime.connection.displayName,
      accountId: voiceRuntime.connection.accountId,
      phoneNumber: voiceRuntime.connection.phoneNumber,
      webhookUrl: voiceRuntime.connection.webhookUrl,
      mode: voiceRuntime.connection.mode,
      lastCheckedAt: new Date(),
      lastError:
        voiceRuntime.connection.status === "NOT_CONNECTED"
          ? "Missing Twilio, OpenAI, or public webhook environment variables."
          : null,
      metadata: voiceRuntime.connection.metadata,
    },
    create: {
      companyId,
      provider: voiceRuntime.connection.provider,
      channel: voiceRuntime.connection.channel,
      status: voiceRuntime.connection.status as any,
      displayName: voiceRuntime.connection.displayName,
      accountId: voiceRuntime.connection.accountId,
      phoneNumber: voiceRuntime.connection.phoneNumber,
      webhookUrl: voiceRuntime.connection.webhookUrl,
      mode: voiceRuntime.connection.mode,
      lastCheckedAt: new Date(),
      lastError:
        voiceRuntime.connection.status === "NOT_CONNECTED"
          ? "Missing Twilio, OpenAI, or public webhook environment variables."
          : null,
      metadata: voiceRuntime.connection.metadata,
    },
  });

  await prisma.integrationConnection.upsert({
    where: {
      companyId_provider: {
        companyId,
        provider: whatsappRuntime.connection.provider,
      },
    },
    update: {
      channel: whatsappRuntime.connection.channel,
      status: whatsappRuntime.connection.status as any,
      displayName: whatsappRuntime.connection.displayName,
      accountId: whatsappRuntime.connection.accountId,
      phoneNumber: whatsappRuntime.connection.phoneNumber,
      webhookUrl: whatsappRuntime.connection.webhookUrl,
      mode: whatsappRuntime.connection.mode,
      lastCheckedAt: new Date(),
      lastError:
        whatsappRuntime.connection.status === "NOT_CONNECTED"
          ? "WhatsApp Cloud API environment variables are not complete yet."
          : null,
      metadata: whatsappRuntime.connection.metadata,
    },
    create: {
      companyId,
      provider: whatsappRuntime.connection.provider,
      channel: whatsappRuntime.connection.channel,
      status: whatsappRuntime.connection.status as any,
      displayName: whatsappRuntime.connection.displayName,
      accountId: whatsappRuntime.connection.accountId,
      phoneNumber: whatsappRuntime.connection.phoneNumber,
      webhookUrl: whatsappRuntime.connection.webhookUrl,
      mode: whatsappRuntime.connection.mode,
      lastCheckedAt: new Date(),
      lastError:
        whatsappRuntime.connection.status === "NOT_CONNECTED"
          ? "WhatsApp Cloud API environment variables are not complete yet."
          : null,
      metadata: whatsappRuntime.connection.metadata,
    },
  });

  return updatedSettings;
}

async function ensureDefaultCrmStages(companyId: string) {
  const count = await prisma.crmStage.count({
    where: {
      companyId,
    },
  });

  if (count > 0) return;

  const stages = [
    "New",
    "In Progress",
    "Follow-up",
    "Meeting Booked",
    "Quotation Sent",
    "Won",
    "Lost",
  ];

  await prisma.crmStage.createMany({
    data: stages.map((stage, index) => ({
      companyId,
      name: stage,
      order: index + 1,
      color:
        stage === "Won"
          ? "emerald"
          : stage === "Lost"
            ? "red"
            : stage === "Follow-up"
              ? "amber"
              : "cyan",
      isEnabled: true,
      requiredFields:
        stage === "Follow-up"
          ? ["followUpDate"]
          : stage === "Won"
            ? ["dealValue"]
            : stage === "Lost"
              ? ["lostReason"]
              : [],
      automationRule:
        stage === "Follow-up"
          ? {
              requireFollowUpDate: true,
            }
          : {},
    })),
  });
}

function getConnectionStatus(settings: any, key: string) {
  const channels = asObject(settings.channelSettings, defaultChannelSettings);
  const channel = asObject(channels[key]);

  return channel.status || "NOT_CONNECTED";
}

function buildSetupHealth({
  company,
  settings,
  teamCount,
  knowledgeCount,
  handoffCount,
  notificationCount,
}: {
  company: any;
  settings: any;
  teamCount: number;
  knowledgeCount: number;
  handoffCount: number;
  notificationCount: number;
}) {
  const checks = [
    {
      key: "COMPANY",
      label: "Company Profile",
      complete: Boolean(company?.name && settings.timezone && settings.mainWhatsappNumber),
      description: "Company name, timezone and main contact number.",
    },
    {
      key: "TEAM",
      label: "Team",
      complete: teamCount > 0,
      description: `${teamCount} active member${teamCount === 1 ? "" : "s"}.`,
    },
    {
      key: "WHATSAPP",
      label: "WhatsApp",
      complete: getConnectionStatus(settings, "whatsapp") === "CONNECTED",
      description:
        getConnectionStatus(settings, "whatsapp") === "CONNECTED"
          ? "Connected"
          : "Not connected",
    },
    {
      key: "CALLS",
      label: "Calls",
      complete: getConnectionStatus(settings, "calls") === "CONNECTED",
      description:
        getConnectionStatus(settings, "calls") === "CONNECTED"
          ? "Connected"
          : "Not connected",
    },
    {
      key: "KNOWLEDGE",
      label: "Knowledge Base",
      complete: knowledgeCount > 0,
      description: `${knowledgeCount} active item${knowledgeCount === 1 ? "" : "s"}.`,
    },
    {
      key: "HANDOFF",
      label: "Handoff Rules",
      complete: handoffCount > 0,
      description: `${handoffCount} enabled rule${handoffCount === 1 ? "" : "s"}.`,
    },
    {
      key: "NOTIFICATIONS",
      label: "Notifications",
      complete: notificationCount > 0,
      description: `${notificationCount} enabled alert rule${notificationCount === 1 ? "" : "s"}.`,
    },
    {
      key: "AI_TEST",
      label: "Test AI Reply",
      complete: knowledgeCount > 0 && handoffCount > 0,
      description: "Test AI after knowledge and handoff rules are ready.",
    },
  ];

  const completed = checks.filter((check) => check.complete).length;

  return {
    checks,
    completed,
    total: checks.length,
    percent: Math.round((completed / checks.length) * 100),
  };
}

export async function getSettingsControlRoom(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    await ensureDefaultCrmStages(req.user.companyId);

    const baseSettings = await ensureSettings(req.user.companyId);
    const runtimeSettings = await syncRuntimeIntegrations(
      req.user.companyId,
      baseSettings
    );

    const [
      company,
      teamMembers,
      knowledgeItems,
      crmStages,
      handoffRules,
      notificationRules,
      auditLogs,
      integrationConnections,
    ] = await Promise.all([
      prisma.company.findUnique({
        where: {
          id: req.user.companyId,
        },
      }),

      prisma.user.findMany({
        where: {
          companyId: req.user.companyId,
        },
        orderBy: [
          {
            isActive: "desc",
          },
          {
            name: "asc",
          },
        ],
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          department: true,
          jobTitle: true,
          workloadCapacity: true,
          permissions: true,
          twoFactorEnabled: true,
          lastActiveAt: true,
          createdAt: true,
        },
      }),

      prisma.knowledgeItem.findMany({
        where: {
          companyId: req.user.companyId,
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),

      prisma.crmStage.findMany({
        where: {
          companyId: req.user.companyId,
        },
        orderBy: {
          order: "asc",
        },
      }),

      prisma.handoffRule.findMany({
        where: {
          companyId: req.user.companyId,
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),

      prisma.notificationRule.findMany({
        where: {
          companyId: req.user.companyId,
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),

      prisma.auditLog.findMany({
        where: {
          companyId: req.user.companyId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
      }),

      prisma.integrationConnection.findMany({
        where: {
          companyId: req.user.companyId,
        },
        orderBy: {
          updatedAt: "desc",
        },
      }),
    ]);

    const channelSettings = asObject(
      runtimeSettings.channelSettings,
      defaultChannelSettings
    );

    const activeKnowledgeCount = knowledgeItems.filter(
      (item) => item.enabled !== false && item.isActive !== false
    ).length;
    const activeHandoffCount = handoffRules.filter((rule) => rule.isEnabled).length;
    const activeNotificationCount = notificationRules.filter(
      (rule) => rule.isEnabled
    ).length;
    const activeTeamCount = teamMembers.filter((member) => member.isActive).length;

    const voiceConnection = integrationConnections.find(
      (item) => item.provider === "twilio"
    );

    const whatsappConnection = integrationConnections.find(
      (item) => item.provider === "whatsapp_cloud"
    );

    return res.json({
      company,
      settings: runtimeSettings,
      teamMembers,
      knowledgeItems,
      crmStages,
      handoffRules,
      notificationRules,
      auditLogs,
      integrationConnections,
      setupHealth: buildSetupHealth({
        company,
        settings: runtimeSettings,
        teamCount: activeTeamCount,
        knowledgeCount: activeKnowledgeCount,
        handoffCount: activeHandoffCount,
        notificationCount: activeNotificationCount,
      }),
      integrations: {
        whatsapp: {
          ...asObject(channelSettings.whatsapp, defaultChannelSettings.whatsapp),
          connection: whatsappConnection || null,
        },
        calls: {
          ...asObject(channelSettings.calls, defaultChannelSettings.calls),
          connection: voiceConnection || null,
        },
        websiteChat: asObject(
          channelSettings.websiteChat,
          defaultChannelSettings.websiteChat
        ),
        email: asObject(channelSettings.email, defaultChannelSettings.email),
        calendar: {
          status: "NOT_CONNECTED",
          mode: "DEMO",
        },
        payment: {
          status: "NOT_CONNECTED",
          mode: "DEMO",
        },
      },
      billing: {
        status: "MANUAL",
        message:
          "Billing is managed manually for this account. Contact support to update your plan or payment method.",
        plan: "Manual Account",
        usage: {
          aiMessages: 0,
          callMinutes: 0,
          whatsappMessages: 0,
          teamSeats: teamMembers.length,
        },
      },
    });
  } catch (error) {
    console.error("Settings control room error:", error);

    return res.status(500).json({
      message: "Failed to load settings",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateCompanySettings(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = companySchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid company settings",
        errors: result.error.flatten(),
      });
    }

    await prisma.company.update({
      where: {
        id: req.user.companyId,
      },
      data: {
        name: result.data.companyName,
      },
    });

    const settings = await ensureSettings(req.user.companyId);

    await prisma.companySettings.update({
      where: {
        id: settings.id,
      },
      data: {
        businessType: result.data.businessType,
        address: result.data.address,
        city: result.data.city,
        country: result.data.country,
        timezone: result.data.timezone,
        defaultLanguage: result.data.defaultLanguage,
        supportedLanguages: result.data.supportedLanguages,
        websiteUrl: result.data.websiteUrl,
        brandTone: result.data.brandTone,
        mainWhatsappNumber: result.data.mainWhatsappNumber,
        mainCallNumber: result.data.mainCallNumber,
        callForwardingNumber: result.data.callForwardingNumber,
        emergencyEscalationNumber: result.data.emergencyEscalationNumber,
        businessHours: result.data.businessHours || defaultBusinessHours,
        closedDays: result.data.closedDays,
      },
    });

    await audit(req, "UPDATE", "COMPANY_SETTINGS", "Company profile updated");

    return res.json({
      message: "Company settings saved",
    });
  } catch (error) {
    console.error("Update company settings error:", error);

    return res.status(500).json({
      message: "Failed to save company settings",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateAiBehavior(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = aiBehaviorSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid AI behavior settings",
        errors: result.error.flatten(),
      });
    }

    const settings = await ensureSettings(req.user.companyId);

    await prisma.companySettings.update({
      where: {
        id: settings.id,
      },
      data: {
        aiName: result.data.aiName,
        aiTone: result.data.aiTone,
        aiReplyMode: result.data.aiReplyMode,
        aiReplyLength: result.data.aiReplyLength,
        aiConfidenceThreshold: result.data.aiConfidenceThreshold,
        aiAllowedActions: result.data.aiAllowedActions,
        aiRestrictedActions: result.data.aiRestrictedActions,
        aiFallbackResponse: result.data.aiFallbackResponse,
      },
    });

    await audit(req, "UPDATE", "AI_BEHAVIOR", "AI behavior updated");

    return res.json({
      message: "AI behavior saved",
    });
  } catch (error) {
    console.error("Update AI behavior error:", error);

    return res.status(500).json({
      message: "Failed to save AI behavior",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateChannelSettings(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const channel = req.params.channel;

    if (!["whatsapp", "calls", "websiteChat", "email"].includes(channel)) {
      return res.status(400).json({
        message: "Invalid channel",
      });
    }

    const result = channelSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid channel settings",
        errors: result.error.flatten(),
      });
    }

    const settings = await ensureSettings(req.user.companyId);
    const current = asObject(settings.channelSettings, defaultChannelSettings);

    const next = {
      ...current,
      [channel]: {
        ...asObject((current as any)[channel]),
        ...result.data.settings,
      },
    };

    await prisma.companySettings.update({
      where: {
        id: settings.id,
      },
      data: {
        channelSettings: next,
      },
    });

    await syncRuntimeIntegrations(req.user.companyId, settings);

    await audit(
      req,
      "UPDATE",
      "CHANNEL_SETTINGS",
      `${channel} settings updated`,
      undefined,
      {
        channel,
      }
    );

    return res.json({
      message: "Channel settings saved",
    });
  } catch (error) {
    console.error("Update channel settings error:", error);

    return res.status(500).json({
      message: "Failed to save channel settings",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function testChannel(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const channel = req.params.channel;
    const settings = await syncRuntimeIntegrations(
      req.user.companyId,
      await ensureSettings(req.user.companyId)
    );

    const channelSettings = asObject(settings.channelSettings, defaultChannelSettings);
    const selectedChannel = asObject((channelSettings as any)[channel]);

    await audit(req, "TEST", "CHANNEL", `${channel} test requested`, undefined, {
      channel,
    });

    return res.json({
      ok: selectedChannel.status === "CONNECTED",
      status: selectedChannel.status || "NOT_CONNECTED",
      message:
        channel === "whatsapp"
          ? selectedChannel.status === "CONNECTED"
            ? "WhatsApp is connected."
            : "WhatsApp is not connected yet. Add Meta Cloud API credentials and webhook."
          : channel === "calls"
            ? selectedChannel.status === "CONNECTED"
              ? "Twilio realtime voice is connected."
              : "Calls are not fully connected yet. Check Twilio, OpenAI and PUBLIC_WEBHOOK_URL."
            : "Test completed.",
      settings: selectedChannel,
    });
  } catch (error) {
    console.error("Test channel error:", error);

    return res.status(500).json({
      message: "Failed to test channel",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createKnowledgeItem(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = knowledgeSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid knowledge item",
        errors: result.error.flatten(),
      });
    }

    const item = await prisma.knowledgeItem.create({
      data: {
        companyId: req.user.companyId,
        title: result.data.title,
        category: result.data.category,
        content: result.data.content,
        enabled: result.data.enabled,
        isActive: result.data.enabled,
        sourceType: result.data.sourceType || "MANUAL",
        fileUrl: result.data.fileUrl || null,
      },
    });

    await audit(req, "CREATE", "KNOWLEDGE", "Knowledge item created", item.id);

    return res.status(201).json({
      message: "Knowledge item created",
      item,
    });
  } catch (error) {
    console.error("Create knowledge error:", error);

    return res.status(500).json({
      message: "Failed to create knowledge item",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateKnowledgeItem(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = knowledgeSchema.partial().safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid knowledge item",
        errors: result.error.flatten(),
      });
    }

    const existing = await prisma.knowledgeItem.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Knowledge item not found",
      });
    }

    const item = await prisma.knowledgeItem.update({
      where: {
        id: existing.id,
      },
      data: {
        title: result.data.title,
        category: result.data.category,
        content: result.data.content,
        enabled: result.data.enabled,
        isActive:
          result.data.enabled === undefined ? undefined : result.data.enabled,
        sourceType: result.data.sourceType,
        fileUrl: result.data.fileUrl,
      },
    });

    await audit(req, "UPDATE", "KNOWLEDGE", "Knowledge item updated", item.id);

    return res.json({
      message: "Knowledge item saved",
      item,
    });
  } catch (error) {
    console.error("Update knowledge error:", error);

    return res.status(500).json({
      message: "Failed to update knowledge item",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteKnowledgeItem(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const existing = await prisma.knowledgeItem.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Knowledge item not found",
      });
    }

    await prisma.knowledgeItem.delete({
      where: {
        id: existing.id,
      },
    });

    await audit(
      req,
      "DELETE",
      "KNOWLEDGE",
      "Knowledge item deleted",
      existing.id
    );

    return res.json({
      message: "Knowledge item deleted",
    });
  } catch (error) {
    console.error("Delete knowledge error:", error);

    return res.status(500).json({
      message: "Failed to delete knowledge item",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function testKnowledgeAnswer(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const question = String(req.body.question || "").trim();

    if (!question) {
      return res.status(400).json({
        message: "Question is required",
      });
    }

    const items = await prisma.knowledgeItem.findMany({
      where: {
        companyId: req.user.companyId,
        enabled: true,
        isActive: true,
      },
      take: 20,
    });

    const match = items.find((item) => {
      const haystack = `${item.title} ${item.category} ${item.content}`.toLowerCase();

      return question
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.length > 3 && haystack.includes(word));
    });

    await audit(req, "TEST", "KNOWLEDGE", "AI answer test requested");

    return res.json({
      answer: match
        ? `Based on your knowledge base: ${match.content.slice(0, 600)}`
        : "I could not find a confident answer in the knowledge base. Add or improve knowledge before allowing AI to answer this question.",
      confidence: match ? 74 : 22,
      matchedItem: match
        ? {
            id: match.id,
            title: match.title,
            category: match.category,
          }
        : null,
    });
  } catch (error) {
    console.error("Test knowledge answer error:", error);

    return res.status(500).json({
      message: "Failed to test AI answer",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createCrmStage(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = crmStageSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid CRM stage",
        errors: result.error.flatten(),
      });
    }

    const stage = await prisma.crmStage.create({
      data: {
        companyId: req.user.companyId,
        name: result.data.name,
        color: result.data.color,
        order: result.data.order,
        isEnabled: result.data.isEnabled,
        requiredFields: result.data.requiredFields,
        automationRule: result.data.automationRule,
      },
    });

    await audit(req, "CREATE", "CRM_STAGE", "CRM stage created", stage.id);

    return res.status(201).json({
      message: "CRM stage created",
      stage,
    });
  } catch (error) {
    console.error("Create CRM stage error:", error);

    return res.status(500).json({
      message: "Failed to create CRM stage",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateCrmStage(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = crmStageSchema.partial().safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid CRM stage",
        errors: result.error.flatten(),
      });
    }

    const existing = await prisma.crmStage.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "CRM stage not found",
      });
    }

    const stage = await prisma.crmStage.update({
      where: {
        id: existing.id,
      },
      data: {
        name: result.data.name,
        color: result.data.color,
        order: result.data.order,
        isEnabled: result.data.isEnabled,
        requiredFields: result.data.requiredFields,
        automationRule: result.data.automationRule,
      },
    });

    await audit(req, "UPDATE", "CRM_STAGE", "CRM stage updated", stage.id);

    return res.json({
      message: "CRM stage saved",
      stage,
    });
  } catch (error) {
    console.error("Update CRM stage error:", error);

    return res.status(500).json({
      message: "Failed to update CRM stage",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteCrmStage(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const existing = await prisma.crmStage.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "CRM stage not found",
      });
    }

    await prisma.crmStage.delete({
      where: {
        id: existing.id,
      },
    });

    await audit(req, "DELETE", "CRM_STAGE", "CRM stage deleted", existing.id);

    return res.json({
      message: "CRM stage deleted",
    });
  } catch (error) {
    console.error("Delete CRM stage error:", error);

    return res.status(500).json({
      message: "Failed to delete CRM stage",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createHandoffRule(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = handoffRuleSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid handoff rule",
        errors: result.error.flatten(),
      });
    }

    const rule = await prisma.handoffRule.create({
      data: {
        companyId: req.user.companyId,
        name: result.data.name,
        condition: result.data.condition,
        action: result.data.action,
        assignedUserId: result.data.assignedUserId,
        notificationChannel: result.data.notificationChannel,
        priority: result.data.priority,
        isEnabled: result.data.isEnabled,
      },
    });

    await audit(
      req,
      "CREATE",
      "HANDOFF_RULE",
      "Handoff rule created",
      rule.id
    );

    return res.status(201).json({
      message: "Handoff rule created",
      rule,
    });
  } catch (error) {
    console.error("Create handoff rule error:", error);

    return res.status(500).json({
      message: "Failed to create handoff rule",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateHandoffRule(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = handoffRuleSchema.partial().safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid handoff rule",
        errors: result.error.flatten(),
      });
    }

    const existing = await prisma.handoffRule.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Handoff rule not found",
      });
    }

    const rule = await prisma.handoffRule.update({
      where: {
        id: existing.id,
      },
      data: {
        name: result.data.name,
        condition: result.data.condition,
        action: result.data.action,
        assignedUserId: result.data.assignedUserId,
        notificationChannel: result.data.notificationChannel,
        priority: result.data.priority,
        isEnabled: result.data.isEnabled,
      },
    });

    await audit(
      req,
      "UPDATE",
      "HANDOFF_RULE",
      "Handoff rule updated",
      rule.id
    );

    return res.json({
      message: "Handoff rule saved",
      rule,
    });
  } catch (error) {
    console.error("Update handoff rule error:", error);

    return res.status(500).json({
      message: "Failed to update handoff rule",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteHandoffRule(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const existing = await prisma.handoffRule.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Handoff rule not found",
      });
    }

    await prisma.handoffRule.delete({
      where: {
        id: existing.id,
      },
    });

    await audit(
      req,
      "DELETE",
      "HANDOFF_RULE",
      "Handoff rule deleted",
      existing.id
    );

    return res.json({
      message: "Handoff rule deleted",
    });
  } catch (error) {
    console.error("Delete handoff rule error:", error);

    return res.status(500).json({
      message: "Failed to delete handoff rule",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createNotificationRule(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = notificationRuleSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid notification rule",
        errors: result.error.flatten(),
      });
    }

    const rule = await prisma.notificationRule.create({
      data: {
        companyId: req.user.companyId,
        name: result.data.name,
        event: result.data.event,
        recipients: result.data.recipients,
        channels: result.data.channels,
        quietHours: result.data.quietHours,
        isEnabled: result.data.isEnabled,
      },
    });

    await audit(
      req,
      "CREATE",
      "NOTIFICATION_RULE",
      "Notification rule created",
      rule.id
    );

    return res.status(201).json({
      message: "Notification rule created",
      rule,
    });
  } catch (error) {
    console.error("Create notification rule error:", error);

    return res.status(500).json({
      message: "Failed to create notification rule",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateNotificationRule(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = notificationRuleSchema.partial().safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid notification rule",
        errors: result.error.flatten(),
      });
    }

    const existing = await prisma.notificationRule.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Notification rule not found",
      });
    }

    const rule = await prisma.notificationRule.update({
      where: {
        id: existing.id,
      },
      data: {
        name: result.data.name,
        event: result.data.event,
        recipients: result.data.recipients,
        channels: result.data.channels,
        quietHours: result.data.quietHours,
        isEnabled: result.data.isEnabled,
      },
    });

    await audit(
      req,
      "UPDATE",
      "NOTIFICATION_RULE",
      "Notification rule updated",
      rule.id
    );

    return res.json({
      message: "Notification rule saved",
      rule,
    });
  } catch (error) {
    console.error("Update notification rule error:", error);

    return res.status(500).json({
      message: "Failed to update notification rule",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteNotificationRule(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const existing = await prisma.notificationRule.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existing) {
      return res.status(404).json({
        message: "Notification rule not found",
      });
    }

    await prisma.notificationRule.delete({
      where: {
        id: existing.id,
      },
    });

    await audit(
      req,
      "DELETE",
      "NOTIFICATION_RULE",
      "Notification rule deleted",
      existing.id
    );

    return res.json({
      message: "Notification rule deleted",
    });
  } catch (error) {
    console.error("Delete notification rule error:", error);

    return res.status(500).json({
      message: "Failed to delete notification rule",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateTeamSettings(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "OWNER" && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Only owner or admin can update team permissions",
      });
    }

    const result = teamSettingsSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid team settings",
        errors: result.error.flatten(),
      });
    }

    const member = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!member) {
      return res.status(404).json({
        message: "Team member not found",
      });
    }

    const updated = await prisma.user.update({
      where: {
        id: member.id,
      },
      data: {
        role: result.data.role,
        department: result.data.department,
        jobTitle: result.data.jobTitle,
        workloadCapacity: result.data.workloadCapacity,
        permissions: result.data.permissions,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        department: true,
        jobTitle: true,
        workloadCapacity: true,
        permissions: true,
        isActive: true,
      },
    });

    await audit(
      req,
      "UPDATE",
      "TEAM_MEMBER",
      "Team permissions updated",
      member.id
    );

    return res.json({
      message: "Team member saved",
      member: updated,
    });
  } catch (error) {
    console.error("Update team settings error:", error);

    return res.status(500).json({
      message: "Failed to update team settings",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function resetTeamPassword(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    if (req.user.role !== "OWNER" && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Only owner or admin can reset passwords",
      });
    }

    const result = resetPasswordSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid password",
        errors: result.error.flatten(),
      });
    }

    const member = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!member) {
      return res.status(404).json({
        message: "Team member not found",
      });
    }

    const password = await bcrypt.hash(result.data.password, 10);

    await prisma.user.update({
      where: {
        id: member.id,
      },
      data: {
        password,
      },
    });

    await audit(
      req,
      "UPDATE",
      "TEAM_MEMBER",
      "Team member password reset",
      member.id
    );

    return res.json({
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);

    return res.status(500).json({
      message: "Failed to reset password",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateTaskWorkflowSettings(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = genericSettingsSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid task workflow settings",
        errors: result.error.flatten(),
      });
    }

    const settings = await ensureSettings(req.user.companyId);

    await prisma.companySettings.update({
      where: {
        id: settings.id,
      },
      data: {
        taskWorkflowSettings: result.data.settings,
      },
    });

    await audit(
      req,
      "UPDATE",
      "TASK_WORKFLOW",
      "Task workflow settings updated"
    );

    return res.json({
      message: "Task workflow saved",
    });
  } catch (error) {
    console.error("Update task workflow error:", error);

    return res.status(500).json({
      message: "Failed to save task workflow",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateSecuritySettings(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = genericSettingsSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid security settings",
        errors: result.error.flatten(),
      });
    }

    const settings = await ensureSettings(req.user.companyId);

    await prisma.companySettings.update({
      where: {
        id: settings.id,
      },
      data: {
        securitySettings: result.data.settings,
      },
    });

    await audit(req, "UPDATE", "SECURITY", "Security settings updated");

    return res.json({
      message: "Security settings saved",
    });
  } catch (error) {
    console.error("Update security settings error:", error);

    return res.status(500).json({
      message: "Failed to save security settings",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}