import { prisma } from "../server/db/client";
import { pruneRetention } from "./retention";
import { CRIS_CONVERSATION_DAYS, CRIS_PENDING_DAYS, METRIC_SNAPSHOT_DAYS, RETENTION_DAYS } from "../lib/retention";

pruneRetention()
  .then((r) => {
    console.log(`[prune] removed ${r.deliveries} deliveries and ${r.jobs} jobs older than ${RETENTION_DAYS} days`);
    console.log(
      `[prune] removed ${r.crisConversations} Cris chats older than ${CRIS_CONVERSATION_DAYS} days ` +
        `and ${r.crisPending} Cris pending actions older than ${CRIS_PENDING_DAYS} day`,
    );
    console.log(`[prune] removed ${r.metricSnapshots} metric snapshots older than ${METRIC_SNAPSHOT_DAYS} days`);
  })
  .catch((err) => { console.error(`[prune] failed: ${err instanceof Error ? err.message : String(err)}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
