import { prisma } from "../server/db/client";

const POLL_MS = 5000;

let shuttingDown = false;

async function tick() {
  // Phase 4 replaces this with FOR UPDATE SKIP LOCKED job claiming.
  const pending = await prisma.job.count({ where: { status: "PENDING" } });
  if (pending > 0) {
    console.log(`[worker] ${pending} pending job(s) — executors arrive in Phase 4`);
  }
}

async function main() {
  console.log("[worker] started (stub); polling every", POLL_MS, "ms");
  // Finish the current tick before exiting so a SIGTERM never tears down mid-write.
  process.on("SIGTERM", () => {
    shuttingDown = true;
  });
  process.on("SIGINT", () => {
    shuttingDown = true;
  });
  while (!shuttingDown) {
    try {
      await tick();
    } catch (err) {
      console.error("[worker] tick failed:", err);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await prisma.$disconnect();
  console.log("[worker] stopped cleanly");
}

main();
