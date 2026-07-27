import "dotenv/config";
import { prisma } from "../src/db/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const calls = await prisma.call.findMany({
    where: {
      telephonyProvider: null,
      OR: [{ twilioCallSid: { not: null } }, { providerCallId: { not: null } }, { provider: "twilio" }],
    },
    select: { id: true },
    take: 2000,
  });

  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, rowsWouldUpdate: calls.length }, null, 2));
    return;
  }

  const ids = calls.map((c) => c.id);
  const updated = ids.length
    ? await prisma.call.updateMany({
        where: { id: { in: ids } },
        data: {
          telephonyProvider: "TWILIO",
          voiceAgentProvider: "UNKNOWN",
        },
      })
    : { count: 0 };

  console.log(JSON.stringify({ dryRun: false, updated: updated.count }, null, 2));
}

void main().finally(async () => {
  await prisma.$disconnect();
});
