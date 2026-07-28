import { Response } from "express";
import { z } from "zod";
import { prisma } from "../db/prisma";
import { AuthRequest } from "../middleware/auth.middleware";
import {
  AI_CALL_OWNER,
  AI_CALL_TASK_KIND,
} from "../services/aiScheduledCall.service";

const taskQuerySchema = z.object({
  filter: z
    .enum([
      "ALL",
      "MY_TASKS",
      "UNASSIGNED",
      "DUE_TODAY",
      "OVERDUE",
      "CRITICAL",
      "BLOCKED",
      "OPEN",
      "DOING",
      "COMPLETED",
    ])
    .default("ALL"),
  priority: z.enum(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("ALL"),
  assignee: z.string().default("ALL"),
  taskType: z
    .enum([
      "ALL",
      "EMERGENCY",
      "CALLBACK",
      "APPOINTMENT",
      "PAYMENT",
      "FOLLOW_UP",
      "AI_HANDOFF",
      "AI_CALL",
      "ADMIN",
      "GENERAL",
    ])
    .default("ALL"),
  search: z.string().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  status: z.enum(["OPEN", "DOING", "BLOCKED", "DONE"]).default("OPEN"),
  dueAt: z.string().datetime().nullable().optional(),
  customerId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  aiNotes: z.string().nullable().optional(),
  blockedReason: z.string().nullable().optional(),
});

const scheduleAiCallTaskSchema = z.object({
  fullName: z.string().optional().nullable(),
  phone: z.string().min(3),
  scheduledAt: z.string().datetime(),
  purpose: z.string().min(1),
  notes: z.string().optional().nullable(),
  preferredLanguage: z
    .enum(["AUTO", "ENGLISH", "HINDI", "GUJARATI"])
    .default("AUTO"),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("HIGH"),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).optional(),
  status: z.enum(["OPEN", "DOING", "BLOCKED", "DONE"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedUserId: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  aiNotes: z.string().nullable().optional(),
  blockedReason: z.string().nullable().optional(),
});

const taskActionSchema = z.object({
  action: z.enum([
    "START",
    "BLOCK",
    "DONE",
    "ESCALATE",
    "REOPEN",
    "CREATE_FOLLOW_UP",
  ]),
  blockedReason: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

function getCurrentUserId(req: AuthRequest) {
  return String((req.user as any)?.userId || (req.user as any)?.id || "");
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function isSameDay(date: Date, target: Date) {
  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

function cleanText(value?: string | null, fallback = "Customer work") {
  if (!value) return fallback;

  const lower = value.toLowerCase();

  if (
    lower.includes("test customer") ||
    lower.includes("llm test") ||
    lower.includes("real whatsapp customer") ||
    lower.includes("call test customer") ||
    lower.includes("live/testing")
  ) {
    return fallback;
  }

  return value;
}

function normalizePhoneNumber(value: string) {
  return String(value || "")
    .replace(/[\s()\-]/g, "")
    .trim();
}



function formatDateTimeLabel(value?: string | Date | null) {
  if (!value) return "Not set";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cleanRequirementLine(value?: string | null) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableText(value?: string | null) {
  return cleanRequirementLine(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueRequirementLines(values: Array<string | null | undefined>) {
  const seen = new Set<string>();

  return values
    .map((value) => cleanRequirementLine(value))
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeComparableText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isLikelyAgentPrompt(value?: string | null) {
  const candidate = cleanRequirementLine(value);
  if (!candidate) return false;

  const normalized = candidate.toLowerCase();

  if (
    /^(?:act|behave|respond|speak)\s+as\b/i.test(candidate) ||
    /^(?:you are|you'?re|your role is|your task is|your goal is|system prompt|instructions?\s*:)\b/i.test(
      candidate,
    ) ||
    /<\s*\/?\s*(?:opening_behavior|instructions?|rules?|system|persona)\b/i.test(
      candidate,
    ) ||
    /\bthe system begins the call\b/i.test(candidate) ||
    /\bwait for the caller to respond\b/i.test(candidate)
  ) {
    return true;
  }

  const roleSignals = [
    /\bconsultative\s+sales\s+representative\b/i,
    /\b(?:ai|voice|calling|sales)\s+(?:agent|assistant|representative)\b/i,
    /\b(?:salesperson|call-centre agent|call center agent)\b/i,
  ];

  const instructionSignals = [
    /\b(?:always|never|must|should|do not|don't)\b/i,
    /\b(?:ask the caller|ask the lead|wait for|speak only|sound natural)\b/i,
    /\b(?:call objective|conversation objective|qualification flow|sales script)\b/i,
    /\b(?:opening behavior|opening behaviour|company context|service context)\b/i,
    /\b(?:collect .*requirements?|ask .*budget|schedule .*meeting)\b/i,
  ];

  const roleCount = roleSignals.filter((pattern) => pattern.test(candidate)).length;
  const instructionCount = instructionSignals.filter((pattern) =>
    pattern.test(candidate),
  ).length;
  const commandWords =
    normalized.match(
      /\b(?:always|never|must|should|do not|don't|ask|wait|speak|sell|qualify|collect|schedule)\b/g,
    )?.length || 0;

  return (
    candidate.length > 1200 ||
    roleCount >= 2 ||
    (roleCount >= 1 && (instructionCount >= 1 || commandWords >= 2)) ||
    (candidate.length > 300 && instructionCount >= 2 && commandWords >= 3)
  );
}

function isConfiguredPromptLeak(value: string, promptTexts: string[]) {
  const candidate = normalizeComparableText(value);
  if (!candidate) return false;

  return promptTexts.some((promptText) => {
    const prompt = normalizeComparableText(promptText);
    if (!prompt) return false;

    if (candidate === prompt) return true;
    if (candidate.length >= 60 && prompt.includes(candidate)) return true;
    if (prompt.length >= 60 && candidate.includes(prompt)) return true;

    const candidateWords = new Set(candidate.split(" ").filter(Boolean));
    const promptWords = prompt.split(" ").filter(Boolean);
    if (candidateWords.size < 10 || promptWords.length < 10) return false;

    const overlap = promptWords.filter((word) => candidateWords.has(word)).length;
    return overlap / Math.min(candidateWords.size, promptWords.length) >= 0.8;
  });
}

type ConversationTurn = {
  speaker: "CUSTOMER" | "AI" | "HUMAN";
  text: string;
  createdAt?: string | Date | null;
};

function parseTranscriptJson(value: string): ConversationTurn[] {
  const trimmed = value.trim();

  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    const turns: ConversationTurn[] = [];

    const visit = (item: unknown) => {
      if (!item) return;

      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }

      if (typeof item !== "object") return;

      const record = item as Record<string, unknown>;
      const role = String(
        record.senderType ||
          record.speaker ||
          record.role ||
          record.author ||
          record.type ||
          "",
      ).toUpperCase();
      const text = cleanRequirementLine(
        typeof record.body === "string"
          ? record.body
          : typeof record.text === "string"
            ? record.text
            : typeof record.content === "string"
              ? record.content
              : typeof record.transcript === "string"
                ? record.transcript
                : "",
      );

      const speaker =
        /CUSTOMER|CALLER|LEAD|PROSPECT|USER/.test(role)
          ? "CUSTOMER"
          : /AI|ASSISTANT|AGENT|BOT/.test(role)
            ? "AI"
            : /HUMAN|STAFF|EMPLOYEE/.test(role)
              ? "HUMAN"
              : null;

      if (speaker && text) {
        turns.push({
          speaker,
          text,
          createdAt:
            typeof record.createdAt === "string" ? record.createdAt : null,
        });
      }

      for (const [key, child] of Object.entries(record)) {
        if (
          [
            "senderType",
            "speaker",
            "role",
            "author",
            "type",
            "body",
            "text",
            "content",
            "transcript",
            "createdAt",
          ].includes(key)
        ) {
          continue;
        }

        visit(child);
      }
    };

    visit(parsed);
    return turns;
  } catch {
    return [];
  }
}

function extractSpeakerTurnsFromTranscript(value?: string | null) {
  const transcript = String(value || "").trim();
  if (!transcript) return [];

  const jsonTurns = parseTranscriptJson(transcript);
  if (jsonTurns.length > 0) return jsonTurns;

  const turns: ConversationTurn[] = [];
  const pattern =
    /(?:^|\n|\]\s*)(CUSTOMER|CALLER|LEAD|PROSPECT|USER|AI|ASSISTANT|AGENT|BOT|HUMAN|STAFF)\s*[:\-]\s*([\s\S]*?)(?=(?:\n|\]\s*)(?:CUSTOMER|CALLER|LEAD|PROSPECT|USER|AI|ASSISTANT|AGENT|BOT|HUMAN|STAFF)\s*[:\-]|$)/gi;

  for (const match of transcript.matchAll(pattern)) {
    const role = String(match[1] || "").toUpperCase();
    const text = cleanRequirementLine(match[2]);
    if (!text) continue;

    turns.push({
      speaker: /CUSTOMER|CALLER|LEAD|PROSPECT|USER/.test(role)
        ? "CUSTOMER"
        : /AI|ASSISTANT|AGENT|BOT/.test(role)
          ? "AI"
          : "HUMAN",
      text,
    });
  }

  if (turns.length > 0) return turns;

  for (const line of transcript.split(/\r?\n+/)) {
    const match = line.match(
      /^(?:\[[^\]]+\]\s*)?(CUSTOMER|CALLER|LEAD|PROSPECT|USER|AI|ASSISTANT|AGENT|BOT|HUMAN|STAFF)\s*[:\-]\s*(.+)$/i,
    );

    if (!match) continue;

    const role = String(match[1] || "").toUpperCase();
    const text = cleanRequirementLine(match[2]);
    if (!text) continue;

    turns.push({
      speaker: /CUSTOMER|CALLER|LEAD|PROSPECT|USER/.test(role)
        ? "CUSTOMER"
        : /AI|ASSISTANT|AGENT|BOT/.test(role)
          ? "AI"
          : "HUMAN",
      text,
    });
  }

  return turns;
}

function extractCustomerTurnsFromTranscript(value?: string | null) {
  return uniqueRequirementLines(
    extractSpeakerTurnsFromTranscript(value)
      .filter((turn) => turn.speaker === "CUSTOMER")
      .map((turn) => turn.text),
  );
}

function isCustomerRequirementStatement(value?: string | null) {
  const line = cleanRequirementLine(value);

  if (!line || line.length < 8 || isLikelyAgentPrompt(line)) return false;

  if (
    /^(?:hello|hi|hey|yes|yeah|okay|ok|no|thanks|thank you|bye|goodbye|sure|fine)[.! ]*$/i.test(
      line,
    )
  ) {
    return false;
  }

  return /\b(?:need|needs|want|wants|looking for|require|requires|requirement|problem|issue|build|create|develop|design|redesign|website|web site|landing page|app|application|automation|agent|software|crm|booking|restaurant|clinic|real estate|ecommerce|e-commerce|integration|dashboard|payment|inventory|support|lead generation|follow[- ]?up|appointment|customer service|sales|portfolio|online store|mobile app)\b/i.test(
    line,
  );
}

function parseRequirementDetails(value: unknown): Record<string, unknown> {
  if (!value) return {};

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  return typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function collectPostCallRequirementCandidates(task: any) {
  const analyses = getRelevantCalls(task)
    .map((call: any) => call.postAnalysis)
    .filter(Boolean)
    .sort((first: any, second: any) => {
      const firstTime = new Date(
        first.completedAt || first.updatedAt || first.createdAt || 0,
      ).getTime();
      const secondTime = new Date(
        second.completedAt || second.updatedAt || second.createdAt || 0,
      ).getTime();
      return secondTime - firstTime;
    });

  const completedAnalysis =
    analyses.find((analysis: any) =>
      ["COMPLETED", "SUCCEEDED"].includes(
        String(analysis.status || "").toUpperCase(),
      ),
    ) || analyses[0];

  if (!completedAnalysis) return [];

  const details = parseRequirementDetails(completedAnalysis.requirementDetails);

  const values: unknown[] = [
    details.primaryNeed,
    details.customerNeed,
    details.requirement,
    details.requirements,
    details.businessProblem,
    details.customerRequest,
    details.requestedCapabilities,
    details.desiredCapabilities,
    details.capabilities,
    details.features,
    details.integrationNeeds,
    details.scope,
    details.useCase,
    completedAnalysis.requirementSummary,
  ];

  const flattened: string[] = [];

  const visit = (value: unknown) => {
    if (typeof value === "string") {
      flattened.push(value);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
    }
  };

  values.forEach(visit);
  return flattened;
}

function collectPostCallMeetingCandidates(task: any) {
  const analyses = getRelevantCalls(task)
    .map((call: any) => call.postAnalysis)
    .filter(Boolean)
    .sort((first: any, second: any) => {
      const firstTime = new Date(
        first.completedAt || first.updatedAt || first.createdAt || 0,
      ).getTime();
      const secondTime = new Date(
        second.completedAt || second.updatedAt || second.createdAt || 0,
      ).getTime();
      return secondTime - firstTime;
    });

  const candidates: string[] = [];

  for (const analysis of analyses.slice(0, 2)) {
    const details = parseRequirementDetails(analysis.requirementDetails);
    const values = [
      details.requestedNextStep,
      details.meetingTime,
      details.preferredMeetingTime,
      details.appointmentTime,
      details.scheduledTime,
      details.timelineSignal,
    ];

    for (const value of values) {
      if (typeof value === "string" && value.trim()) {
        candidates.push(value.trim());
      }
    }
  }

  return uniqueRequirementLines(candidates);
}

function hasExplicitClockTime(value: string) {
  return (
    /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)\b/i.test(value) ||
    /\b(?:at|around)\s+\d{1,2}(?::\d{2})?\b/i.test(value)
  );
}

function hasFutureDayOrDate(value: string) {
  return /\b(?:today|tomorrow|day after tomorrow|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}|kal|aaj|પરમદિવસ|કાલે|આજે|परसों|कल|आज)\b/i.test(
    value,
  );
}

function hasMeetingLanguage(value: string) {
  return /\b(?:meeting|meet|schedule|book|appointment|demo|call back|callback|available|availability|free|slot|time works|consultation)\b/i.test(
    value,
  );
}

function extractMeetingEvidenceFromTask(task: any) {
  const messageTurns: ConversationTurn[] = [
    ...(task.conversation?.messages || []),
  ]
    .sort(
      (first: any, second: any) =>
        new Date(first.createdAt || 0).getTime() -
        new Date(second.createdAt || 0).getTime(),
    )
    .map(
      (message: any): ConversationTurn => ({
        speaker:
          message.senderType === "CUSTOMER"
            ? "CUSTOMER"
            : message.senderType === "AI"
              ? "AI"
              : "HUMAN",
        text: cleanRequirementLine(message.body),
        createdAt: message.createdAt,
      }),
    )
    .filter((turn) => Boolean(turn.text));

  const transcriptTurns = getRelevantCalls(task).flatMap((call: any) =>
    extractSpeakerTurnsFromTranscript(call.transcript),
  );

  for (const turns of [messageTurns, transcriptTurns]) {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      if (turn.speaker !== "CUSTOMER") continue;

      const text = cleanRequirementLine(turn.text);
      if (!text) continue;

      const previousTurn = turns[index - 1];
      const previousAskedForMeeting =
        previousTurn?.speaker === "AI" && hasMeetingLanguage(previousTurn.text);

      const explicitClock = hasExplicitClockTime(text);
      const futureDay = hasFutureDayOrDate(text);

      if (
        (hasMeetingLanguage(text) && (explicitClock || futureDay)) ||
        (previousAskedForMeeting && (explicitClock || futureDay)) ||
        (futureDay && explicitClock)
      ) {
        return text.slice(0, 220);
      }
    }
  }

  const scheduled = parseAiScheduledCallNotes(task.aiNotes);
  const storedMeetingText = cleanRequirementLine(
    scheduled?.leadRequirements?.meetingTime,
  );

  if (
    scheduled?.meetingBookingId &&
    storedMeetingText &&
    (hasExplicitClockTime(storedMeetingText) ||
      hasFutureDayOrDate(storedMeetingText))
  ) {
    return storedMeetingText.slice(0, 220);
  }

  const analysisCandidate = collectPostCallMeetingCandidates(task).find(
    (candidate) =>
      hasMeetingLanguage(candidate) &&
      (hasExplicitClockTime(candidate) || hasFutureDayOrDate(candidate)),
  );

  return analysisCandidate?.slice(0, 220) || null;
}

function resolveMeetingDateTime(
  text: string | null | undefined,
  baseDate: Date = new Date(),
): Date | null {
  const raw = cleanRequirementLine(text || "");
  if (!raw) return null;

  const lower = raw.toLowerCase().replace(/\./g, "");
  const reference = new Date(baseDate);
  const result = new Date(baseDate);

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
    } else if (hours >= 1 && hours <= 6) {
      hours += 12;
    }
  } else if (/morning|subah|સવારે|सुबह/.test(lower)) {
    hours = 10;
  } else if (/afternoon|dopahar|બપોરે|दोपहर/.test(lower)) {
    hours = 14;
  } else if (/evening|shaam|સાંજે|शाम|night/.test(lower)) {
    hours = 17;
  } else {
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

  const numericDate = lower.match(
    /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/,
  );
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const namedMonthMatch = lower.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/,
  );

  if (/day after tomorrow|પરમદિવસ|परसों/.test(lower)) {
    result.setDate(result.getDate() + 2);
  } else if (/tomorrow|kal|કાલે|कल/.test(lower)) {
    result.setDate(result.getDate() + 1);
  } else if (/today|aaj|આજે|आज/.test(lower)) {
    // Keep the call date.
  } else if (numericDate) {
    const day = Number(numericDate[1]);
    const month = Number(numericDate[2]) - 1;
    let year = numericDate[3]
      ? Number(numericDate[3])
      : reference.getFullYear();
    if (year < 100) year += 2000;
    result.setFullYear(year, month, day);
  } else if (namedMonthMatch) {
    const month = monthNames.indexOf(namedMonthMatch[1]);
    const day = Number(namedMonthMatch[2]);
    const year = namedMonthMatch[3]
      ? Number(namedMonthMatch[3])
      : reference.getFullYear();
    result.setFullYear(year, month, day);
  } else if (weekdayIdx >= 0) {
    const current = result.getDay();
    let delta = (weekdayIdx - current + 7) % 7;
    if (delta === 0) delta = 7;
    result.setDate(result.getDate() + delta);
  }

  result.setHours(hours, minutes, 0, 0);

  if (
    !numericDate &&
    !namedMonthMatch &&
    !/today|tomorrow|day after tomorrow|aaj|kal|આજે|કાલે|પરમદિવસ|आज|कल|परसों/.test(
      lower,
    ) &&
    weekdayIdx < 0 &&
    result.getTime() <= reference.getTime() + 30 * 60 * 1000
  ) {
    result.setDate(result.getDate() + 1);
  }

  if (Number.isNaN(result.getTime())) return null;
  return result;
}

function parseAiScheduledCallNotes(value?: string | null) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);

    if (parsed?.kind !== AI_CALL_TASK_KIND) return null;

    return parsed as {
      kind: string;
      status?: string;
      phone?: string;
      fullName?: string;
      purpose?: string;
      notes?: string;
      preferredLanguage?: "AUTO" | "ENGLISH" | "HINDI" | "GUJARATI";
      scheduledAt?: string;
      conversationId?: string;
      callSid?: string;
      startedAt?: string;
      completedAt?: string;
      meetingBookingId?: string;
      error?: string;
      leadRequirements?: {
        summary?: string | null;
        meetingTime?: string | null;
        capturedAt?: string | null;
      } | null;
    };
  } catch {
    return null;
  }
}


function getRelevantCalls(task: any) {
  const calls = [...(task.conversation?.calls || [])].sort(
    (first: any, second: any) =>
      new Date(
        second.endedAt || second.startedAt || second.createdAt || 0,
      ).getTime() -
      new Date(
        first.endedAt || first.startedAt || first.createdAt || 0,
      ).getTime(),
  );

  const scheduled = parseAiScheduledCallNotes(task.aiNotes);
  const callReference = scheduled?.callSid;

  if (callReference) {
    const matchedCall = calls.find(
      (call: any) =>
        call.id === callReference ||
        call.providerCallId === callReference ||
        call.callSid === callReference,
    );

    if (matchedCall) return [matchedCall];
  }

  return calls.slice(0, 1);
}

function getAiScheduledCallDisplay(task: any) {
  const data = parseAiScheduledCallNotes(task.aiNotes);
  if (!data) return null;

  const scheduleLabel = data.scheduledAt
    ? formatDateTimeLabel(data.scheduledAt)
    : "Not scheduled";

  const parts = [
    "AI requirement call",
    `Call time: ${scheduleLabel}`,
    data.status
      ? `Status: ${String(data.status).replace(/_/g, " ").toLowerCase()}`
      : "",
    data.preferredLanguage
      ? `Language: ${String(data.preferredLanguage).replace(/_/g, " ").toLowerCase()}`
      : "",
    data.error ? `Error: ${data.error}` : "",
  ];

  return parts.filter(Boolean).join("\n");
}

function buildLeadRequirementsFromTask(task: any) {
  const scheduled = parseAiScheduledCallNotes(task.aiNotes);
  const promptTexts = uniqueRequirementLines([
    scheduled?.purpose,
    scheduled?.notes,
    task.description,
  ]).filter((value) => value.length >= 20);

  const customerMessageLines = uniqueRequirementLines(
    (task.conversation?.messages || [])
      .filter((message: any) => message.senderType === "CUSTOMER")
      .map((message: any) => message.body),
  );

  const customerTranscriptLines = uniqueRequirementLines(
    getRelevantCalls(task).flatMap((call: any) =>
      extractCustomerTurnsFromTranscript(call.transcript),
    ),
  );

  const sanitizeRequirement = (value?: string | null) => {
    const candidate = cleanRequirementLine(value);
    if (!candidate) return "";
    if (isLikelyAgentPrompt(candidate)) return "";
    if (isConfiguredPromptLeak(candidate, promptTexts)) return "";

    if (
      /^(?:customer completed (?:an )?ai (?:voice )?call|incoming call started|outbound ai call requested|call this (?:lead|customer)|ai scheduled call)/i.test(
        candidate,
      )
    ) {
      return "";
    }

    if (
      /^(?:phone|status|language|scheduled|started|completed|call sid|twilio call|provider|task id)\s*[:\-]/i.test(
        candidate,
      )
    ) {
      return "";
    }

    return candidate;
  };

  const structuredRequirements = collectPostCallRequirementCandidates(task)
    .map((value) => sanitizeRequirement(value))
    .filter(Boolean);

  const spokenRequirements = uniqueRequirementLines([
    ...customerMessageLines,
    ...customerTranscriptLines,
  ])
    .filter((value) => isCustomerRequirementStatement(value))
    .map((value) => sanitizeRequirement(value))
    .filter(Boolean);

  const storedAnalysisRequirement = sanitizeRequirement(
    scheduled?.leadRequirements?.summary,
  );

  const requirementCandidates = uniqueRequirementLines([
    ...structuredRequirements,
    ...(storedAnalysisRequirement ? [storedAnalysisRequirement] : []),
    ...spokenRequirements,
  ]).filter((item, index, items) => {
    const normalized = normalizeComparableText(item);

    return !items.some((other, otherIndex) => {
      if (index === otherIndex) return false;
      const otherNormalized = normalizeComparableText(other);

      return (
        otherNormalized.length > normalized.length &&
        otherNormalized.includes(normalized)
      );
    });
  });

  const summary = requirementCandidates.slice(0, 4).join(" · ");
  const spokenMeetingText = extractMeetingEvidenceFromTask(task);

  const latestCall = getRelevantCalls(task)[0];

  const callBaseDate = new Date(
    latestCall?.endedAt ||
      latestCall?.startedAt ||
      latestCall?.createdAt ||
      task.updatedAt ||
      new Date(),
  );

  const spokenResolved = spokenMeetingText
    ? resolveMeetingDateTime(spokenMeetingText, callBaseDate)
    : null;

  const matchingBooking = spokenResolved
    ? (task.conversation?.bookings || []).find((booking: any) => {
        if (!booking.dateTime) return false;

        const bookingTime = new Date(booking.dateTime).getTime();
        return (
          !Number.isNaN(bookingTime) &&
          Math.abs(bookingTime - spokenResolved.getTime()) <= 10 * 60 * 1000
        );
      })
    : null;

  return {
    summary,
    raw: requirementCandidates,
    meetingTime: spokenResolved
      ? formatDateTimeLabel(spokenResolved)
      : spokenMeetingText,
    meetingScheduledAt: spokenResolved
      ? spokenResolved.toISOString()
      : null,
    meetingStatus: matchingBooking?.status || null,
    bookingTitle: matchingBooking?.title || null,
    captured: requirementCandidates.length > 0,
    source:
      structuredRequirements.length > 0
        ? "Post-call analysis"
        : spokenRequirements.length > 0
          ? "Customer conversation"
          : "AI call",
  };
}

function getScheduledCallInfo(
  task: any,
  leadRequirements?: ReturnType<typeof buildLeadRequirementsFromTask>,
) {
  const data = parseAiScheduledCallNotes(task.aiNotes);
  if (!data) return null;

  const scheduledAt = data.scheduledAt || task.dueAt || null;

  return {
    status: data.status || task.status || "SCHEDULED",
    scheduledAt,
    scheduledLabel: formatDateTimeLabel(scheduledAt),
    phone: data.phone || getCustomerPhone(task) || null,
    fullName: data.fullName || getCustomerName(task),
    purpose: null,
    notes: null,
    preferredLanguage: data.preferredLanguage || "AUTO",
    startedAt: data.startedAt || null,
    completedAt: data.completedAt || task.completedAt || null,
    callSid: data.callSid || null,
    error: data.error || null,
    meetingTime: leadRequirements?.meetingTime || null,
  };
}

function isCompletedCallStatus(value?: string | null) {
  return [
    "COMPLETED",
    "COMPLETE",
    "ENDED",
    "FINISHED",
    "HANGUP",
    "DONE",
    "SUCCEEDED",
  ].includes(String(value || "").toUpperCase());
}

function isFailedCallStatus(value?: string | null) {
  return [
    "FAILED",
    "MISSED",
    "NO_ANSWER",
    "BUSY",
    "CANCELLED",
    "CANCELED",
  ].includes(String(value || "").toUpperCase());
}

function buildWorkToDo(
  task: any,
  taskType: string,
  leadRequirements: ReturnType<typeof buildLeadRequirementsFromTask>,
  scheduledCall: ReturnType<typeof getScheduledCallInfo>,
) {
  const customerName = getCustomerName(task);
  const latestCall = task.conversation?.calls?.[0] || null;
  const callStatus = scheduledCall?.status || latestCall?.status || null;

  const isAiCallRelated =
    taskType === "AI_CALL" || task.conversation?.channel === "AI_CALL";

  if (isAiCallRelated) {
    if (isFailedCallStatus(callStatus)) {
      return `Contact ${customerName} manually or reschedule the AI call. The previous call did not complete successfully.`;
    }

    if (
      !isCompletedCallStatus(callStatus) &&
      !isCompletedCallStatus(latestCall?.status)
    ) {
      return `The AI will call ${customerName} at ${
        scheduledCall?.scheduledLabel || getDueLabel(task, taskType)
      }. No employee action is required until the call finishes.`;
    }

    if (leadRequirements.meetingTime && leadRequirements.summary) {
      return `Prepare for the meeting with ${customerName} on ${leadRequirements.meetingTime}. Review the captured requirement: ${leadRequirements.summary}. Confirm the final scope, expected deliverables, budget and timeline during the meeting, then update this task with the agreed next step.`;
    }

    if (leadRequirements.meetingTime) {
      return `Prepare for the meeting with ${customerName} on ${leadRequirements.meetingTime}. The call did not capture a clear requirement, so confirm exactly what the customer needs during the meeting and record the agreed scope and next step.`;
    }

    if (leadRequirements.summary) {
      return `Follow up with ${customerName} about this requirement: ${leadRequirements.summary}. Confirm the scope, timeline, budget and the next step, then update this task.`;
    }

    return `Review the completed call with ${customerName}. No clear customer requirement or meeting time was captured, so contact the customer and confirm what they need before proceeding.`;
  }

  const description = cleanRequirementLine(task.description);

  if (description && !isLikelyAgentPrompt(description)) {
    return description;
  }

  return cleanRequirementLine(getNextAction(task, taskType)) ||
    cleanText(task.title, "Review and complete this task.");
}

function getDisplayTaskTitle(
  task: any,
  taskType: string,
  leadRequirements: ReturnType<typeof buildLeadRequirementsFromTask>,
  scheduledCall: ReturnType<typeof getScheduledCallInfo>,
) {
  const isAiCallRelated =
    taskType === "AI_CALL" || task.conversation?.channel === "AI_CALL";

  if (!isAiCallRelated) {
    return cleanText(task.title, "Customer task");
  }

  const latestCall = task.conversation?.calls?.[0] || null;
  const callStatus = scheduledCall?.status || latestCall?.status || null;

  if (isFailedCallStatus(callStatus)) {
    return "Retry customer call";
  }

  if (
    !isCompletedCallStatus(callStatus) &&
    !isCompletedCallStatus(latestCall?.status)
  ) {
    return "AI call scheduled";
  }

  if (leadRequirements.meetingTime) {
    return "Prepare for customer meeting";
  }

  if (leadRequirements.summary) {
    return "Follow up on customer requirement";
  }

  return "Review completed AI call";
}


function buildRecordingMediaUrl(call: any) {
  if (!call?.id) return null;
  if (!call.recordingUrl && !call.recordingSid) return null;
  return `/api/calls/${call.id}/recording/media`;
}

function isSetupTask(task: any) {
  const text = `${task.title || ""} ${task.description || ""} ${
    task.aiNotes || ""
  }`.toLowerCase();

  return (
    text.includes("connect ai call agent") ||
    text.includes("live/testing call agent") ||
    text.includes("no live/testing call agent") ||
    text.includes("call agent is configured")
  );
}

function isOverdue(task: any) {
  if (!task.dueAt || task.status === "DONE") return false;
  return new Date(task.dueAt).getTime() < Date.now();
}

function isDueToday(task: any) {
  if (!task.dueAt || task.status === "DONE") return false;
  return isSameDay(new Date(task.dueAt), new Date());
}

function getTaskType(task: any) {
  const text = `${task.title || ""} ${task.description || ""} ${
    task.aiNotes || ""
  }`.toLowerCase();

  if (
    text.includes(AI_CALL_TASK_KIND.toLowerCase()) ||
    text.includes("ai scheduled call") ||
    task.owner === AI_CALL_OWNER
  ) {
    return "AI_CALL";
  }

  if (
    text.includes("chest pain") ||
    text.includes("breathing") ||
    text.includes("severe pain") ||
    text.includes("emergency") ||
    text.includes("urgent medical") ||
    text.includes("urgent doctor")
  ) {
    return "EMERGENCY";
  }

  if (
    text.includes("callback") ||
    text.includes("call back") ||
    text.includes("missed call")
  ) {
    return "CALLBACK";
  }

  if (
    text.includes("appointment") ||
    text.includes("booking") ||
    text.includes("meeting") ||
    text.includes("confirm meeting") ||
    text.includes("meeting request") ||
    text.includes("confirm")
  ) {
    return "APPOINTMENT";
  }

  if (text.includes("payment") || text.includes("invoice")) {
    return "PAYMENT";
  }

  if (text.includes("follow up") || text.includes("follow-up")) {
    return "FOLLOW_UP";
  }

  if (text.includes("handoff") || text.includes("human required")) {
    return "AI_HANDOFF";
  }

  if (text.includes("admin")) {
    return "ADMIN";
  }

  return "GENERAL";
}

function getTaskTypeLabel(type: string) {
  const labels: Record<string, string> = {
    EMERGENCY: "Emergency",
    CALLBACK: "Callback",
    APPOINTMENT: "Appointment",
    PAYMENT: "Payment",
    FOLLOW_UP: "Follow-up",
    AI_HANDOFF: "AI Handoff",
    AI_CALL: "AI Scheduled Call",
    ADMIN: "Admin",
    GENERAL: "General",
  };

  return labels[type] || "General";
}

function getCustomerName(task: any) {
  return cleanText(
    task.customer?.fullName ||
      task.conversation?.customer?.fullName ||
      task.customer?.phone ||
      task.conversation?.customer?.phone,
    "Customer Inquiry",
  );
}

function getCustomerPhone(task: any) {
  return task.customer?.phone || task.conversation?.customer?.phone || null;
}

function getSource(task: any) {
  if (task.conversation?.channel === "WHATSAPP") return "WhatsApp";
  if (task.conversation?.channel === "AI_CALL") return "Call";
  if (task.conversation?.channel === "WEBSITE_CHAT") return "Website";
  return "Manual";
}

function getDelayLabel(task: any) {
  if (!isOverdue(task)) return "No delay";

  const diff = Date.now() - new Date(task.dueAt).getTime();
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);

  if (days > 0) return `Overdue by ${days} day${days === 1 ? "" : "s"}`;
  if (hours > 0) return `Overdue by ${hours} hour${hours === 1 ? "" : "s"}`;

  const minutes = Math.floor(diff / 60000);
  return `Overdue by ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function getDueLabel(task: any, taskType: string) {
  if (!task.dueAt) {
    if (taskType === "EMERGENCY") return "Due now";
    if (task.priority === "CRITICAL" || task.priority === "HIGH") {
      return "Deadline missing";
    }

    return "No deadline";
  }

  if (isOverdue(task)) return getDelayLabel(task);
  if (isDueToday(task)) return "Due today";

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameDay(new Date(task.dueAt), tomorrow)) {
    return "Due tomorrow";
  }

  return new Date(task.dueAt).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSlaLabel(task: any, taskType: string) {
  if (taskType === "EMERGENCY") return "Emergency SLA: 5 minutes";
  if (taskType === "CALLBACK") return "Callback SLA: 1 hour";
  if (taskType === "APPOINTMENT") return "Appointment SLA: same day";
  if (taskType === "AI_CALL") return "AI call SLA: call at scheduled time";
  if (task.priority === "CRITICAL") return "Critical SLA: today";
  if (task.priority === "HIGH") return "High priority SLA: 24 hours";
  return "Standard SLA";
}

function getOwner(task: any) {
  if (task.assignedUser?.name) {
    return {
      label: task.assignedUser.name,
      type: "STAFF",
      id: task.assignedUser.id,
    };
  }

  if (task.owner) {
    return {
      label: cleanText(task.owner, "Staff"),
      type: "STAFF",
      id: null,
    };
  }

  return {
    label: "Unassigned",
    type: "UNASSIGNED",
    id: null,
  };
}

function getNextAction(task: any, taskType: string) {
  if (task.status === "DONE") return "No action needed";

  if (taskType === "AI_CALL") {
    const scheduled = parseAiScheduledCallNotes(task.aiNotes);

    if (scheduled?.status === "CALL_STARTED") {
      return "AI call started. Wait for call transcript and meeting request.";
    }

    if (scheduled?.status === "FAILED") {
      return "AI call failed. Human should call manually or reschedule.";
    }

    if (task.dueAt && new Date(task.dueAt).getTime() > Date.now()) {
      return "AI will call this person automatically at the scheduled time.";
    }

    return "AI call is due now and will be picked by the scheduler.";
  }

  if (taskType === "EMERGENCY") {
    return "Call immediately and escalate if not handled.";
  }

  if (task.status === "BLOCKED") {
    return task.blockedReason
      ? `Remove blocker: ${task.blockedReason}`
      : "Add blocked reason and remove blocker.";
  }

  if (!task.assignedUserId && !task.owner) {
    return "Assign this task to a responsible person.";
  }

  if (!task.dueAt && ["CRITICAL", "HIGH"].includes(task.priority)) {
    return "Set deadline and start work.";
  }

  if (task.status === "OPEN") return "Start the task.";
  if (task.status === "DOING") return "Complete or update progress.";

  return task.description || "Review and complete task.";
}

function getWarnings(task: any, taskType: string) {
  const warnings: string[] = [];

  if (
    !task.assignedUserId &&
    !task.owner &&
    task.status !== "DONE" &&
    taskType !== "AI_CALL"
  ) {
    warnings.push("Unassigned");
  }

  if (taskType === "EMERGENCY" && task.status !== "DONE") {
    warnings.push("Emergency");
  }

  if (
    !task.dueAt &&
    task.status !== "DONE" &&
    (taskType === "EMERGENCY" ||
      task.priority === "CRITICAL" ||
      task.priority === "HIGH")
  ) {
    warnings.push("Deadline required");
  }

  if (isOverdue(task) && taskType !== "AI_CALL") {
    warnings.push("Overdue");
  }

  if (taskType === "AI_CALL") {
    const scheduled = parseAiScheduledCallNotes(task.aiNotes);

    if (scheduled?.status === "FAILED") warnings.push("AI call failed");
    if (scheduled?.status === "CALL_STARTED") warnings.push("AI call started");
  }

  if (task.status === "BLOCKED" && !task.blockedReason) {
    warnings.push("Blocked reason missing");
  }

  return warnings;
}

function buildTimeline(task: any) {
  const timeline: {
    title: string;
    description: string;
    createdAt: Date;
    callId?: string;
    recordingMediaUrl?: string | null;
  }[] = [
    {
      title: "Task created",
      description: cleanText(task.title, "Task created"),
      createdAt: task.createdAt,
    },
  ];

  const scheduledCallDisplay = getAiScheduledCallDisplay(task);

  if (scheduledCallDisplay) {
    timeline.push({
      title: "AI call scheduled",
      description: scheduledCallDisplay,
      createdAt: task.createdAt,
    });
  } else if (task.aiNotes && !isLikelyAgentPrompt(task.aiNotes)) {
    timeline.push({
      title: "Internal note",
      description: cleanText(task.aiNotes, "Task note"),
      createdAt: task.createdAt,
    });
  }

  if (task.status === "BLOCKED") {
    timeline.push({
      title: "Task blocked",
      description: task.blockedReason || "Blocked reason not added.",
      createdAt: task.updatedAt,
    });
  }

  if (task.completedAt) {
    timeline.push({
      title: "Task completed",
      description: "Task was marked done.",
      createdAt: task.completedAt,
    });
  }

  if (task.conversation?.messages?.length) {
    for (const message of task.conversation.messages.slice(0, 8)) {
      timeline.push({
        title:
          message.senderType === "CUSTOMER"
            ? "Customer message"
            : message.senderType === "AI"
              ? "AI reply"
              : "Human reply",
        description: cleanText(message.body, "Conversation update"),
        createdAt: message.createdAt,
      });
    }
  }

  if (task.conversation?.calls?.length) {
    for (const call of task.conversation.calls.slice(0, 3)) {
      timeline.push({
        title: `Call ${String(call.status || "").toLowerCase()}`,
        description:
          cleanText(call.transcript, "") ||
          `${call.direction || "INBOUND"} call · ${call.durationSeconds || 0}s`,
        createdAt: call.createdAt,
        callId: call.id,
        recordingMediaUrl: buildRecordingMediaUrl(call),
      });
    }
  }

  const leadRequirements = buildLeadRequirementsFromTask(task);

  if (leadRequirements.captured) {
    timeline.push({
      title: "Customer requirement captured",
      description: leadRequirements.summary,
      createdAt: task.updatedAt,
    });
  }

  if (leadRequirements.meetingTime) {
    timeline.push({
      title: "Customer meeting requested",
      description: leadRequirements.meetingTime,
      createdAt: task.updatedAt,
    });
  }

  if (
    leadRequirements.meetingScheduledAt &&
    task.conversation?.bookings?.length
  ) {
    const requestedMeetingTime = new Date(
      leadRequirements.meetingScheduledAt,
    ).getTime();

    const matchingBooking = task.conversation.bookings.find((booking: any) => {
      if (!booking.dateTime) return false;
      const bookingTime = new Date(booking.dateTime).getTime();

      return (
        !Number.isNaN(bookingTime) &&
        Math.abs(bookingTime - requestedMeetingTime) <= 10 * 60 * 1000
      );
    });

    if (matchingBooking) {
      timeline.push({
        title: "Meeting record created",
        description: `${matchingBooking.title || "Customer meeting"} · ${
          leadRequirements.meetingTime
        }`,
        createdAt: matchingBooking.createdAt,
      });
    }
  }

  return timeline.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function buildTaskRow(task: any) {
  const taskType = getTaskType(task);
  const owner = getOwner(task);
  const latestCall = task.conversation?.calls?.[0] || null;
  const leadRequirements =
    taskType === "AI_CALL" || task.conversation?.channel === "AI_CALL"
      ? buildLeadRequirementsFromTask(task)
      : {
          summary: "",
          raw: [],
          meetingTime: null,
          meetingScheduledAt: null,
          meetingStatus: null,
          bookingTitle: null,
          captured: false,
          source: getSource(task),
        };
  const scheduledCall = getScheduledCallInfo(task, leadRequirements);
  const workToDo = buildWorkToDo(
    task,
    taskType,
    leadRequirements,
    scheduledCall,
  );
  const displayTitle = getDisplayTaskTitle(
    task,
    taskType,
    leadRequirements,
    scheduledCall,
  );

  return {
    id: task.id,
    title: cleanText(task.title, "Customer task"),
    displayTitle,
    description: cleanText(task.description, ""),
    workToDo,
    status: task.status,
    priority: task.priority,

    taskType,
    taskTypeLabel: getTaskTypeLabel(taskType),
    source: getSource(task),

    assignedUserId: task.assignedUserId || null,
    manualOwner: task.owner || "",
    ownerLabel: owner.label,
    ownerType: owner.type,

    customerId: task.customerId || task.conversation?.customerId || null,
    customerName: getCustomerName(task),
    customerPhone: getCustomerPhone(task),

    conversationId: task.conversationId,
    conversationChannel: task.conversation?.channel || null,

    dueAt: task.dueAt,
    dueLabel: getDueLabel(task, taskType),
    delayLabel: getDelayLabel(task),
    slaLabel: getSlaLabel(task, taskType),

    nextAction: getNextAction(task, taskType),
    warnings: getWarnings(task, taskType),

    aiNotes:
      taskType === "AI_CALL"
        ? getAiScheduledCallDisplay(task) || ""
        : cleanText(task.aiNotes, ""),
    scheduledCall,
    leadRequirements:
      taskType === "AI_CALL" || task.conversation?.channel === "AI_CALL"
        ? leadRequirements
        : null,
    blockedReason: task.blockedReason || "",

    latestCallId: latestCall?.id || null,
    latestCallStatus: latestCall?.status || null,
    latestCallRecordingMediaUrl: buildRecordingMediaUrl(latestCall),

    isEmergency: taskType === "EMERGENCY",
    isOverdue: isOverdue(task),
    isDueToday: isDueToday(task),
    isUnassigned: !task.assignedUserId && !task.owner,

    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,

    timeline: buildTimeline(task),
  };
}

function sortByExecutionRisk(a: any, b: any) {
  const risk = (task: any) => {
    let score = 0;

    if (task.isEmergency) score += 100;
    if (task.isOverdue) score += 85;
    if (task.isUnassigned) score += 70;
    if (task.priority === "CRITICAL") score += 60;
    if (task.priority === "HIGH") score += 40;
    if (task.status === "BLOCKED") score += 35;
    if (task.isDueToday) score += 25;
    if (task.status === "DOING") score += 8;

    return score;
  };

  return risk(b) - risk(a);
}

function buildSummary(tasks: any[]) {
  const today = new Date();

  const done = tasks.filter((task) => task.status === "DONE").length;

  return {
    total: tasks.length,
    open: tasks.filter((task) => task.status === "OPEN").length,
    doing: tasks.filter((task) => task.status === "DOING").length,
    dueToday: tasks.filter((task) => task.isDueToday).length,
    overdue: tasks.filter((task) => task.isOverdue).length,
    unassigned: tasks.filter((task) => task.isUnassigned).length,
    blocked: tasks.filter((task) => task.status === "BLOCKED").length,
    critical: tasks.filter((task) => task.priority === "CRITICAL").length,
    completedToday: tasks.filter(
      (task) =>
        task.status === "DONE" &&
        task.completedAt &&
        isSameDay(new Date(task.completedAt), today),
    ).length,
    completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

function applyFilters(
  tasks: any[],
  query: z.infer<typeof taskQuerySchema>,
  userId: string,
) {
  return tasks.filter((task) => {
    if (query.filter === "MY_TASKS" && task.assignedUserId !== userId) {
      return false;
    }

    if (query.filter === "UNASSIGNED" && !task.isUnassigned) return false;
    if (query.filter === "DUE_TODAY" && !task.isDueToday) return false;
    if (query.filter === "OVERDUE" && !task.isOverdue) return false;
    if (query.filter === "CRITICAL" && task.priority !== "CRITICAL")
      return false;
    if (query.filter === "BLOCKED" && task.status !== "BLOCKED") return false;
    if (query.filter === "OPEN" && task.status !== "OPEN") return false;
    if (query.filter === "DOING" && task.status !== "DOING") return false;
    if (query.filter === "COMPLETED" && task.status !== "DONE") return false;

    if (query.priority !== "ALL" && task.priority !== query.priority) {
      return false;
    }

    if (query.assignee === "UNASSIGNED" && !task.isUnassigned) return false;

    if (
      query.assignee !== "ALL" &&
      query.assignee !== "UNASSIGNED" &&
      task.assignedUserId !== query.assignee
    ) {
      return false;
    }

    if (query.taskType !== "ALL" && task.taskType !== query.taskType) {
      return false;
    }

    if (query.search?.trim()) {
      const search = query.search.trim().toLowerCase();

      const haystack =
        `${task.title} ${task.description} ${task.customerName} ${task.customerPhone || ""} ${task.ownerLabel} ${task.nextAction} ${task.aiNotes}`.toLowerCase();

      if (!haystack.includes(search)) return false;
    }

    return true;
  });
}

async function validateConversationForCompany(input: {
  conversationId?: string | null;
  companyId: string;
}) {
  if (!input.conversationId) return null;

  return prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      companyId: input.companyId,
    },
    select: {
      id: true,
      customerId: true,
    },
  });
}

async function validateCustomerForCompany(input: {
  customerId?: string | null;
  companyId: string;
}) {
  if (!input.customerId) return null;

  return prisma.customer.findFirst({
    where: {
      id: input.customerId,
      companyId: input.companyId,
    },
    select: {
      id: true,
    },
  });
}

export async function getTaskOperations(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const query = taskQuerySchema.parse(req.query);
    const companyId = req.user.companyId;
    const userId = getCurrentUserId(req);

    const [rawTasks, teamMembers] = await Promise.all([
      prisma.task.findMany({
        where: {
          companyId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              isActive: true,
            },
          },
          customer: true,
          conversation: {
            include: {
              customer: true,
              messages: {
                orderBy: {
                  createdAt: "desc",
                },
                take: 50,
              },
              calls: {
                orderBy: {
                  createdAt: "desc",
                },
                take: 4,
                include: {
                  postAnalysis: true,
                },
              },
              bookings: {
                orderBy: {
                  createdAt: "desc",
                },
                take: 3,
              },
            },
          },
        },
      }),

      prisma.user.findMany({
        where: {
          companyId,
          isActive: true,
        },
        orderBy: {
          name: "asc",
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
        },
      }),
    ]);

    const allTasks = rawTasks
      .filter((task) => !isSetupTask(task))
      .map(buildTaskRow)
      .sort(sortByExecutionRisk);

    const filteredTasks = applyFilters(allTasks, query, userId);

    const todayFocus = allTasks
      .filter(
        (task) =>
          task.isEmergency ||
          task.isOverdue ||
          task.isUnassigned ||
          task.status === "BLOCKED" ||
          task.priority === "CRITICAL" ||
          task.isDueToday,
      )
      .sort(sortByExecutionRisk)
      .slice(0, 8);

    return res.json({
      summary: buildSummary(allTasks),
      tasks: filteredTasks,
      todayFocus,
      teamMembers,
      taskTypes: [
        "EMERGENCY",
        "CALLBACK",
        "APPOINTMENT",
        "PAYMENT",
        "FOLLOW_UP",
        "AI_HANDOFF",
        "AI_CALL",
        "ADMIN",
        "GENERAL",
      ].map((type) => ({
        key: type,
        label: getTaskTypeLabel(type),
      })),
    });
  } catch (error) {
    console.error("Task operations error:", error);

    return res.status(500).json({
      message: "Failed to fetch tasks",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function scheduleAiCallTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = scheduleAiCallTaskSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid AI call task input",
        errors: result.error.flatten(),
      });
    }

    const companyId = req.user.companyId;
    const phone = normalizePhoneNumber(result.data.phone);
    const scheduledAt = new Date(result.data.scheduledAt);

    if (!phone.startsWith("+")) {
      return res.status(400).json({
        message:
          "Phone number must include country code, example: +919586410399.",
      });
    }

    if (Number.isNaN(scheduledAt.getTime())) {
      return res.status(400).json({
        message: "Scheduled time is invalid.",
      });
    }

    if (scheduledAt.getTime() < Date.now() - 60000) {
      return res.status(400).json({
        message: "Scheduled time cannot be in the past.",
      });
    }

    const existingCustomer = await prisma.customer.findFirst({
      where: {
        companyId,
        phone,
      },
    });

    const customer = existingCustomer
      ? await prisma.customer.update({
          where: {
            id: existingCustomer.id,
          },
          data: {
            fullName:
              result.data.fullName || existingCustomer.fullName || phone,
            notes: [
              existingCustomer.notes,
              result.data.purpose,
              result.data.notes,
              `Preferred AI call language: ${result.data.preferredLanguage}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
            lastContactAt: new Date(),
            lastSeenAt: new Date(),
          },
        })
      : await prisma.customer.create({
          data: {
            companyId,
            fullName: result.data.fullName || phone,
            phone,
            source: "AI Scheduled Call",
            leadStage: "NEW",
            leadScore: 55,
            notes:
              [
                result.data.purpose,
                result.data.notes,
                `Preferred AI call language: ${result.data.preferredLanguage}`,
              ]
                .filter(Boolean)
                .join("\n") || null,
            lastContactAt: new Date(),
            lastSeenAt: new Date(),
          },
        });

    const task = await prisma.task.create({
      data: {
        companyId,
        customerId: customer.id,
        title: `AI call ${customer.fullName || phone}`,
        description: `AI will call ${customer.fullName || phone}, speak in ${result.data.preferredLanguage === "AUTO" ? "the customer language" : result.data.preferredLanguage.toLowerCase()}, collect requirements, and create a meeting request.`,
        owner: AI_CALL_OWNER,
        dueAt: scheduledAt,
        priority: result.data.priority,
        status: "OPEN",
        aiNotes: JSON.stringify(
          {
            kind: AI_CALL_TASK_KIND,
            version: 1,
            status: "SCHEDULED",
            phone,
            fullName: result.data.fullName || customer.fullName || null,
            purpose: result.data.purpose,
            notes: result.data.notes || null,
            preferredLanguage: result.data.preferredLanguage,
            scheduledAt: scheduledAt.toISOString(),
            createdBy: getCurrentUserId(req) || null,
          },
          null,
          2,
        ),
      },
    });

    return res.status(201).json({
      message: "AI call task scheduled",
      task,
      customer,
    });
  } catch (error) {
    console.error("Schedule AI call task error:", error);

    return res.status(500).json({
      message: "Failed to schedule AI call task",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = createTaskSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid task input",
        errors: result.error.flatten(),
      });
    }

    const companyId = req.user.companyId;

    const conversation = await validateConversationForCompany({
      conversationId: result.data.conversationId,
      companyId,
    });

    if (result.data.conversationId && !conversation) {
      return res.status(404).json({
        message: "Conversation not found",
      });
    }

    const customer = await validateCustomerForCompany({
      customerId: result.data.customerId,
      companyId,
    });

    if (result.data.customerId && !customer) {
      return res.status(404).json({
        message: "Customer not found",
      });
    }

    let assignedUserName: string | undefined;

    if (result.data.assignedUserId) {
      const assignedUser = await prisma.user.findFirst({
        where: {
          id: result.data.assignedUserId,
          companyId,
          isActive: true,
        },
      });

      if (!assignedUser) {
        return res.status(404).json({
          message: "Assigned user not found",
        });
      }

      assignedUserName = assignedUser.name;
    }

    const task = await prisma.task.create({
      data: {
        companyId,
        title: result.data.title,
        description: result.data.description || null,
        priority: result.data.priority,
        status: result.data.status,
        dueAt: result.data.dueAt ? new Date(result.data.dueAt) : null,
        customerId: result.data.customerId || conversation?.customerId || null,
        conversationId: result.data.conversationId || null,
        assignedUserId: result.data.assignedUserId || null,
        owner: assignedUserName || result.data.owner || null,
        aiNotes: result.data.aiNotes || null,
        blockedReason: result.data.blockedReason || null,
        completedAt: result.data.status === "DONE" ? new Date() : null,
      },
    });

    return res.status(201).json({
      message: "Task created",
      task,
    });
  } catch (error) {
    console.error("Create task error:", error);

    return res.status(500).json({
      message: "Failed to create task",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function updateTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = updateTaskSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid task input",
        errors: result.error.flatten(),
      });
    }

    const existingTask = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existingTask) {
      return res.status(404).json({
        message: "Task not found",
      });
    }

    let ownerValue: string | null | undefined = result.data.owner;

    if (result.data.assignedUserId) {
      const assignedUser = await prisma.user.findFirst({
        where: {
          id: result.data.assignedUserId,
          companyId: req.user.companyId,
          isActive: true,
        },
      });

      if (!assignedUser) {
        return res.status(404).json({
          message: "Assigned user not found",
        });
      }

      ownerValue = assignedUser.name;
    }

    if (result.data.assignedUserId === null) {
      ownerValue = result.data.owner || null;
    }

    if (
      result.data.status === "BLOCKED" &&
      !result.data.blockedReason?.trim() &&
      !existingTask.blockedReason
    ) {
      return res.status(400).json({
        message: "Blocked reason is required",
      });
    }

    const preserveAiCallMetadata = Boolean(
      parseAiScheduledCallNotes(existingTask.aiNotes),
    );

    const task = await prisma.task.update({
      where: {
        id: existingTask.id,
      },
      data: {
        title: result.data.title,
        description: result.data.description,
        priority: result.data.priority,
        status: result.data.status,
        dueAt:
          result.data.dueAt === undefined
            ? undefined
            : result.data.dueAt
              ? new Date(result.data.dueAt)
              : null,
        assignedUserId: result.data.assignedUserId,
        owner: ownerValue,
        aiNotes: preserveAiCallMetadata ? undefined : result.data.aiNotes,
        blockedReason: result.data.blockedReason,
        completedAt:
          result.data.status === "DONE"
            ? existingTask.completedAt || new Date()
            : result.data.status
              ? null
              : undefined,
      },
    });

    return res.json({
      message: "Task updated",
      task,
    });
  } catch (error) {
    console.error("Update task error:", error);

    return res.status(500).json({
      message: "Failed to update task",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function runTaskAction(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const result = taskActionSchema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        message: "Invalid task action",
        errors: result.error.flatten(),
      });
    }

    const existingTask = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
    });

    if (!existingTask) {
      return res.status(404).json({
        message: "Task not found",
      });
    }

    if (result.data.action === "BLOCK" && !result.data.blockedReason?.trim()) {
      return res.status(400).json({
        message: "Blocked reason is required",
      });
    }

    if (result.data.action === "CREATE_FOLLOW_UP") {
      const followUp = await prisma.task.create({
        data: {
          companyId: req.user.companyId,
          customerId: existingTask.customerId,
          conversationId: existingTask.conversationId,
          title: result.data.note || `Follow up: ${existingTask.title}`,
          description: existingTask.description,
          priority: existingTask.priority,
          dueAt: result.data.dueAt ? new Date(result.data.dueAt) : null,
          assignedUserId: existingTask.assignedUserId,
          owner: existingTask.owner,
          status: "OPEN",
          aiNotes: existingTask.aiNotes,
        },
      });

      return res.status(201).json({
        message: "Follow-up task created",
        task: followUp,
      });
    }

    const updateData: any = {};

    if (result.data.action === "START") {
      updateData.status = "DOING";
    }

    if (result.data.action === "BLOCK") {
      updateData.status = "BLOCKED";
      updateData.blockedReason = result.data.blockedReason;
    }

    if (result.data.action === "DONE") {
      updateData.status = "DONE";
      updateData.completedAt = new Date();
    }

    if (result.data.action === "ESCALATE") {
      updateData.priority = "CRITICAL";
      updateData.dueAt = existingTask.dueAt || new Date();
      updateData.aiNotes = existingTask.aiNotes
        ? `${existingTask.aiNotes}\nManager escalation: ${
            result.data.note || "Escalated task"
          }`
        : `Manager escalation: ${result.data.note || "Escalated task"}`;
    }

    if (result.data.action === "REOPEN") {
      updateData.status = "OPEN";
      updateData.completedAt = null;
    }

    const task = await prisma.task.update({
      where: {
        id: existingTask.id,
      },
      data: updateData,
    });

    return res.json({
      message: "Task action completed",
      task,
    });
  } catch (error) {
    console.error("Task action error:", error);

    return res.status(500).json({
      message: "Failed to run task action",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteTask(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        message: "Unauthorized",
      });
    }

    const existingTask = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        companyId: req.user.companyId,
      },
      select: {
        id: true,
        title: true,
        conversationId: true,
      },
    });

    if (!existingTask) {
      return res.status(404).json({
        message: "Task not found",
      });
    }

    await prisma.task.delete({
      where: {
        id: existingTask.id,
      },
    });

    if (existingTask.conversationId) {
      await prisma.conversation
        .update({
          where: {
            id: existingTask.conversationId,
          },
          data: {
            nextAction:
              "Task removed. Review conversation and create a new task if needed.",
            lastMessageAt: new Date(),
          },
        })
        .catch(() => null);
    }

    return res.json({
      message: "Task removed",
      taskId: existingTask.id,
    });
  } catch (error) {
    console.error("Delete task error:", error);

    return res.status(500).json({
      message: "Failed to remove task",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}