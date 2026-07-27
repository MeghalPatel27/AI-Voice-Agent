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
};

type DecisionResult = {
  intent: string;
  aiSummary: string;
  priority: Priority;
  humanNeeded: boolean;
  taskTitle?: string;
  nextAction: string;
  aiConfidence: number;
  conversationStatus: ConversationStatus;
};

function cleanText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function normalize(text: string) {
  return cleanText(text).toLowerCase();
}

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function summaryFor(rawText: string, fallback: string) {
  if (!rawText) return fallback;

  if (rawText.length <= 220) {
    return rawText;
  }

  return `${rawText.slice(0, 217)}...`;
}

export function analyzeInboundMessage(input: DecisionInput): DecisionResult {
  const rawText = cleanText(input.text || "");
  const text = normalize(rawText);
  const industry = input.industry || "OTHER";

  const urgentMedicalWords = [
    "emergency",
    "urgent",
    "immediately",
    "asap",
    "right now",
    "chest pain",
    "breathing",
    "breathless",
    "bleeding",
    "accident",
    "unconscious",
    "critical",
    "serious pain",
    "heart attack",
    "stroke",
    "severe pain",
  ];

  const generalUrgentWords = [
    "urgent",
    "immediately",
    "asap",
    "right now",
    "emergency",
    "critical",
    "serious",
  ];

  const bookingWords = [
    "book",
    "booking",
    "appointment",
    "schedule",
    "slot",
    "available",
    "availability",
    "reserve",
    "reservation",
    "today",
    "tomorrow",
    "visit",
    "table",
    "room",
    "site visit",
    "meeting",
  ];

  const pricingWords = [
    "price",
    "pricing",
    "cost",
    "charge",
    "charges",
    "rate",
    "fees",
    "package",
    "quote",
    "quotation",
    "budget",
  ];

  const complaintWords = [
    "complaint",
    "angry",
    "bad service",
    "not happy",
    "refund",
    "cancel",
    "problem",
    "issue",
    "wrong",
    "delay",
    "disappointed",
    "terrible",
  ];

  const callbackWords = [
    "call me",
    "callback",
    "call back",
    "talk to human",
    "speak to someone",
    "contact me",
    "staff",
    "manager",
    "representative",
  ];

  const convertedWords = [
    "confirm",
    "confirmed",
    "done",
    "yes book",
    "yes confirm",
    "i will take it",
    "send payment",
    "payment link",
  ];

  const lostWords = [
    "not interested",
    "too expensive",
    "don't want",
    "dont want",
    "cancel everything",
    "stop messaging",
  ];

  if (
    (industry === "HOSPITAL" || industry === "CLINIC") &&
    includesAny(text, urgentMedicalWords)
  ) {
    return {
      intent: "urgent_medical_case",
      aiSummary: `Urgent medical case detected: ${summaryFor(rawText, "Urgent case")}`,
      priority: "CRITICAL",
      humanNeeded: true,
      taskTitle: "Urgent medical handover",
      nextAction: "Human staff must call or handle this patient immediately.",
      aiConfidence: 96,
      conversationStatus: "HUMAN_REQUIRED",
    };
  }

  if (includesAny(text, generalUrgentWords)) {
    return {
      intent: "urgent_case",
      aiSummary: `Urgent customer request detected: ${summaryFor(rawText, "Urgent request")}`,
      priority: "CRITICAL",
      humanNeeded: true,
      taskTitle: "Urgent human follow-up needed",
      nextAction: "Human staff should review this immediately.",
      aiConfidence: 92,
      conversationStatus: "HUMAN_REQUIRED",
    };
  }

  if (includesAny(text, complaintWords)) {
    return {
      intent: "customer_complaint",
      aiSummary: `Complaint or service issue detected: ${summaryFor(rawText, "Customer complaint")}`,
      priority: "HIGH",
      humanNeeded: true,
      taskTitle: "Handle customer complaint",
      nextAction: "Staff should review the issue and contact the customer.",
      aiConfidence: 88,
      conversationStatus: "HUMAN_REQUIRED",
    };
  }

  if (includesAny(text, callbackWords)) {
    return {
      intent: "callback_request",
      aiSummary: `Customer requested human contact: ${summaryFor(rawText, "Callback request")}`,
      priority: "HIGH",
      humanNeeded: true,
      taskTitle: "Call customer back",
      nextAction: "Staff should call the customer and resolve the request.",
      aiConfidence: 87,
      conversationStatus: "HUMAN_REQUIRED",
    };
  }

  if (includesAny(text, lostWords)) {
    return {
      intent: "lead_lost_or_not_interested",
      aiSummary: `Customer may not be interested: ${summaryFor(rawText, "Not interested")}`,
      priority: "LOW",
      humanNeeded: false,
      nextAction: "Mark the conversation as low priority unless staff wants to recover it.",
      aiConfidence: 82,
      conversationStatus: "LOST",
    };
  }

  if (includesAny(text, convertedWords)) {
    return {
      intent: "conversion_signal",
      aiSummary: `Customer showed conversion or confirmation intent: ${summaryFor(rawText, "Conversion signal")}`,
      priority: "HIGH",
      humanNeeded: false,
      nextAction: "Confirm details and move toward booking, payment or final confirmation.",
      aiConfidence: 83,
      conversationStatus: "IN_PROGRESS",
    };
  }

  if (includesAny(text, bookingWords)) {
    const bookingName =
      industry === "HOSPITAL" || industry === "CLINIC"
        ? "appointment"
        : industry === "HOTEL"
          ? "room or guest booking"
          : industry === "RESTAURANT"
            ? "table booking"
            : industry === "REAL_ESTATE"
              ? "site visit"
              : "booking";

    return {
      intent: "booking_request",
      aiSummary: `Customer wants to make or check a ${bookingName}: ${summaryFor(rawText, "Booking request")}`,
      priority: "MEDIUM",
      humanNeeded: false,
      nextAction: "Ask for preferred date, time, name and any required booking details.",
      aiConfidence: 84,
      conversationStatus: "IN_PROGRESS",
    };
  }

  if (includesAny(text, pricingWords)) {
    return {
      intent: "pricing_enquiry",
      aiSummary: `Customer asked about pricing or charges: ${summaryFor(rawText, "Pricing enquiry")}`,
      priority: "MEDIUM",
      humanNeeded: false,
      nextAction: "Ask qualifying details before giving or escalating pricing guidance.",
      aiConfidence: 80,
      conversationStatus: "IN_PROGRESS",
    };
  }

  if (input.channel === "AI_CALL") {
    return {
      intent: "general_call",
      aiSummary: `Customer call received: ${summaryFor(rawText, "Customer call")}`,
      priority: "MEDIUM",
      humanNeeded: false,
      nextAction: "Summarize the call and continue if more information is needed.",
      aiConfidence: 72,
      conversationStatus: "IN_PROGRESS",
    };
  }

  return {
    intent: "general_enquiry",
    aiSummary: `Customer enquiry received: ${summaryFor(rawText, "General enquiry")}`,
    priority: "LOW",
    humanNeeded: false,
    nextAction: "Acknowledge the customer and ask one useful follow-up question.",
    aiConfidence: 68,
    conversationStatus: "IN_PROGRESS",
  };
}