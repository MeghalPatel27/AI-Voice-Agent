import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { getAiDecision } from "../services/llmDecision.service";
import { generateAiReply } from "../services/aiReply.service";
import { runAiActions } from "../services/aiAction.service";
import { deliverOutboundMessageById } from "../services/outboundDelivery.service";

const priorityOptions = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

function asOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const whatsappInboundSchema = z.object({
  customerName: z.string().optional(),
  customerPhone: z.string().min(3),
  customerEmail: z.string().email().optional(),
  message: z.string().min(1),
  intent: z.string().optional(),
  aiSummary: z.string().optional(),
  priority: z.enum(priorityOptions).optional(),
  humanNeeded: z.boolean().optional(),
  taskTitle: z.string().optional(),
});

const callInboundSchema = z.object({
  customerName: z.string().optional(),
  customerPhone: z.string().min(3),
  customerEmail: z.string().email().optional(),
  transcript: z.string().optional(),
  durationSeconds: z.number().int().min(0).optional(),
  status: z.enum(["LIVE", "COMPLETED", "MISSED", "TRANSFERRED"]).optional(),
  intent: z.string().optional(),
  aiSummary: z.string().optional(),
  priority: z.enum(priorityOptions).optional(),
  humanNeeded: z.boolean().optional(),
  taskTitle: z.string().optional(),
});

const outboundStatusSchema = z.object({
  status: z.enum(["SENT", "FAILED"]),
  providerMessageId: z.string().optional(),
  errorMessage: z.string().optional(),
});

type Channel = "WHATSAPP" | "AI_CALL" | "WEBSITE_CHAT";
type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type CompanyContext = {
  company: {
    id: string;
    name: string;
    industry: any;
  };
  settings: {
    businessHours?: unknown;
    handoverRules?: unknown;
    aiTone?: string | null;
    [key: string]: unknown;
  };
};

type ProcessWhatsAppInput = CompanyContext & {
  customerName?: string;
  customerPhone: string;
  customerEmail?: string;
  message: string;
  intent?: string;
  aiSummary?: string;
  priority?: Priority;
  humanNeeded?: boolean;
  taskTitle?: string;
};

type MetaIncomingMessage = {
  phoneNumberId?: string | null;
  customerName?: string;
  customerPhone: string;
  message: string;
  metaMessageId?: string;
  messageType?: string;
};

type MetaStatusUpdate = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipientId?: string;
  errors?: any[];
};

const priorityRank: Record<Priority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function maxPriority(current: Priority, next: Priority): Priority {
  return priorityRank[next] > priorityRank[current] ? next : current;
}

function normalizeMetaPhone(phone: string) {
  if (!phone) return phone;

  return phone.startsWith("+") ? phone : `+${phone}`;
}

function getMetaWebhookVerifyToken() {
  return process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "airadesk_verify_token";
}

function getMetaMessageBody(message: any) {
  const type = message?.type;

  if (type === "text") {
    return message?.text?.body || "";
  }

  if (type === "button") {
    return message?.button?.text || message?.button?.payload || "";
  }

  if (type === "interactive") {
    return (
      message?.interactive?.button_reply?.title ||
      message?.interactive?.button_reply?.id ||
      message?.interactive?.list_reply?.title ||
      message?.interactive?.list_reply?.id ||
      ""
    );
  }

  if (type) {
    return `[Unsupported WhatsApp message type: ${type}]`;
  }

  return "";
}

function extractMetaWhatsAppEvents(payload: any) {
  const incomingMessages: MetaIncomingMessage[] = [];
  const statusUpdates: MetaStatusUpdate[] = [];

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value;

      if (!value) continue;

      const phoneNumberId = value?.metadata?.phone_number_id || null;
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];

      for (const status of statuses) {
        statusUpdates.push({
          id: status?.id,
          status: status?.status,
          timestamp: status?.timestamp,
          recipientId: status?.recipient_id,
          errors: status?.errors,
        });
      }

      for (const message of messages) {
        const from = message?.from;

        if (!from) continue;

        const contact = contacts.find((item: any) => item?.wa_id === from);

        const body = getMetaMessageBody(message);

        if (!body) continue;

        incomingMessages.push({
          phoneNumberId,
          customerName: contact?.profile?.name,
          customerPhone: normalizeMetaPhone(from),
          message: body,
          metaMessageId: message?.id,
          messageType: message?.type,
        });
      }
    }
  }

  return {
    incomingMessages,
    statusUpdates,
  };
}

function getMetaStatusError(status: MetaStatusUpdate) {
  const firstError = status.errors?.[0];

  if (!firstError) return null;

  return (
    firstError?.title ||
    firstError?.message ||
    firstError?.error_data?.details ||
    JSON.stringify(firstError)
  );
}

async function applyMetaStatusUpdates(statusUpdates: MetaStatusUpdate[]) {
  let updated = 0;
  let skipped = 0;

  for (const status of statusUpdates) {
    if (!status.id || !status.status) {
      skipped += 1;
      continue;
    }

    const normalizedStatus = status.status.toLowerCase();

    const nextStatus =
      normalizedStatus === "failed"
        ? "FAILED"
        : ["sent", "delivered", "read"].includes(normalizedStatus)
          ? "SENT"
          : null;

    if (!nextStatus) {
      skipped += 1;
      continue;
    }

    const result = await prisma.outboundMessage.updateMany({
      where: {
        providerMessageId: status.id,
      },
      data: {
        status: nextStatus,
        errorMessage:
          nextStatus === "FAILED" ? getMetaStatusError(status) : null,
      },
    });

    updated += result.count;
  }

  return {
    received: statusUpdates.length,
    updated,
    skipped,
  };
}

async function verifyWebhook(req: Request) {
  const companyId = String(req.headers["x-airadesk-company-id"] || "");
  const secret = String(req.headers["x-airadesk-secret"] || "");

  if (!companyId || !secret) {
    return null;
  }

  const settings = await prisma.companySettings.findFirst({
    where: {
      companyId,
      webhookSecret: secret,
    },
    include: {
      company: true,
    },
  });

  if (!settings) {
    return null;
  }

  return {
    company: settings.company,
    settings,
  };
}

async function getCompanyForMetaWhatsApp(phoneNumberId?: string | null) {
  const phoneNumberIds = [
    phoneNumberId,
    process.env.WHATSAPP_PHONE_NUMBER_ID,
  ]
    .filter(Boolean)
    .map(String);

  if (phoneNumberIds.length > 0) {
    const settingsByPhoneNumberId = await prisma.companySettings.findFirst({
      where: {
        OR: [
          {
            whatsappPhoneNumberId: {
              in: phoneNumberIds,
            },
          },
          {
            whatsappNumber: {
              in: phoneNumberIds,
            },
          },
        ],
      },
      include: {
        company: true,
      },
    });

    if (settingsByPhoneNumberId) {
      return {
        company: settingsByPhoneNumberId.company,
        settings: settingsByPhoneNumberId,
      };
    }
  }

  if (process.env.WHATSAPP_DEFAULT_COMPANY_ID) {
    const settingsByDefaultCompany = await prisma.companySettings.findFirst({
      where: {
        companyId: process.env.WHATSAPP_DEFAULT_COMPANY_ID,
      },
      include: {
        company: true,
      },
    });

    if (settingsByDefaultCompany) {
      return {
        company: settingsByDefaultCompany.company,
        settings: settingsByDefaultCompany,
      };
    }
  }

  const fallbackSettings = await prisma.companySettings.findFirst({
    include: {
      company: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!fallbackSettings) {
    return null;
  }

  return {
    company: fallbackSettings.company,
    settings: fallbackSettings,
  };
}

async function getActiveAgent(companyId: string, channel: Channel) {
  return prisma.aiAgent.findFirst({
    where: {
      companyId,
      channel,
      status: {
        in: ["LIVE", "TESTING"],
      },
    },
    orderBy: [
      {
        status: "asc",
      },
      {
        updatedAt: "desc",
      },
    ],
  });
}

async function getKnowledgeBase(companyId: string) {
  return prisma.knowledgeItem.findMany({
    where: {
      companyId,
      isActive: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 25,
    select: {
      title: true,
      category: true,
      content: true,
    },
  });
}

async function processWhatsAppInboundMessage(input: ProcessWhatsAppInput) {
  const {
    company,
    settings,
    customerName,
    customerPhone,
    customerEmail,
    message,
    intent,
    aiSummary,
    priority,
    humanNeeded,
    taskTitle,
  } = input;

  const activeAgent = await getActiveAgent(company.id, "WHATSAPP");
  const knowledgeBase = await getKnowledgeBase(company.id);

  const decision = await getAiDecision({
    text: message,
    channel: "WHATSAPP",
    industry: company.industry,
    companyName: company.name,
    agentName: activeAgent?.name,
    agentInstructions: activeAgent?.instructions,
    handoverRules: asOptionalString(settings.handoverRules),
    businessHours: asOptionalString(settings.businessHours),
    aiTone: settings.aiTone,
    knowledgeBase,
  });

  const noActiveAgent = !activeAgent;

  const finalIntent = noActiveAgent
    ? "no_active_whatsapp_agent"
    : intent || decision.intent;

  const finalAiSummary = noActiveAgent
    ? `WhatsApp message received but no LIVE/TESTING WhatsApp agent is configured: ${message}`
    : aiSummary || decision.aiSummary;

  const finalPriority = noActiveAgent ? "HIGH" : priority || decision.priority;

  const finalHumanNeeded = noActiveAgent
    ? true
    : typeof humanNeeded === "boolean"
      ? humanNeeded
      : decision.humanNeeded;

  const finalTaskTitle =
    taskTitle ||
    (noActiveAgent
      ? "Connect WhatsApp agent"
      : decision.taskTitle || "Human follow-up needed");

  const finalNextAction = noActiveAgent
    ? "Create or activate a WhatsApp agent before automatic handling."
    : decision.nextAction;

  const aiReply = noActiveAgent
    ? `Thanks for reaching out to ${company.name}. Your message has been received and the team will follow up soon.`
    : decision.reply ||
      generateAiReply({
        companyName: company.name,
        text: message,
        channel: "WHATSAPP",
        intent: finalIntent,
        priority: finalPriority,
        humanNeeded: finalHumanNeeded,
        businessHours: asOptionalString(settings.businessHours),
        aiTone: settings.aiTone,
        agentName: activeAgent?.name,
        agentInstructions: activeAgent?.instructions,
        nextAction: finalNextAction,
      });

  const saved = await prisma.$transaction(async (tx) => {
    let customer = await tx.customer.findFirst({
      where: {
        companyId: company.id,
        phone: customerPhone,
      },
    });

    if (customer) {
      customer = await tx.customer.update({
        where: {
          id: customer.id,
        },
        data: {
          fullName: customerName || customer.fullName,
          email: customerEmail || customer.email,
          source: customer.source || "whatsapp",
        },
      });
    } else {
      customer = await tx.customer.create({
        data: {
          companyId: company.id,
          fullName: customerName || "Unknown Customer",
          phone: customerPhone,
          email: customerEmail,
          source: "whatsapp",
        },
      });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const existingConversation = await tx.conversation.findFirst({
      where: {
        companyId: company.id,
        customerId: customer.id,
        channel: "WHATSAPP",
        status: {
          in: ["NEW", "IN_PROGRESS", "FOLLOW_UP", "HUMAN_REQUIRED"],
        },
        updatedAt: {
          gte: twentyFourHoursAgo,
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const conversation = existingConversation
      ? await tx.conversation.update({
          where: {
            id: existingConversation.id,
          },
          data: {
            status: finalHumanNeeded
              ? "HUMAN_REQUIRED"
              : decision.conversationStatus === "NEW"
                ? "IN_PROGRESS"
                : decision.conversationStatus,
            priority: maxPriority(
              existingConversation.priority as Priority,
              finalPriority
            ),
            intent: finalIntent,
            aiSummary: finalAiSummary,
            nextAction: finalNextAction,
            aiConfidence: noActiveAgent ? 35 : decision.aiConfidence,
            humanNeeded: existingConversation.humanNeeded || finalHumanNeeded,
            lastMessage: message,
            lastMessageAt: new Date(),
            updatedAt: new Date(),
          },
        })
      : await tx.conversation.create({
          data: {
            companyId: company.id,
            customerId: customer.id,
            channel: "WHATSAPP",
            status: finalHumanNeeded
              ? "HUMAN_REQUIRED"
              : decision.conversationStatus === "NEW"
                ? "IN_PROGRESS"
                : decision.conversationStatus,
            priority: finalPriority,
            intent: finalIntent,
            aiSummary: finalAiSummary,
            nextAction: finalNextAction,
            aiConfidence: noActiveAgent ? 35 : decision.aiConfidence,
            humanNeeded: finalHumanNeeded,
            lastMessage: message,
            lastMessageAt: new Date(),
          },
        });

    const savedMessage = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderType: "CUSTOMER",
        body: message,
        provider: "whatsapp_cloud",
        providerMessageId: (input as any).metaMessageId || null,
        providerStatus: "received",
      },
    });

    const aiMessage = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderType: "AI",
        body: aiReply,
        provider: "whatsapp_cloud",
        providerStatus: "queued",
      },
    });

    const outboundMessage = await tx.outboundMessage.create({
      data: {
        companyId: company.id,
        conversationId: conversation.id,
        customerId: customer.id,
        channel: "WHATSAPP",
        toPhone: customerPhone,
        body: aiReply,
        status: "PENDING",
        provider: "whatsapp_cloud",
      },
    });

    const actionResult = await runAiActions({
      tx,
      companyId: company.id,
      customerId: customer.id,
      conversationId: conversation.id,
      companyName: company.name,
      industry: company.industry,
      channel: "WHATSAPP",
      text: message,
      intent: finalIntent,
      aiSummary: finalAiSummary,
      priority: finalPriority,
      humanNeeded: finalHumanNeeded,
      taskTitle: finalTaskTitle,
      nextAction: finalNextAction,
    });

    const refreshedConversation = await tx.conversation.findUnique({
      where: {
        id: conversation.id,
      },
    });

    return {
      customer,
      conversation: refreshedConversation || conversation,
      savedMessage,
      aiMessage,
      aiReply,
      outboundMessage,
      task: actionResult.task,
      booking: actionResult.booking,
      actionResult,
      activeAgent,
      knowledgeUsed: knowledgeBase.length,
    };
  });

  if (saved.outboundMessage?.id) {
    try {
      await deliverOutboundMessageById(saved.outboundMessage.id);
    } catch (error) {
      console.error("Immediate WhatsApp AI reply delivery failed:", error);
    }
  }

  return saved;
}

async function isValidMetaVerifyToken(token: unknown) {
  if (typeof token !== "string" || !token.trim()) return false;

  if (token === getMetaWebhookVerifyToken()) return true;

  const settings = await prisma.companySettings.findFirst({
    where: {
      whatsappWebhookVerifyToken: token,
    },
  });

  return Boolean(settings);
}

export async function metaWhatsAppVerify(req: Request, res: Response) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    typeof challenge === "string" &&
    (await isValidMetaVerifyToken(token))
  ) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
}

export async function metaWhatsAppInbound(req: Request, res: Response) {
  try {
    const { incomingMessages, statusUpdates } = extractMetaWhatsAppEvents(
      req.body
    );

    const statusResult = await applyMetaStatusUpdates(statusUpdates);

    const processedMessages = [];

    for (const incomingMessage of incomingMessages) {
      const verified = await getCompanyForMetaWhatsApp(
        incomingMessage.phoneNumberId
      );

      if (!verified) {
        processedMessages.push({
          skipped: true,
          reason: "No company settings found for WhatsApp phone number ID",
          phoneNumberId: incomingMessage.phoneNumberId,
          customerPhone: incomingMessage.customerPhone,
        });

        continue;
      }

      const saved = await processWhatsAppInboundMessage({
        company: verified.company,
        settings: verified.settings,
        customerName: incomingMessage.customerName,
        customerPhone: incomingMessage.customerPhone,
        message: incomingMessage.message,
        metaMessageId: incomingMessage.metaMessageId,
      } as any);

      processedMessages.push({
        skipped: false,
        metaMessageId: incomingMessage.metaMessageId,
        messageType: incomingMessage.messageType,
        customer: saved.customer,
        conversation: saved.conversation,
        outboundMessage: saved.outboundMessage,
        booking: saved.booking,
        task: saved.task,
        knowledgeUsed: saved.knowledgeUsed,
      });
    }

    return res.status(200).json({
      received: true,
      messagesReceived: incomingMessages.length,
      messagesProcessed: processedMessages.filter((item) => !item.skipped)
        .length,
      statusesReceived: statusResult.received,
      statusesUpdated: statusResult.updated,
      processedMessages,
    });
  } catch (error) {
    console.error("Meta WhatsApp webhook error:", error);

    return res.status(500).json({
      message: "Failed to process Meta WhatsApp webhook",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function whatsappInbound(req: Request, res: Response) {
  try {
    const verified = await verifyWebhook(req);

    if (!verified) {
      return res.status(401).json({
        message: "Invalid webhook credentials",
      });
    }

    const result = whatsappInboundSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const saved = await processWhatsAppInboundMessage({
      company: verified.company,
      settings: verified.settings,
      ...result.data,
    });

    return res.status(201).json({
      message: "WhatsApp inbound processed by AI agent",
      ...saved,
    });
  } catch (error) {
    console.error("WhatsApp webhook error:", error);

    return res.status(500).json({
      message: "Failed to process WhatsApp webhook",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function callInbound(req: Request, res: Response) {
  try {
    const verified = await verifyWebhook(req);

    if (!verified) {
      return res.status(401).json({
        message: "Invalid webhook credentials",
      });
    }

    const { company, settings } = verified;

    const result = callInboundSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: result.error.flatten(),
      });
    }

    const {
      customerName,
      customerPhone,
      customerEmail,
      transcript,
      durationSeconds,
      status,
      intent,
      aiSummary,
      priority,
      humanNeeded,
      taskTitle,
    } = result.data;

    const callText = transcript || "Call received";
    const activeAgent = await getActiveAgent(company.id, "AI_CALL");
    const knowledgeBase = await getKnowledgeBase(company.id);

    const decision = await getAiDecision({
      text: callText,
      channel: "AI_CALL",
      industry: company.industry,
      companyName: company.name,
      agentName: activeAgent?.name,
      agentInstructions: activeAgent?.instructions,
      handoverRules: asOptionalString(settings.handoverRules),
      businessHours: asOptionalString(settings.businessHours),
      aiTone: settings.aiTone,
      knowledgeBase,
    });

    const noActiveAgent = !activeAgent;

    const finalIntent = noActiveAgent
      ? "no_active_call_agent"
      : intent || decision.intent;

    const finalAiSummary = noActiveAgent
      ? `Call received but no LIVE/TESTING call agent is configured: ${callText}`
      : aiSummary || decision.aiSummary;

    const finalPriority = noActiveAgent ? "HIGH" : priority || decision.priority;

    const finalHumanNeeded = noActiveAgent
      ? true
      : typeof humanNeeded === "boolean"
        ? humanNeeded
        : decision.humanNeeded;

    const finalTaskTitle =
      taskTitle ||
      (noActiveAgent
        ? "Connect AI call agent"
        : decision.taskTitle || "Call needs human follow-up");

    const finalNextAction = noActiveAgent
      ? "Create or activate an AI call agent before automatic handling."
      : decision.nextAction;

    const aiReply = noActiveAgent
      ? `Thank you for the call. The team at ${company.name} will follow up soon.`
      : decision.reply ||
        generateAiReply({
          companyName: company.name,
          text: callText,
          channel: "AI_CALL",
          intent: finalIntent,
          priority: finalPriority,
          humanNeeded: finalHumanNeeded,
          businessHours: asOptionalString(settings.businessHours),
          aiTone: settings.aiTone,
          agentName: activeAgent?.name,
          agentInstructions: activeAgent?.instructions,
          nextAction: finalNextAction,
        });

    const saved = await prisma.$transaction(async (tx) => {
      let customer = await tx.customer.findFirst({
        where: {
          companyId: company.id,
          phone: customerPhone,
        },
      });

      if (customer) {
        customer = await tx.customer.update({
          where: {
            id: customer.id,
          },
          data: {
            fullName: customerName || customer.fullName,
            email: customerEmail || customer.email,
            source: customer.source || "ai_call",
          },
        });
      } else {
        customer = await tx.customer.create({
          data: {
            companyId: company.id,
            fullName: customerName || "Unknown Customer",
            phone: customerPhone,
            email: customerEmail,
            source: "ai_call",
          },
        });
      }

      const conversation = await tx.conversation.create({
        data: {
          companyId: company.id,
          customerId: customer.id,
          channel: "AI_CALL",
          status: finalHumanNeeded
            ? "HUMAN_REQUIRED"
            : decision.conversationStatus === "NEW"
              ? "IN_PROGRESS"
              : decision.conversationStatus,
          priority: finalPriority,
          intent: finalIntent,
          aiSummary: finalAiSummary,
          nextAction: finalNextAction,
          aiConfidence: noActiveAgent ? 35 : decision.aiConfidence,
          humanNeeded: finalHumanNeeded,
          lastMessage: callText,
          lastMessageAt: new Date(),
        },
      });

      const call = await tx.call.create({
        data: {
          conversationId: conversation.id,
          phone: customerPhone,
          durationSeconds: durationSeconds || 0,
          transcript,
          status: status || (finalHumanNeeded ? "TRANSFERRED" : "COMPLETED"),
        },
      });

      let transcriptMessage = null;

      if (transcript) {
        transcriptMessage = await tx.message.create({
          data: {
            conversationId: conversation.id,
            senderType: "CUSTOMER",
            body: transcript,
          },
        });
      }

      const aiMessage = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderType: "AI",
          body: aiReply,
        },
      });

      const outboundMessage = await tx.outboundMessage.create({
        data: {
          companyId: company.id,
          conversationId: conversation.id,
          customerId: customer.id,
          channel: "AI_CALL",
          toPhone: customerPhone,
          body: aiReply,
          status: "PENDING",
        },
      });

      const actionResult = await runAiActions({
        tx,
        companyId: company.id,
        customerId: customer.id,
        conversationId: conversation.id,
        companyName: company.name,
        industry: company.industry,
        channel: "AI_CALL",
        text: callText,
        intent: finalIntent,
        aiSummary: finalAiSummary,
        priority: finalPriority,
        humanNeeded: finalHumanNeeded,
        taskTitle: finalTaskTitle,
        nextAction: finalNextAction,
      });

      const refreshedConversation = await tx.conversation.findUnique({
        where: {
          id: conversation.id,
        },
      });

      return {
        customer,
        conversation: refreshedConversation || conversation,
        call,
        transcriptMessage,
        aiMessage,
        aiReply,
        outboundMessage,
        task: actionResult.task,
        booking: actionResult.booking,
        actionResult,
        activeAgent,
        knowledgeUsed: knowledgeBase.length,
      };
    });

    return res.status(201).json({
      message: "Call inbound processed by AI agent",
      ...saved,
    });
  } catch (error) {
    console.error("Call webhook error:", error);

    return res.status(500).json({
      message: "Failed to process call webhook",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getPendingOutboundForProvider(
  req: Request,
  res: Response
) {
  try {
    const verified = await verifyWebhook(req);

    if (!verified) {
      return res.status(401).json({
        message: "Invalid webhook credentials",
      });
    }

    const { company } = verified;

    const messages = await prisma.outboundMessage.findMany({
      where: {
        companyId: company.id,
        status: "PENDING",
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 50,
      select: {
        id: true,
        companyId: true,
        conversationId: true,
        customerId: true,
        channel: true,
        toPhone: true,
        body: true,
        status: true,
        createdAt: true,
      },
    });

    return res.json({
      messages,
    });
  } catch (error) {
    console.error("Provider pending outbound error:", error);

    return res.status(500).json({
      message: "Failed to fetch pending outbound messages",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateOutboundFromProvider(
  req: Request<Record<string, string>>,
  res: Response,
) {
  try {
    const verified = await verifyWebhook(req);

    if (!verified) {
      return res.status(401).json({
        message: "Invalid webhook credentials",
      });
    }

    const { company } = verified;

    const result = outboundStatusSchema.safeParse(req.body);

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
        companyId: company.id,
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
      data: {
        status: result.data.status,
        providerMessageId: result.data.providerMessageId,
        errorMessage: result.data.errorMessage,
      },
    });

    return res.json({
      message: "Outbound message updated",
      outboundMessage,
    });
  } catch (error) {
    console.error("Provider outbound update error:", error);

    return res.status(500).json({
      message: "Failed to update outbound message",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}