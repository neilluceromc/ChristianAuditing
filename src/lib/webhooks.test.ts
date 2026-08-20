import { describe, expect, it } from "vitest";
import {
  EVENT_LABELS, SIGNATURE_HEADER, WEBHOOK_EVENTS, deleteBlockedReason, deliveryStage, parseEvents,
  partitionEvents, webhookEnvelope,
} from "./webhooks";
import { MAX_JOB_ATTEMPTS } from "./jobs";
import { statusFamily } from "./status";

describe("WEBHOOK_EVENTS", () => {
  it("is the short, deliberate list from scope decision #9", () => {
    expect(WEBHOOK_EVENTS).toEqual([
      "approval.executed", "offboarding.completed", "purchase_request.completed",
    ]);
  });

  it("labels every event, so no checkbox renders a bare dotted key", () => {
    for (const event of WEBHOOK_EVENTS) expect(EVENT_LABELS[event]).toBeTruthy();
  });
});

describe("parseEvents", () => {
  it("keeps known events in WEBHOOK_EVENTS order, not input order", () => {
    expect(parseEvents(["offboarding.completed", "approval.executed"]))
      .toEqual(["approval.executed", "offboarding.completed"]);
  });

  it("drops unknown events rather than storing them", () => {
    expect(parseEvents(["approval.executed", "asset.deleted"])).toEqual(["approval.executed"]);
  });

  it("de-duplicates", () => {
    expect(parseEvents(["approval.executed", "approval.executed"])).toEqual(["approval.executed"]);
  });

  it("survives junk from the database column without throwing", () => {
    expect(parseEvents(null)).toEqual([]);
    expect(parseEvents("approval.executed")).toEqual([]);
    expect(parseEvents([1, 2, 3])).toEqual([]);
  });

  // parseEvents is partitionEvents().known, not an independent implementation
  // — vary partitionEvents (via its exported behaviour) and parseEvents must
  // move with it. Asserting agreement with a hand-copied expectation would
  // pass even if someone re-forked parseEvents into its own filter, so this
  // compares the two functions to each other on the same input instead.
  it("is derived from partitionEvents, not a parallel implementation", () => {
    const raw = ["purchase_request.completed", "asset.deleted", "approval.executed"];
    expect(parseEvents(raw)).toEqual(partitionEvents(raw).known);
  });
});

describe("partitionEvents", () => {
  it("keeps known events in WEBHOOK_EVENTS order", () => {
    expect(partitionEvents(["offboarding.completed", "approval.executed"]).known)
      .toEqual(["approval.executed", "offboarding.completed"]);
  });

  it("keeps unknown events in input order rather than dropping them", () => {
    expect(partitionEvents(["asset.deleted", "approval.executed", "widget.pinged"]).unknown)
      .toEqual(["asset.deleted", "widget.pinged"]);
  });

  it("de-duplicates the unknown side too", () => {
    expect(partitionEvents(["asset.deleted", "asset.deleted"]).unknown).toEqual(["asset.deleted"]);
  });

  it("returns empty arrays for junk from the database column", () => {
    expect(partitionEvents(null)).toEqual({ known: [], unknown: [] });
    expect(partitionEvents("approval.executed")).toEqual({ known: [], unknown: [] });
  });

  it("a name can only land on one side, never both", () => {
    const { known, unknown } = partitionEvents(["approval.executed", "asset.deleted"]);
    expect(known).toEqual(["approval.executed"]);
    expect(unknown).toEqual(["asset.deleted"]);
  });
});

describe("webhookEnvelope", () => {
  it("carries id, event, occurredAt and data — and nothing else", () => {
    const env = webhookEnvelope({
      id: "wd-1",
      event: "approval.executed",
      occurredAt: new Date("2026-08-19T02:00:00Z"),
      data: { refNo: "APR-2042" },
    });
    expect(Object.keys(env).sort()).toEqual(["data", "event", "id", "occurredAt"]);
    expect(env).toEqual({
      id: "wd-1",
      event: "approval.executed",
      occurredAt: "2026-08-19T02:00:00.000Z",
      data: { refNo: "APR-2042" },
    });
  });

  // Object.keys(...).sort() and toEqual are both order-blind: an
  // alphabetised return literal would pass both of the assertions above
  // while changing every byte the signature (src/server/webhooks/sign.ts)
  // covers. Pinning the exact serialized string is what catches that,
  // since scope decision #14 calls this envelope's shape stable.
  it("serializes to a pinned byte-exact string — key order is part of the contract", () => {
    const env = webhookEnvelope({
      id: "wd-1",
      event: "approval.executed",
      occurredAt: new Date("2026-08-19T02:00:00Z"),
      data: { refNo: "APR-2042" },
    });
    expect(JSON.stringify(env)).toBe(
      '{"id":"wd-1","event":"approval.executed","occurredAt":"2026-08-19T02:00:00.000Z","data":{"refNo":"APR-2042"}}',
    );
  });
});

describe("deliveryStage", () => {
  it("reads DELIVERED without a counter — the count stops mattering once it lands", () => {
    expect(deliveryStage("DELIVERED", 2, 5)).toBe("DELIVERED");
  });

  it("reads DEAD with the full ratio, which is the design's DEAD · 5/5", () => {
    expect(deliveryStage("DEAD", 5, 5)).toBe("DEAD · 5/5");
  });

  it("reads RETRYING with progress through the budget", () => {
    expect(deliveryStage("RETRYING", 2, 5)).toBe("RETRYING · 2/5");
  });

  it("reads a never-attempted row as QUEUED, not as 0/5", () => {
    expect(deliveryStage("PENDING", 0, 5)).toBe("QUEUED");
  });

  it("reads a re-queued row with its attempts so far", () => {
    expect(deliveryStage("PENDING", 1, 5)).toBe("QUEUED · 1/5");
  });

  // A status this build doesn't recognise must look unrecognised, not fall
  // into the PENDING branch and read as a healthy queue.
  it("passes an unrecognised status straight through rather than defaulting to QUEUED", () => {
    expect(deliveryStage("SOMETHING_NEW", 3, 5)).toBe("SOMETHING_NEW");
  });

  // The denominator defaults to the worker's real cap so a caller can't
  // silently supply a different number — this is what Important 3 in the
  // quality review was about: two literal 5s (worker + this module) meant
  // tuning one didn't tune the other, invisibly, with a green suite.
  it("defaults the denominator to MAX_JOB_ATTEMPTS when none is supplied", () => {
    expect(deliveryStage("DEAD", MAX_JOB_ATTEMPTS)).toBe(`DEAD · ${MAX_JOB_ATTEMPTS}/${MAX_JOB_ATTEMPTS}`);
  });
});

// `deliveryStage` returns a LABEL and nothing else. Colour is not its business:
// src/lib/status.ts owns "every enum value in the app maps into exactly one
// family; nothing gets a bespoke colour", and StatusPill derives the family from
// the raw status value. DeliveryStatus was simply the one app enum that map had
// never been taught — Step 3b fixes that, and these are the tests for it.
// (`statusFamily` needs the "delivery" namespace here — PENDING and RETRYING
// both live under "attention" in the flat map, which is exactly the collision
// src/lib/status.ts's delivery namespace exists to separate; its own test
// suite in src/lib/status.test.ts covers that in depth.)
describe("DeliveryStatus is in the six-family system", () => {
  it("colours a dead delivery as a fault and a landed one as settled", () => {
    expect(statusFamily("DELIVERED", "delivery")).toBe("settled");
    expect(statusFamily("DEAD", "delivery")).toBe("fault");
    expect(statusFamily("RETRYING", "delivery")).toBe("attention");
  });
});

// The refusal /admin/webhooks states BESIDE a disabled Delete and the one
// `deleteEndpoint` returns AFTER the click are the same string, from here.
// Two copies would drift the moment one was reworded, and the page's copy is
// the one an operator reads while deciding — §6a rules 5, 10 and 11.
describe("deleteBlockedReason", () => {
  // Null, not "" and not a sentence about being deletable: a caller renders
  // the refusal or the affordance, never both, and `if (blocked)` is how both
  // call sites branch. A truthy empty-ish return would put a blank
  // explanation next to a dead button.
  it("is null for an endpoint with no delivery history, so Delete stays live", () => {
    expect(deleteBlockedReason(0)).toBeNull();
    // Defensive: the count comes from a groupBy on one side and a COUNT(*) on
    // the other, so it can only ever be >= 0 — but a negative must not read
    // as "blocked".
    expect(deleteBlockedReason(-1)).toBeNull();
  });

  it("names the count, and singularises one attempt", () => {
    expect(deleteBlockedReason(1)).toContain("1 delivery attempt on record");
    expect(deleteBlockedReason(1)).not.toContain("attempts");
    expect(deleteBlockedReason(3)).toContain("3 delivery attempts on record");
  });

  // The point of the sentence is the ALTERNATIVE. Without it an admin reads
  // "you can't delete this" and has nothing to do next — disabling is the
  // safe direction and stays available in every case (§6a rule 14).
  it("points at disabling instead, so the refusal isn't a dead end", () => {
    expect(deleteBlockedReason(2)).toContain("Disable it instead");
  });

  // Textually disjoint from `deleteEndpoint`'s OTHER refusal — the P2003 race
  // message ("That endpoint just received a delivery — refresh; it can no
  // longer be deleted"). Two refusals a test can't tell apart is the §6a
  // rule 4 trap.
  it("does not read as the mid-click race refusal", () => {
    expect(deleteBlockedReason(2)).not.toContain("refresh");
  });
});

describe("SIGNATURE_HEADER", () => {
  // Pinned by a literal, like `secretAad` (§6a rule 34): the value is a
  // contract with receivers we cannot migrate, and a rename typechecks,
  // lints, and passes every property-shaped assertion while silently
  // breaking every receiver in existence. `src/server/webhooks/sign.test.ts`
  // pins it too, from the consumer side.
  it("is the exact header the worker sends and the admin page names", () => {
    expect(SIGNATURE_HEADER).toBe("x-backroom-signature");
  });
});
