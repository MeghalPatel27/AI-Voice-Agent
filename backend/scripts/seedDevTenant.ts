import "dotenv/config";
import * as bcrypt from "bcryptjs";
import { prisma } from "../src/db/prisma";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed in production");
  }

  const email = process.env.DEV_ADMIN_EMAIL?.trim();
  const password = process.env.DEV_ADMIN_PASSWORD;
  const companyName = process.env.DEV_COMPANY_NAME?.trim();

  if (!email || !password || !companyName) {
    throw new Error(
      "DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD, and DEV_COMPANY_NAME are required",
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(
      JSON.stringify({
        seeded: false,
        reason: "user_exists",
        companyIdSet: Boolean(process.env.VOICE_COMPANY_ID),
      }),
    );
    return;
  }

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

  console.log(
    JSON.stringify({
      seeded: true,
      companyCreated: true,
    }),
  );

  void company.id;
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
