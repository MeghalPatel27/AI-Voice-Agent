import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/db/prisma";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to initialize tenant in production");
  }

  const email = process.env.DEV_ADMIN_EMAIL?.trim() || "dev-admin@airadesk.local";
  const password = process.env.DEV_ADMIN_PASSWORD || "DevAdmin!2026Reset";
  const companyName = process.env.DEV_COMPANY_NAME?.trim() || "AiraDesk Development";

  const existing = await prisma.user.findUnique({ where: { email } });
  let companyId = existing?.companyId;

  if (!existing) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const company = await prisma.company.create({
      data: {
        name: companyName,
        industry: "OTHER",
        users: {
          create: {
            name: "Development Admin",
            email,
            password: hashedPassword,
            role: "OWNER",
          },
        },
      },
    });
    companyId = company.id;
  }

  if (!companyId) {
    throw new Error("Failed to resolve company id");
  }

  const envPath = resolve(process.cwd(), ".env");
  const raw = readFileSync(envPath, "utf8");
  const updated = raw.includes("VOICE_COMPANY_ID=")
    ? raw.replace(/^VOICE_COMPANY_ID=.*$/m, `VOICE_COMPANY_ID="${companyId}"`)
    : `${raw.trim()}\nVOICE_COMPANY_ID="${companyId}"\n`;

  writeFileSync(envPath, updated.endsWith("\n") ? updated : `${updated}\n`, "utf8");

  const verified = await prisma.company.findUnique({ where: { id: companyId } });

  console.log(
    JSON.stringify({
      initialized: true,
      userCreated: !existing,
      voiceCompanyIdSet: Boolean(verified),
      companyExists: Boolean(verified),
    }),
  );
}

void main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
