import { describe, expect, it } from "vitest";
import { isFullyReceived, nextTags, outstanding, preferredPrefix } from "./receiving";
import { TAG_SHAPE } from "./tag-key";

describe("outstanding", () => {
  it("is what is left to receive", () => {
    expect(outstanding({ unitId: "u", ordered: 8, received: 0 })).toBe(8);
    expect(outstanding({ unitId: "u", ordered: 8, received: 5 })).toBe(3);
    expect(outstanding({ unitId: "u", ordered: 8, received: 8 })).toBe(0);
  });

  // Over-receipt should not produce a NEGATIVE outstanding that a caller then
  // renders as "-2 remaining" or uses to size an array.
  it("floors at zero when more arrived than was ordered", () => {
    expect(outstanding({ unitId: "u", ordered: 2, received: 5 })).toBe(0);
  });
});

describe("isFullyReceived", () => {
  it("is true at and beyond the ordered quantity", () => {
    expect(isFullyReceived({ unitId: "u", ordered: 2, received: 1 })).toBe(false);
    expect(isFullyReceived({ unitId: "u", ordered: 2, received: 2 })).toBe(true);
    expect(isFullyReceived({ unitId: "u", ordered: 2, received: 3 })).toBe(true);
  });

  // A zero-quantity unit is vacuously complete — it must not present a
  // Receive action forever.
  it("treats a zero-quantity unit as complete", () => {
    expect(isFullyReceived({ unitId: "u", ordered: 0, received: 0 })).toBe(true);
  });
});

describe("nextTags", () => {
  it("runs on from the highest existing number", () => {
    const r = nextTags("LT", 210, 3);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tags).toEqual(["BR-LT-0211", "BR-LT-0212", "BR-LT-0213"]);
  });

  // A prefix with no assets yet must start somewhere sane, not at NaN.
  it("starts at 0001 for a prefix that has never been used", () => {
    const r = nextTags("ZZ", null, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tags).toEqual(["BR-ZZ-0001", "BR-ZZ-0002"]);
  });

  it("pads every tag to the shape the rest of the app validates", () => {
    const r = nextTags("MN", 8, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const t of r.tags) expect(TAG_SHAPE.test(t), t).toBe(true);
  });

  // THE boundary. Four digits means 9999 is the last legal tag, and a run that
  // crosses it must refuse where the number is minted — not produce
  // "BR-LT-10000" for TAG_SHAPE to reject three layers later.
  it("fills the last legal number exactly", () => {
    expect(nextTags("LT", 9998, 1)).toEqual({ ok: true, tags: ["BR-LT-9999"] });
  });

  // BOTH cases are load-bearing and neither is redundant.
  //
  // `9999, 1` catches a missing bound: a generator with no ceiling at all
  // mints BR-LT-10000 from the very first tag.
  //
  // `9998, 3` catches the OFF-BY-ONE: a bound written `start > MAX` instead of
  // `start + count - 1 > MAX` passes for a single tag (where the two
  // expressions are equal) and then happily mints BR-LT-10000 and BR-LT-10001
  // partway through a run. Verified by mutation: that change fails THIS
  // assertion and no other test in the file.
  //
  // Do not collapse these into one case. The count > 1 case is the only thing
  // covering the off-by-one, and the pinning test below cannot cover it —
  // at count 1 the buggy and correct expressions agree.
  it("refuses rather than wrapping past the four-digit ceiling", () => {
    expect(nextTags("LT", 9999, 1)).toEqual({ ok: false, reason: "overflow" });
    expect(nextTags("LT", 9998, 3)).toEqual({ ok: false, reason: "overflow" });
  });

  it("refuses a malformed prefix", () => {
    expect(nextTags("lt", 1, 1)).toEqual({ ok: false, reason: "bad-prefix" });
    expect(nextTags("L", 1, 1)).toEqual({ ok: false, reason: "bad-prefix" });
    expect(nextTags("LTX", 1, 1)).toEqual({ ok: false, reason: "bad-prefix" });
    expect(nextTags("L1", 1, 1)).toEqual({ ok: false, reason: "bad-prefix" });
  });

  it("refuses a count that cannot produce a run", () => {
    expect(nextTags("LT", 1, 0)).toEqual({ ok: false, reason: "bad-count" });
    expect(nextTags("LT", 1, -1)).toEqual({ ok: false, reason: "bad-count" });
    expect(nextTags("LT", 1, 1.5)).toEqual({ ok: false, reason: "bad-count" });
  });

  // MAX_TAG_NUMBER (9999) and TAG_SHAPE's \d{4} encode the same limit in two
  // different forms, in two different files. Nothing but this test stops them
  // drifting: widen the regex to five digits and the generator silently keeps
  // refusing at 9999; narrow it to three and the generator happily mints tags
  // the rest of the app rejects. Both directions are caught here.
  it("keeps the four-digit ceiling in step with the tag shape itself", () => {
    const last = nextTags("LT", 9998, 1);
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    // The highest number the generator will mint must be a legal tag...
    expect(TAG_SHAPE.test(last.tags[0])).toBe(true);
    expect(last.tags[0]).toBe("BR-LT-9999");
    // ...and one past it must not be, which is WHY the generator refuses there.
    expect(TAG_SHAPE.test("BR-LT-10000")).toBe(false);
  });
});

describe("preferredPrefix", () => {
  it("picks the most-used prefix", () => {
    expect(preferredPrefix([{ prefix: "LT", n: 12 }, { prefix: "MN", n: 4 }])).toBe("LT");
  });

  // Deterministic on a tie, so the form does not offer a different default on
  // each render for the same data.
  it("breaks a tie alphabetically rather than by input order", () => {
    expect(preferredPrefix([{ prefix: "MN", n: 3 }, { prefix: "DK", n: 3 }])).toBe("DK");
  });

  it("has no opinion when there is nothing to learn from", () => {
    expect(preferredPrefix([])).toBeNull();
  });
});
