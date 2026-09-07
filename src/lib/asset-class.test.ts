import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { AssetClass, AssetStatus } from "@prisma/client";
import {
  ASSET_CLASSES, ASSIGN_TARGETS, ASSIGNABLE_FROM, CLASS_EXAMPLE, CLASS_LABEL, CLASS_PHRASE, CREATABLE_BY_CLASS,
  DEFAULT_ASSIGN_STATUS, DEFAULT_STATUS, HOLDER_STATUSES, RETURN_TARGETS, STATUSES_BY_CLASS,
  MANAGEABLE_CLASSES, REGISTRABLE_CLASSES, VISIBLE_CLASSES,
  canManageClass, canEditAsset, canRegisterClass, canSeeClass, isAwaitingItCheck, isStatusOf, parseCls, statusesFor, visibleClassWhere, withClsQS,
} from "./asset-class";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("STATUSES_BY_CLASS — a partition of the enum", () => {
  it("the two sets are disjoint", () => {
    const it = new Set<string>(STATUSES_BY_CLASS.IT);
    for (const s of STATUSES_BY_CLASS.PURCHASING) expect(it.has(s), s).toBe(false);
  });
  it("their union is EVERY AssetStatus value — a new status must be placed in a class or this fails", () => {
    const union = sorted([...STATUSES_BY_CLASS.IT, ...STATUSES_BY_CLASS.PURCHASING]);
    expect(union).toEqual(sorted(Object.values(AssetStatus)));
  });
  it("IT keeps exactly the original eight, in the original order", () => {
    expect([...STATUSES_BY_CLASS.IT]).toEqual([
      "DEPLOYED", "SPARE", "DEFECTIVE", "DONATED", "TEMPORARY", "BUYOUT", "DISPOSE", "MISSING",
    ]);
  });
  it("Purchasing has exactly the six the user chose", () => {
    expect([...STATUSES_BY_CLASS.PURCHASING]).toEqual([
      "OPERATIONAL", "STORED", "REPAIRING", "RETIRED", "SOLD", "LOST",
    ]);
  });
  it("ASSET_CLASSES is every AssetClass value, IT first", () => {
    expect(sorted([...ASSET_CLASSES])).toEqual(sorted(Object.values(AssetClass)));
    expect(ASSET_CLASSES[0]).toBe("IT"); // the default class -- see the comment on the constant
  });
});

describe("CLASS_PHRASE — the labels, with their article, said out loud", () => {
  it("every phrase ends with its label, and the article is \"an\" exactly when the label starts with a vowel sound", () => {
    for (const cls of ASSET_CLASSES) expect(CLASS_PHRASE[cls].endsWith(CLASS_LABEL[cls])).toBe(true);
    expect(CLASS_PHRASE.IT).toBe("an IT"); // "IT" is said like the letters I-T -- a vowel sound
    expect(CLASS_PHRASE.PURCHASING).toBe("a Purchasing");
  });
});

describe("CLASS_EXAMPLE — form placeholder copy, one per class", () => {
  it("every class has an example, the prefix hint carries a two-letter token, and IT ≠ Purchasing copy", () => {
    for (const cls of ASSET_CLASSES) {
      expect(CLASS_EXAMPLE[cls].model.length).toBeGreaterThan(0);
      expect(CLASS_EXAMPLE[cls].prefixHint).toMatch(/\b[A-Z]{2}\b/);
      // The example tag must itself be a valid tag, or the placeholder teaches a wrong shape.
      expect(CLASS_EXAMPLE[cls].tag).toMatch(/^BR-[A-Z]{2}-\d{4}$/);
    }
    // The tag's prefix is the class's own — a laptop tag on the car form is the defect this exists for (D-15).
    expect(CLASS_EXAMPLE.IT.tag).toMatch(/^BR-LT-/);
    expect(CLASS_EXAMPLE.PURCHASING.tag).toMatch(/^BR-VH-/);
    // A copy-paste of one class's example into the other must fail.
    expect(CLASS_EXAMPLE.IT.model).toMatch(/ThinkPad/);
    expect(CLASS_EXAMPLE.PURCHASING.model).not.toMatch(/ThinkPad/);
    // The two-letter token is shape-checked above; pin its actual content too,
    // so swapping the two hints (both still match \b[A-Z]{2}\b) still fails.
    expect(CLASS_EXAMPLE.IT.prefixHint).toMatch(/\bLT\b/);
    expect(CLASS_EXAMPLE.PURCHASING.prefixHint).not.toMatch(/\bLT\b/);
  });
});

describe("the derived sets stay inside their class", () => {
  for (const cls of ASSET_CLASSES) {
    const set = new Set<string>(STATUSES_BY_CLASS[cls]);
    it(`${cls}: defaults, assign, return, creatable and holder statuses are all members`, () => {
      expect(set.has(DEFAULT_STATUS[cls])).toBe(true);
      expect(set.has(DEFAULT_ASSIGN_STATUS[cls])).toBe(true);
      expect(set.has(ASSIGNABLE_FROM[cls])).toBe(true);
      for (const s of ASSIGN_TARGETS[cls]) expect(set.has(s), s).toBe(true);
      for (const s of RETURN_TARGETS[cls]) expect(set.has(s), s).toBe(true);
      for (const s of CREATABLE_BY_CLASS[cls]) expect(set.has(s), s).toBe(true);
      for (const s of HOLDER_STATUSES[cls]) expect(set.has(s), s).toBe(true);
    });
  }
  it("a return never lands on a holder status — that is what lifecycle.assign is for", () => {
    for (const cls of ASSET_CLASSES) {
      for (const s of RETURN_TARGETS[cls]) expect(HOLDER_STATUSES[cls]).not.toContain(s);
    }
  });
  it("Purchasing has no Buyout-shaped return: nobody buys out a company car through the leaver wizard", () => {
    expect(RETURN_TARGETS.PURCHASING).not.toContain("BUYOUT");
    expect(RETURN_TARGETS.PURCHASING).toEqual(["STORED", "REPAIRING", "LOST"]);
  });
  it("the assign default is an assign target -- the summary and the executor must agree", () => {
    for (const cls of ASSET_CLASSES) expect(ASSIGN_TARGETS[cls]).toContain(DEFAULT_ASSIGN_STATUS[cls]);
  });
  it("creatable = the default plus the assign targets -- exactly what creationPlan encodes", () => {
    for (const cls of ASSET_CLASSES) {
      expect(sorted(CREATABLE_BY_CLASS[cls])).toEqual(sorted([DEFAULT_STATUS[cls], ...ASSIGN_TARGETS[cls]]));
    }
  });
  it("the create default is never a holder status -- an asset is created with nobody holding it", () => {
    for (const cls of ASSET_CLASSES) expect(HOLDER_STATUSES[cls]).not.toContain(DEFAULT_STATUS[cls]);
  });
  it("HOLDER_STATUSES and ASSIGN_TARGETS coincide today -- when they diverge, delete this test, not the constant", () => {
    for (const cls of ASSET_CLASSES) expect(sorted(HOLDER_STATUSES[cls])).toEqual(sorted(ASSIGN_TARGETS[cls]));
  });
  it("ASSIGNABLE_FROM and DEFAULT_STATUS coincide today -- when they diverge, delete this test, not the constant", () => {
    for (const cls of ASSET_CLASSES) expect(ASSIGNABLE_FROM[cls]).toBe(DEFAULT_STATUS[cls]);
  });
});

describe("statusesFor / isStatusOf", () => {
  it("answer by class", () => {
    expect(statusesFor("PURCHASING")).toEqual(STATUSES_BY_CLASS.PURCHASING);
    expect(isStatusOf("PURCHASING", "STORED")).toBe(true);
    expect(isStatusOf("PURCHASING", "SPARE")).toBe(false);
    expect(isStatusOf("IT", "SPARE")).toBe(true);
    expect(isStatusOf("IT", "STORED")).toBe(false);
    expect(isStatusOf("IT", "BANANAS")).toBe(false);
  });
});

describe("MANAGEABLE_CLASSES / canManageClass — each class is its own department's", () => {
  it.each<[Parameters<typeof canManageClass>[0], AssetClass, boolean]>([
    ["admin", "IT", true], ["admin", "PURCHASING", true],
    ["it_staff", "IT", true], ["it_staff", "PURCHASING", false],
    ["purchasing_staff", "PURCHASING", true], ["purchasing_staff", "IT", false],
    ["finance_staff", "IT", false], ["finance_staff", "PURCHASING", false],
    ["viewer", "IT", false], ["viewer", "PURCHASING", false],
  ])("%s on %s → %s", (role, cls, ok) => {
    expect(canManageClass(role, cls)).toBe(ok);
  });
});

describe("parseCls / withClsQS — the ?cls= nav parameter", () => {
  it("parses the two classes and nothing else", () => {
    expect(parseCls("IT")).toBe("IT");
    expect(parseCls("PURCHASING")).toBe("PURCHASING");
    expect(parseCls("purchasing")).toBeNull(); // case-sensitive like every enum here
    expect(parseCls("OFFICE")).toBeNull();
    expect(parseCls(null)).toBeNull();
    expect(parseCls(undefined)).toBeNull();
  });
  it("IT is the default and is never written into a URL; only PURCHASING is", () => {
    expect(withClsQS("", "IT")).toBe("");
    expect(withClsQS("?q=x", "IT")).toBe("?q=x");
    expect(withClsQS("", "PURCHASING")).toBe("?cls=PURCHASING");
    expect(withClsQS("?q=x", "PURCHASING")).toBe("?q=x&cls=PURCHASING");
  });
});

describe("the trigger's literal lists are pinned to STATUSES_BY_CLASS", () => {
  // Same move as receiving.test.ts pinning MAX_TAG_NUMBER to TAG_SHAPE: the
  // status list exists twice — here and in plpgsql — and the two must move
  // together. This test reads the migration so a drift is a red test, not a
  // production error at the first write.
  // The LAST definition wins: migration 001 created the function and 002
  // replaced it (D-3), and CREATE OR REPLACE means the database runs whichever
  // came last. Pinning a fixed filename would pin a body the database no
  // longer executes -- a green test proving nothing (D-4).
  const migrationsDir = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
  const bodies = readdirSync(migrationsDir)
    .filter((d) => statSync(path.join(migrationsDir, d)).isDirectory())
    .sort()
    .map((d) => readFileSync(path.join(migrationsDir, d, "migration.sql"), "utf8"))
    .filter((sql) => sql.includes("CREATE OR REPLACE FUNCTION asset_class_invariants()"));
  if (bodies.length === 0) throw new Error("no migration defines asset_class_invariants()");
  const sql = bodies[bodies.length - 1];
  const listAfter = (cls: AssetClass): string[] => {
    const m = new RegExp(`NEW\\."cls" = '${cls}' AND NEW\\."status"(?:::text)? NOT IN\\s*\\(([^)]*)\\)`).exec(sql);
    if (!m) throw new Error(`trigger has no NOT IN list for ${cls}`);
    return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  };
  it("IT", () => expect(sorted(listAfter("IT"))).toEqual(sorted(STATUSES_BY_CLASS.IT)));
  it("PURCHASING", () => expect(sorted(listAfter("PURCHASING"))).toEqual(sorted(STATUSES_BY_CLASS.PURCHASING)));
});

describe("Phase 14 — the three maps", () => {
  it("VISIBLE: IT and the viewer see IT only; everyone else sees everything", () => {
    expect(VISIBLE_CLASSES.it_staff).toEqual(["IT"]);
    expect(VISIBLE_CLASSES.viewer).toEqual(["IT"]);
    for (const r of ["admin", "purchasing_staff", "finance_staff"] as Role[]) {
      expect(VISIBLE_CLASSES[r]).toEqual([...ASSET_CLASSES]);
    }
  });
  it("REGISTRABLE: Purchasing registers both, IT its own, Finance and viewer nothing", () => {
    expect(REGISTRABLE_CLASSES.purchasing_staff).toEqual(["IT", "PURCHASING"]);
    expect(REGISTRABLE_CLASSES.it_staff).toEqual(["IT"]);
    expect(REGISTRABLE_CLASSES.finance_staff).toEqual([]);
    expect(REGISTRABLE_CLASSES.viewer).toEqual([]);
  });
  it("MANAGEABLE ⊆ REGISTRABLE ⊆ VISIBLE for every role", () => {
    const ROLES: Role[] = ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"];
    for (const r of ROLES) {
      for (const c of MANAGEABLE_CLASSES[r]) expect(REGISTRABLE_CLASSES[r]).toContain(c);
      for (const c of REGISTRABLE_CLASSES[r]) expect(VISIBLE_CLASSES[r]).toContain(c);
    }
  });
  it("canSeeClass / canRegisterClass read the maps", () => {
    expect(canSeeClass("it_staff", "PURCHASING")).toBe(false);
    expect(canSeeClass("purchasing_staff", "IT")).toBe(true);
    expect(canRegisterClass("purchasing_staff", "IT")).toBe(true);
    expect(canRegisterClass("it_staff", "PURCHASING")).toBe(false);
    expect(canRegisterClass("finance_staff", "IT")).toBe(false);
  });
  it("visibleClassWhere is empty for an all-class role and an `in` list otherwise", () => {
    expect(visibleClassWhere("admin")).toEqual({});
    expect(visibleClassWhere("purchasing_staff")).toEqual({});
    expect(visibleClassWhere("finance_staff")).toEqual({});
    expect(visibleClassWhere("it_staff")).toEqual({ cls: { in: ["IT"] } });
    expect(visibleClassWhere("viewer")).toEqual({ cls: { in: ["IT"] } });
  });
});

describe("Phase 14 — the IT check", () => {
  const d = new Date();
  it("only an IT asset with no stamp is awaiting", () => {
    expect(isAwaitingItCheck({ cls: "IT", itVerifiedAt: null })).toBe(true);
    expect(isAwaitingItCheck({ cls: "IT", itVerifiedAt: d })).toBe(false);
    expect(isAwaitingItCheck({ cls: "PURCHASING", itVerifiedAt: null })).toBe(false);
    expect(isAwaitingItCheck({ cls: "PURCHASING", itVerifiedAt: d })).toBe(false);
  });
  const awaiting = { cls: "IT" as const, itVerifiedAt: null };
  const checked = { cls: "IT" as const, itVerifiedAt: d };
  const car = { cls: "PURCHASING" as const, itVerifiedAt: null };
  it.each([
    ["admin", true, true, true],
    ["it_staff", true, true, false],
    ["purchasing_staff", true, false, true],
    ["finance_staff", false, false, false],
    ["viewer", false, false, false],
  ] as Array<[Role, boolean, boolean, boolean]>)(
    "canEditAsset %s: awaiting IT %s · checked IT %s · car %s",
    (role, a, c, p) => {
      expect(canEditAsset(role, awaiting)).toBe(a);
      expect(canEditAsset(role, checked)).toBe(c);
      expect(canEditAsset(role, car)).toBe(p);
    },
  );
});
