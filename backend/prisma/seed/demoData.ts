import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { prisma } from "../../src/db/prisma";

/**
 * Optional generic demo seed — industry-neutral, no vertical-specific scenarios.
 * Prefer registering a fresh company from the app when testing.
 */
async function main() {
  const email = "demo@airadesk.com";
  const hashedPassword = await bcrypt.hash("123456", 10);

  let user = await prisma.user.findUnique({
    where: { email },
    include: { company: true },
  });

  if (!user) {
    const company = await prisma.company.create({
      data: {
        name: "Demo Company",
        industry: "OTHER",
        users: {
          create: {
            name: "Demo Owner",
            email,
            password: hashedPassword,
            role: "OWNER",
          },
        },
      },
      include: { users: true },
    });

    user = {
      ...company.users[0],
      company,
    };
  }

  const companyId = user.companyId;

  await prisma.outboundMessage.deleteMany({ where: { companyId } });
  await prisma.message.deleteMany({
    where: { conversation: { companyId } },
  });
  await prisma.call.deleteMany({
    where: { conversation: { companyId } },
  });
  await prisma.task.deleteMany({ where: { companyId } });
  await prisma.booking.deleteMany({ where: { companyId } });
  await prisma.conversation.deleteMany({ where: { companyId } });
  await prisma.customer.deleteMany({ where: { companyId } });
  await prisma.aiAgent.deleteMany({ where: { companyId } });

  await prisma.companySettings.upsert({
    where: { companyId },
    create: {
      companyId,
      businessHours: "Mon-Fri, 9 AM - 6 PM",
      whatsappNumber: "",
      callForwardingNumber: "",
      escalationPhone: "",
      handoverRules:
        "Transfer angry customers, payment disputes, and low-confidence conversations to staff.",
      aiTone: "Professional, calm and helpful.",
    },
    update: {
      businessHours: "Mon-Fri, 9 AM - 6 PM",
      whatsappNumber: "",
      callForwardingNumber: "",
      escalationPhone: "",
      handoverRules:
        "Transfer angry customers, payment disputes, and low-confidence conversations to staff.",
      aiTone: "Professional, calm and helpful.",
    },
  });

  await prisma.company.update({
    where: { id: companyId },
    data: {
      name: "Demo Company",
      industry: "OTHER",
    },
  });

  await prisma.aiAgent.createMany({
    data: [
      {
        companyId,
        name: "Call Agent",
        status: "LIVE",
        channel: "AI_CALL",
        language: "en",
        instructions: "Handle inbound calls, qualify enquiries, and escalate when needed.",
      },
      {
        companyId,
        name: "WhatsApp Agent",
        status: "LIVE",
        channel: "WHATSAPP",
        language: "en",
        instructions: "Handle WhatsApp enquiries, follow-ups, and booking requests.",
      },
      {
        companyId,
        name: "Website Chat Agent",
        status: "TESTING",
        channel: "WEBSITE_CHAT",
        language: "en",
        instructions: "Answer website visitor questions and qualify leads.",
      },
    ],
  });

  console.log("Generic demo company ready (no sample conversations).");
  console.log(`Login email: ${email}`);
  console.log("Login password: 123456");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
