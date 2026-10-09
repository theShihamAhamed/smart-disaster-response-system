import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifySeed } from "./verify-seed-core.js";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  try {
    const checks = await verifySeed(prisma);
    console.log(`Seed verification passed: ${JSON.stringify(checks)}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
