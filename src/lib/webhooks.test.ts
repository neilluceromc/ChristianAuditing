import { describe, expect, it } from "vitest";
import {
  EVENT_LABELS, WEBHOOK_EVENTS, deliveryStage, parseEvents, webhookEnvelope,
} from "./webhooks";
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
});

describe("webhookEnvelope", () => {
  it("carries id, event, occurredAt and data — and nothing else", () => {
    const env = webhookEnvelope("wd-1", "approval.executed", new Date("2026-08-19T02:00:00Z"), {
      refNo: "APR-2042",
    });
    expect(Object.keys(env).sort()).toEqual(["data", "event", "id", "occurredAt"]);
    expect(env).toEqual({
      id: "wd-1",
      event: "approval.executed",
      occurredAt: "2026-08-19T02:00:00.000Z",
      data: { refNo: "APR-2042" },
    });
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
});

// `deliveryStage` returns a LABEL and nothing else. Colour is not its business:
// src/lib/status.ts owns "every enum value in the app maps into exactly one
// family; nothing gets a bespoke colour", and StatusPill derives the family from
// the raw status value. DeliveryStatus was simply the one app enum that map had
// never been taught — Step 3b fixes that, and these are the tests for it.
describe("DeliveryStatus is in the six-family system", () => {
  it("colours a dead delivery as a fault and a landed one as settled", () => {
    expect(statusFamily("DELIVERED")).toBe("settled");
    expect(statusFamily("DEAD")).toBe("fault");
    expect(statusFamily("RETRYING")).toBe("attention");
  });
});
