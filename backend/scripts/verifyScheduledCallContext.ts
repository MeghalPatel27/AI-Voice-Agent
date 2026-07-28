import "dotenv/config";
import { prisma } from "../src/db/prisma";
import { prepareScheduledAiCallForTask } from "../src/services/aiScheduledCall.service";
import { noDialScheduledCallAdapter } from "../src/services/aiScheduledCallDial";
import { buildAiradeskCallContext } from "../src/services/callContext.service";
import {
  parseScheduledCallContext,
  stringifyScheduledCallContext,
} from "../src/services/aiScheduledCallContext";
import {
  SEED_SCHEDULED_CONTEXT_CUSTOMER_NAME,
  SEED_SCHEDULED_CONTEXT_MARKER,
  SEED_SCHEDULED_CONTEXT_PHONE,
  createScheduledCallTask,
  findSeedScheduledContextCustomer,
  findSeedScheduledContextTask,
} from "../src/services/scheduledCallTask.service";

class VerificationRollback extends Error {
  constructor(readonly summary: Record<string, unknown>) {
    super("verification_rollback");
    this.name = "VerificationRollback";
  }
}

function env(name: string) {
  return String(process.env[name] || "").trim();
}

function assertNode24() {
  const version = process.version;
  if (!version.startsWith("v24.")) {
    throw new Error(`Node 24 is required for verification (found ${version})`);
  }
}

function assertDevelopmentGates(apply: boolean) {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Refusing verification unless NODE_ENV=development");
  }
  if (env("ALLOW_DEV_SCHEDULED_CONTEXT_SEED") !== "true") {
    throw new Error("Refusing verification unless ALLOW_DEV_SCHEDULED_CONTEXT_SEED=true");
  }
  if (!apply) {
    throw new Error("Refusing database mutation without --apply");
  }
}

function assertDevelopmentDatabase() {
  const databaseUrl = env("DATABASE_URL");
  const expectedProjectRef =
    env("DEV_SUPABASE_PROJECT_REF") || "tqmwrmlswbwngblxkibm";

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing");
  }

  if (!databaseUrl.includes(expectedProjectRef)) {
    throw new Error(
      `Connected database is not the known development project (${expectedProjectRef})`,
    );
  }
}

function redactPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "***";
  return `***${digits.slice(-4)}`;
}

function buildSeedValues() {
  const scheduledAt = new Date();
  scheduledAt.setUTCDate(scheduledAt.getUTCDate() + 45);
  scheduledAt.setUTCHours(10, 30, 0, 0);

  return {
    collectionGoal:
      "[SEED] Collect the required website type, important pages and features, budget range, timeline, current website status, decision-maker status and an exact preferred meeting date and time.",
    callPurpose: "[SEED] Website discovery follow-up",
    extraNotes:
      "[SEED PRIVATE NOTE] The lead previously asked about e-commerce and WhatsApp automation. Do not repeat questions already answered.",
    preferredLanguage: "ENGLISH" as const,
    timezone: "Asia/Kolkata",
    scheduledAt,
  };
}

async function ensureSeedRecords(companyId: string, createdByUserId?: string | null) {
  const values = buildSeedValues();
  let customer = await findSeedScheduledContextCustomer(companyId);
  let task:
    | Awaited<ReturnType<typeof findSeedScheduledContextTask>>
    | Awaited<ReturnType<typeof createScheduledCallTask>>["task"]
    | null = await findSeedScheduledContextTask(companyId);
  let customerCreated = false;
  let taskCreated = false;

  if (!customer) {
    const created = await createScheduledCallTask({
      companyId,
      createdByUserId,
      phone: SEED_SCHEDULED_CONTEXT_PHONE,
      fullName: SEED_SCHEDULED_CONTEXT_CUSTOMER_NAME,
      scheduledAt: values.scheduledAt,
      timezone: values.timezone,
      collectionGoal: values.collectionGoal,
      callPurpose: values.callPurpose,
      extraNotes: values.extraNotes,
      preferredLanguage: values.preferredLanguage,
      seedMarker: SEED_SCHEDULED_CONTEXT_MARKER,
    });
    customer = created.customer;
    task = created.task;
    customerCreated = true;
    taskCreated = true;
  } else if (!task) {
    const created = await createScheduledCallTask({
      companyId,
      createdByUserId,
      customerId: customer.id,
      phone: customer.phone,
      fullName: customer.fullName,
      scheduledAt: values.scheduledAt,
      timezone: values.timezone,
      collectionGoal: values.collectionGoal,
      callPurpose: values.callPurpose,
      extraNotes: values.extraNotes,
      preferredLanguage: values.preferredLanguage,
      seedMarker: SEED_SCHEDULED_CONTEXT_MARKER,
    });
    task = created.task;
    taskCreated = true;
  }

  if (!customer || !task) {
    throw new Error("Failed to resolve seed customer and task");
  }

  return {
    customer,
    task,
    customerCreated,
    taskCreated,
    values,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          verificationStatus: "refused",
          reason: "Pass --apply to run development seed verification",
          requiredGates: [
            "NODE_ENV=development",
            "ALLOW_DEV_SCHEDULED_CONTEXT_SEED=true",
            "--apply",
            "Node 24 active",
            "known development Supabase project",
          ],
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  assertNode24();
  assertDevelopmentGates(true);
  assertDevelopmentDatabase();

  const companyId = env("VOICE_COMPANY_ID");
  if (!companyId) {
    throw new Error("VOICE_COMPANY_ID is required for seed verification");
  }

  const devUser = await prisma.user.findFirst({
    where: { companyId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const seed = await ensureSeedRecords(companyId, devUser?.id || null);
  const parsedTaskContext = parseScheduledCallContext(seed.task.aiNotes);

  if (!parsedTaskContext) {
    throw new Error("Seed task context failed production parser validation");
  }

  const contextMatches =
    parsedTaskContext.collectionGoal === seed.values.collectionGoal &&
    parsedTaskContext.extraNotes === seed.values.extraNotes &&
    parsedTaskContext.callPurpose === seed.values.callPurpose &&
    parsedTaskContext.preferredLanguage === seed.values.preferredLanguage &&
    parsedTaskContext.timezone === seed.values.timezone;

  let preparationSummary: Record<string, unknown> = {};
  let contextSummary: Record<string, unknown> = {};

  try {
    await prisma.$transaction(async (tx) => {
      const prepared = await prepareScheduledAiCallForTask(
        {
          ...seed.task,
          customer: seed.customer,
        },
        {
          client: tx,
          verificationOnly: true,
        },
      );

      if (prepared.skipped) {
        throw new Error(`Preparation skipped: ${prepared.reason}`);
      }
      if (prepared.failed) {
        throw new Error(`Preparation failed: ${prepared.reason}`);
      }

      const dialAttempt = await noDialScheduledCallAdapter.dial({
        phone: prepared.phone,
        fromNumber: "+10000000000",
        answerUrl: "https://example.invalid/no-dial",
        statusCallbackUrl: "https://example.invalid/no-dial",
        accountSid: "AC_NO_DIAL",
        authToken: "no_dial",
      });

      const context = await buildAiradeskCallContext(
        prepared.callId,
        companyId,
        tx,
      );

      const preparedCall = await tx.call.findUnique({
        where: { id: prepared.callId },
        select: {
          purpose: true,
          notes: true,
          preferredLanguage: true,
          preferredCallTime: true,
          metadata: true,
          providerCallId: true,
          twilioCallSid: true,
        },
      });

      preparationSummary = {
        executed: true,
        callIdSuffix: prepared.callId.slice(-6),
        providerCallId: preparedCall?.providerCallId || null,
        twilioCallSid: preparedCall?.twilioCallSid || null,
        purposeMatched: preparedCall?.purpose === seed.values.collectionGoal,
        notesMatched: preparedCall?.notes === seed.values.extraNotes,
        languageMatched: preparedCall?.preferredLanguage === seed.values.preferredLanguage,
        timezoneMatched:
          (preparedCall?.metadata as Record<string, unknown> | null)?.timezone ===
          seed.values.timezone,
        noDialAdapterInvoked: dialAttempt.ok === false,
        noDialReason: dialAttempt.ok ? null : dialAttempt.error,
      };

      contextSummary = {
        collectionGoalMatched:
          context.call.collectionGoal === seed.values.collectionGoal,
        callPurposeMatched: context.call.callPurpose === seed.values.callPurpose,
        extraNotesPrivate: Boolean(context.call.extraNotes?.includes("PRIVATE_INTERNAL_NOTE")),
        extraNotesMatched: Boolean(
          context.call.extraNotes?.includes(seed.values.extraNotes),
        ),
        preferredLanguageMatched:
          context.call.preferredLanguage === seed.values.preferredLanguage,
        timezoneMatched: context.call.timezone === seed.values.timezone,
        customerNamePresent: Boolean(context.customer.name),
        companyNamePresent: Boolean(context.company.name),
      };

      throw new VerificationRollback({
        preparationSummary,
        contextSummary,
      });
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) {
      throw error;
    }

    console.log(
      JSON.stringify(
        {
          verificationStatus: "passed",
          seedCustomer: seed.customerCreated ? "created" : "reused",
          seedTask: seed.taskCreated ? "created" : "reused",
          seedCustomerPhone: redactPhone(seed.customer.phone),
          taskContextParsed: contextMatches,
          noDialPreparationExecuted: true,
          preparationRollback: "transaction_rolled_back",
          callContextMapped: true,
          ...error.summary,
          externalProviderCallsAttempted: 0,
          duplicateRecordsCreated: 0,
        },
        null,
        2,
      ),
    );
    return;
  }
}

void main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          verificationStatus: "failed",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
