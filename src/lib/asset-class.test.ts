import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AssetStatus, type AssetClass } from "@prisma/client";
import {
  ASSET_CLASSES, ASSIGN_TARGETS, CLASSES_FOR_ROLE, CREATABLE_BY_CLASS, DEFAULT_ASSIGN_STATUS,
  DEFAULT_STATUS, HOLDER_STATUSES, RETURN_TARGETS, STATUSES_BY_CLASS,
  canActOnClass, isStatusOf, parseCls, statusesFor, withClsQS,
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
});

describe("the derived sets stay inside their class", () => {
  for (const cls of ASSET_CLASSES) {
    const set = new Set<string>(STATUSES_BY_CLASS[cls]);
    it(`${cls}: defaults, assign, return, creatable and holder statuses are all members`, () => {
      expect(set.has(DEFAULT_STATUS[cls])).toBe(true);
      expect(set.has(DEFAULT_ASSIGN_STATUS[cls])).toBe(true);
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

describe("CLASSES_FOR_ROLE / canActOnClass — each class is its own department's", () => {
  it.each<[Parameters<typeof canActOnClass>[0], AssetClass, boolean]>([
    ["admin", "IT", true], ["admin", "PURCHASING", true],
    ["it_staff", "IT", true], ["it_staff", "PURCHASING", false],
    ["purchasing_staff", "PURCHASING", true], ["purchasing_staff", "IT", false],
    ["finance_staff", "IT", false], ["finance_staff", "PURCHASING", false],
    ["viewer", "IT", false], ["viewer", "PURCHASING", false],
  ])("%s on %s → %s", (role, cls, ok) => {
    expect(canActOnClass(role, cls)).toBe(ok);
    expect(CLASSES_FOR_ROLE[role].includes(cls)).toBe(ok);
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
  const migrationsDir = path.join(process.cwd(), "prisma/migrations");
  const bodies = readdirSync(migrationsDir)
    .filter((d) => statSync(path.join(migrationsDir, d)).isDirectory())
    .sort()
    .map((d) => readFileSync(path.join(migrationsDir, d, "migration.sql"), "utf8"))
    .filter((sql) => sql.includes("FUNCTION asset_class_invariants()"));
  if (bodies.length === 0) throw new Error("no migration defines asset_class_invariants()");
  const sql = bodies[bodies.length - 1];
  const listAfter = (cls: AssetClass): string[] => {
    const m = new RegExp(`NEW\\."cls" = '${cls}' AND NEW\\."status"::text NOT IN\\s*\\(([^)]*)\\)`).exec(sql);
    if (!m) throw new Error(`trigger has no NOT IN list for ${cls}`);
    return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
  };
  it("IT", () => expect(sorted(listAfter("IT"))).toEqual(sorted(STATUSES_BY_CLASS.IT)));
  it("PURCHASING", () => expect(sorted(listAfter("PURCHASING"))).toEqual(sorted(STATUSES_BY_CLASS.PURCHASING)));
});
