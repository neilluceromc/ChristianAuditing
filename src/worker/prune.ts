import { prisma } from "../server/db/client";
import { pruneRetention } from "./retention";
import { RETENTION_DAYS } from "../lib/retention";

pruneRetention()
  .then((r) => console.log(`[prune] removed ${r.deliveries} deliveries and ${r.jobs} jobs older than ${RETENTION_DAYS} days`))
  .catch((err) => { console.error(`[prune] failed: ${err instanceof Error ? err.message : String(err)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
