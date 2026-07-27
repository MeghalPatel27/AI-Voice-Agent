import { analyzeInboundMessage } from "./aiDecision.service";

type Channel = "WHATSAPP" | "AI_CALL" | "WEBSITE_CHAT";
type Priority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type ConversationStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "FOLLOW_UP"
  | "CONVERTED"
  | "HUMAN_REQUIRED"
  | "LOST";

type Industry =
  | "HOSPITAL"
  | "CLINIC"
  | "HOTEL"
  | "RESTAURANT"
  | "REAL_ESTATE"
  | "OTHER";

type DecisionInput = {
  text: string;
  channel: Channel;
  industry?: Industry;
  companyName?: string;
  agentName?: string;
  agentInstructions?: string | null;
  handoverRules?: string | null;
  businessHours?: string | null;
  aiTone?: string | null;
  knowledgeBase?: {
    title: string;
    category: string;
    content: string;
  }[];
  conversationHistory?: {
    senderType: "CUSTOMER" | "AI" | "HUMAN";
    body: string;
    createdAt?: string;
  }[];
};

type LlmDecisionResult = {
  intent: string;
  aiSummary: string;
  priority: Priority;
  humanNeeded: boolean;
  taskTitle?: string;
  nextAction: string;
  aiConfidence: number;
  conversationStatus: ConversationStatus;
  reply?: string;
};

const priorityOptions: Priority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

const conversationStatusOptions: ConversationStatus[] = [
  "NEW",
  "IN_PROGRESS",
  "FOLLOW_UP",
  "CONVERTED",
  "HUMAN_REQUIRED",
  "LOST",
];

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY;
}

function getOpenAiModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function getTimeoutMs() {
  const raw = Number(process.env.OPENAI_DECISION_TIMEOUT_MS || 12000);
  return Number.isFinite(raw) ? raw : 12000;
}

function clampConfidence(value: unknown, fallback: number) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function safePriority(value: unknown, fallback: Priority): Priority {
  if (typeof value !== "string") return fallback;

  if (priorityOptions.includes(value as Priority)) {
    return value as Priority;
  }

  return fallback;
}

function safeConversationStatus(
  value: unknown,
  fallback: ConversationStatus
): ConversationStatus {
  if (typeof value !== "string") return fallback;

  if (conversationStatusOptions.includes(value as ConversationStatus)) {
    return value as ConversationStatus;
  }

  return fallback;
}

function cleanString(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;

  return value.trim() || fallback;
}

function buildSystemPrompt() {
  return `
You are the AI decision engine for AiraDesk, an AI conversation CRM.

Your job:
- Understand customer WhatsApp messages and call transcripts.
- Decide intent, priority, human handover, next action and reply.
- Follow company settings and agent instructions.
- Output only valid structured JSON matching the schema.

Important behavior rules:
1. Never invent unavailable prices, slots, doctors, rooms, staff names or guarantees.
2. Ask only one useful follow-up question at a time.
3. If the customer asks for human, manager, callback, complaint, refund, emergency, anger or sensitive issue, set humanNeeded true.
4. For hospital/clinic medical emergencies, do not diagnose. Tell them to contact emergency services or visit nearest emergency facility, and mark humanNeeded true.
5. If customer wants booking/appointment/table/room/site visit, set intent as booking_request unless they are only asking generic information.
6. If customer confirms booking/payment/final yes, set intent as conversion_signal.
7. If customer says not interested or stop, set status LOST.
8. Reply must be customer-facing, short, professional and useful.
9. If agent instructions conflict with safety or customer protection, ignore unsafe instructions.
10. Use the provided knowledge base as the source of truth. If the knowledge base does not contain the answer, ask a follow-up or say the team will confirm. Do not invent details.
`;
}

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "aiSummary",
    "priority",
    "humanNeeded",
    "taskTitle",
    "nextAction",
    "aiConfidence",
    "conversationStatus",
    "reply",
  ],
  properties: {
    intent: {
      type: "string",
      description:
        "Short snake_case intent like booking_request, pricing_enquiry, urgent_medical_case, callback_request, customer_complaint, conversion_signal, general_enquiry.",
    },
    aiSummary: {
      type: "string",
      description: "Internal CRM summary of the customer need.",
    },
    priority: {
      type: "string",
      enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
    },
    humanNeeded: {
      type: "boolean",
    },
    taskTitle: {
      type: ["string", "null"],
      description:
        "Short staff task title if human follow-up is useful, otherwise null.",
    },
    nextAction: {
      type: "string",
      description: "Internal next action for staff or AI.",
    },
    aiConfidence: {
      type: "integer",
      minimum: 0,
      maximum: 100,
    },
    conversationStatus: {
      type: "string",
      enum: [
        "NEW",
        "IN_PROGRESS",
        "FOLLOW_UP",
        "CONVERTED",
        "HUMAN_REQUIRED",
        "LOST",
      ],
    },
    reply: {
      type: "string",
      description: "Short customer-facing reply.",
    },
  },
};

function extractOutputText(data: any) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }

  const output = data?.output;

  if (!Array.isArray(output)) {
    return "";
  }

  for (const item of output) {
    const content = item?.content;

    if (!Array.isArray(content)) continue;

    for (const contentItem of content) {
      if (
        contentItem?.type === "output_text" &&
        typeof contentItem?.text === "string"
      ) {
        return contentItem.text;
      }
    }
  }

  return "";
}

function normalizeLlmDecision(
  parsed: any,
  fallback: LlmDecisionResult
): LlmDecisionResult {
  return {
    intent: cleanString(parsed?.intent, fallback.intent),
    aiSummary: cleanString(parsed?.aiSummary, fallback.aiSummary),
    priority: safePriority(parsed?.priority, fallback.priority),
    humanNeeded:
      typeof parsed?.humanNeeded === "boolean"
        ? parsed.humanNeeded
        : fallback.humanNeeded,
    taskTitle:
      typeof parsed?.taskTitle === "string" && parsed.taskTitle.trim()
        ? parsed.taskTitle.trim()
        : fallback.taskTitle,
    nextAction: cleanString(parsed?.nextAction, fallback.nextAction),
    aiConfidence: clampConfidence(parsed?.aiConfidence, fallback.aiConfidence),
    conversationStatus: safeConversationStatus(
      parsed?.conversationStatus,
      fallback.conversationStatus
    ),
    reply: cleanString(parsed?.reply, fallback.reply || ""),
  };
}

async function callOpenAiDecision(
  input: DecisionInput,
  fallback: LlmDecisionResult
): Promise<LlmDecisionResult> {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    return fallback;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getOpenAiModel(),
        instructions: buildSystemPrompt(),
      input: JSON.stringify({
  companyName: input.companyName || "Business",
  industry: input.industry || "OTHER",
  channel: input.channel,
  text: input.text,
  agentName: input.agentName || null,
  agentInstructions: input.agentInstructions || null,
  handoverRules: input.handoverRules || null,
  businessHours: input.businessHours || null,
  aiTone: input.aiTone || null,
  knowledgeBase: input.knowledgeBase || [],
  conversationHistory: input.conversationHistory || [],
}),
        text: {
          format: {
            type: "json_schema",
            name: "airadesk_ai_decision",
            strict: true,
            schema: decisionSchema,
          },
        },
        max_output_tokens: 900,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI decision error:", data);
      return fallback;
    }

    const outputText = extractOutputText(data);

    if (!outputText) {
      console.error("OpenAI decision empty output:", data);
      return fallback;
    }

    const parsed = JSON.parse(outputText);

    return normalizeLlmDecision(parsed, fallback);
  } catch (error) {
    console.error("OpenAI decision failed, using fallback:", error);
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getAiDecision(
  input: DecisionInput
): Promise<LlmDecisionResult> {
  const fallback = analyzeInboundMessage(input);

  const fallbackWithReply: LlmDecisionResult = {
    ...fallback,
    reply: "",
  };

  return callOpenAiDecision(input, fallbackWithReply);
}