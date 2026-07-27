import { Response } from "express";
import { IncomingMessage } from "http";
import WebSocket, { RawData } from "ws";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  VOICE_ENGINE_CONFIG,
  isElevenLabsTtsEnabled,
  preferElevenLabsWebSocket,
  VoiceLatencyTracker,
  SentenceStreamer,
  streamElevenLabsUlaw,
  ElevenLabsMultiStreamTts,
  PlaybackManager,
  ConversationManager,
  VoiceEventBus,
  VoicePerformanceSuite,
  evaluateAdaptiveTurn,
  adaptiveVadTimerDelayMs,
} from "../voice";
import {
  finalizeCall,
  mapTwilioStatusToCallStatus as mapTwilioStatusToCallStatusShared,
  shouldApplyCallStatus as shouldApplyCallStatusShared,
  TERMINAL_CALL_STATUSES as TERMINAL_CALL_STATUSES_SHARED,
  type DbCallStatus as SharedDbCallStatus,
} from "../services/callFinalization.service";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL =
  process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

const OPENAI_REALTIME_MODEL = VOICE_ENGINE_CONFIG.openaiRealtimeModel;
const OPENAI_REALTIME_VOICE = VOICE_ENGINE_CONFIG.openaiRealtimeVoice;

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_PHONE_NUMBER =
  process.env.TWILIO_PHONE_NUMBER || process.env.VOICE_FROM_NUMBER || "";

const VOICE_BUSINESS_NAME =
  process.env.VOICE_BUSINESS_NAME || "Kadam Web Design";

const VOICE_BUSINESS_TYPE =
  process.env.VOICE_BUSINESS_TYPE ||
  "premium web design, website development, e-commerce website, AI chatbot, WhatsApp automation, CRM and business automation company";

const VOICE_GREETING =
  process.env.VOICE_GREETING ||
  "Hi, you’ve reached Kadam Web Design. Tell me what kind of website or automation you need.";

const VOICE_PRICING_MENU =
  process.env.VOICE_PRICING_MENU ||
  "Business website: 35000 to 75000 rupees. Premium animated website: 75000 to 150000 rupees plus. E-commerce website: 90000 to 250000 rupees plus. AI chatbot or WhatsApp automation: 25000 to 100000 rupees setup, plus 10000 to 40000 rupees per month.";

const TWILIO_TTS_VOICE = process.env.TWILIO_TTS_VOICE || "Polly.Joanna-Neural";

const TWILIO_TTS_LANGUAGE = process.env.TWILIO_TTS_LANGUAGE || "en-US";

const VOICE_SPEECH_TIMEOUT = process.env.VOICE_SPEECH_TIMEOUT || "1";
const VOICE_LISTEN_TIMEOUT = process.env.VOICE_LISTEN_TIMEOUT || "4";

const LOCAL_VAD_THRESHOLD = VOICE_ENGINE_CONFIG.localVadThreshold;
const LOCAL_VAD_PEAK_THRESHOLD = VOICE_ENGINE_CONFIG.localVadPeakThreshold;
const LOCAL_VAD_END_SILENCE_MS = VOICE_ENGINE_CONFIG.localVadEndSilenceMs;
const LOCAL_VAD_COMMIT_DELAY_MS = VOICE_ENGINE_CONFIG.localVadCommitDelayMs;

const LOCAL_ECHO_GUARD_MS = VOICE_ENGINE_CONFIG.echoGuardMs;
const BARGE_IN_ECHO_GUARD_MS = VOICE_ENGINE_CONFIG.bargeInEchoGuardMs;
const BARGE_IN_ENABLED = VOICE_ENGINE_CONFIG.bargeInEnabled;
const AUTO_MEETING_AFTER_CUSTOMER_TURNS = Number(
  process.env.VOICE_AUTO_MEETING_AFTER_CUSTOMER_TURNS || 4,
);

const ASSISTANT_POST_PLAYBACK_GRACE_MS =
  VOICE_ENGINE_CONFIG.assistantPostPlaybackGraceMs;

const REALTIME_OUTPUT_TOKEN_LIMIT =
  VOICE_ENGINE_CONFIG.openaiRealtimeOutputTokenLimit;

/** When true: OpenAI Realtime outputs text; ElevenLabs Flash synthesizes μ-law for Twilio. */
const USE_ELEVENLABS_TTS = isElevenLabsTtsEnabled();
const PREFER_ELEVENLABS_WS = preferElevenLabsWebSocket();

const VOICE_HINTS = [
  "website",
  "web design",
  "landing page",
  "premium website",
  "animated website",
  "business website",
  "e-commerce",
  "ecommerce",
  "online store",
  "SEO",
  "AI chatbot",
  "WhatsApp automation",
  "CRM",
  "AI sales agent",
  "pricing",
  "quote",
  "meeting",
  "appointment",
  "call back",
  "budget",
  "timeline",
].join(",");

type VoiceLanguage = "AUTO" | "ENGLISH" | "HINDI" | "GUJARATI";

function normalizeVoiceLanguage(value?: string | null): VoiceLanguage {
  const normalized = String(value || "AUTO")
    .toUpperCase()
    .trim();

  if (
    normalized === "ENGLISH" ||
    normalized === "HINDI" ||
    normalized === "GUJARATI"
  ) {
    return normalized;
  }

  return "AUTO";
}

function getVoiceLanguageLabel(language?: string | null) {
  const normalized = normalizeVoiceLanguage(language);

  if (normalized === "ENGLISH") return "English";
  if (normalized === "HINDI") return "Hindi";
  if (normalized === "GUJARATI") return "Gujarati";

  return "Auto-detect customer language";
}

function getVoiceLanguageRules(language?: string | null) {
  const normalized = normalizeVoiceLanguage(language);

  if (normalized === "HINDI") {
    return `
Preferred language: Hindi.
- Speak in natural Hindi/Hinglish suitable for an Indian business phone call.
- Use Hindi words naturally, but keep business terms like website, budget, meeting, CRM, WhatsApp, automation in common Indian usage.
- If the customer speaks English or Gujarati, you may understand them, but reply mainly in Hindi unless they clearly asks to switch.
- Do not translate the company name or service names awkwardly.
`.trim();
  }

  if (normalized === "GUJARATI") {
    return `
Preferred language: Gujarati.
- Speak in natural Gujarati suitable for an Ahmedabad/Gujarat business phone call.
- Use simple Gujarati with common English business words like website, budget, meeting, CRM, WhatsApp and automation when natural.
- If the customer speaks Hindi or English, you may understand them, but reply mainly in Gujarati unless they clearly asks to switch.
- Do not translate the company name or service names awkwardly.
`.trim();
  }

  if (normalized === "ENGLISH") {
    return `
Preferred language: English.
- Speak in clear Indian business English.
- If the customer replies in Hindi or Gujarati, understand them, but answer in simple English unless they asks to switch.
`.trim();
  }

  return `
Preferred language: Auto-detect.
- Start in simple English.
- If the customer speaks Hindi, switch to natural Hindi/Hinglish.
- If the customer speaks Gujarati, switch to natural Gujarati.
- Keep the same language as the customer after detecting it.
`.trim();
}

function getLocalizedVoiceGreeting(language?: string | null) {
  const normalized = normalizeVoiceLanguage(language);

  if (normalized === "HINDI") {
    return `Namaste, aap Kadam Web Design se baat kar rahe hain. Batayiye, aapko kis type ki website ya automation chahiye?`;
  }

  if (normalized === "GUJARATI") {
    return `Namaste, tame Kadam Web Design sathe vaat kari rahya cho. Tame kai type ni website ke automation joiye chhe?`;
  }

  return VOICE_GREETING;
}

function getLocalizedFinalGoodbye(language?: string | null) {
  const normalized = normalizeVoiceLanguage(language);

  if (normalized === "HINDI") {
    return `Perfect, mere paas enough details hain. Maine system mein meeting request create kar di hai aur Kadam ki team follow up karegi. Goodbye.`;
  }

  if (normalized === "GUJARATI") {
    return `Perfect, mara pase enough details chhe. Hu system ma meeting request create kari didhi chhe ane Kadam ni team follow up karse. Goodbye.`;
  }

  return `Perfect, I have enough details. I have created a meeting request in our system and Kadam's team will follow up. Goodbye.`;
}

function getLocalizedQuestionExamples(language?: string | null) {
  const normalized = normalizeVoiceLanguage(language);

  if (normalized === "HINDI") {
    return `Good question examples: "Samajh gaya. Website mein kaunse pages ya features chahiye?" or "Perfect. Meeting ke liye aap kab free ho — kaunsa din aur time?"`;
  }

  if (normalized === "GUJARATI") {
    return `Good question examples: "Samajh gayu. Website ma kaya pages ke features joiye chhe?" or "Perfect. Meeting mate tame kyare free cho — kayo divas ane time?"`;
  }

  return `Good question examples: "Got it. What pages or features do you need on the website?" or "Perfect. When are you available for a short meeting — which day and time?"`;
}

function extractPreferredLanguageFromText(
  value?: string | null,
): VoiceLanguage | null {
  const text = String(value || "").toLowerCase();

  if (!text) return null;
  if (
    text.includes("preferred language: hindi") ||
    text.includes("language: hindi")
  )
    return "HINDI";
  if (
    text.includes("preferred language: gujarati") ||
    text.includes("language: gujarati")
  )
    return "GUJARATI";
  if (
    text.includes("preferred language: english") ||
    text.includes("language: english")
  )
    return "ENGLISH";
  if (text.includes("preferred ai call language: hindi")) return "HINDI";
  if (text.includes("preferred ai call language: gujarati")) return "GUJARATI";
  if (text.includes("preferred ai call language: english")) return "ENGLISH";

  return null;
}

function extractPreferredLanguageFromMetadata(
  metadata: unknown,
): VoiceLanguage | null {
  if (!metadata || typeof metadata !== "object") return null;

  const value =
    (metadata as any).preferredLanguage || (metadata as any).language;
  const normalized = normalizeVoiceLanguage(value);

  if (normalized === "AUTO" && !value) return null;
  return normalized;
}

async function getConversationVoiceLanguage(
  conversationId?: string | null,
): Promise<VoiceLanguage> {
  if (!conversationId)
    return normalizeVoiceLanguage(process.env.VOICE_DEFAULT_LANGUAGE || "AUTO");

  const call = await prisma.call.findFirst({
    where: {
      conversationId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      metadata: true,
    },
  });

  const fromCall = extractPreferredLanguageFromMetadata(call?.metadata);
  if (fromCall) return fromCall;

  const conversation = await prisma.conversation.findUnique({
    where: {
      id: conversationId,
    },
    select: {
      aiSummary: true,
      nextAction: true,
      lastMessage: true,
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        take: 8,
        select: {
          body: true,
        },
      },
    },
  });

  const possibleTexts = [
    conversation?.aiSummary,
    conversation?.nextAction,
    conversation?.lastMessage,
    ...(conversation?.messages || []).map((message) => message.body),
  ];

  for (const text of possibleTexts) {
    const detected = extractPreferredLanguageFromText(text);
    if (detected) return detected;
  }

  return normalizeVoiceLanguage(process.env.VOICE_DEFAULT_LANGUAGE || "AUTO");
}

function getPublicUrl(req: AuthRequest) {
  const fromEnv = process.env.PUBLIC_WEBHOOK_URL?.trim();

  if (fromEnv) {
    return fromEnv.replace(/\/$/, "");
  }

  return `${req.protocol}://${req.get("host")}`;
}

function getRealtimeWebSocketUrl(publicUrl: string) {
  const normalized = publicUrl.replace(/\/$/, "");

  if (normalized.startsWith("https://")) {
    return (
      normalized.replace("https://", "wss://") + "/api/voice/twilio/realtime"
    );
  }

  if (normalized.startsWith("http://")) {
    return (
      normalized.replace("http://", "ws://") + "/api/voice/twilio/realtime"
    );
  }

  return `wss://${normalized}/api/voice/twilio/realtime`;
}

function xmlEscape(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sendXml(res: Response, xml: string) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(xml);
}

function cleanVoiceText(text: string) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#/g, "")
    .replace(/₹/g, " rupees ")
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sanitize OpenAI text deltas for continuous ElevenLabs WebSocket streaming.
 * Preserves leading/trailing spaces so word boundaries survive across deltas.
 */
function sanitizeStreamingDelta(text: string) {
  const value = String(text || "");
  if (!value.includes("*") && !value.includes("#") && !value.includes("\n") && !value.includes("\r")) return value;
  return value.replaceAll("*", "").replaceAll("#", "").replaceAll("\r", " ").replaceAll("\n", " ");
}

function limitVoiceReply(text: string) {
  const clean = cleanVoiceText(text);

  if (!clean) {
    return "I could not hear that clearly. Please say that once more.";
  }

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const shortReply = sentences.slice(0, 2).join(" ");

  return (shortReply || clean).slice(0, 320);
}

function say(text: string) {
  const clean = limitVoiceReply(text);

  return `<Say voice="${xmlEscape(TWILIO_TTS_VOICE)}" language="${xmlEscape(
    TWILIO_TTS_LANGUAGE,
  )}">${xmlEscape(clean)}</Say>`;
}

function buildListenOnlyGather(publicUrl: string) {
  return `
<Gather
  input="speech"
  action="${publicUrl}/api/voice/twilio/speech"
  method="POST"
  speechTimeout="${xmlEscape(VOICE_SPEECH_TIMEOUT)}"
  timeout="${xmlEscape(VOICE_LISTEN_TIMEOUT)}"
  language="${xmlEscape(TWILIO_TTS_LANGUAGE)}"
  hints="${xmlEscape(VOICE_HINTS)}"
  profanityFilter="false"
>
</Gather>
<Redirect method="POST">${publicUrl}/api/voice/twilio/repeat</Redirect>
`.trim();
}

function buildPromptThenListen(publicUrl: string, prompt: string) {
  return `
${say(prompt)}
${buildListenOnlyGather(publicUrl)}
`.trim();
}

function twimlResponse(inner: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function isMissingOpenAiKey() {
  return (
    !OPENAI_API_KEY ||
    OPENAI_API_KEY.includes("your_openai_api_key_here") ||
    OPENAI_API_KEY.includes("paste_")
  );
}

function extractOpenAiText(json: any) {
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

async function getVoiceCompany() {
  const envCompanyId = process.env.VOICE_COMPANY_ID?.trim();

  if (envCompanyId) {
    const company = await prisma.company.findUnique({
      where: {
        id: envCompanyId,
      },
    });

    if (company) return company;
  }

  return prisma.company.findFirst({
    orderBy: {
      createdAt: "asc",
    },
  });
}

async function getOrCreateCallContext(input: {
  callSid: string;
  fromPhone: string;
  toPhone: string;
}) {
  const company = await getVoiceCompany();

  if (!company) {
    throw new Error("No company found. Create/login company first.");
  }

  const phone = input.fromPhone || "UNKNOWN_CALLER";

  let customer = await prisma.customer.findFirst({
    where: {
      companyId: company.id,
      phone,
    },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        companyId: company.id,
        phone,
        source: "AI_CALL",
      },
    });
  }

  const existingCall = input.callSid
    ? await prisma.call.findFirst({
        where: {
          providerCallId: input.callSid,
        },
        include: {
          conversation: true,
        },
      })
    : null;

  if (existingCall?.conversation) {
    return {
      company,
      customer,
      conversation: existingCall.conversation,
      call: existingCall,
    };
  }

  const conversation = await prisma.conversation.create({
    data: {
      companyId: company.id,
      customerId: customer.id,
      channel: "AI_CALL",
      status: "IN_PROGRESS",
      priority: "MEDIUM",
      intent: "Incoming AI voice call",
      aiSummary: "Incoming call started.",
      nextAction: "AI is speaking with customer.",
      lastMessage: `Incoming call from ${phone}`,
      lastMessageAt: new Date(),
      humanNeeded: false,
    },
  });

  const call = await prisma.call.create({
    data: {
      conversationId: conversation.id,
      phone,
      provider: "twilio",
      providerCallId: input.callSid || null,
      direction: "INBOUND",
      status: "IN_PROGRESS",
      durationSeconds: 0,
      startedAt: new Date(),
      metadata: {
        twilioStatus: "in-progress",
        createdFrom: "inbound_webhook",
      },
    },
  });

  voiceLog("call_initiated", {
    callSid: input.callSid || null,
    conversationId: conversation.id,
    direction: "INBOUND",
    phone,
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderType: "CUSTOMER",
      body: `Incoming call started from ${phone}.`,
    },
  });

  return {
    company,
    customer,
    conversation,
    call,
  };
}

async function getRecentConversationMessages(conversationId: string) {
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 12,
  });

  return messages
    .reverse()
    .map((message) => {
      const speaker =
        message.senderType === "CUSTOMER" ? "Caller" : "Assistant";
      return `${speaker}: ${message.body}`;
    })
    .join("\n");
}

async function buildRealtimeInstructions(input?: {
  companyId?: string;
  conversationId?: string;
}) {
  let companyName = VOICE_BUSINESS_NAME;
  let aiTone = "Calm, confident, short and helpful";
  let businessKnowledge = "";
  let recentMessages = "";

  if (input?.companyId) {
    const [company, settings, knowledgeItems] = await Promise.all([
      prisma.company.findUnique({
        where: {
          id: input.companyId,
        },
      }),

      prisma.companySettings.findUnique({
        where: {
          companyId: input.companyId,
        },
      }),

      prisma.knowledgeItem.findMany({
        where: {
          companyId: input.companyId,
          enabled: true,
          isActive: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 12,
      }),
    ]);

    companyName = company?.name || VOICE_BUSINESS_NAME;
    aiTone = (settings as any)?.aiTone || aiTone;

    businessKnowledge = knowledgeItems
      .map((item) => {
        return `Title: ${item.title}\nCategory: ${item.category}\nContent: ${item.content}`;
      })
      .join("\n\n---\n\n");
  }

  if (input?.conversationId) {
    recentMessages = await getRecentConversationMessages(input.conversationId);
  }

  const preferredLanguage = await getConversationVoiceLanguage(
    input?.conversationId,
  );
  const preferredLanguageLabel = getVoiceLanguageLabel(preferredLanguage);
  const languageRules = getVoiceLanguageRules(preferredLanguage);
  const localizedGreeting = getLocalizedVoiceGreeting(preferredLanguage);
  const localizedFinalGoodbye = getLocalizedFinalGoodbye(preferredLanguage);

  return `
You are a natural, sharp, human-sounding phone assistant for ${VOICE_BUSINESS_NAME}.

Business type:
${VOICE_BUSINESS_TYPE}

Company from database:
${companyName}

Voice style:
${aiTone}

Language mode:
${preferredLanguageLabel}

Language rules:
${languageRules}

Pricing:
${VOICE_PRICING_MENU}

Services:
- Premium business websites
- Animated landing pages
- E-commerce websites
- SEO-ready websites
- AI chatbots
- WhatsApp automation
- CRM systems
- AI sales agents
- Business automation

Critical live-call rules:
- This is a real phone call.
- Be calm, patient, and premium. Do not rush the caller.
- Let the caller finish before answering. Do not speak over the caller.
- Maximum 1 short sentence plus 1 question per reply.
- Never ask more than 1 question at a time.
- Do not keep asking endless questions. After enough details are collected, stop and create a meeting request.
- Never say this is a restaurant.
- Never mention Apollo Restaurant.
- Never invent a different business name.
- Do not repeat the caller's whole message.
- Do not over-explain.
- Do not ask budget too early. First collect business type and required website/features.
- Ask budget only after the caller explains the business/service, or if the caller asks pricing.
- If the caller asks pricing, give a short range and continue collecting requirements.
- If the caller wants a quote, collect business type, required service, pages/features, budget, timeline, and preferred meeting time.
- After requirements are clear, ALWAYS ask one availability question: which day and time works for a short meeting or callback.
- Do not end the call until you have a preferred meeting day/time (for example: tomorrow 3 pm, Monday morning).
- Once name/business need and availability are collected, create a meeting request and say exactly in the selected language: "${localizedFinalGoodbye}"
- Never promise a final price before requirements are clear.
- Never promise discounts.

Meeting details needed before ending:
- Name
- Phone number if not already available from the call
- Business type
- Required service
- Preferred meeting day and time / callback availability

Knowledge base:
${businessKnowledge || "No extra knowledge base has been added yet. Use only the pricing and services above."}

Recent call context:
${recentMessages || "No previous call context."}

Start the call with this greeting:
${localizedGreeting}
`.trim();
}

async function buildAiPrompt(input: {
  companyId: string;
  conversationId: string;
  userSpeech: string;
}) {
  const [company, settings, knowledgeItems, recentMessages] = await Promise.all(
    [
      prisma.company.findUnique({
        where: {
          id: input.companyId,
        },
      }),

      prisma.companySettings.findUnique({
        where: {
          companyId: input.companyId,
        },
      }),

      prisma.knowledgeItem.findMany({
        where: {
          companyId: input.companyId,
          enabled: true,
          isActive: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 20,
      }),

      getRecentConversationMessages(input.conversationId),
    ],
  );

  const preferredLanguage = await getConversationVoiceLanguage(
    input.conversationId,
  );
  const preferredLanguageLabel = getVoiceLanguageLabel(preferredLanguage);
  const languageRules = getVoiceLanguageRules(preferredLanguage);
  const localizedFinalGoodbye = getLocalizedFinalGoodbye(preferredLanguage);

  const businessKnowledge = knowledgeItems
    .map((item) => {
      return `Title: ${item.title}\nCategory: ${item.category}\nContent: ${item.content}`;
    })
    .join("\n\n---\n\n");

  const aiSettings = settings as any;

  return `
You are a natural, sharp, human-sounding phone assistant for ${VOICE_BUSINESS_NAME}.

Business type:
${VOICE_BUSINESS_TYPE}

Company from database:
${company?.name || VOICE_BUSINESS_NAME}

Voice style:
${aiSettings?.aiTone || "Calm, confident, short and helpful"}

Language mode:
${preferredLanguageLabel}

Language rules:
${languageRules}

Pricing:
${VOICE_PRICING_MENU}

Services:
- Premium business websites
- Animated landing pages
- E-commerce websites
- SEO-ready websites
- AI chatbots
- WhatsApp automation
- CRM systems
- AI sales agents
- Business automation

Critical rules:
- Never say this is a restaurant.
- Never mention Apollo Restaurant.
- Never invent a different business name.
- Speak like a real human receptionist, not a chatbot.
- Be calm and patient. Do not rush.
- Maximum 1 short sentence plus 1 question.
- Ask only 1 question at a time.
- Do not ask endless questions.
- Do not ask budget too early. First collect business type and website/features.
- Do not explain too much on phone.
- Do not repeat the caller's whole message.
- If the caller asks pricing, give the range and ask one useful requirement question.
- If the caller wants a quote, collect business type, required service, features or pages, budget, timeline, and meeting time.
- Finish every sentence fully. Never stop in the middle of a question.
- After requirements are clear, ask when they are available for a short meeting (day + time).
- Do not create the meeting goodbye until you have availability.
- If enough details AND availability are already collected, stop asking more questions and create a meeting request.
- If you have enough details, say exactly in the selected language: "${localizedFinalGoodbye}"
- If you are not sure, say: "Kadam's team will confirm this and follow up. Goodbye."
- Never promise a final price before requirements are clear.
- Never promise discounts.
- Keep the reply suitable for voice, not text.

Meeting details needed before ending:
- Name
- Phone number if not already available from the call
- Business type
- Required service
- Preferred meeting day and time / callback availability

Allowed actions:
${
  Array.isArray(aiSettings?.aiAllowedActions)
    ? aiSettings.aiAllowedActions.map((item: string) => `- ${item}`).join("\n")
    : "- Answer FAQs\n- Collect customer details\n- Qualify lead\n- Collect meeting request\n- Transfer to human"
}

Restricted actions:
${
  Array.isArray(aiSettings?.aiRestrictedActions)
    ? aiSettings.aiRestrictedActions
        .map((item: string) => `- ${item}`)
        .join("\n")
    : "- Cannot confirm payment\n- Cannot promise discounts\n- Cannot make legal claims"
}

Knowledge base:
${businessKnowledge || "No extra knowledge base has been added yet. Use only the pricing and services above."}

Recent call context:
${recentMessages || "No previous call context."}

Caller just said:
${input.userSpeech}

Reply now as the phone assistant.
`.trim();
}

async function generateAiVoiceReply(input: {
  companyId: string;
  conversationId: string;
  userSpeech: string;
}) {
  if (isMissingOpenAiKey()) {
    return "OpenAI is not connected yet. Please add the real API key and restart the backend.";
  }

  const prompt = await buildAiPrompt(input);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt,
      max_output_tokens: 75,
    }),
  });

  const json: any = await response.json();

  if (!response.ok) {
    console.error("OpenAI voice reply failed:", json);

    return "I am having trouble connecting to the AI system right now. Kadam's team will follow up. Goodbye.";
  }

  const reply =
    extractOpenAiText(json) ||
    "Kadam's team will confirm this and follow up. Goodbye.";

  return limitVoiceReply(reply);
}

function shouldEndCall(text: string) {
  const lower = text.toLowerCase();

  return [
    "bye",
    "goodbye",
    "thank you bye",
    "thanks bye",
    "end call",
    "cut the call",
    "disconnect",
    "that's all",
    "that is all",
    "nothing else",
    "no thanks",
    "no thank you",
    "call me later",
    "talk later",
  ].some((phrase) => lower.includes(phrase));
}

function shouldHangUpAfterReply(aiReply: string) {
  const lower = aiReply.toLowerCase();

  return [
    "team will follow up",
    "team will confirm",
    "we will follow up",
    "kadam’s team will follow up",
    "kadam's team will follow up",
    "kadam's team will confirm",
    "my team will respond",
    "our team will respond",
    "meeting is booked",
    "meeting request is noted",
    "i have your details",
    "goodbye",
    "bye",
  ].some((phrase) => lower.includes(phrase));
}

function safeJsonParse(raw: RawData) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

function sendSocketJson(socket: WebSocket, payload: Record<string, any>) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function extractTextFromRealtimeEvent(event: any) {
  const values = [
    event?.transcript,
    event?.delta,
    event?.text,
    event?.item?.content?.[0]?.transcript,
    event?.response?.output?.[0]?.content?.[0]?.transcript,
    event?.response?.output?.[0]?.content?.[0]?.text,
  ];

  return values
    .filter((value) => typeof value === "string")
    .join(" ")
    .trim();
}

function decodeMulawByte(value: number) {
  const uLawByte = ~value & 0xff;
  let sample = ((uLawByte & 0x0f) << 3) + 0x84;
  sample <<= (uLawByte & 0x70) >> 4;

  return (uLawByte & 0x80) !== 0 ? 0x84 - sample : sample - 0x84;
}

function getMulawAudioLevel(base64Payload: string) {
  try {
    const audio = Buffer.from(base64Payload, "base64");

    if (audio.length === 0) {
      return {
        rms: 0,
        peak: 0,
        speech: false,
      };
    }

    let sumSquares = 0;
    let peak = 0;

    for (const byte of audio) {
      const sample = decodeMulawByte(byte);
      const absolute = Math.abs(sample);

      sumSquares += sample * sample;

      if (absolute > peak) {
        peak = absolute;
      }
    }

    const rms = Math.sqrt(sumSquares / audio.length);
    const speech =
      rms >= LOCAL_VAD_THRESHOLD || peak >= LOCAL_VAD_PEAK_THRESHOLD;

    return {
      rms,
      peak,
      speech,
    };
  } catch {
    return {
      rms: 0,
      peak: 0,
      speech: false,
    };
  }
}

type DbCallStatus = SharedDbCallStatus;

const TERMINAL_CALL_STATUSES = TERMINAL_CALL_STATUSES_SHARED;

function voiceLog(
  event: string,
  data: Record<string, unknown> = {},
) {
  console.log(
    JSON.stringify({
      scope: "voice_lifecycle",
      event,
      at: new Date().toISOString(),
      ...data,
    }),
  );
}

function mapTwilioStatusToCallStatus(
  twilioStatus: string,
  direction?: string | null,
): DbCallStatus {
  return mapTwilioStatusToCallStatusShared(twilioStatus, direction);
}

function shouldApplyCallStatus(
  currentStatus: string | null | undefined,
  nextStatus: DbCallStatus,
) {
  return shouldApplyCallStatusShared(currentStatus, nextStatus);
}

async function finalizeCallConversation(input: {
  callSid?: string | null;
  conversationId?: string | null;
  reason: string;
  markCompleted?: boolean;
  providerStatus?: string | null;
  durationSeconds?: number;
  terminalStatus?: DbCallStatus;
}) {
  if (!input.conversationId && !input.callSid) return null;

  const result = await finalizeCall({
    providerCallId: input.callSid,
    conversationId: input.conversationId,
    endReason: input.reason,
    markCompleted: input.markCompleted,
    providerStatus: input.providerStatus,
    durationSeconds: input.durationSeconds,
    terminalStatus: input.terminalStatus,
  });

  if (!result.callId && !result.conversationId) {
    return null;
  }

  voiceLog("conversation_saved", {
    conversationId: result.conversationId,
    callSid: input.callSid || null,
    reason: input.reason,
    alreadyTerminal: result.alreadyTerminal,
    analysisQueued: result.analysisQueued,
  });

  return {
    conversationId: result.conversationId,
    callId: result.callId,
    transcript: result.transcript,
    summary: null as string | null,
  };
}

async function applyTwilioCallStatusUpdate(input: {
  callSid: string;
  twilioStatus: string;
  durationSeconds?: number;
  source: string;
}) {
  if (!input.callSid) return null;

  const existingCall = await prisma.call.findFirst({
    where: {
      providerCallId: input.callSid,
    },
  });

  if (!existingCall) return null;

  const nextStatus = mapTwilioStatusToCallStatus(
    input.twilioStatus,
    existingCall.direction,
  );

  const canApply = shouldApplyCallStatus(existingCall.status, nextStatus);
  const isTerminal = TERMINAL_CALL_STATUSES.has(nextStatus);
  const metadata = {
    ...((existingCall.metadata as Record<string, unknown>) || {}),
    twilioStatus: input.twilioStatus,
    twilioStatusUpdatedAt: new Date().toISOString(),
    twilioStatusSource: input.source,
  };

  const updated = await prisma.call.update({
    where: {
      id: existingCall.id,
    },
    data: {
      status: canApply ? nextStatus : existingCall.status,
      durationSeconds:
        Number.isFinite(input.durationSeconds) &&
        (input.durationSeconds as number) > 0
          ? (input.durationSeconds as number)
          : existingCall.durationSeconds,
      endedAt:
        isTerminal && canApply
          ? existingCall.endedAt || new Date()
          : existingCall.endedAt,
      startedAt:
        nextStatus === "IN_PROGRESS" || nextStatus === "LIVE"
          ? existingCall.startedAt || new Date()
          : existingCall.startedAt,
      failureReason: ["NO_ANSWER", "BUSY", "CANCELED", "FAILED", "MISSED"].includes(
        canApply ? nextStatus : (existingCall.status as string),
      )
        ? `Twilio call status: ${input.twilioStatus}`
        : existingCall.failureReason,
      metadata,
    },
  });

  voiceLog("call_status_updated", {
    callSid: input.callSid,
    twilioStatus: input.twilioStatus,
    previousStatus: existingCall.status,
    nextStatus: canApply ? nextStatus : existingCall.status,
    applied: canApply,
    source: input.source,
  });

  return updated;
}

async function forceHangupTwilioCall(callSid: string) {
  if (!callSid || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    voiceLog("call_hangup_skipped", {
      callSid,
      reason: "missing_credentials_or_sid",
    });
    return;
  }

  try {
    const auth = Buffer.from(
      `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`,
    ).toString("base64");

    const body = new URLSearchParams({
      Status: "completed",
    });

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("Twilio force hangup failed:", text);
      voiceLog("call_hangup_failed", { callSid, error: text.slice(0, 300) });
      return;
    }

    voiceLog("call_hangup_requested", { callSid });
  } catch (error) {
    console.error("Twilio force hangup error:", error);
    voiceLog("call_hangup_error", {
      callSid,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

async function saveRealtimeCustomerMessage(input: {
  conversationId?: string;
  text: string;
}) {
  const text = cleanVoiceText(input.text);

  if (!input.conversationId || !text) return;

  try {
    await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderType: "CUSTOMER",
        body: text,
      },
    });

    await prisma.conversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        lastMessage: text,
        lastMessageAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Realtime customer message save error:", error);
  }
}

async function saveRealtimeAssistantMessage(input: {
  conversationId?: string;
  text: string;
  shouldHangUp: boolean;
}) {
  const text = cleanVoiceText(input.text);

  if (!input.conversationId || !text) return;

  try {
    await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        senderType: "AI",
        body: text,
      },
    });

    await prisma.conversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        status: input.shouldHangUp ? "FOLLOW_UP" : "IN_PROGRESS",
        aiSummary: text.slice(0, 500),
        nextAction: input.shouldHangUp
          ? "Review realtime voice call and follow up with the lead."
          : "Continue realtime AI voice conversation or hand off if needed.",
        lastMessage: text,
        lastMessageAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Realtime assistant message save error:", error);
  }
}

function hasMeetingIntent(text: string) {
  const lower = text.toLowerCase();

  return [
    "meeting",
    "appointment",
    "call me",
    "callback",
    "call back",
    "schedule",
    "book",
    "tomorrow",
    "today",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "morning",
    "afternoon",
    "evening",
    "pm",
    "am",
  ].some((phrase) => lower.includes(phrase));
}

function isUsefulCustomerRequirement(text: string) {
  const lower = text.toLowerCase();

  if (!lower || lower.includes("incoming call started")) return false;

  return [
    "website",
    "business",
    "company",
    "store",
    "ecommerce",
    "e-commerce",
    "pages",
    "page",
    "budget",
    "rupees",
    "lakh",
    "timeline",
    "urgent",
    "next week",
    "this week",
    "service",
    "features",
    "booking",
    "automation",
    "chatbot",
    "crm",
    "portfolio",
    "landing",
  ].some((phrase) => lower.includes(phrase));
}

function buildLeadSummary(messages: { senderType: string; body: string }[]) {
  const customerLines = messages
    .filter((message) => message.senderType === "CUSTOMER")
    .map((message) => cleanVoiceText(message.body))
    .filter(
      (body) => body && !body.toLowerCase().includes("incoming call started"),
    );

  return (
    customerLines.slice(-8).join(" | ") || "AI call requirement collected."
  );
}


function extractPreferredMeetingTimeFromText(text: string) {
  const lines = text
    .split(/\n|\.|\?|!/)
    .map((line) => cleanVoiceText(line))
    .filter(Boolean);

  // Only match real availability signals — NOT "meeting"/"schedule"/"book"
  // alone (those false-positive as requirements text).
  const dayOrTimeWords = [
    "tomorrow",
    "today",
    "morning",
    "afternoon",
    "evening",
    "night",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "kal",
    "aaj",
    "subah",
    "shaam",
    "dopahar",
    "કાલે",
    "આજે",
    "સવારે",
    "સાંજે",
    "બપોરે",
    "कल",
    "आज",
    "सुबह",
    "शाम",
    "दोपहर",
  ];

  const explicitTime =
    /\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?|am|pm|[ap])\b/i;

  const match = [...lines]
    .reverse()
    .find((line) => {
      const lower = line.toLowerCase();
      return (
        explicitTime.test(lower) ||
        dayOrTimeWords.some((word) => lower.includes(word))
      );
    });

  return match ? match.slice(0, 180) : null;
}

/**
 * Best-effort parse of spoken availability into a concrete Date for bookings.
 * Handles STT quirks like "5 p", "5p", "5 p.m.", "at 5".
 */
function resolveMeetingDateTime(text: string | null | undefined): Date | null {
  const raw = cleanVoiceText(text || "");
  if (!raw) return null;

  const lower = raw.toLowerCase().replace(/\./g, "");
  const now = new Date();
  const result = new Date(now);

  const timeMatch =
    lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i) ||
    lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])(?=\s|$|[,;])/i) ||
    lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i);

  let hours: number | null = null;
  let minutes = 0;
  let meridiem: string | null = null;

  if (timeMatch) {
    hours = Number(timeMatch[1]);
    minutes = Number(timeMatch[2] || 0);
    meridiem = timeMatch[3] ? String(timeMatch[3]).toLowerCase() : null;
  }

  if (hours !== null) {
    if (meridiem) {
      const isPm = meridiem.startsWith("p");
      const isAm = meridiem.startsWith("a");
      hours = hours % 12;
      if (isPm) hours += 12;
      if (isAm && hours === 12) hours = 0;
    } else {
      // Bare hour from speech ("at 5") — business meetings default to PM for 1–6.
      if (hours >= 1 && hours <= 6) hours += 12;
      if (hours === 0) hours = 12;
    }
  } else if (
    lower.includes("morning") ||
    lower.includes("subah") ||
    lower.includes("સવારે") ||
    lower.includes("सुबह")
  ) {
    hours = 10;
  } else if (
    lower.includes("afternoon") ||
    lower.includes("dopahar") ||
    lower.includes("બપોરે") ||
    lower.includes("दोपहर")
  ) {
    hours = 14;
  } else if (
    lower.includes("evening") ||
    lower.includes("shaam") ||
    lower.includes("સાંજે") ||
    lower.includes("शाम") ||
    lower.includes("night")
  ) {
    hours = 17;
  } else {
    // Day-only ("tomorrow") without a clock — do not invent 11:00.
    return null;
  }

  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const weekdayIdx = weekdays.findIndex((day) => lower.includes(day));
  const hasDayHint =
    lower.includes("tomorrow") ||
    lower.includes("kal") ||
    lower.includes("કાલે") ||
    lower.includes("कल") ||
    lower.includes("today") ||
    lower.includes("aaj") ||
    lower.includes("આજે") ||
    lower.includes("आज") ||
    weekdayIdx >= 0;

  if (
    lower.includes("tomorrow") ||
    lower.includes("kal") ||
    lower.includes("કાલે") ||
    lower.includes("कल")
  ) {
    result.setDate(result.getDate() + 1);
  } else if (
    lower.includes("today") ||
    lower.includes("aaj") ||
    lower.includes("આજે") ||
    lower.includes("आज")
  ) {
    // keep today
  } else if (weekdayIdx >= 0) {
    const current = result.getDay();
    let delta = (weekdayIdx - current + 7) % 7;
    if (delta === 0) delta = 7;
    result.setDate(result.getDate() + delta);
  } else if (!timeMatch) {
    result.setDate(result.getDate() + 1);
    while (result.getDay() === 0 || result.getDay() === 6) {
      result.setDate(result.getDate() + 1);
    }
  }

  result.setSeconds(0, 0);
  result.setHours(hours, minutes, 0, 0);

  if (result.getTime() <= now.getTime() + 30 * 60 * 1000) {
    result.setDate(result.getDate() + (weekdayIdx >= 0 ? 7 : hasDayHint ? 0 : 1));
    if (result.getTime() <= now.getTime() + 30 * 60 * 1000) {
      result.setDate(result.getDate() + 1);
    }
  }

  return result;
}

function parseScheduledAiCallTaskNotes(value?: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    if (parsed?.kind !== "AI_SCHEDULED_CALL") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function createMeetingRequestIfReady(input: {
  companyId: string;
  conversationId: string;
  force?: boolean;
}) {
  const conversation = await prisma.conversation.findUnique({
    where: {
      id: input.conversationId,
    },
    include: {
      customer: true,
      messages: {
        orderBy: {
          createdAt: "asc",
        },
        take: 40,
      },
      bookings: {
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
      },
    },
  });

  if (!conversation) return false;

  const existingRequest = conversation.bookings.find((booking) => {
    return ["REQUESTED", "AI_REQUESTED", "MEETING_REQUESTED"].includes(
      String(booking.status || "").toUpperCase(),
    );
  });

  const customerTextsEarly = conversation.messages
    .filter((message) => message.senderType === "CUSTOMER")
    .map((message) => cleanVoiceText(message.body))
    .filter(
      (body) => body && !body.toLowerCase().includes("incoming call started"),
    );
  const latestMeetingText = extractPreferredMeetingTimeFromText(
    customerTextsEarly.join("\n"),
  );
  const latestMeetingDateTime = resolveMeetingDateTime(latestMeetingText);

  if (existingRequest) {
    // Repair / refresh slot from the caller's latest spoken availability.
    if (
      latestMeetingDateTime &&
      (!existingRequest.dateTime ||
        Math.abs(
          new Date(existingRequest.dateTime).getTime() -
            latestMeetingDateTime.getTime(),
        ) > 60_000)
    ) {
      const customerLabel =
        conversation.customer?.fullName ||
        conversation.customer?.phone ||
        "AI call lead";
      await prisma.booking.update({
        where: { id: existingRequest.id },
        data: {
          dateTime: latestMeetingDateTime,
          title: `Meeting request - ${customerLabel}${
            latestMeetingText ? ` · Preferred: ${latestMeetingText}` : ""
          }`,
        },
      });
      console.log("Meeting booking time updated from caller availability.", {
        bookingId: existingRequest.id,
        meetingTimeText: latestMeetingText,
        meetingDateTime: latestMeetingDateTime.toISOString(),
      });
    }
    return true;
  }

  if (conversation.bookingCreated) return true;

  const customerTexts = customerTextsEarly;

  const usefulRequirementCount = customerTexts.filter(
    isUsefulCustomerRequirement,
  ).length;
  const meetingRequested = customerTexts.some(hasMeetingIntent);

  if (
    !input.force &&
    !meetingRequested &&
    usefulRequirementCount < AUTO_MEETING_AFTER_CUSTOMER_TURNS
  ) {
    return false;
  }

  const summary = buildLeadSummary(conversation.messages);
  const meetingTimeText =
    latestMeetingText ||
    extractPreferredMeetingTimeFromText(customerTexts.join("\n"));
  const meetingDateTime =
    latestMeetingDateTime || resolveMeetingDateTime(meetingTimeText);
  const customerLabel =
    conversation.customer?.fullName ||
    conversation.customer?.phone ||
    "AI call lead";

  // Without an availability window, keep asking — only force-create on goodbye.
  if (!input.force && !meetingTimeText) {
    return false;
  }

  await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        companyId: conversation.companyId,
        customerId: conversation.customerId,
        conversationId: conversation.id,
        title: `Meeting request - ${customerLabel}${meetingTimeText ? ` · Preferred: ${meetingTimeText}` : ""}`,
        status: "REQUESTED",
        dateTime: meetingDateTime,
      },
    });

    await tx.task.create({
      data: {
        companyId: conversation.companyId,
        customerId: conversation.customerId,
        conversationId: conversation.id,
        title: `Confirm meeting with ${customerLabel}${meetingTimeText ? ` - ${meetingTimeText}` : ""}`,
        description: [
          "AI call collected lead requirements.",
          `Requirements: ${summary}`,
          meetingTimeText
            ? `Preferred meeting time: ${meetingTimeText}`
            : "Preferred meeting time: Not captured. Confirm with lead.",
          meetingDateTime
            ? `Scheduled slot (auto): ${meetingDateTime.toISOString()}`
            : "Scheduled slot: not parsed — confirm manually.",
        ].join("\n"),
        owner: "AI",
        aiNotes:
          "Created automatically by AI voice agent after collecting call requirements and availability.",
        priority: "HIGH",
        status: "OPEN",
        dueAt: meetingDateTime,
      },
    });

    const scheduledAiTask = await tx.task.findFirst({
      where: {
        conversationId: conversation.id,
        aiNotes: {
          contains: "AI_SCHEDULED_CALL",
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (scheduledAiTask) {
      const previousNotes = parseScheduledAiCallTaskNotes(scheduledAiTask.aiNotes) || {};

      await tx.task.update({
        where: {
          id: scheduledAiTask.id,
        },
        data: {
          status: "DONE",
          completedAt: new Date(),
          description: [
            "AI scheduled call completed.",
            previousNotes?.scheduledAt ? `Scheduled call time: ${previousNotes.scheduledAt}` : "",
            `Lead requirements: ${summary}`,
            meetingTimeText ? `Meeting requested for: ${meetingTimeText}` : "Meeting time: To confirm",
          ]
            .filter(Boolean)
            .join("\n"),
          aiNotes: JSON.stringify(
            {
              ...previousNotes,
              status: "COMPLETED",
              completedAt: new Date().toISOString(),
              meetingBookingId: booking.id,
              leadRequirements: {
                summary,
                meetingTime: meetingTimeText || null,
                capturedAt: new Date().toISOString(),
              },
            },
            null,
            2,
          ),
        },
      });
    }

    await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderType: "AI",
        body: [
          "Lead requirements captured from AI call.",
          `Requirements: ${summary}`,
          meetingTimeText ? `Preferred meeting time: ${meetingTimeText}` : "Preferred meeting time: Not captured yet.",
        ].join("\n"),
      },
    });

    await tx.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        status: "FOLLOW_UP",
        priority: "HIGH",
        humanNeeded: true,
        bookingCreated: true,
        intent: "Website meeting request",
        aiSummary: `Lead requirements: ${summary}${meetingTimeText ? ` Meeting time: ${meetingTimeText}` : ""}`.slice(
          0,
          500,
        ),
        nextAction:
          meetingTimeText
            ? `Confirm meeting for: ${meetingTimeText}`
            : "Confirm meeting time and send quotation after requirement review.",
        lastMessage: meetingTimeText
          ? `AI created a meeting request for ${meetingTimeText}.`
          : "AI created a meeting request from the call.",
        lastMessageAt: new Date(),
      },
    });
  });

  console.log("Meeting request created from AI call.", {
    conversationId: conversation.id,
    usefulRequirementCount,
    meetingRequested,
    meetingTimeText,
    meetingDateTime: meetingDateTime?.toISOString() || null,
  });

  return true;
}

async function startTwilioCallRecording(input: {
  callSid: string;
  publicUrl?: string;
}) {
  if (!input.callSid || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.warn(
      "Cannot start Twilio recording because Twilio credentials or CallSid are missing.",
    );
    return;
  }

  const publicUrl =
    input.publicUrl?.replace(/\/$/, "") ||
    process.env.PUBLIC_WEBHOOK_URL?.trim()?.replace(/\/$/, "") ||
    "";

  if (!publicUrl) {
    console.warn(
      "Cannot start Twilio recording because PUBLIC_WEBHOOK_URL is missing.",
    );
    return;
  }

  try {
    const auth = Buffer.from(
      `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`,
    ).toString("base64");

    const body = new URLSearchParams({
      RecordingStatusCallback: `${publicUrl}/api/voice/twilio/recording`,
      RecordingStatusCallbackMethod: "POST",
      RecordingChannels: "dual",
    });

    body.append("RecordingStatusCallbackEvent", "in-progress");
    body.append("RecordingStatusCallbackEvent", "completed");
    body.append("RecordingStatusCallbackEvent", "absent");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${input.callSid}/Recordings.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Twilio recording start failed:", responseText);
      return;
    }

    let recording: any = null;

    try {
      recording = JSON.parse(responseText);
    } catch {
      recording = null;
    }

    if (recording?.sid) {
      await prisma.call.updateMany({
        where: {
          providerCallId: input.callSid,
        },
        data: {
          recordingSid: recording.sid,
          recordingStatus: recording.status || "in-progress",
          recordingChannels: 2,
          recordingSource: "api",
        },
      });
    }

    console.log("Twilio recording started.", {
      callSid: input.callSid,
      recordingSid: recording?.sid || null,
    });
  } catch (error) {
    console.error("Twilio recording start error:", error);
  }
}

function buildTwilioAuthHeader() {
  return `Basic ${Buffer.from(
    `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`,
  ).toString("base64")}`;
}

function normalizePhoneNumber(phone: string) {
  return String(phone || "")
    .replace(/[^\d+]/g, "")
    .trim();
}

async function createOrUpdateOutboundCustomer(input: {
  companyId: string;
  name?: string;
  phone: string;
  notes?: string;
}) {
  const cleanPhone = normalizePhoneNumber(input.phone);

  let customer = await prisma.customer.findFirst({
    where: {
      companyId: input.companyId,
      phone: cleanPhone,
    },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        companyId: input.companyId,
        fullName: input.name || null,
        phone: cleanPhone,
        source: "AI_OUTBOUND_CALL",
        notes: input.notes || null,
        lastContactAt: new Date(),
      },
    });

    return customer;
  }

  customer = await prisma.customer.update({
    where: {
      id: customer.id,
    },
    data: {
      fullName: input.name || customer.fullName,
      notes: input.notes
        ? [customer.notes, input.notes].filter(Boolean).join("\n")
        : customer.notes,
      lastContactAt: new Date(),
    },
  });

  return customer;
}

async function fetchTwilioRecordingForCall(callSid: string) {
  if (!callSid || !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return;

  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls/${callSid}/Recordings.json?PageSize=1`,
      {
        method: "GET",
        headers: {
          Authorization: buildTwilioAuthHeader(),
        },
      },
    );

    const json: any = await response.json();

    if (!response.ok) {
      console.error("Twilio recording fetch failed:", json);
      return;
    }

    const recording = Array.isArray(json?.recordings)
      ? json.recordings[0]
      : null;

    if (!recording) return;

    const recordingData: {
      recordingSid?: string;
      recordingStatus?: string;
      recordingUrl?: string;
      recordingDurationSeconds?: number;
      recordingChannels?: number;
      recordingSource?: string;
      recordingAvailableAt?: Date;
    } = {
      recordingChannels: 2,
      recordingSource: "fetch",
    };

    if (recording.sid) recordingData.recordingSid = recording.sid;
    if (recording.status) recordingData.recordingStatus = recording.status;
    if (recording.media_url) recordingData.recordingUrl = recording.media_url;

    const durationValue =
      typeof recording.duration === "string"
        ? Number(recording.duration)
        : typeof recording.duration === "number"
          ? recording.duration
          : NaN;

    if (Number.isFinite(durationValue)) {
      recordingData.recordingDurationSeconds = durationValue;
    }

    if (recording.status === "completed") {
      recordingData.recordingAvailableAt = new Date();
    }

    await prisma.call.updateMany({
      where: {
        providerCallId: callSid,
      },
      data: recordingData,
    });

    voiceLog("recording_attached", {
      callSid,
      recordingSid: recording.sid || null,
      recordingStatus: recording.status || null,
      source: "fetch",
    });
  } catch (error) {
    console.error("Twilio recording fetch error:", error);
  }
}

export async function handleTwilioIncomingRealtimeCall(
  req: AuthRequest,
  res: Response,
) {
  try {
    const publicUrl = getPublicUrl(req);
    const realtimeWebSocketUrl = getRealtimeWebSocketUrl(publicUrl);

    const callSid = String(req.body.CallSid || "");
    const fromPhone = String(req.body.From || "");
    const toPhone = String(req.body.To || "");

    // Return Stream TwiML first — do not block on CRM/DB.
    sendXml(
      res,
      twimlResponse(`
        <Connect>
          <Stream url="${xmlEscape(realtimeWebSocketUrl)}">
            <Parameter name="callSid" value="${xmlEscape(callSid)}"/>
            <Parameter name="fromPhone" value="${xmlEscape(fromPhone)}"/>
            <Parameter name="toPhone" value="${xmlEscape(toPhone)}"/>
            <Parameter name="direction" value="INBOUND"/>
            <Parameter name="publicUrl" value="${xmlEscape(publicUrl)}"/>
            <Parameter name="recordingManagedByCallApi" value="false"/>
          </Stream>
        </Connect>
        <Hangup/>
      `),
    );

    void getOrCreateCallContext({
      callSid,
      fromPhone,
      toPhone,
    }).catch((error) => {
      console.error("Async inbound call context create failed:", error);
    });

    return;
  } catch (error) {
    console.error("Twilio realtime incoming call error:", error);

    return sendXml(
      res,
      twimlResponse(`
        ${say("Sorry, the realtime voice assistant is not available right now. Please try again later.")}
        <Hangup/>
      `),
    );
  }
}

export function handleTwilioRealtimeConnection(
  twilioSocket: WebSocket,
  _request: IncomingMessage,
) {
  console.log("Twilio realtime socket connected.");

  if (isMissingOpenAiKey()) {
    console.error("OpenAI key missing. Closing realtime call.");
    twilioSocket.close();
    return;
  }

  let streamSid = "";
  let callSid = "";
  let fromPhone = "";
  let toPhone = "";

  let companyId = "";
  let conversationId = "";
  let streamPreferredLanguage: VoiceLanguage | null = null;

  let openAiReady = false;
  let twilioStarted = false;
  let sessionUpdateSent = false;
  let sessionUpdated = false;
  let initialGreetingSent = false;

  let callerTurnActive = false;
  let callerTurnCommitting = false;
  let callerTurnSpeechStartedAt = 0;
  let callerTurnLastSpeechAt = 0;
  let callerTurnFrameCount = 0;
  let callerTurnSpeechFrameCount = 0;
  let callerTurnEndTimer: NodeJS.Timeout | null = null;

  let assistantResponseActive = false;
  let assistantPlaybackActive = false;
  let assistantResponseId = "";
  let assistantText = "";
  let assistantTextSavedForResponseId = "";
  let pendingAssistantPlaybackMark = "";
  let lastAssistantAudioAt = 0;
  let assistantReadyToListenAt = 0;
  let meetingRequestCreated = false;
  let currentVoiceLanguage: VoiceLanguage = normalizeVoiceLanguage(
    process.env.VOICE_DEFAULT_LANGUAGE || "AUTO",
  );
  let recordingStartRequested = false;
  let recordingManagedByCallApi = false;
  let publicUrlFromStream = "";
  let hangupDesired = false;
  let hangupExecuted = false;
  let conversationFinalized = false;
  let hangupFallbackTimer: NodeJS.Timeout | null = null;

  const perf = new VoicePerformanceSuite({ log: voiceLog });
  const latency = new VoiceLatencyTracker(perf.wrapLatencyLog(voiceLog));
  /** HTTP TTS fallback only — WebSocket streams deltas continuously. */
  const sentenceStreamer = new SentenceStreamer();
  const conversationManager = new ConversationManager({
    autoMeetingAfterCustomerTurns: AUTO_MEETING_AFTER_CUSTOMER_TURNS,
  });
  const voiceEvents = new VoiceEventBus();
  let elevenLabsSpeakQueue: Promise<void> = Promise.resolve();
  /** OpenAI events and ws.send are ordered; avoid a Promise chain per delta. */
  const elevenLabsPendingDeltas: string[] = [];
  let elevenLabsAbort: AbortController | null = null;
  let elevenLabsChunksPending = 0;
  let elevenLabsSpokenForResponse = false;
  let elevenLabsResponseComplete = false;
  let elevenLabsTts: ElevenLabsMultiStreamTts | null = null;
  let elevenLabsTransport: "websocket" | "http" | "none" = USE_ELEVENLABS_TTS
    ? PREFER_ELEVENLABS_WS
      ? "websocket"
      : "http"
    : "none";
  let elevenLabsWsConnectPromise: Promise<void> | null = null;
  let bargeInInProgress = false;
  let perfFinalized = false;
  let initialGreetingSpoken = false;
  let greetingSeededInOpenAi = false;
  let awaitingMeetingAvailability = false;

  const INPUT_AUDIO_COMMIT_JSON = '{"type":"input_audio_buffer.commit"}';
  const INPUT_AUDIO_CLEAR_JSON = '{"type":"input_audio_buffer.clear"}';
  let preparedResponseCreateJson = "";
  let preparedResponseReason = "initial";

  const playback = new PlaybackManager({
    twilioSocket,
    sendJson: sendSocketJson,
    onFirstMedia: () => {
      latency.mark("first_audio_to_twilio", {
        tts: USE_ELEVENLABS_TTS ? "elevenlabs" : "openai",
        transport: elevenLabsTransport,
      });
      perf.markBargeInAudioResumed();
    },
    onMediaSent: (buffer) => {
      lastAssistantAudioAt = Date.now();
      assistantReadyToListenAt =
        Date.now() + ASSISTANT_POST_PLAYBACK_GRACE_MS;
      assistantPlaybackActive = true;
      perf.recordMediaFrameSent(buffer);
    },
  });

  latency.setContext({
    ttsProvider: USE_ELEVENLABS_TTS ? "elevenlabs" : "openai",
    ttsTransport: elevenLabsTransport,
    model: OPENAI_REALTIME_MODEL,
  });

  perf.start({
    ttsProvider: USE_ELEVENLABS_TTS ? "elevenlabs" : "openai",
    ttsTransport: elevenLabsTransport,
    model: OPENAI_REALTIME_MODEL,
  });

  voiceLog("voice_engine_session_config", {
    model: OPENAI_REALTIME_MODEL,
    ttsProvider: USE_ELEVENLABS_TTS ? "elevenlabs" : "openai",
    ttsTransport: elevenLabsTransport,
    continuousDeltaStreaming: PREFER_ELEVENLABS_WS,
    elevenLabsVoiceId: USE_ELEVENLABS_TTS
      ? VOICE_ENGINE_CONFIG.elevenLabsVoiceId
      : undefined,
    elevenLabsModelId: USE_ELEVENLABS_TTS
      ? VOICE_ENGINE_CONFIG.elevenLabsModelId
      : undefined,
    elevenLabsChunkSchedule: USE_ELEVENLABS_TTS
      ? VOICE_ENGINE_CONFIG.elevenLabsChunkLengthSchedule
      : undefined,
    bargeInEnabled: BARGE_IN_ENABLED,
    vadEndSilenceMs: LOCAL_VAD_END_SILENCE_MS,
    vadShortSilenceMs: VOICE_ENGINE_CONFIG.localVadShortSilenceMs,
    vadLongSilenceMs: VOICE_ENGINE_CONFIG.localVadLongSilenceMs,
    vadCommitDelayMs: LOCAL_VAD_COMMIT_DELAY_MS,
    performanceSuite: true,
  });

  function finalizePerf(reason: string) {
    if (perfFinalized) return;
    perfFinalized = true;
    perf.setContext({
      callSid,
      conversationId,
      streamSid,
      ttsProvider: USE_ELEVENLABS_TTS ? "elevenlabs" : "openai",
      ttsTransport: elevenLabsTransport,
      model: OPENAI_REALTIME_MODEL,
    });
    perf.finalize(reason);
  }

  const openAiSocket = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(
      OPENAI_REALTIME_MODEL,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
    },
  );

  function cleanup() {
    if (callerTurnEndTimer) {
      clearTimeout(callerTurnEndTimer);
      callerTurnEndTimer = null;
    }

    if (hangupFallbackTimer) {
      clearTimeout(hangupFallbackTimer);
      hangupFallbackTimer = null;
    }

    if (elevenLabsAbort) {
      elevenLabsAbort.abort();
      elevenLabsAbort = null;
    }

    if (elevenLabsTts) {
      elevenLabsTts.close();
      elevenLabsTts = null;
    }

    voiceEvents.emit("CallEnded", {
      callSid,
      conversationId,
      companyId,
      reason: "session_cleanup",
      phase: conversationManager.getPhase(),
    });
    voiceEvents.clear();

    finalizePerf("session_cleanup");

    if (
      openAiSocket.readyState === WebSocket.OPEN ||
      openAiSocket.readyState === WebSocket.CONNECTING
    ) {
      openAiSocket.close();
    }

    if (twilioSocket.readyState === WebSocket.OPEN) {
      twilioSocket.close();
    }
  }

  function resetCallerTurn() {
    callerTurnActive = false;
    callerTurnCommitting = false;
    callerTurnSpeechStartedAt = 0;
    callerTurnLastSpeechAt = 0;
    callerTurnFrameCount = 0;
    callerTurnSpeechFrameCount = 0;

    if (callerTurnEndTimer) {
      clearTimeout(callerTurnEndTimer);
      callerTurnEndTimer = null;
    }
  }

  async function finalizeOnce(reason: string) {
    if (conversationFinalized) return;
    conversationFinalized = true;

    try {
      await finalizeCallConversation({
        callSid,
        conversationId,
        reason,
        markCompleted: true,
      });
      voiceLog("call_completed", {
        callSid,
        conversationId,
        reason,
      });
    } catch (error) {
      conversationFinalized = false;
      console.error("Finalize realtime call error:", error);
    }
  }

  async function endRealtimeCall(reason = "ai_goodbye_complete") {
    if (hangupExecuted) return;
    hangupExecuted = true;

    if (hangupFallbackTimer) {
      clearTimeout(hangupFallbackTimer);
      hangupFallbackTimer = null;
    }

    await finalizeOnce(reason);

    if (callSid) {
      await forceHangupTwilioCall(callSid);
    }

    setTimeout(() => {
      cleanup();
    }, 300);
  }

  function sendTwilioMark(name: string) {
    if (!streamSid) return;
    playback.setStreamSid(streamSid);
    playback.sendMark(name);
  }

  function maybeHangUpAfterFinalReply() {
    if (!hangupDesired || !streamSid || hangupExecuted) return;
    if (hangupFallbackTimer) return;

    sendTwilioMark("assistant-final-goodbye");

    hangupFallbackTimer = setTimeout(() => {
      void endRealtimeCall("ai_goodbye_fallback_timer");
    }, 4500);
  }

  async function saveAssistantIfNeeded() {
    const text = cleanVoiceText(assistantText);

    if (!text || !conversationId) return;
    if (assistantTextSavedForResponseId === assistantResponseId) return;

    assistantTextSavedForResponseId = assistantResponseId;
    conversationManager.onAssistantReply(text);

    const shouldHangUp = shouldHangUpAfterReply(text);

    // CRM must never block the voice loop — persist off the hot path.
    void saveRealtimeAssistantMessage({
      conversationId,
      text,
      shouldHangUp,
    }).catch((error) => {
      console.error("Async assistant message save error:", error);
    });

    if (shouldHangUp) {
      hangupDesired = true;
      conversationManager.onCallEnding();
      voiceEvents.emit("AIResponseCompleted", {
        callSid,
        conversationId,
        companyId,
        text,
        phase: conversationManager.getPhase(),
        reason: "goodbye",
      });

      void createMeetingRequestIfReady({
        companyId,
        conversationId,
        force: true,
      })
        .then((created) => {
          meetingRequestCreated = created || meetingRequestCreated;
          if (created) {
            conversationManager.onMeetingCreated();
            voiceEvents.emit("MeetingCreated", {
              callSid,
              conversationId,
              companyId,
              phase: conversationManager.getPhase(),
            });
          }
          voiceLog("openai_session_end_requested", {
            callSid,
            conversationId,
            meetingRequestCreated,
          });
        })
        .catch((error) => {
          console.error("Async meeting request error:", error);
        });
    }
  }

  function sendTwilioMediaPayload(audioPayload: string) {
    if (!audioPayload) return;

    if (!streamSid) {
      perf.recordDroppedAudioPacket("missing_stream_sid");
      return;
    }

    if (twilioSocket.readyState !== WebSocket.OPEN) {
      perf.recordDroppedAudioPacket("twilio_socket_not_open");
      return;
    }

    playback.setStreamSid(streamSid);
    assistantPlaybackActive = true;
    lastAssistantAudioAt = Date.now();
    assistantReadyToListenAt = Date.now() + ASSISTANT_POST_PLAYBACK_GRACE_MS;

    const sent = playback.sendMedia(audioPayload);
    if (!sent) {
      perf.recordDroppedAudioPacket("playback_send_failed");
    }
  }

  function maybeFinishElevenLabsPlayback() {
    if (!USE_ELEVENLABS_TTS) return;
    if (!elevenLabsResponseComplete || elevenLabsChunksPending > 0) return;
    if (!streamSid || pendingAssistantPlaybackMark) return;

    pendingAssistantPlaybackMark = `assistant-playback-${assistantResponseId || Date.now()}`;
    playback.setStreamSid(streamSid);
    playback.beginPlaybackMark(pendingAssistantPlaybackMark);
    latency.mark("first_playback_mark", {
      markName: pendingAssistantPlaybackMark,
      transport: elevenLabsTransport,
    });
  }

  async function ensureElevenLabsWs(): Promise<ElevenLabsMultiStreamTts | null> {
    if (!USE_ELEVENLABS_TTS || !PREFER_ELEVENLABS_WS) return null;
    if (elevenLabsTransport === "http") return null;

    if (elevenLabsTts?.isReady) return elevenLabsTts;

    if (!elevenLabsWsConnectPromise) {
      const client = new ElevenLabsMultiStreamTts({
        onAudioChunk: (payload, contextId) => {
          const activeId = elevenLabsTts?.currentContextId;
          // Drop audio from closed/stale contexts so it cannot layer on top
          // of the active utterance.
          if (!activeId || (contextId && activeId !== contextId)) {
            perf.recordDroppedAudioPacket("stale_elevenlabs_context");
            return;
          }
          sendTwilioMediaPayload(payload);
        },
        onFirstChunk: () => {
          latency.mark("elevenlabs_first_audio", {
            transport: "websocket",
          });
        },
        onContextFinal: () => {
          if (elevenLabsTransport !== "websocket") return;
          elevenLabsChunksPending = 0;
          maybeFinishElevenLabsPlayback();
        },
        onError: (error) => {
          console.error("ElevenLabs WS error:", error);
        },
        onOpen: () => {
          voiceLog("elevenlabs_ws_connected", {
            callSid,
            conversationId,
          });
        },
        onClose: () => {
          voiceLog("elevenlabs_ws_closed", {
            callSid,
            conversationId,
            duringPlayback: assistantPlaybackActive || assistantResponseActive,
            assistantResponseId,
          });
          if (assistantPlaybackActive || assistantResponseActive) {
            voiceLog("playback_interruption", {
              callSid,
              conversationId,
              reason: "elevenlabs_ws_closed_during_playback",
              assistantResponseId,
            });
          }
        },
      });

      elevenLabsTts = client;
      elevenLabsWsConnectPromise = client
        .connect()
        .then(() => {
          elevenLabsTransport = "websocket";
          latency.setContext({ ttsTransport: "websocket" });
          perf.setContext({ ttsTransport: "websocket" });
        })
        .catch((error) => {
          console.error(
            "ElevenLabs WS connect failed; falling back to HTTP TTS:",
            error,
          );
          elevenLabsTransport = "http";
          latency.setContext({ ttsTransport: "http" });
          perf.setContext({ ttsTransport: "http" });
          perf.recordWebSocketReconnect(
            "elevenlabs",
            "connect_failed_http_fallback",
          );
          try {
            client.close();
          } catch {
            // ignore
          }
          if (elevenLabsTts === client) {
            elevenLabsTts = null;
          }
        })
        .finally(() => {
          elevenLabsWsConnectPromise = null;
        });
    }

    await elevenLabsWsConnectPromise;
    return elevenLabsTts?.isReady ? elevenLabsTts : null;
  }

  function speakWithElevenLabsHttp(text: string) {
    const cleaned = cleanVoiceText(text);
    if (!cleaned || !USE_ELEVENLABS_TTS) return;

    elevenLabsSpokenForResponse = true;
    elevenLabsChunksPending += 1;
    assistantResponseActive = true;
    assistantPlaybackActive = true;

    elevenLabsSpeakQueue = elevenLabsSpeakQueue
      .then(async () => {
        if (!streamSid || hangupExecuted || bargeInInProgress) return;

        elevenLabsAbort = new AbortController();

        await streamElevenLabsUlaw({
          text: cleaned,
          signal: elevenLabsAbort.signal,
          handlers: {
            onAudioChunk: (payload) => {
              if (bargeInInProgress) return;
              sendTwilioMediaPayload(payload);
            },
            onFirstChunk: () => {
              latency.mark("elevenlabs_first_audio", { transport: "http" });
            },
            onError: (error) => {
              console.error("ElevenLabs TTS chunk error:", error);
            },
          },
        });
      })
      .catch((error) => {
        if ((error as Error)?.name === "AbortError") return;
        console.error("ElevenLabs TTS error:", error);
      })
      .finally(() => {
        elevenLabsChunksPending = Math.max(0, elevenLabsChunksPending - 1);
        maybeFinishElevenLabsPlayback();
      });
  }

  function flushPendingElevenLabsDeltas(client: ElevenLabsMultiStreamTts) {
    if (!client.currentContextId || elevenLabsPendingDeltas.length === 0) return;
    while (elevenLabsPendingDeltas.length > 0) {
      const delta = elevenLabsPendingDeltas.shift();
      if (delta) client.streamDelta(delta, client.currentContextId);
    }
  }

  function speakWithElevenLabs(text: string, options?: { flush?: boolean }) {
    if (!USE_ELEVENLABS_TTS) return;
    const useWs = PREFER_ELEVENLABS_WS && elevenLabsTransport !== "http";
    const cleaned = useWs ? sanitizeStreamingDelta(text) : cleanVoiceText(text);
    if (!cleaned && !options?.flush) return;
    if (cleaned) elevenLabsSpokenForResponse = true;
    assistantResponseActive = true;
    assistantPlaybackActive = true;

    if (!useWs) {
      if (cleaned) speakWithElevenLabsHttp(cleaned);
      return;
    }
    if (!streamSid || hangupExecuted || bargeInInProgress) return;

    const client = elevenLabsTts?.isReady ? elevenLabsTts : null;
    if (client) {
      const contextId = client.currentContextId || `turn-${assistantResponseId || Date.now()}`;
      if (!client.currentContextId) {
        client.beginUtterance(contextId);
        elevenLabsChunksPending = Math.max(1, elevenLabsChunksPending);
        playback.resetTurnPlayback();
      }
      flushPendingElevenLabsDeltas(client);
      if (cleaned) client.streamDelta(cleaned, contextId);
      if (options?.flush) client.flush(contextId);
      return;
    }

    if (cleaned) elevenLabsPendingDeltas.push(cleaned);
    void ensureElevenLabsWs().then((ready) => {
      if (!ready || hangupExecuted || bargeInInProgress) return;
      const contextId = ready.currentContextId || `turn-${assistantResponseId || Date.now()}`;
      if (!ready.currentContextId) {
        ready.beginUtterance(contextId);
        elevenLabsChunksPending = Math.max(1, elevenLabsChunksPending);
        playback.resetTurnPlayback();
      }
      flushPendingElevenLabsDeltas(ready);
      if (options?.flush) ready.flush(contextId);
    }).catch((error) => {
      console.error("ElevenLabs WS speak error:", error);
      const fallback = elevenLabsPendingDeltas.splice(0).join("");
      if (fallback) speakWithElevenLabsHttp(cleanVoiceText(fallback));
    });
  }

  function flushElevenLabsTurn() {
    if (!USE_ELEVENLABS_TTS) return;

    if (elevenLabsTts?.isReady && elevenLabsTts.currentContextId) {
      elevenLabsTts.flush();
    }
  }

  function beginElevenLabsResponseContext() {
    if (!USE_ELEVENLABS_TTS || !PREFER_ELEVENLABS_WS) return;
    if (elevenLabsTransport === "http") return;

    const contextId = `turn-${assistantResponseId || Date.now()}`;
    void ensureElevenLabsWs().then((client) => {
      if (!client) return;
      // Close prior context if any, then start fresh for this reply.
      // Do NOT clear Twilio here — that caused mid-call silence when the
      // greeting was still draining. Barge-in owns clearPlayback.
      if (client.currentContextId && client.currentContextId !== contextId) {
        client.closeContext(client.currentContextId);
      }
      client.beginUtterance(contextId);
      elevenLabsChunksPending = 1;
      playback.resetTurnPlayback();
    });
  }

  function completeElevenLabsResponse() {
    if (!USE_ELEVENLABS_TTS) return;

    const finish = () => {
      flushElevenLabsTurn();
      elevenLabsResponseComplete = true;

      if (elevenLabsTransport === "websocket") {
        // Prefer waiting for ElevenLabs is_final. Safety mark only if audio
        // has gone quiet — never cut mid-stream (caused overlapping words).
        setTimeout(() => {
          if (
            !elevenLabsResponseComplete ||
            pendingAssistantPlaybackMark ||
            bargeInInProgress
          ) {
            return;
          }
          const quietForMs = Date.now() - (lastAssistantAudioAt || 0);
          if (lastAssistantAudioAt && quietForMs < 600) {
            return;
          }
          elevenLabsChunksPending = 0;
          maybeFinishElevenLabsPlayback();
        }, 3200);
        return;
      }

      maybeFinishElevenLabsPlayback();
    };

    // WebSocket delta sends are synchronous and ordered by ws.send().
    // There is no Promise queue in the optimized path.
    finish();
  }

  function handleBargeIn(reason: string) {
    if (!BARGE_IN_ENABLED || bargeInInProgress) return;
    if (!assistantResponseActive && !assistantPlaybackActive) return;

    bargeInInProgress = true;
    const finishBargeInPerf = perf.beginBargeIn(reason);

    voiceLog("barge_in", {
      callSid,
      conversationId,
      reason,
      assistantResponseId,
    });
    voiceLog("playback_interruption", {
      callSid,
      conversationId,
      reason: `barge_in:${reason}`,
      assistantResponseId,
      assistantResponseActive,
      assistantPlaybackActive,
    });

    voiceEvents.emit("BargeIn", {
      callSid,
      conversationId,
      companyId,
      reason,
      phase: conversationManager.getPhase(),
    });

    // 1. Clear Twilio playback buffer immediately.
    if (streamSid) {
      playback.setStreamSid(streamSid);
      playback.clearPlayback();
    }

    pendingAssistantPlaybackMark = "";
    assistantPlaybackActive = false;
    assistantResponseActive = false;
    elevenLabsChunksPending = 0;
    elevenLabsResponseComplete = true;
    elevenLabsSpokenForResponse = false;
    sentenceStreamer.reset();
    elevenLabsPendingDeltas.length = 0;

    // 2. Abort HTTP TTS if in flight.
    if (elevenLabsAbort) {
      elevenLabsAbort.abort();
      elevenLabsAbort = null;
    }
    elevenLabsSpeakQueue = Promise.resolve();

    // 3. Close ElevenLabs synthesis context (multi-context close_context).
    if (elevenLabsTts) {
      elevenLabsTts.interrupt();
    }

    // 4. Cancel OpenAI response generation.
    if (openAiSocket.readyState === WebSocket.OPEN) {
      voiceLog("response_cancel", {
        callSid,
        conversationId,
        reason,
        assistantResponseId,
      });
      sendSocketJson(openAiSocket, {
        type: "response.cancel",
      });
      sendSocketJson(openAiSocket, {
        type: "input_audio_buffer.clear",
      });
    }

    finishBargeInPerf();

    lastAssistantAudioAt = Date.now();
    // Short grace so we do not immediately re-trigger on residual echo.
    assistantReadyToListenAt = Date.now() + BARGE_IN_ECHO_GUARD_MS;

    setTimeout(() => {
      bargeInInProgress = false;
    }, 120);
  }

  async function sendSessionUpdate() {
    if (!openAiReady || !twilioStarted || sessionUpdateSent) return;

    try {
      currentVoiceLanguage =
        streamPreferredLanguage && streamPreferredLanguage !== "AUTO"
          ? streamPreferredLanguage
          : await getConversationVoiceLanguage(conversationId);

      const instructions = await buildRealtimeInstructions({
        companyId,
        conversationId,
      });

      const sessionAudio: Record<string, unknown> = {
        input: {
          format: {
            type: "audio/pcmu",
          },
          transcription: {
            model: "gpt-4o-mini-transcribe",
          },
          turn_detection: null,
        },
      };

      // OpenAI native audio path only when ElevenLabs is not the TTS provider.
      if (!USE_ELEVENLABS_TTS) {
        sessionAudio.output = {
          format: {
            type: "audio/pcmu",
          },
          voice: OPENAI_REALTIME_VOICE,
        };
      }

      sendSocketJson(openAiSocket, {
        type: "session.update",
        session: {
          type: "realtime",
          model: OPENAI_REALTIME_MODEL,
          instructions,
          output_modalities: USE_ELEVENLABS_TTS ? ["text"] : ["audio"],
          audio: sessionAudio,
          max_output_tokens: REALTIME_OUTPUT_TOKEN_LIMIT,
        },
      });

      sessionUpdateSent = true;
      console.log("OpenAI realtime session.update sent.", {
        ttsProvider: USE_ELEVENLABS_TTS ? "elevenlabs" : "openai",
        outputModalities: USE_ELEVENLABS_TTS ? ["text"] : ["audio"],
      });
    } catch (error) {
      console.error("Failed to build full OpenAI realtime session update:", error);

      const fallbackInstructions = `
You are a natural, concise phone receptionist for ${VOICE_BUSINESS_NAME}.
${getVoiceLanguageRules(currentVoiceLanguage)}
Listen fully before replying.
Use at most two short complete sentences and ask only one useful question.
Collect the caller's requirement naturally, then ask for a meeting day and time.
Do not end the call until the caller asks to end or the meeting is confirmed.
`.trim();

      const fallbackAudio: Record<string, unknown> = {
        input: {
          format: { type: "audio/pcmu" },
          transcription: { model: "gpt-4o-mini-transcribe" },
          turn_detection: null,
        },
      };

      if (!USE_ELEVENLABS_TTS) {
        fallbackAudio.output = {
          format: { type: "audio/pcmu" },
          voice: OPENAI_REALTIME_VOICE,
        };
      }

      sendSocketJson(openAiSocket, {
        type: "session.update",
        session: {
          type: "realtime",
          model: OPENAI_REALTIME_MODEL,
          instructions: fallbackInstructions,
          output_modalities: USE_ELEVENLABS_TTS ? ["text"] : ["audio"],
          audio: fallbackAudio,
          max_output_tokens: REALTIME_OUTPUT_TOKEN_LIMIT,
        },
      });

      sessionUpdateSent = true;
      voiceLog("openai_session_fallback_update_sent", {
        callSid,
        conversationId,
      });
    }
  }

  async function maybeConfigureAndGreet() {
    if (!openAiReady || !twilioStarted) return;

    await sendSessionUpdate();

    if (!sessionUpdated) return;

    // ElevenLabs path: greeting should already be speaking (started on Twilio
    // media start). Only seed OpenAI history here — never wait on OpenAI
    // before the caller hears audio.
    if (USE_ELEVENLABS_TTS) {
      if (!initialGreetingSpoken) {
        speakElevenLabsGreetingNow("session_updated_fallback");
      }

      if (greetingSeededInOpenAi) return;
      greetingSeededInOpenAi = true;

      const greeting =
        cleanVoiceText(assistantText) ||
        getLocalizedVoiceGreeting(
          currentVoiceLanguage || streamPreferredLanguage,
        );

      sendSocketJson(openAiSocket, {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: greeting,
            },
          ],
        },
      });
      void saveAssistantIfNeeded();
      return;
    }

    if (initialGreetingSent) return;
    initialGreetingSent = true;

    console.log("Sending initial AI greeting.", {
      ttsProvider: "openai",
    });

    const greeting = getLocalizedVoiceGreeting(currentVoiceLanguage);
    assistantText = greeting;
    assistantResponseId = `greeting-${Date.now()}`;
    latency.mark("assistant_response_create", { reason: "greeting" });

    sendSocketJson(openAiSocket, {
      type: "response.create",
      response: {
        output_modalities: ["audio"],
        max_output_tokens: REALTIME_OUTPUT_TOKEN_LIMIT,
        instructions: `Start the call now. Say exactly this greeting, naturally, in the selected language: ${greeting}`,
      },
    });
  }

  function speakElevenLabsGreetingNow(reason: string) {
    if (!USE_ELEVENLABS_TTS || initialGreetingSpoken || !streamSid) return;

    initialGreetingSpoken = true;
    initialGreetingSent = true;

    const greeting = getLocalizedVoiceGreeting(
      currentVoiceLanguage || streamPreferredLanguage,
    );
    assistantText = greeting;
    assistantResponseId = `greeting-${Date.now()}`;
    latency.mark("assistant_response_create", { reason: "greeting" });
    elevenLabsResponseComplete = true;
    elevenLabsChunksPending = 1;
    assistantResponseActive = true;
    assistantPlaybackActive = true;

    voiceLog("immediate_greeting", {
      callSid,
      conversationId,
      reason,
      chars: greeting.length,
      ttsProvider: "elevenlabs",
    });

    console.log("Sending immediate ElevenLabs greeting.", { reason });

    const finishSafetyMark = () => {
      setTimeout(() => {
        if (
          !elevenLabsResponseComplete ||
          pendingAssistantPlaybackMark ||
          bargeInInProgress
        ) {
          return;
        }
        const quietForMs = Date.now() - (lastAssistantAudioAt || 0);
        if (lastAssistantAudioAt && quietForMs < 600) {
          return;
        }
        elevenLabsChunksPending = 0;
        maybeFinishElevenLabsPlayback();
      }, 4000);
    };

    if (PREFER_ELEVENLABS_WS) {
      void ensureElevenLabsWs()
        .then((client) => {
          if (client) {
            client.beginUtterance(`greeting-${assistantResponseId}`);
          }
          speakWithElevenLabs(greeting, { flush: true });
          finishSafetyMark();
        })
        .catch(() => {
          speakWithElevenLabs(greeting, { flush: true });
          finishSafetyMark();
        });
      return;
    }

    speakWithElevenLabs(greeting, { flush: true });
    finishSafetyMark();
  }

  function prepareNextAssistantResponse(reason: string) {
    const finalGoodbye = getLocalizedFinalGoodbye(currentVoiceLanguage);
    const questionExamples = getLocalizedQuestionExamples(currentVoiceLanguage);
    const languageRules = getVoiceLanguageRules(currentVoiceLanguage);
    const usefulCount = conversationManager.getUsefulRequirementCount();
    const shouldAskAvailability = !meetingRequestCreated && (awaitingMeetingAvailability || usefulCount >= Math.max(2, AUTO_MEETING_AFTER_CUSTOMER_TURNS - 1));

    const instructions = meetingRequestCreated
      ? `Stop asking questions now.
Language rules:
${languageRules}
Say exactly this complete sentence in the selected language and do not add anything else: ${finalGoodbye}`
      : shouldAskAvailability
        ? `Reply now as ${VOICE_BUSINESS_NAME}'s phone assistant.
Language rules:
${languageRules}
Requirements are already clear enough. Your ONLY job now is to schedule a meeting. Ask exactly one short question about availability. Do not ask about budget, features, or anything else. Do not say goodbye yet.`
        : `Reply now as ${VOICE_BUSINESS_NAME}'s phone assistant.
Reason: ${reason}
Language rules:
${languageRules}
Speak calmly and naturally. Finish the full sentence. Use at most 2 complete short sentences. Ask only 1 useful next question. Do not ask budget too early. Do not repeat the caller's full sentence. After requirements are clear, ask one availability question for a meeting. ${questionExamples}`;

    preparedResponseReason = reason;
    preparedResponseCreateJson = JSON.stringify({
      type: "response.create",
      response: {
        output_modalities: USE_ELEVENLABS_TTS ? ["text"] : ["audio"],
        max_output_tokens: REALTIME_OUTPUT_TOKEN_LIMIT,
        instructions,
      },
    });
  }

  function commitCallerTurn(reason: string) {
    if (!callerTurnActive || callerTurnCommitting || assistantResponseActive) return;

    if (callerTurnSpeechFrameCount < 2 || callerTurnFrameCount < 3) {
      if (openAiSocket.readyState === WebSocket.OPEN) openAiSocket.send(INPUT_AUDIO_CLEAR_JSON);
      resetCallerTurn();
      return;
    }

    if (!preparedResponseCreateJson) prepareNextAssistantResponse(reason);
    callerTurnCommitting = true;
    if (callerTurnEndTimer) {
      clearTimeout(callerTurnEndTimer);
      callerTurnEndTimer = null;
    }

    const speechEndedAt = callerTurnLastSpeechAt > 0 ? callerTurnLastSpeechAt : Date.now();
    const committedAt = Date.now();
    assistantResponseActive = true;
    sentenceStreamer.reset();
    elevenLabsSpokenForResponse = false;
    elevenLabsResponseComplete = false;

    if (openAiSocket.readyState !== WebSocket.OPEN) {
      assistantResponseActive = false;
      callerTurnCommitting = false;
      return;
    }

    openAiSocket.send(INPUT_AUDIO_COMMIT_JSON);
    openAiSocket.send(preparedResponseCreateJson);

    const dispatchedReason = preparedResponseReason || reason;
    preparedResponseCreateJson = "";
    setImmediate(() => {
      latency.markAt("caller_speech_ended", speechEndedAt, { reason });
      latency.markAt("caller_turn_committed", committedAt, { reason });
      latency.markAt("assistant_response_create", committedAt, { reason: dispatchedReason });
      latency.mark("vad_triggered", { reason });
      voiceEvents.emit("SpeechEnded", { callSid, conversationId, companyId, reason, phase: conversationManager.getPhase() });
      voiceEvents.emit("VadTriggered", { callSid, conversationId, companyId, reason });
      voiceEvents.emit("TurnCommitted", { callSid, conversationId, companyId, reason });
    });
    resetCallerTurn();
  }

  function scheduleCallerTurnEndCheck() {
    if (callerTurnEndTimer) {
      clearTimeout(callerTurnEndTimer);
    }

    const speechMs =
      callerTurnSpeechStartedAt > 0
        ? Date.now() - callerTurnSpeechStartedAt
        : 0;

    callerTurnEndTimer = setTimeout(() => {
      if (!callerTurnActive || callerTurnCommitting) return;

      const now = Date.now();
      const silenceMs = now - callerTurnLastSpeechAt;
      const currentSpeechMs = now - callerTurnSpeechStartedAt;
      const decision = evaluateAdaptiveTurn({
        speechMs: currentSpeechMs,
        silenceMs,
        speechFrameCount: callerTurnSpeechFrameCount,
        totalFrameCount: callerTurnFrameCount,
      });

      if (decision.shouldCommit) {
        commitCallerTurn(`adaptive_${decision.reason}_timer`);
      }
    }, adaptiveVadTimerDelayMs({
      speechMs,
      speechFrameCount: callerTurnSpeechFrameCount,
    }));
  }

  function handleInboundAudio(base64Payload: string) {
    if (!base64Payload) return;

    perf.recordInboundMediaFrame();
    const now = Date.now();

    if (
      !openAiReady ||
      !twilioStarted ||
      !sessionUpdateSent ||
      !sessionUpdated ||
      hangupDesired ||
      bargeInInProgress
    ) {
      return;
    }

    // While assistant is speaking: listen only for barge-in, do not append.
    if (assistantResponseActive || assistantPlaybackActive) {
      if (!BARGE_IN_ENABLED) return;
      if (now < assistantReadyToListenAt) return;
      if (
        lastAssistantAudioAt &&
        now - lastAssistantAudioAt < BARGE_IN_ECHO_GUARD_MS
      ) {
        return;
      }

      const bargeLevel = getMulawAudioLevel(base64Payload);
      if (bargeLevel.speech) {
        handleBargeIn("caller_speech_during_playback");
      }
      return;
    }

    if (now < assistantReadyToListenAt) {
      return;
    }

    if (
      lastAssistantAudioAt &&
      now - lastAssistantAudioAt < LOCAL_ECHO_GUARD_MS
    ) {
      return;
    }

    const level = getMulawAudioLevel(base64Payload);

    if (!callerTurnActive) {
      if (!level.speech) {
        return;
      }

      callerTurnActive = true;
      callerTurnCommitting = false;
      callerTurnSpeechStartedAt = now;
      callerTurnLastSpeechAt = now;
      callerTurnFrameCount = 0;
      callerTurnSpeechFrameCount = 0;

      sendSocketJson(openAiSocket, {
        type: "input_audio_buffer.clear",
      });

      latency.mark("caller_speech_started", {
        rms: Math.round(level.rms),
        peak: Math.round(level.peak),
      });

      voiceEvents.emit("SpeechStarted", {
        callSid,
        conversationId,
        companyId,
        phase: conversationManager.getPhase(),
      });

      console.log("Caller started speaking.", {
        rms: Math.round(level.rms),
        peak: Math.round(level.peak),
      });
    }

    callerTurnFrameCount += 1;

    if (level.speech) {
      callerTurnSpeechFrameCount += 1;
      callerTurnLastSpeechAt = now;
    }

    sendSocketJson(openAiSocket, {
      type: "input_audio_buffer.append",
      audio: base64Payload,
    });

    const silenceMs = now - callerTurnLastSpeechAt;
    const speechMs = now - callerTurnSpeechStartedAt;
    const decision = evaluateAdaptiveTurn({
      speechMs,
      silenceMs,
      speechFrameCount: callerTurnSpeechFrameCount,
      totalFrameCount: callerTurnFrameCount,
    });

    if (decision.shouldCommit) {
      commitCallerTurn(
        decision.reason === "max_turn"
          ? "local_max_turn"
          : `adaptive_${decision.reason}`,
      );
      return;
    }

    scheduleCallerTurnEndCheck();
  }

  openAiSocket.on("open", async () => {
    openAiReady = true;
    voiceLog("openai_session_started", {
      callSid,
      conversationId,
    });

    if (USE_ELEVENLABS_TTS && PREFER_ELEVENLABS_WS) void ensureElevenLabsWs();
    await maybeConfigureAndGreet();
  });

  openAiSocket.on("message", async (raw) => {
    const event = safeJsonParse(raw);
    if (!event) return;

    if (event.type === "error") {
      console.error("OpenAI realtime error:", JSON.stringify(event, null, 2));

      if (event?.error?.code === "input_audio_buffer_commit_empty") {
        resetCallerTurn();
      }

      return;
    }

    if (event.type === "session.created") {
      console.log("OpenAI realtime session created.");
      return;
    }

    if (event.type === "session.updated") {
      sessionUpdated = true;
      prepareNextAssistantResponse("session_ready");
      console.log("OpenAI realtime session updated.");

      await maybeConfigureAndGreet();
      return;
    }

    if (event.type === "response.created") {
      assistantResponseActive = true;
      assistantReadyToListenAt = Date.now() + ASSISTANT_POST_PLAYBACK_GRACE_MS;
      assistantResponseId = String(
        event.response?.id || event.response_id || Date.now(),
      );
      assistantText = "";
      elevenLabsSpokenForResponse = false;
      elevenLabsResponseComplete = false;
      sentenceStreamer.reset();
      beginElevenLabsResponseContext();
      voiceEvents.emit("AIResponseStarted", {
        callSid,
        conversationId,
        companyId,
        phase: conversationManager.getPhase(),
      });
      return;
    }

    if (
      event.type === "conversation.item.input_audio_transcription.completed" ||
      event.type === "conversation.item.input_audio_transcription.done"
    ) {
      const callerText = cleanVoiceText(event.transcript || event.text || "");

      if (callerText) {
        console.log("Caller transcript:", callerText);

        const turnSummary = conversationManager.onCallerTranscript({
          transcript: callerText,
          meetingAlreadyCreated: meetingRequestCreated,
        });

        voiceLog("conversation_phase", {
          callSid,
          conversationId,
          phase: conversationManager.getPhase(),
          customerTurnCount: turnSummary.customerTurnCount,
          usefulRequirementCount: turnSummary.usefulRequirementCount,
        });

        // Persist CRM off the critical audio path.
        void saveRealtimeCustomerMessage({
          conversationId,
          text: callerText,
        }).catch((error) => {
          console.error("Async customer message save error:", error);
        });

        void createMeetingRequestIfReady({
          companyId,
          conversationId,
          force: false,
        })
          .then((created) => {
            meetingRequestCreated = created || meetingRequestCreated;
            if (created) {
              awaitingMeetingAvailability = false;
              conversationManager.onMeetingCreated();
              voiceEvents.emit("MeetingCreated", {
                callSid,
                conversationId,
                companyId,
                phase: conversationManager.getPhase(),
              });
              return;
            }

            const useful =
              turnSummary.usefulRequirementCount ||
              conversationManager.getUsefulRequirementCount();
            const hasAvailability = Boolean(
              extractPreferredMeetingTimeFromText(callerText),
            );
            if (
              useful >= Math.max(2, AUTO_MEETING_AFTER_CUSTOMER_TURNS - 1) &&
              !hasAvailability
            ) {
              awaitingMeetingAvailability = true;
            }
          })
          .catch((error) => {
            console.error("Async meeting request error:", error);
          });

        if (shouldEndCall(callerText) && !assistantResponseActive) {
          conversationManager.onCallEnding();
          sendSocketJson(openAiSocket, {
            type: "response.create",
            response: {
              output_modalities: USE_ELEVENLABS_TTS ? ["text"] : ["audio"],
              max_output_tokens: REALTIME_OUTPUT_TOKEN_LIMIT,
              instructions:
                "The caller wants to end the call. Say exactly: Thanks for calling. Kadam's team will follow up if needed. Goodbye.",
            },
          });
        }
      }

      return;
    }

    if (
      event.type === "response.output_audio.delta" ||
      event.type === "response.audio.delta"
    ) {
      // Native OpenAI audio path only — ElevenLabs owns audio when enabled.
      if (USE_ELEVENLABS_TTS) return;

      const audioPayload = event.delta;

      if (audioPayload && streamSid) {
        sendTwilioMediaPayload(audioPayload);
      }

      return;
    }

    if (
      event.type === "response.output_audio_transcript.delta" ||
      event.type === "response.audio_transcript.delta" ||
      event.type === "response.output_text.delta" ||
      event.type === "response.text.delta"
    ) {
      const text = typeof event.delta === "string" ? event.delta : extractTextFromRealtimeEvent(event);

      if (text) {
        if (!assistantText) {
          latency.mark("openai_first_token", {
            transport: elevenLabsTransport,
          });
        }

        assistantText += text;

        if (USE_ELEVENLABS_TTS) {
          const useWs =
            PREFER_ELEVENLABS_WS && elevenLabsTransport !== "http";

          if (useWs) {
            // Primary path: stream every delta immediately — no sentence wait.
            speakWithElevenLabs(text, { flush: false });
          } else {
            // HTTP fallback: sentence buffer before each utterance request.
            const chunks = sentenceStreamer.push(text);
            for (const chunk of chunks) {
              speakWithElevenLabs(chunk, { flush: true });
            }
          }
        }
      }

      return;
    }

    if (
      event.type === "response.output_audio_transcript.done" ||
      event.type === "response.audio_transcript.done" ||
      event.type === "response.output_text.done" ||
      event.type === "response.text.done"
    ) {
      const finalText = extractTextFromRealtimeEvent(event);

      if (finalText) {
        assistantText = finalText;
      }

      if (assistantText) {
        console.log("Assistant transcript:", assistantText);
      }

      return;
    }

    if (
      event.type === "response.output_audio.done" ||
      event.type === "response.audio.done"
    ) {
      return;
    }

    if (event.type === "response.done") {
      const fallbackText = extractTextFromRealtimeEvent(event);

      if (fallbackText && !assistantText) {
        assistantText = fallbackText;
      }

      if (assistantText) {
        console.log("Assistant response done:", assistantText);
      }

      latency.mark("openai_final_delta", {
        transport: elevenLabsTransport,
      });

      if (USE_ELEVENLABS_TTS) {
        const useWs =
          PREFER_ELEVENLABS_WS && elevenLabsTransport !== "http";

        if (useWs) {
          // Flush at turn end only. Deltas were already streamed continuously.
          if (!elevenLabsSpokenForResponse && cleanVoiceText(assistantText)) {
            speakWithElevenLabs(assistantText, { flush: true });
          } else {
            speakWithElevenLabs("", { flush: true });
          }
        } else {
          const remaining = sentenceStreamer.flush();
          if (remaining) {
            speakWithElevenLabs(remaining, { flush: true });
          } else if (
            !elevenLabsSpokenForResponse &&
            cleanVoiceText(assistantText)
          ) {
            speakWithElevenLabs(assistantText, { flush: true });
          }
        }

        completeElevenLabsResponse();
      }

      voiceEvents.emit("AIResponseCompleted", {
        callSid,
        conversationId,
        companyId,
        text: assistantText,
        phase: conversationManager.getPhase(),
      });

      void saveAssistantIfNeeded();

      assistantResponseActive = USE_ELEVENLABS_TTS
        ? elevenLabsChunksPending > 0 || assistantPlaybackActive
        : false;

      if (!USE_ELEVENLABS_TTS) {
        if (streamSid && assistantPlaybackActive) {
          pendingAssistantPlaybackMark = `assistant-playback-${assistantResponseId || Date.now()}`;
          playback.setStreamSid(streamSid);
          playback.beginPlaybackMark(pendingAssistantPlaybackMark);
          latency.mark("first_playback_mark", {
            markName: pendingAssistantPlaybackMark,
            transport: "openai",
          });
        } else {
          assistantPlaybackActive = false;
          lastAssistantAudioAt = Date.now();
          assistantReadyToListenAt =
            Date.now() + ASSISTANT_POST_PLAYBACK_GRACE_MS;

          if (hangupDesired) {
            maybeHangUpAfterFinalReply();
          }
        }
      }

      setImmediate(() => prepareNextAssistantResponse("previous_response_done"));
      return;
    }

    if (event.type === "input_audio_buffer.committed") {
      console.log("OpenAI accepted caller audio commit.");
      return;
    }

    if (event.type === "input_audio_buffer.cleared") {
      return;
    }
  });

  openAiSocket.on("error", (error) => {
    console.error("OpenAI realtime socket error:", error);
  });

  openAiSocket.on("close", () => {
    voiceLog("openai_session_ended", {
      callSid,
      conversationId,
      hangupDesired,
      hangupExecuted,
    });
  });

  twilioSocket.on("message", async (raw) => {
    const event = safeJsonParse(raw);
    if (!event) return;

    if (event.event === "connected") {
      voiceLog("media_stream_socket_connected", {
        callSid,
      });
      return;
    }

    if (event.event === "start") {
      streamSid = String(event.start?.streamSid || event.streamSid || "");
      callSid = String(
        event.start?.callSid ||
          event.start?.customParameters?.callSid ||
          callSid ||
          "",
      );

      fromPhone = String(
        event.start?.customParameters?.fromPhone || fromPhone || "",
      );

      toPhone = String(
        event.start?.customParameters?.toPhone || toPhone || "",
      );

      publicUrlFromStream = String(
        event.start?.customParameters?.publicUrl ||
          process.env.PUBLIC_WEBHOOK_URL ||
          "",
      );

      const streamConversationId = String(
        event.start?.customParameters?.conversationId || "",
      ).trim();
      if (streamConversationId) {
        conversationId = streamConversationId;
      }

      recordingManagedByCallApi =
        String(event.start?.customParameters?.recordingManagedByCallApi || "")
          .toLowerCase()
          .trim() === "true";

      playback.setStreamSid(streamSid);
      latency.setContext({
        callSid,
        streamSid,
        ttsTransport: elevenLabsTransport,
      });
      perf.setContext({
        callSid,
        streamSid,
        ttsTransport: elevenLabsTransport,
      });

      streamPreferredLanguage = normalizeVoiceLanguage(
        String(event.start?.customParameters?.preferredLanguage || "AUTO"),
      );
      if (!currentVoiceLanguage || currentVoiceLanguage === "AUTO") {
        currentVoiceLanguage = streamPreferredLanguage;
      }

      // Mark media ready immediately and greet via ElevenLabs before DB /
      // OpenAI session work — that wait was causing 5–7s of silence and
      // made it sound like a different system spoke first.
      twilioStarted = true;
      if (USE_ELEVENLABS_TTS && PREFER_ELEVENLABS_WS) {
        void ensureElevenLabsWs();
      }
      if (USE_ELEVENLABS_TTS) {
        speakElevenLabsGreetingNow("media_stream_start");
      }

      voiceLog("media_stream_connected", {
        streamSid,
        callSid,
        fromPhone,
        toPhone,
        preferredLanguage: streamPreferredLanguage,
      });

      try {
        if (conversationId) {
          // Outbound calls already have a conversation. Use the ID passed
          // through <Stream><Parameter> and avoid racing the async
          // outbound-answer Prisma update against the WebSocket start event.
          const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { id: true, companyId: true },
          });

          if (conversation) {
            companyId = conversation.companyId;
          } else {
            console.warn("Realtime outbound conversation was not found.", {
              callSid,
              conversationId,
            });
          }
        } else {
          // Incoming calls may still need their context created here.
          const context = await getOrCreateCallContext({
            callSid,
            fromPhone,
            toPhone,
          });

          companyId = context.company.id;
          conversationId = context.conversation.id;
        }

        latency.setContext({
          callSid,
          conversationId,
          streamSid,
          ttsProvider: USE_ELEVENLABS_TTS ? "elevenlabs" : "openai",
          model: OPENAI_REALTIME_MODEL,
        });
        perf.setContext({
          callSid,
          conversationId,
          streamSid,
          ttsProvider: USE_ELEVENLABS_TTS ? "elevenlabs" : "openai",
          model: OPENAI_REALTIME_MODEL,
        });

        // Status and recording work is intentionally detached. A database or
        // Twilio REST failure must never close the live Media Stream.
        if (callSid) {
          void applyTwilioCallStatusUpdate({
            callSid,
            twilioStatus: "in-progress",
            source: "media_stream_start",
          }).catch((error) => {
            console.error("Async realtime status update failed:", error);
          });

          void prisma.call
            .updateMany({
              where: {
                providerCallId: callSid,
                status: {
                  in: ["RINGING", "IN_PROGRESS"],
                },
              },
              data: {
                status: "LIVE",
                startedAt: new Date(),
              },
            })
            .then(() => {
              voiceLog("call_answered_live", {
                callSid,
                conversationId,
                status: "LIVE",
              });
            })
            .catch((error) => {
              console.error("Async call LIVE update failed:", error);
            });
        }

        if (!recordingStartRequested && !recordingManagedByCallApi) {
          recordingStartRequested = true;
          const recordingPublicUrl =
            publicUrlFromStream || process.env.PUBLIC_WEBHOOK_URL || "";
          void startTwilioCallRecording(
            recordingPublicUrl
              ? { callSid, publicUrl: recordingPublicUrl }
              : { callSid },
          ).catch((error) => {
            console.error("Async recording start failed:", error);
          });
        }
      } catch (error) {
        // Never close the phone call because CRM/bootstrap work failed.
        // The realtime session can continue with environment-backed defaults.
        console.error("Realtime context bootstrap degraded:", error);
        voiceLog("realtime_context_bootstrap_degraded", {
          callSid,
          conversationId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }

      await maybeConfigureAndGreet();
      return;
    }

    if (event.event === "media") {
      const audioPayload = event.media?.payload;

      if (event.media?.track && event.media.track !== "inbound") {
        return;
      }

      handleInboundAudio(audioPayload);
      return;
    }

    if (event.event === "mark") {
      const markName = String(event.mark?.name || "");

      if (
        markName &&
        (markName === pendingAssistantPlaybackMark ||
          playback.handleMark(markName))
      ) {
        assistantPlaybackActive = false;
        pendingAssistantPlaybackMark = "";
        playback.markPlaybackIdle();
        lastAssistantAudioAt = Date.now();
        assistantReadyToListenAt =
          Date.now() + ASSISTANT_POST_PLAYBACK_GRACE_MS;
        assistantResponseActive = false;
        latency.mark("assistant_playback_complete", { markName });
        console.log("Assistant playback finished.", { markName });

        if (hangupDesired) {
          maybeHangUpAfterFinalReply();
        }
      }

      if (markName === "assistant-final-goodbye") {
        setTimeout(() => {
          void endRealtimeCall("ai_goodbye_mark_complete");
        }, 900);
      }

      return;
    }

    if (event.event === "dtmf") {
      console.log("Twilio DTMF received:", event.dtmf?.digit);
      return;
    }

    if (event.event === "stop") {
      const stoppedCallSid = String(event.stop?.callSid || callSid || "");

      voiceLog("media_stream_stopped", {
        callSid: stoppedCallSid,
        conversationId,
      });

      hangupExecuted = true;

      void finalizeOnce("twilio_media_stream_stopped").finally(() => {
        if (stoppedCallSid) {
          void fetchTwilioRecordingForCall(stoppedCallSid);
        }
        cleanup();
      });
    }
  });

  twilioSocket.on("error", (error) => {
    console.error("Twilio realtime socket error:", error);
    cleanup();
  });

  twilioSocket.on("close", () => {
    console.log("Twilio realtime socket closed.");

    // Fallback only: prefer media-stream `stop` / Twilio status callbacks.
    if (!conversationFinalized && (callSid || conversationId)) {
      void finalizeOnce("websocket_close_fallback");
    }

    if (elevenLabsTts) {
      elevenLabsTts.close();
      elevenLabsTts = null;
    }

    if (
      openAiSocket.readyState === WebSocket.OPEN ||
      openAiSocket.readyState === WebSocket.CONNECTING
    ) {
      openAiSocket.close();
    }
  });
}

export async function handleTwilioIncomingCall(
  req: AuthRequest,
  res: Response,
) {
  try {
    const publicUrl = getPublicUrl(req);

    const callSid = String(req.body.CallSid || "");
    const fromPhone = String(req.body.From || "");
    const toPhone = String(req.body.To || "");

    await getOrCreateCallContext({
      callSid,
      fromPhone,
      toPhone,
    });

    const response = twimlResponse(`
      ${buildPromptThenListen(publicUrl, VOICE_GREETING)}
    `);

    return sendXml(res, response);
  } catch (error) {
    console.error("Twilio incoming call error:", error);

    return sendXml(
      res,
      twimlResponse(`
        ${say("Sorry, the AI assistant is not available right now. Please try again later.")}
        <Hangup/>
      `),
    );
  }
}

export async function handleTwilioSpeech(req: AuthRequest, res: Response) {
  try {
    const publicUrl = getPublicUrl(req);

    const callSid = String(req.body.CallSid || "");
    const fromPhone = String(req.body.From || "");
    const toPhone = String(req.body.To || "");
    const speechResult = String(req.body.SpeechResult || "").trim();

    const context = await getOrCreateCallContext({
      callSid,
      fromPhone,
      toPhone,
    });

    if (!speechResult) {
      return sendXml(
        res,
        twimlResponse(`
          ${buildPromptThenListen(publicUrl, "I did not catch that. Please say it once more.")}
        `),
      );
    }

    await prisma.message.create({
      data: {
        conversationId: context.conversation.id,
        senderType: "CUSTOMER",
        body: speechResult,
      },
    });

    await prisma.conversation.update({
      where: {
        id: context.conversation.id,
      },
      data: {
        lastMessage: speechResult,
        lastMessageAt: new Date(),
      },
    });

    if (shouldEndCall(speechResult)) {
      const endReply =
        "Thanks for calling. Kadam's team will follow up if needed. Goodbye.";

      await prisma.message.create({
        data: {
          conversationId: context.conversation.id,
          senderType: "AI",
          body: endReply,
        },
      });

      await prisma.conversation.update({
        where: {
          id: context.conversation.id,
        },
        data: {
          status: "FOLLOW_UP",
          aiSummary: "Caller ended the call.",
          nextAction: "Review call and follow up if needed.",
          lastMessage: "Call ended by caller.",
          lastMessageAt: new Date(),
        },
      });

      return sendXml(
        res,
        twimlResponse(`
          ${say(endReply)}
          <Hangup/>
        `),
      );
    }

    const aiReply = await generateAiVoiceReply({
      companyId: context.company.id,
      conversationId: context.conversation.id,
      userSpeech: speechResult,
    });

    await prisma.message.create({
      data: {
        conversationId: context.conversation.id,
        senderType: "AI",
        body: aiReply,
      },
    });

    const shouldHangUp = shouldHangUpAfterReply(aiReply);

    await prisma.conversation.update({
      where: {
        id: context.conversation.id,
      },
      data: {
        status: shouldHangUp ? "FOLLOW_UP" : "IN_PROGRESS",
        aiSummary: aiReply.slice(0, 500),
        nextAction: shouldHangUp
          ? "Review voice call and follow up with the lead."
          : "Continue AI voice conversation or hand off if needed.",
        lastMessage: aiReply,
        lastMessageAt: new Date(),
      },
    });

    return sendXml(
      res,
      twimlResponse(`
        ${say(aiReply)}
        ${shouldHangUp ? "<Hangup/>" : buildListenOnlyGather(publicUrl)}
      `),
    );
  } catch (error) {
    console.error("Twilio speech error:", error);

    return sendXml(
      res,
      twimlResponse(`
        ${say("Sorry, something went wrong while processing your answer. Kadam's team will follow up. Goodbye.")}
        <Hangup/>
      `),
    );
  }
}

export async function handleTwilioRepeat(req: AuthRequest, res: Response) {
  const publicUrl = getPublicUrl(req);

  return sendXml(
    res,
    twimlResponse(`
      ${buildPromptThenListen(publicUrl, "I am still here. Tell me what you need built, or say goodbye to end the call.")}
    `),
  );
}

export async function handleTwilioFallback(_req: AuthRequest, res: Response) {
  return sendXml(
    res,
    twimlResponse(`
      ${say("Sorry, the main voice assistant is not responding right now. Please try again later.")}
      <Hangup/>
    `),
  );
}

export async function handleTwilioRecordingStatus(
  req: AuthRequest,
  res: Response,
) {
  try {
    const callSid = String(req.body.CallSid || "");
    const recordingSid = String(req.body.RecordingSid || "");
    const recordingStatus = String(req.body.RecordingStatus || "");
    const recordingUrl = String(req.body.RecordingUrl || "");
    const recordingDuration = Number(req.body.RecordingDuration || 0);
    const recordingChannels = Number(req.body.RecordingChannels || 0);
    const recordingSource = String(req.body.RecordingSource || "callback");

    voiceLog("recording_callback_received", {
      callSid,
      recordingSid,
      recordingStatus,
      hasRecordingUrl: Boolean(recordingUrl),
      recordingDuration,
      recordingChannels,
    });

    if (callSid) {
      const existingCall = await prisma.call.findFirst({
        where: {
          providerCallId: callSid,
        },
      });

      if (existingCall) {
        // Recording is an enhancement only — never overwrite transcript/summary/status/lead.
        await prisma.call.update({
          where: {
            id: existingCall.id,
          },
          data: {
            recordingSid: recordingSid || existingCall.recordingSid,
            recordingStatus: recordingStatus || existingCall.recordingStatus,
            recordingUrl: recordingUrl || existingCall.recordingUrl,
            recordingDurationSeconds: Number.isFinite(recordingDuration)
              ? recordingDuration
              : existingCall.recordingDurationSeconds,
            recordingChannels:
              Number.isFinite(recordingChannels) && recordingChannels > 0
                ? recordingChannels
                : existingCall.recordingChannels,
            recordingSource: recordingSource || existingCall.recordingSource,
            recordingAvailableAt:
              recordingStatus === "completed"
                ? new Date()
                : existingCall.recordingAvailableAt,
          },
        });

        voiceLog("recording_attached", {
          callId: existingCall.id,
          callSid,
          recordingSid: recordingSid || existingCall.recordingSid,
          recordingStatus,
        });
      }
    }

    return res.status(204).send();
  } catch (error) {
    console.error("Twilio recording status error:", error);
    return res.status(204).send();
  }
}

export async function handleTwilioRecordingMedia(
  req: AuthRequest,
  res: Response,
) {
  try {
    const callId = String(req.params.callId || "");
    const companyId = String((req.user as any)?.companyId || "");

    const call = await prisma.call.findUnique({
      where: {
        id: callId,
      },
      include: {
        conversation: true,
      },
    });

    if (!call || (companyId && call.conversation.companyId !== companyId)) {
      return res.status(404).json({
        message: "Recording not found.",
      });
    }

    if (!call.recordingUrl) {
      if (call.providerCallId) {
        await fetchTwilioRecordingForCall(call.providerCallId);

        const refreshedCall = await prisma.call.findUnique({
          where: {
            id: callId,
          },
        });

        if (!refreshedCall?.recordingUrl) {
          return res.status(404).json({
            message:
              "Recording is still processing. Try again in a few seconds.",
          });
        }

        call.recordingUrl = refreshedCall.recordingUrl;
      } else {
        return res.status(404).json({
          message: "Recording is still processing. Try again in a few seconds.",
        });
      }
    }

    const recordingUrl = call.recordingUrl.endsWith(".mp3")
      ? call.recordingUrl
      : `${call.recordingUrl}.mp3`;

    const response = await fetch(recordingUrl, {
      method: "GET",
      headers: {
        Authorization: buildTwilioAuthHeader(),
      },
    });

    if (!response.ok) {
      const text = await response.text();

      console.error("Twilio recording media fetch failed:", text);

      return res.status(502).json({
        message: "Could not load Twilio recording media yet.",
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, max-age=300");

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Twilio recording media error:", error);

    return res.status(500).json({
      message: "Recording media failed.",
    });
  }
}

export async function handleStartAiOutboundCall(
  req: AuthRequest,
  res: Response,
) {
  try {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      return res.status(400).json({
        message:
          "Twilio outbound calling is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER.",
      });
    }

    const publicUrl = getPublicUrl(req);
    const companyIdFromToken = String((req.user as any)?.companyId || "");
    const company = companyIdFromToken
      ? await prisma.company.findUnique({
          where: {
            id: companyIdFromToken,
          },
        })
      : await getVoiceCompany();

    if (!company) {
      return res.status(404).json({
        message: "No company found for outbound AI call.",
      });
    }

    const fullName = cleanVoiceText(
      String(req.body.fullName || req.body.name || req.body.clientName || ""),
    );
    const phone = normalizePhoneNumber(
      String(req.body.phone || req.body.toPhone || ""),
    );
    const purpose = cleanVoiceText(
      String(req.body.purpose || req.body.requirement || ""),
    );
    const notes = cleanVoiceText(String(req.body.notes || ""));
    const preferredTime = cleanVoiceText(String(req.body.preferredTime || ""));
    const preferredLanguage = normalizeVoiceLanguage(
      String(req.body.preferredLanguage || req.body.language || "AUTO"),
    );
    const preferredLanguageLabel = getVoiceLanguageLabel(preferredLanguage);

    if (!phone || !phone.startsWith("+")) {
      return res.status(400).json({
        message:
          "Phone number must include country code, example: +919586410399.",
      });
    }

    const customer = await createOrUpdateOutboundCustomer({
      companyId: company.id,
      name: fullName,
      phone,
      notes: [
        purpose,
        notes,
        preferredTime ? `Preferred time: ${preferredTime}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    const conversation = await prisma.conversation.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        channel: "AI_CALL",
        status: "IN_PROGRESS",
        priority: "HIGH",
        intent: purpose || "Outbound AI requirement call",
        aiSummary: `Outbound AI call requested from CRM. Preferred language: ${preferredLanguageLabel}.`,
        nextAction: `AI is calling the lead in ${preferredLanguageLabel} to collect requirements and schedule a meeting.`,
        lastMessage: `Outbound AI call requested for ${phone}`,
        lastMessageAt: new Date(),
        humanNeeded: false,
      },
    });

    const firstNote = [
      `Outbound AI call requested.`,
      fullName ? `Client name: ${fullName}` : "",
      `Phone: ${phone}`,
      purpose ? `Purpose: ${purpose}` : "",
      notes ? `Notes: ${notes}` : "",
      preferredTime ? `Preferred time: ${preferredTime}` : "",
      `Preferred language: ${preferredLanguageLabel}`,
    ]
      .filter(Boolean)
      .join("\n");

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderType: "AI",
        body: firstNote,
      },
    });

    const answerUrl = `${publicUrl}/api/voice/twilio/outbound-answer?conversationId=${encodeURIComponent(
      conversation.id,
    )}&preferredLanguage=${encodeURIComponent(preferredLanguage)}`;

    const body = new URLSearchParams({
      To: phone,
      From: TWILIO_PHONE_NUMBER,
      Url: answerUrl,
      Method: "POST",
      StatusCallback: `${publicUrl}/api/voice/twilio/status`,
      StatusCallbackMethod: "POST",
      Record: "true",
      RecordingChannels: "dual",
      RecordingStatusCallback: `${publicUrl}/api/voice/twilio/recording`,
      RecordingStatusCallbackMethod: "POST",
    });

    body.append("StatusCallbackEvent", "initiated");
    body.append("StatusCallbackEvent", "ringing");
    body.append("StatusCallbackEvent", "answered");
    body.append("StatusCallbackEvent", "completed");
    body.append("RecordingStatusCallbackEvent", "in-progress");
    body.append("RecordingStatusCallbackEvent", "completed");
    body.append("RecordingStatusCallbackEvent", "absent");

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
      {
        method: "POST",
        headers: {
          Authorization: buildTwilioAuthHeader(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    const json: any = await response.json();

    if (!response.ok) {
      console.error("Twilio outbound call failed:", json);

      await prisma.conversation.update({
        where: {
          id: conversation.id,
        },
        data: {
          status: "FOLLOW_UP",
          humanNeeded: true,
          nextAction:
            "Outbound AI call failed. Human should call this lead manually.",
          aiSummary:
            `Outbound AI call failed: ${json?.message || "Unknown Twilio error"}`.slice(
              0,
              500,
            ),
        },
      });

      return res.status(502).json({
        message: json?.message || "Twilio outbound call failed.",
        twilio: json,
      });
    }

    const callSid = String(json.sid || "");
    const initialTwilioStatus = String(json.status || "queued");
    const initialCallStatus = mapTwilioStatusToCallStatus(
      initialTwilioStatus,
      "OUTBOUND",
    );

    const call = await prisma.call.create({
      data: {
        conversationId: conversation.id,
        phone,
        provider: "twilio",
        providerCallId: callSid || null,
        direction: "OUTBOUND",
        status: initialCallStatus === "IN_PROGRESS" ? "RINGING" : initialCallStatus,
        durationSeconds: 0,
        startedAt: new Date(),
        metadata: {
          requestedBy:
            (req.user as any)?.userId || (req.user as any)?.id || null,
          purpose,
          preferredTime,
          preferredLanguage,
          preferredLanguageLabel,
          twilioInitialStatus: initialTwilioStatus,
          twilioStatus: initialTwilioStatus,
        },
      },
    });

    voiceLog("call_initiated", {
      callSid,
      conversationId: conversation.id,
      direction: "OUTBOUND",
      phone,
      status: call.status,
    });

    await prisma.conversation.update({
      where: {
        id: conversation.id,
      },
      data: {
        lastMessage: `AI outbound call started to ${phone}`,
        lastMessageAt: new Date(),
      },
    });

    return res.status(201).json({
      ok: true,
      callSid,
      call,
      customer,
      conversation,
      status: json.status,
      message: "AI outbound call started.",
    });
  } catch (error) {
    console.error("Start AI outbound call error:", error);

    return res.status(500).json({
      message: "Failed to start AI outbound call.",
    });
  }
}

export async function handleTwilioOutboundAnswer(
  req: AuthRequest,
  res: Response,
) {
  try {
    const publicUrl = getPublicUrl(req);
    const realtimeWebSocketUrl = getRealtimeWebSocketUrl(publicUrl);

    const callSid = String(req.body.CallSid || "");
    const fromPhone = String(req.body.From || TWILIO_PHONE_NUMBER || "");
    const toPhone = String(req.body.To || "");
    const conversationId = String(req.query.conversationId || "");
    const preferredLanguage = normalizeVoiceLanguage(
      String(req.query.preferredLanguage || "AUTO"),
    );

    // Return Media Stream TwiML immediately. Any Prisma work must be async —
    // awaiting DB here delayed Connect/Stream and produced ~15s of dead air /
    // distorted hold noise with no media_stream_connected logs.
    const twiml = twimlResponse(`
        <Connect>
          <Stream url="${xmlEscape(realtimeWebSocketUrl)}">
            <Parameter name="callSid" value="${xmlEscape(callSid)}"/>
            <Parameter name="fromPhone" value="${xmlEscape(toPhone)}"/>
            <Parameter name="toPhone" value="${xmlEscape(fromPhone)}"/>
            <Parameter name="direction" value="OUTBOUND"/>
            <Parameter name="publicUrl" value="${xmlEscape(publicUrl)}"/>
            <Parameter name="recordingManagedByCallApi" value="true"/>
            <Parameter name="preferredLanguage" value="${xmlEscape(preferredLanguage)}"/>
            <Parameter name="conversationId" value="${xmlEscape(conversationId)}"/>
          </Stream>
        </Connect>
        <Hangup/>
      `);

    sendXml(res, twiml);

    if (callSid && conversationId) {
      void (async () => {
        try {
          const existingOutboundCall = await prisma.call.findFirst({
            where: {
              conversationId,
            },
            orderBy: {
              createdAt: "desc",
            },
          });

          if (existingOutboundCall) {
            await prisma.call.update({
              where: {
                id: existingOutboundCall.id,
              },
              data: {
                providerCallId: callSid,
                status: shouldApplyCallStatus(
                  existingOutboundCall.status,
                  "IN_PROGRESS",
                )
                  ? "IN_PROGRESS"
                  : existingOutboundCall.status,
                startedAt: existingOutboundCall.startedAt || new Date(),
                metadata: {
                  ...((existingOutboundCall.metadata as Record<
                    string,
                    unknown
                  >) || {}),
                  twilioStatus: "in-progress",
                  answeredAt: new Date().toISOString(),
                },
              },
            });
          }

          voiceLog("call_answered", {
            callSid,
            conversationId,
            direction: "OUTBOUND",
            status: "IN_PROGRESS",
          });

          await prisma.conversation.updateMany({
            where: {
              id: conversationId,
            },
            data: {
              status: "IN_PROGRESS",
              lastMessage: "AI outbound call answered.",
              lastMessageAt: new Date(),
            },
          });
        } catch (error) {
          console.error("Async outbound answer CRM update failed:", error);
        }
      })();
    }

    return;
  } catch (error) {
    console.error("Twilio outbound answer error:", error);

    return sendXml(
      res,
      twimlResponse(`
        ${say("Sorry, the AI assistant is not available right now. Please try again later.")}
        <Hangup/>
      `),
    );
  }
}

export async function handleTwilioStatus(req: AuthRequest, res: Response) {
  try {
    const callSid = String(req.body.CallSid || "");
    const callStatus = String(req.body.CallStatus || "").toLowerCase();
    const durationSeconds = Number(req.body.CallDuration || 0);

    voiceLog("twilio_status_callback", {
      callSid,
      twilioStatus: callStatus,
      durationSeconds,
    });

    if (callSid) {
      const statusUpdateInput: {
        callSid: string;
        twilioStatus: string;
        durationSeconds?: number;
        source: string;
      } = {
        callSid,
        twilioStatus: callStatus,
        source: "twilio_status_callback",
      };

      if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
        statusUpdateInput.durationSeconds = durationSeconds;
      }

      const updated = await applyTwilioCallStatusUpdate(statusUpdateInput);

      const mapped = mapTwilioStatusToCallStatus(
        callStatus,
        updated?.direction || null,
      );

      if (
        TERMINAL_CALL_STATUSES.has(mapped) &&
        updated?.conversationId
      ) {
        // Ensure transcript/summary exist even if media stream finalize raced or missed.
        await finalizeCallConversation({
          callSid,
          conversationId: updated.conversationId,
          reason: `twilio_status_${callStatus}`,
          markCompleted: mapped === "COMPLETED",
          providerStatus: callStatus,
          terminalStatus: mapped,
          durationSeconds:
            Number.isFinite(durationSeconds) && durationSeconds > 0
              ? durationSeconds
              : undefined,
        });
      }

      if (mapped === "COMPLETED" && callSid) {
        setTimeout(() => {
          void fetchTwilioRecordingForCall(callSid);
        }, 5000);
      }
    }

    return res.status(204).send();
  } catch (error) {
    console.error("Twilio status error:", error);

    return res.status(204).send();
  }
}