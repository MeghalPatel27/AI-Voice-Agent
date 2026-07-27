import "dotenv/config";
import { prisma } from "../../src/db/prisma";

/**
 * Clears all tenant/demo data from the connected database.
 * Safe for local testing resets against Supabase or Postgres.
 */
async function main() {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
  });

  console.log(`Found ${companies.length} company(ies) to remove.`);

  // Cascade deletes related rows (users, conversations, settings, etc.)
  const result = await prisma.company.deleteMany({});

  console.log(`Deleted ${result.count} company(ies) and cascaded related data.`);
  console.log("Database is clear. Register a new account from the app to continue.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
