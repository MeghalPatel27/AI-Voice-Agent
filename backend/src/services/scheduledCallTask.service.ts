import { prisma } from "../db/prisma";
import {
  AI_CALL_OWNER,
  AI_CALL_TASK_KIND,
  normalizePhoneNumber,
  parseScheduledCallContext,
  stringifyScheduledCallContext,
  type AiCallLanguage,
  type ScheduledCallContext,
} from "./aiScheduledCallContext";

export const SEED_SCHEDULED_CONTEXT_CUSTOMER_NAME =
  "[SEED] Scheduled Context Verification";
export const SEED_SCHEDULED_CONTEXT_MARKER = "DEV_SCHEDULED_CONTEXT_VERIFICATION";
export const SEED_SCHEDULED_CONTEXT_PHONE = "+15550100999";

export type CreateScheduledCallTaskInput = {
  companyId: string;
  createdByUserId?: string | null;
  phone: string;
  fullName?: string | null;
  scheduledAt: Date;
  timezone: string;
  collectionGoal: string;
  callPurpose?: string | null;
  extraNotes?: string | null;
  preferredLanguage: AiCallLanguage;
  priority?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  customerId?: string | null;
  seedMarker?: string | null;
};

export async function createScheduledCallTask(input: CreateScheduledCallTaskInput) {
  const phone = normalizePhoneNumber(input.phone);
  if (!phone.startsWith("+")) {
    throw new Error("invalid_phone");
  }

  const explicitCustomer = input.customerId
    ? await prisma.customer.findFirst({
        where: { id: input.customerId, companyId: input.companyId },
      })
    : null;

  if (input.customerId && !explicitCustomer) {
    throw new Error("customer_not_found");
  }

  const existingCustomer =
    explicitCustomer ||
    (await prisma.customer.findFirst({
      where: {
        companyId: input.companyId,
        phone,
      },
    }));

  const customer = existingCustomer
    ? await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: {
          fullName: input.fullName || existingCustomer.fullName || phone,
          notes: [
            existingCustomer.notes,
            input.collectionGoal,
            input.callPurpose,
            input.extraNotes,
            `Preferred AI call language: ${input.preferredLanguage}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          lastContactAt: new Date(),
          lastSeenAt: new Date(),
        },
      })
    : await prisma.customer.create({
        data: {
          companyId: input.companyId,
          fullName: input.fullName || phone,
          phone,
          source: "AI Scheduled Call",
          leadStage: "NEW",
          leadScore: 55,
          notes:
            [
              input.collectionGoal,
              input.callPurpose,
              input.extraNotes,
              `Preferred AI call language: ${input.preferredLanguage}`,
            ]
              .filter(Boolean)
              .join("\n") || null,
          lastContactAt: new Date(),
          lastSeenAt: new Date(),
        },
      });

  const context: ScheduledCallContext = {
    kind: AI_CALL_TASK_KIND,
    version: 2,
    status: "SCHEDULED",
    phone,
    fullName: input.fullName || customer.fullName || null,
    collectionGoal: input.collectionGoal,
    callPurpose: input.callPurpose || null,
    extraNotes: input.extraNotes || null,
    preferredLanguage: input.preferredLanguage,
    scheduledAt: input.scheduledAt.toISOString(),
    timezone: input.timezone,
    customerId: customer.id,
    createdBy: input.createdByUserId || null,
  };

  if (input.seedMarker) {
    context.verificationSeed = input.seedMarker;
  }

  const task = await prisma.task.create({
    data: {
      companyId: input.companyId,
      customerId: customer.id,
      title: input.seedMarker
        ? `[SEED] Scheduled call context verification`
        : `AI call ${customer.fullName || phone}`,
      description: input.seedMarker
        ? "Development-only scheduled-call context verification seed."
        : `AI will call ${customer.fullName || phone}, speak in ${input.preferredLanguage === "AUTO" ? "the customer language" : input.preferredLanguage.toLowerCase()}, and collect: ${input.collectionGoal}`,
      owner: AI_CALL_OWNER,
      dueAt: input.scheduledAt,
      priority: input.priority || "HIGH",
      status: "OPEN",
      aiNotes: stringifyScheduledCallContext(context),
    },
  });

  return { task, customer, context: parseScheduledCallContext(task.aiNotes) };
}

export async function findSeedScheduledContextTask(companyId: string) {
  return prisma.task.findFirst({
    where: {
      companyId,
      owner: AI_CALL_OWNER,
      aiNotes: {
        contains: SEED_SCHEDULED_CONTEXT_MARKER,
      },
    },
    include: {
      customer: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
}

export async function findSeedScheduledContextCustomer(companyId: string) {
  return prisma.customer.findFirst({
    where: {
      companyId,
      fullName: SEED_SCHEDULED_CONTEXT_CUSTOMER_NAME,
    },
  });
}
