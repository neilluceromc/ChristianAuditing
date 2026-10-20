import { describe, expect, it } from "vitest";
import {
  CRIS_CONVERSATION_DAYS, CRIS_PENDING_DAYS, METRIC_SNAPSHOT_DAYS, PRUNE_BATCH, PRUNE_INTERVAL_MS, RETENTION_DAYS,
  RETENTION_NOTE, crisConversationCutoff, crisPendingCutoff, metricSnapshotCutoff, pruneDue, retentionCutoff,
} from "./retention";

describe("retention", () => {
  it("constants", () => {
    expect(RETENTION_DAYS).toBe(90); expect(PRUNE_BATCH).toBe(1000); expect(PRUNE_INTERVAL_MS).toBe(3_600_000);
    expect(RETENTION_NOTE).toBe("Attempts older than 90 days are removed automatically.");
  });
  it("cutoff is exactly 90 days before now, across a month end", () => {
    expect(retentionCutoff(new Date("2026-10-05T10:00:00Z")).toISOString()).toBe("2026-07-07T10:00:00.000Z");
  });
  it("pruneDue: never pruned → due; 59 min → not due; 60 min → due", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    expect(pruneDue(null, now)).toBe(true);
    expect(pruneDue(new Date("2026-09-17T11:01:00Z"), now)).toBe(false);
    expect(pruneDue(new Date("2026-09-17T11:00:00Z"), now)).toBe(true);
  });
  it("Cris (spec §7): chats go after 30 days, pending actions after a day", () => {
    expect(CRIS_CONVERSATION_DAYS).toBe(30); expect(CRIS_PENDING_DAYS).toBe(1);
    const now = new Date("2026-10-17T10:00:00Z");
    expect(crisConversationCutoff(now).toISOString()).toBe("2026-09-17T10:00:00.000Z");
    expect(crisPendingCutoff(now).toISOString()).toBe("2026-10-16T10:00:00.000Z");
    // across a month end
    expect(crisConversationCutoff(new Date("2026-03-01T00:00:00Z")).toISOString()).toBe("2026-01-30T00:00:00.000Z");
  });
  it("MetricSnapshot (Phase 46 spec §2.3): rows older than 400 Manila days go", () => {
    expect(METRIC_SNAPSHOT_DAYS).toBe(400);
    // 2026-10-20 in Manila; the cutoff is that day's UTC-midnight date minus 400 days (a @db.Date compare)
    expect(metricSnapshotCutoff(new Date("2026-10-20T03:00:00Z")).toISOString()).toBe("2025-09-15T00:00:00.000Z");
    // 16:00Z is already the next Manila day
    expect(metricSnapshotCutoff(new Date("2026-10-20T16:00:00Z")).toISOString()).toBe("2025-09-16T00:00:00.000Z");
  });
});
