import { Response } from "express";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_TEXT_MODEL =
  process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1-mini";

function isMissingKey(value: string) {
  return !value || value.includes("your_openai_api_key_here") || value.includes("paste_");
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function getCompanyBrain(companyId: string) {
  const [company, settings, knowledgeItems] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
    }),

    prisma.companySettings.findUnique({
      where: { companyId },
    }),

    prisma.knowledgeItem.findMany({
      where: {
        companyId,
        enabled: true,
        isActive: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: 30,
    }),
  ]);

  const knowledge = knowledgeItems
    .map((item) => {
      return [
        `Title: ${item.title}`,
        `Category: ${item.category}`,
        `Content: ${item.content}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return {
    company,
    settings: settings as any,
    knowledge,
  };
}

function buildSystemPrompt(input: {
  companyName: string;
  aiName: string;
  aiTone: string;
  replyLength: string;
  allowedActions: string[];
  restrictedActions: string[];
  fallbackResponse: string;
  knowledge: string;
}) {
  return `
You are ${input.aiName}, the AI assistant for ${input.companyName}.

Tone:
${input.aiTone}

Reply length:
${input.replyLength}

Allowed actions:
${input.allowedActions.map((action) => `- ${action}`).join("\n")}

Restricted actions:
${input.restrictedActions.map((action) => `- ${action}`).join("\n")}

Strict rules:
- Use only the business knowledge below.
- If you do not know something, do not invent it.
- If you are not confident, say: "${input.fallbackResponse}"
- Do not give discounts unless the business knowledge clearly says so.
- Do not confirm payments unless payment status is available.
- Do not make legal, medical, delivery, or guarantee claims.
- Collect customer name, phone, requirement, and preferred time when useful.
- Keep the reply useful, clear, and professional.

Business knowledge:
${input.knowledge || "No knowledge base has been added yet."}
`.trim();
}

function extractResponseText(json: any) {
  if (typeof json?.output_text === "string" && json.output_text.trim()) {
    return json.output_text.trim();
  }

  const output = Array.isArray(json?.output) ? json.output : [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];

    for (const part of content) {
      if (typeof part?.text === "string" && part.text.trim()) {
        return part.text.trim();
      }
    }
  }

  return "";
}

export async function getAiProviderStatus(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    return res.json({
      connected: !isMissingKey(OPENAI_API_KEY),
      textModel: OPENAI_TEXT_MODEL,
      hasApiKey: !isMissingKey(OPENAI_API_KEY),
    });
  } catch (error) {
    return res.status(500).json({
      message: "Failed to read AI provider status",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function generateAiReply(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (isMissingKey(OPENAI_API_KEY)) {
      return res.status(400).json({
        message:
          "OpenAI is not connected. Add your real OPENAI_API_KEY in backend/.env and restart backend.",
      });
    }

    const message = cleanText(req.body.message);
    const conversationId = cleanText(req.body.conversationId);

    if (!message) {
      return res.status(400).json({
        message: "Message is required",
      });
    }

    const brain = await getCompanyBrain(req.user.companyId);
    const settings = brain.settings || {};

    const systemPrompt = buildSystemPrompt({
      companyName: brain.company?.name || "this business",
      aiName: settings.aiName || "AI Assistant",
      aiTone: settings.aiTone || "Professional",
      replyLength: settings.aiReplyLength || "MEDIUM",
      allowedActions: Array.isArray(settings.aiAllowedActions)
        ? settings.aiAllowedActions
        : ["Answer FAQs", "Collect customer details", "Transfer to human"],
      restrictedActions: Array.isArray(settings.aiRestrictedActions)
        ? settings.aiRestrictedActions
        : ["Cannot give discount", "Cannot confirm payment"],
      fallbackResponse:
        settings.aiFallbackResponse || "Let me connect you with a team member.",
      knowledge: brain.knowledge,
    });

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_TEXT_MODEL,
        instructions: systemPrompt,
        input: message,
        temperature: 0.3,
        max_output_tokens: 700,
      }),
    });

    const json: any = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        message: "OpenAI request failed",
        error: json?.error?.message || json,
      });
    }

    const reply =
      extractResponseText(json) ||
      "I could not generate a confident reply. Let me connect you with a team member.";

    if (conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          companyId: req.user.companyId,
        },
      });

      if (conversation) {
        await prisma.message.create({
          data: {
            conversationId,
            senderType: "AI",
            body: reply,
          },
        });

        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessage: reply,
            lastMessageAt: new Date(),
            aiSummary: reply.slice(0, 500),
          },
        });
      }
    }

    return res.json({
      reply,
      model: OPENAI_TEXT_MODEL,
    });
  } catch (error) {
    console.error("Generate AI reply error:", error);

    return res.status(500).json({
      message: "Failed to generate AI reply",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createRealtimeClientSecret(
  req: AuthRequest,
  res: Response
) {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (isMissingKey(OPENAI_API_KEY)) {
      return res.status(400).json({
        message:
          "OpenAI Realtime is not connected. Add your real OPENAI_API_KEY in backend/.env and restart backend.",
      });
    }

    const brain = await getCompanyBrain(req.user.companyId);
    const settings = brain.settings || {};

    const instructions = buildSystemPrompt({
      companyName: brain.company?.name || "this business",
      aiName: settings.aiName || "AI Assistant",
      aiTone: settings.aiTone || "Professional",
      replyLength: "SHORT",
      allowedActions: Array.isArray(settings.aiAllowedActions)
        ? settings.aiAllowedActions
        : ["Answer FAQs", "Collect customer details", "Transfer to human"],
      restrictedActions: Array.isArray(settings.aiRestrictedActions)
        ? settings.aiRestrictedActions
        : ["Cannot give discount", "Cannot confirm payment"],
      fallbackResponse:
        settings.aiFallbackResponse || "Let me connect you with a team member.",
      knowledge: brain.knowledge,
    });

    const response = await fetch(
      "https://api.openai.com/v1/realtime/client_secrets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": req.user.companyId,
        },
        body: JSON.stringify({
          expires_after: {
            anchor: "created_at",
            seconds: 600,
          },
          session: {
            type: "realtime",
            model: OPENAI_REALTIME_MODEL,
            instructions,
            audio: {
              output: {
                voice: "alloy",
              },
            },
          },
        }),
      }
    );

    const json: any = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        message: "OpenAI Realtime client secret failed",
        error: json?.error?.message || json,
      });
    }

    return res.json(json);
  } catch (error) {
    console.error("Create realtime client secret error:", error);

    return res.status(500).json({
      message: "Failed to create realtime client secret",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}