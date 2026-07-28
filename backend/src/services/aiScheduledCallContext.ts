import { z } from "zod";

export const AI_CALL_TASK_KIND = "AI_SCHEDULED_CALL";
export const AI_CALL_OWNER = "AI Caller";

export const COLLECTION_GOAL_MAX_LENGTH = 1200;
export const EXTRA_NOTES_MAX_LENGTH = 2000;
export const CALL_PURPOSE_MAX_LENGTH = 200;
export const TIMEZONE_MAX_LENGTH = 80;

export const aiCallLanguageSchema = z.enum([
  "AUTO",
  "ENGLISH",
  "HINDI",
  "GUJARATI",
]);

export type AiCallLanguage = z.infer<typeof aiCallLanguageSchema>;

const scheduledCallContextSchema = z.object({
  kind: z.literal(AI_CALL_TASK_KIND),
  version: z.number().int().min(1).default(2),
  status: z.string().default("SCHEDULED"),
  phone: z.string().min(3),
  fullName: z.string().nullable().optional(),
  collectionGoal: z.string().min(1).max(COLLECTION_GOAL_MAX_LENGTH),
  callPurpose: z.string().max(CALL_PURPOSE_MAX_LENGTH).nullable().optional(),
  extraNotes: z.string().max(EXTRA_NOTES_MAX_LENGTH).nullable().optional(),
  preferredLanguage: aiCallLanguageSchema.default("AUTO"),
  scheduledAt: z.string().datetime(),
  timezone: z.string().max(TIMEZONE_MAX_LENGTH).default("Asia/Kolkata"),
  customerId: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  callSid: z.string().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  failedAt: z.string().datetime().nullable().optional(),
  error: z.string().nullable().optional(),
  leadRequirements: z
    .object({
      summary: z.string().nullable().optional(),
      meetingTime: z.string().nullable().optional(),
      capturedAt: z.string().datetime().nullable().optional(),
    })
    .nullable()
    .optional(),
  verificationSeed: z.string().nullable().optional(),
});

export type ScheduledCallContext = z.infer<typeof scheduledCallContextSchema>;

export function normalizePhoneNumber(value: string) {
  return String(value || "")
    .replace(/[\s()\-]/g, "")
    .trim();
}

export function normalizeLanguage(value?: string | null): AiCallLanguage {
  const normalized = String(value || "AUTO").toUpperCase().trim();
  if (["ENGLISH", "HINDI", "GUJARATI"].includes(normalized)) {
    return normalized as AiCallLanguage;
  }
  return "AUTO";
}

export function parseScheduledCallContext(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;

    // Legacy v1 payloads used `purpose` instead of `collectionGoal`.
    const normalized = {
      ...parsed,
      version: Number(parsed.version) >= 1 ? Number(parsed.version) : 2,
      collectionGoal:
        parsed.collectionGoal ||
        parsed.purpose ||
        parsed.callPurpose ||
        undefined,
      callPurpose: parsed.callPurpose || parsed.purpose || null,
      extraNotes: parsed.extraNotes || parsed.notes || null,
    };

    const validated = scheduledCallContextSchema.safeParse(normalized);
    if (validated.success) return validated.data;
    return null;
  } catch {
    return null;
  }
}

export function stringifyScheduledCallContext(context: ScheduledCallContext) {
  return JSON.stringify(scheduledCallContextSchema.parse(context), null, 2);
}
