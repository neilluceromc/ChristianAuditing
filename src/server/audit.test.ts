import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "./audit";

function fakeTx() {
  const create = vi.fn(async () => ({}));
  return { tx: { auditEntry: { create } } as unknown as Prisma.TransactionClient, create };
}

const base = { actorId: "u1", actorLabel: "Ana", entityType: "asset", entityId: "a1", action: "note.posted" };

describe("writeAudit", () => {
  it("stores source and reason when given", async () => {
    const { tx, create } = fakeTx();
    await writeAudit(tx, { ...base, source: "web", reason: "Receipt attached" });
    expect(create).toHaveBeenCalledTimes(1);
    const [arg] = create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    const { data } = arg;
    expect(data.source).toBe("web");
    expect(data.reason).toBe("Receipt attached");
  });

  it("leaves source and reason null/absent when not given (existing callers unchanged)", async () => {
    const { tx, create } = fakeTx();
    await writeAudit(tx, base);
    const [arg] = create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }];
    const { data } = arg;
    expect(data.source ?? null).toBeNull();
    expect(data.reason ?? null).toBeNull();
    expect(data.diff).toBeUndefined();
  });
});
