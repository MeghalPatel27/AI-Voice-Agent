import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma";

const runIntegration =
  process.env.RUN_SCHEMA_INTEGRATION_TESTS === "1" &&
  process.env.NODE_ENV !== "production";

const suffix = `${Date.now()}`;
let companyAId = "";
let companyBId = "";
let userAId = "";
let userBId = "";
let customerAId = "";
let conversationAId = "";
let callAId = "";

async function cleanup() {
  if (!companyAId && !companyBId) return;

  await prisma.company.deleteMany({
    where: {
      id: {
        in: [companyAId, companyBId].filter(Boolean),
      },
    },
  });
}

describe.runIf(runIntegration)("canonical schema integration", () => {
  beforeAll(async () => {
    await cleanup();

    const password = await bcrypt.hash("schema-test-password", 10);

    const [companyA, companyB] = await Promise.all([
      prisma.company.create({
        data: {
          name: `Schema Test A ${suffix}`,
          users: {
            create: {
              name: "Schema User A",
              email: `schema-a-${suffix}@example.com`,
              password,
              role: "OWNER",
            },
          },
        },
        include: { users: true },
      }),
      prisma.company.create({
        data: {
          name: `Schema Test B ${suffix}`,
          users: {
            create: {
              name: "Schema User B",
              email: `schema-b-${suffix}@example.com`,
              password,
              role: "OWNER",
            },
          },
        },
        include: { users: true },
      }),
    ]);

    companyAId = companyA.id;
    companyBId = companyB.id;
    userAId = companyA.users[0]!.id;
    userBId = companyB.users[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 60_000);

  it("1. creates company and user", async () => {
    expect(companyAId).toBeTruthy();
    expect(userAId).toBeTruthy();
  });

  it("2. treats auth as JWT-only without session table", async () => {
    const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%session%'`,
    );
    expect(tables).toEqual([]);
  });

  it("3. creates customer scoped to company", async () => {
    const customer = await prisma.customer.create({
      data: {
        companyId: companyAId,
        phone: `+1555${suffix.slice(-7)}`,
        fullName: "Schema Customer",
      },
    });
    customerAId = customer.id;
    expect(customer.companyId).toBe(companyAId);
  });

  it("4. rejects duplicate customer phone within company", async () => {
    const phone = `+1666${suffix.slice(-7)}`;
    await prisma.customer.create({
      data: { companyId: companyAId, phone, fullName: "First" },
    });
    await expect(
      prisma.customer.create({
        data: { companyId: companyAId, phone, fullName: "Second" },
      }),
    ).rejects.toThrow();
  });

  it("5. allows same phone across companies", async () => {
    const phone = `+1777${suffix.slice(-7)}`;
    const [a, b] = await Promise.all([
      prisma.customer.create({ data: { companyId: companyAId, phone } }),
      prisma.customer.create({ data: { companyId: companyBId, phone } }),
    ]);
    expect(a.phone).toBe(b.phone);
  });

  it("5b. enforces unique Twilio routing key across companies", async () => {
    const routingKey = `+15716${suffix.slice(-6)}`;
    await prisma.channelEndpoint.create({
      data: {
        companyId: companyAId,
        channel: "VOICE",
        provider: "TWILIO",
        routingKey,
        status: "ACTIVE",
      },
    });
    await expect(
      prisma.channelEndpoint.create({
        data: {
          companyId: companyBId,
          channel: "VOICE",
          provider: "TWILIO",
          routingKey,
          status: "ACTIVE",
        },
      }),
    ).rejects.toThrow();
  });

  it("6. creates conversation and message", async () => {
    const conversation = await prisma.conversation.create({
      data: {
        companyId: companyAId,
        customerId: customerAId,
        channel: "AI_CALL",
        messages: {
          create: {
            senderType: "CUSTOMER",
            body: "Hello",
          },
        },
      },
      include: { messages: true },
    });
    conversationAId = conversation.id;
    expect(conversation.messages).toHaveLength(1);
  });

  it("7. creates inbound call", async () => {
    const call = await prisma.call.create({
      data: {
        conversationId: conversationAId,
        phone: `+1555${suffix.slice(-7)}`,
        direction: "INBOUND",
        status: "COMPLETED",
      },
    });
    callAId = call.id;
    expect(call.direction).toBe("INBOUND");
  });

  it("8. creates outbound call", async () => {
    const call = await prisma.call.create({
      data: {
        conversationId: conversationAId,
        phone: `+1888${suffix.slice(-7)}`,
        direction: "OUTBOUND",
        status: "COMPLETED",
      },
    });
    expect(call.direction).toBe("OUTBOUND");
  });

  it("9. enforces Twilio SID uniqueness via providerCallId", async () => {
    const sid = `CA${suffix}`;
    await prisma.call.update({
      where: { id: callAId },
      data: { providerCallId: sid, twilioCallSid: sid },
    });
    await expect(
      prisma.call.create({
        data: {
          conversationId: conversationAId,
          phone: "+10000000001",
          providerCallId: sid,
        },
      }),
    ).rejects.toThrow();
  });

  it("10. enforces Hume chat ID uniqueness", async () => {
    const chatId = `chat-${suffix}`;
    await prisma.call.update({
      where: { id: callAId },
      data: { humeChatId: chatId },
    });
    await expect(
      prisma.call.create({
        data: {
          conversationId: conversationAId,
          phone: "+10000000002",
          humeChatId: chatId,
        },
      }),
    ).rejects.toThrow();
  });

  it("11. enforces Hume webhook idempotency", async () => {
    const key = `wh-${suffix}`;
    await prisma.humeWebhookReceipt.create({
      data: { idempotencyKey: key, eventType: "chat_started", chatId: "c1" },
    });
    await expect(
      prisma.humeWebhookReceipt.create({
        data: { idempotencyKey: key, eventType: "chat_started", chatId: "c2" },
      }),
    ).rejects.toThrow();
  });

  it("12. enforces Hume tool-call idempotency", async () => {
    const toolCallId = `tool-${suffix}`;
    await prisma.humeToolCallReceipt.create({
      data: {
        toolCallId,
        chatId: "chat-tool",
        callId: callAId,
        companyId: companyAId,
        toolName: "airadesk_schedule_meeting",
        status: "COMPLETED",
      },
    });
    await expect(
      prisma.humeToolCallReceipt.create({
        data: {
          toolCallId,
          chatId: "chat-tool",
          callId: callAId,
          companyId: companyAId,
          toolName: "airadesk_schedule_meeting",
          status: "COMPLETED",
        },
      }),
    ).rejects.toThrow();
  });

  it("13-14. supports Hume sync job lifecycle and expression analysis", async () => {
    const job = await prisma.humeChatSyncJob.create({
      data: {
        callId: callAId,
        chatId: `sync-${suffix}`,
        companyId: companyAId,
        status: "PENDING",
      },
    });
    const updated = await prisma.humeChatSyncJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    expect(updated.status).toBe("COMPLETED");

    const expression = await prisma.humeExpressionAnalysis.create({
      data: {
        callId: callAId,
        companyId: companyAId,
        chatId: `sync-${suffix}`,
        status: "COMPLETED",
        userTurnCount: 2,
        topExpressions: [{ name: "Interest", score: 0.8 }],
      },
    });
    expect(expression.callId).toBe(callAId);
  });

  it("15. keeps business intent separate from Hume expression scores", async () => {
    const analysis = await prisma.callPostAnalysis.create({
      data: {
        companyId: companyAId,
        callId: callAId,
        status: "COMPLETED",
        intentLevel: "HIGH",
        intentScore: 82,
      },
    });
    const expression = await prisma.humeExpressionAnalysis.findUnique({
      where: { callId: callAId },
    });
    expect(analysis.intentScore).toBe(82);
    expect(expression?.topExpressions).not.toEqual(analysis.intentScore);
  });

  it("16. supports call finalization idempotency via unique call analysis", async () => {
    await expect(
      prisma.callPostAnalysis.create({
        data: {
          companyId: companyAId,
          callId: callAId,
          status: "PENDING",
        },
      }),
    ).rejects.toThrow();
  });

  it("17-26. supports booking/meeting lifecycle", async () => {
    const booking = await prisma.booking.create({
      data: {
        companyId: companyAId,
        customerId: customerAId,
        conversationId: conversationAId,
        callId: callAId,
        title: "Schema Meeting",
        assignedUserId: userAId,
        acceptanceStatus: "PENDING_ACCEPTANCE",
        proposalSent: false,
        outcome: "PENDING",
        nextAction: "Confirm slot",
      },
    });

    expect(booking.acceptanceStatus).toBe("PENDING_ACCEPTANCE");

    const accepted = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        acceptanceStatus: "ACCEPTED",
        acceptedAt: new Date(),
        acceptedByUserId: userAId,
      },
    });
    expect(accepted.acceptanceStatus).toBe("ACCEPTED");

    const reassigned = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        assignedUserId: userBId,
        acceptanceStatus: "PENDING_ACCEPTANCE",
        acceptedAt: null,
        acceptedByUserId: null,
      },
    });
    expect(reassigned.acceptanceStatus).toBe("PENDING_ACCEPTANCE");

    const otherCompanyAccept = prisma.booking.updateMany({
      where: { id: booking.id, companyId: companyBId },
      data: { acceptanceStatus: "ACCEPTED" },
    });
    await expect(otherCompanyAccept).resolves.toMatchObject({ count: 0 });

    const withNotes = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        notes: "Customer confirmed requirements",
        proposalSent: true,
        proposalSentAt: new Date(),
        outcome: "WON",
        nextAction: "Send contract",
      },
    });
    expect(withNotes.proposalSent).toBe(true);
    expect(withNotes.outcome).toBe("WON");
  });

  it("27. supports task assignment", async () => {
    const task = await prisma.task.create({
      data: {
        companyId: companyAId,
        customerId: customerAId,
        conversationId: conversationAId,
        assignedUserId: userAId,
        title: "Follow up",
        status: "OPEN",
      },
    });
    expect(task.assignedUserId).toBe(userAId);
  });

  it("27b. supports unique post-meeting termination intent per call", async () => {
    const booking = await prisma.booking.findFirst({
      where: { callId: callAId, companyId: companyAId },
      orderBy: { createdAt: "desc" },
    });
    expect(booking).toBeTruthy();
    await prisma.callTerminationIntent.create({
      data: {
        callId: callAId,
        bookingId: booking!.id,
        toolCallId: `tool-term-${suffix}`,
        reason: "MEETING_SCHEDULED",
        source: "HUME_MEETING_TOOL",
        state: "ARMED",
        graceDeadlineAt: new Date(Date.now() + 10_000),
      },
    });
    await expect(
      prisma.callTerminationIntent.create({
        data: {
          callId: callAId,
          bookingId: booking!.id,
          toolCallId: `tool-term-dup-${suffix}`,
          reason: "MEETING_SCHEDULED",
          source: "HUME_MEETING_TOOL",
          state: "ARMED",
          graceDeadlineAt: new Date(Date.now() + 10_000),
        },
      }),
    ).rejects.toThrow();
  });

  it("28. supports outbound message queue", async () => {
    const message = await prisma.outboundMessage.create({
      data: {
        companyId: companyAId,
        channel: "WHATSAPP",
        toPhone: "+19990001111",
        body: "Queued message",
        status: "PENDING",
      },
    });
    expect(message.status).toBe("PENDING");
  });

  it("29-30. supports Twilio and Hume recording metadata", async () => {
    const call = await prisma.call.update({
      where: { id: callAId },
      data: {
        recordingSid: `RE${suffix}`,
        recordingUrl: "https://api.twilio.com/recording/example",
        recordingSource: "TWILIO",
        recordingReconstructionStatus: "COMPLETE",
      },
    });
    expect(call.recordingSource).toBe("TWILIO");
    expect(call.recordingReconstructionStatus).toBe("COMPLETE");
  });

  it("31. supports calls-section projection fields", async () => {
    const call = await prisma.call.findUnique({
      where: { id: callAId },
      include: {
        postAnalysis: true,
        conversation: { include: { customer: true } },
        bookings: true,
      },
    });
    expect(call?.conversation.aiSummary).toBeDefined();
    expect(call?.postAnalysis?.requirementSummary).toBeDefined();
    expect(call?.bookings.length).toBeGreaterThan(0);
  });

  it("32. enforces tenant isolation", async () => {
    const foreign = await prisma.customer.findFirst({
      where: { id: customerAId, companyId: companyBId },
    });
    expect(foreign).toBeNull();
  });
});
