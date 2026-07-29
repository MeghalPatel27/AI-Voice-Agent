import { z } from "zod";
import { prisma } from "../db/prisma";
import {
  buildLabeledTranscriptLines,
  loadCallScopedMessages,
} from "./callTranscript.service";

export const POST_CALL_PROMPT_VERSION = "post-call-intent-v1";

export const INTENT_LEVELS = [
  "VERY_HIGH",
  "HIGH",
  "MEDIUM",
  "LOW",
  "NOT_INTERESTED",
  "UNKNOWN",
] as const;

export type IntentLevel = (typeof INTENT_LEVELS)[number];

const requirementDetailsSchema = z.object({
  primaryNeed: z.string().nullable(),
  businessProblem: z.string().nullable(),
  desiredCapabilities: z.array(z.string()),
  integrationNeeds: z.array(z.string()),
  currentSolution: z.string().nullable(),
  timelineSignal: z.string().nullable(),
  budgetSignal: z.string().nullable(),
  decisionStage: z.string().nullable(),
  objections: z.array(z.string()),
  requestedNextStep: z.string().nullable(),
});

export const postCallAnalysisResultSchema = z.object({
  intentLevel: z.enum(INTENT_LEVELS),
  intentScore: z.number().int().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(1),
  requirementSummary: z.string().max(500),
  requirements: requirementDetailsSchema,
  evidenceSignals: z.array(z.string()).max(20),
});

export type PostCallAnalysisResult = z.infer<typeof postCallAnalysisResultSchema>;

export type TranscriptBuildResult = {
  transcript: string;
  customerTurnCount: number;
  truncated: boolean;
  hasMeaningfulCustomerContent: boolean;
};

const MAX_TRANSCRIPT_CHARS = Number(
  process.env.POST_CALL_ANALYSIS_MAX_TRANSCRIPT_CHARS || 14000,
);

function analysisLog(event: string, data: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      scope: "post_call_analysis",
      event,
      at: new Date().toISOString(),
      ...data,
    }),
  );
}

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY || "";
}

export function getPostCallAnalysisModel() {
  return (
    process.env.OPENAI_POST_CALL_MODEL ||
    process.env.OPENAI_TEXT_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-4o-mini"
  );
}

function getTimeoutMs() {
  const raw = Number(process.env.OPENAI_POST_CALL_TIMEOUT_MS || 20000);
  return Number.isFinite(raw) ? raw : 20000;
}

function cleanLine(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMeaningfulCustomerText(text: string) {
  const value = cleanLine(text).toLowerCase();
  if (value.length < 6) return false;
  if (
    /^(hello|hi|hey|ok|okay|yes|no|thanks|thank you|bye|goodbye)\.?$/.test(
      value,
    )
  ) {
    return false;
  }
  return /[a-z0-9]/i.test(value);
}

export function buildLabeledTranscript(
  messages: Array<{ senderType: string; body: string; createdAt?: Date }>,
): TranscriptBuildResult {
  const ordered = [...messages].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aTime - bTime;
  });

  const lines = ordered
    .map((message) => {
      const speaker =
        message.senderType === "CUSTOMER"
          ? "CUSTOMER"
          : message.senderType === "AI"
            ? "AI"
            : "HUMAN";
      const body = cleanLine(message.body);
      if (!body) return null;
      return `${speaker}: ${body}`;
    })
    .filter((line): line is string => Boolean(line));

  const customerTurnCount = ordered.filter(
    (message) =>
      message.senderType === "CUSTOMER" &&
      isMeaningfulCustomerText(message.body),
  ).length;

  let transcript = lines.join("\n");
  let truncated = false;

  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    truncated = true;
    // Prefer the end of the call (requirements, objections, next steps).
    const headBudget = Math.floor(MAX_TRANSCRIPT_CHARS * 0.25);
    const tailBudget = MAX_TRANSCRIPT_CHARS - headBudget - 40;
    const head = transcript.slice(0, headBudget);
    const tail = transcript.slice(-tailBudget);
    transcript = `${head}\n...\n[transcript truncated for length]\n...\n${tail}`;
  }

  return {
    transcript,
    customerTurnCount,
    truncated,
    hasMeaningfulCustomerContent: customerTurnCount > 0,
  };
}

export function validatePostCallAnalysisResult(
  value: unknown,
): PostCallAnalysisResult {
  const parsed = postCallAnalysisResultSchema.parse(value);

  if (parsed.intentLevel === "UNKNOWN" && parsed.intentScore != null) {
    // Allow score with UNKNOWN only if model sent one; normalize to null.
    return {
      ...parsed,
      intentScore: null,
    };
  }

  if (parsed.intentLevel !== "UNKNOWN" && parsed.intentScore == null) {
    throw new Error("intentScore_required_for_known_level");
  }

  if (parsed.requirementSummary.trim().length < 1) {
    throw new Error("requirement_summary_empty");
  }

  return {
    ...parsed,
    requirementSummary: parsed.requirementSummary.trim().slice(0, 500),
    requirements: {
      ...parsed.requirements,
      desiredCapabilities: parsed.requirements.desiredCapabilities
        .map((item) => cleanLine(item))
        .filter(Boolean)
        .slice(0, 12),
      integrationNeeds: parsed.requirements.integrationNeeds
        .map((item) => cleanLine(item))
        .filter(Boolean)
        .slice(0, 12),
      objections: parsed.requirements.objections
        .map((item) => cleanLine(item))
        .filter(Boolean)
        .slice(0, 12),
    },
    evidenceSignals: parsed.evidenceSignals
      .map((item) => cleanLine(item))
      .filter(Boolean)
      .slice(0, 12),
  };
}

function buildSystemPrompt() {
  return `
You analyze completed sales/discovery call transcripts for AiraDesk software interest.

Use ONLY the provided transcript.
Treat CUSTOMER statements as evidence.
Do NOT treat AI statements as customer requirements.
Do NOT invent missing details.
Use null or empty arrays for missing data.
Separate buying/adoption intent from general sentiment or politeness.
Do NOT infer accent, dialect, fluency, gender, age, ethnicity, nationality, disability, socioeconomic status, personality, emotion, or voice characteristics.
Do NOT provide hidden reasoning or chain-of-thought.
Return ONLY the requested structured JSON result.

Customer intent means how strongly the customer appears interested in purchasing, trialling, adopting, or continuing evaluation of the software, based on explicit and behavioural business evidence.

Strong positive signals: pricing/plan questions, demo/trial requests, implementation questions, integrations, detailed requirements, timeline, stakeholders, follow-up agreement, proposal request, how to proceed, scheduling next steps.
Moderate signals: explores features, real use case, compares current process, discusses solvable problems, substantive objections while continuing evaluation.
Low/negative signals: curiosity only, no concrete need, no timeline/next step, explicit disinterest, wrong number, unrelated ask, ends early, rejects follow-up, product unsuitable.

Scoring rubric:
80-100 VERY_HIGH
60-79 HIGH
40-59 MEDIUM
20-39 LOW
0-19 NOT_INTERESTED
Use UNKNOWN with null intentScore when evidence is insufficient.

Requirement summary must be 1-3 brief sentences, max ~500 characters, for a dashboard operator.
`.trim();
}

const analysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intentLevel",
    "intentScore",
    "confidence",
    "requirementSummary",
    "requirements",
    "evidenceSignals",
  ],
  properties: {
    intentLevel: {
      type: "string",
      enum: [...INTENT_LEVELS],
    },
    intentScore: {
      anyOf: [{ type: "integer", minimum: 0, maximum: 100 }, { type: "null" }],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    requirementSummary: { type: "string", maxLength: 500 },
    requirements: {
      type: "object",
      additionalProperties: false,
      required: [
        "primaryNeed",
        "businessProblem",
        "desiredCapabilities",
        "integrationNeeds",
        "currentSolution",
        "timelineSignal",
        "budgetSignal",
        "decisionStage",
        "objections",
        "requestedNextStep",
      ],
      properties: {
        primaryNeed: { anyOf: [{ type: "string" }, { type: "null" }] },
        businessProblem: { anyOf: [{ type: "string" }, { type: "null" }] },
        desiredCapabilities: { type: "array", items: { type: "string" } },
        integrationNeeds: { type: "array", items: { type: "string" } },
        currentSolution: { anyOf: [{ type: "string" }, { type: "null" }] },
        timelineSignal: { anyOf: [{ type: "string" }, { type: "null" }] },
        budgetSignal: { anyOf: [{ type: "string" }, { type: "null" }] },
        decisionStage: { anyOf: [{ type: "string" }, { type: "null" }] },
        objections: { type: "array", items: { type: "string" } },
        requestedNextStep: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    },
    evidenceSignals: { type: "array", items: { type: "string" } },
  },
};

function extractOutputText(data: any): string | null {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text;
  }

  const outputs = Array.isArray(data?.output) ? data.output : [];
  for (const item of outputs) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (
        (content?.type === "output_text" || content?.type === "text") &&
        typeof content?.text === "string" &&
        content.text.trim()
      ) {
        return content.text;
      }
    }
  }

  return null;
}

export async function analyzeCallTranscriptWithOpenAI(input: {
  transcript: string;
  truncated: boolean;
}): Promise<PostCallAnalysisResult> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("openai_api_key_missing");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  const model = getPostCallAnalysisModel();

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: buildSystemPrompt(),
        input: JSON.stringify({
          promptVersion: POST_CALL_PROMPT_VERSION,
          transcriptTruncated: input.truncated,
          transcript: input.transcript,
        }),
        text: {
          format: {
            type: "json_schema",
            name: "airadesk_post_call_analysis",
            strict: true,
            schema: analysisJsonSchema,
          },
        },
        max_output_tokens: 1200,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      analysisLog("post_call_analysis_openai_error", {
        status: response.status,
        failureCode: "openai_http_error",
      });
      throw new Error("openai_http_error");
    }

    const outputText = extractOutputText(data);
    if (!outputText) {
      throw new Error("openai_empty_output");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      throw new Error("openai_invalid_json");
    }

    return validatePostCallAnalysisResult(parsed);
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadCallTranscriptForAnalysis(callId: string) {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    include: {
      conversation: {
        select: {
          id: true,
          companyId: true,
        },
      },
    },
  });

  if (!call) return null;

  const scopedMessages = await loadCallScopedMessages(
    call.id,
    call.conversationId,
  );

  let fromMessages = buildLabeledTranscript(scopedMessages);

  if (
    !fromMessages.hasMeaningfulCustomerContent &&
    call.transcript &&
    /CUSTOMER:|Caller:/i.test(call.transcript)
  ) {
    const synthetic = call.transcript
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        if (/^Caller:/i.test(trimmed)) {
          return {
            senderType: "CUSTOMER",
            body: trimmed.replace(/^Caller:\s*/i, ""),
          };
        }
        if (/^CUSTOMER:/i.test(trimmed)) {
          return {
            senderType: "CUSTOMER",
            body: trimmed.replace(/^CUSTOMER:\s*/i, ""),
          };
        }
        if (/^AI:|^Assistant:/i.test(trimmed)) {
          return {
            senderType: "AI",
            body: trimmed.replace(/^(AI|Assistant):\s*/i, ""),
          };
        }
        return null;
      })
      .filter(
        (
          item,
        ): item is { senderType: string; body: string } => item != null,
      );

    if (synthetic.length > 0) {
      fromMessages = buildLabeledTranscript(synthetic);
    }
  }

  if (
    !fromMessages.hasMeaningfulCustomerContent &&
    call.transcript?.trim()
  ) {
    const labeled = buildLabeledTranscriptLines(
      call.transcript.split("\n").map((line) => ({
        senderType: /^CUSTOMER:|^Caller:/i.test(line) ? "CUSTOMER" : "AI",
        body: line.replace(/^(CUSTOMER|Caller|AI|Assistant):\s*/i, ""),
      })),
    );
    if (labeled.trim()) {
      fromMessages = buildLabeledTranscript(
        call.transcript.split("\n").map((line) => ({
          senderType: /^CUSTOMER:|^Caller:/i.test(line) ? "CUSTOMER" : "AI",
          body: line.replace(/^(CUSTOMER|Caller|AI|Assistant):\s*/i, ""),
        })),
      );
    }
  }

  return {
    call,
    built: fromMessages,
  };
}

export function scoreBandForLevel(level: IntentLevel): string {
  switch (level) {
    case "VERY_HIGH":
      return "80-100";
    case "HIGH":
      return "60-79";
    case "MEDIUM":
      return "40-59";
    case "LOW":
      return "20-39";
    case "NOT_INTERESTED":
      return "0-19";
    default:
      return "unknown";
  }
}
