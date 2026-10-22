import { describe, expect, it } from "vitest";
import type { AssetClass, Role } from "@prisma/client";
import {
  DEVICE_FIELDS, EDIT_REASON, MONEY_FIELDS, PO_MONEY_FIELDS, assetMoneyStage, canEditField, fieldOwner, isMoneyKey, poMoneyStage,
  reasonError, returnTeamFor, teamOfRole, type IntakeField, type IntakeStage,
} from "./intake-rules";
import { TOTAL_KEYS } from "./po-totals";

const CLASSES: AssetClass[] = ["IT", "PURCHASING"];

describe("teamOfRole", () => {
  it("maps the three team roles and nothing else", () => {
    expect(teamOfRole("it_staff")).toBe("IT");
    expect(teamOfRole("purchasing_staff")).toBe("PURCHASING");
    expect(teamOfRole("finance_staff")).toBe("FINANCE");
    expect(teamOfRole("admin")).toBeNull();
    expect(teamOfRole("viewer")).toBeNull();
  });
});

describe("fieldOwner", () => {
  it("serial follows the class", () => {
    expect(fieldOwner("serial", "PURCHASING")).toBe("PURCHASING");
    expect(fieldOwner("serial", "IT")).toBe("IT");
  });

  it("money fields and money documents are always Purchasing's", () => {
    for (const cls of CLASSES) {
      for (const f of MONEY_FIELDS) expect(fieldOwner(f, cls)).toBe("PURCHASING");
      for (const d of ["doc:invoice", "doc:official-receipt", "doc:delivery-receipt"] as const) {
        expect(fieldOwner(d, cls)).toBe("PURCHASING");
      }
    }
  });

  it("a PO's own money keys (PO number, paid by, each total, and the send-back's \"totals\") are Purchasing's money", () => {
    for (const cls of CLASSES) {
      for (const f of [...PO_MONEY_FIELDS, "totals"] as const) {
        expect(isMoneyKey(f)).toBe(true);
        expect(fieldOwner(f, cls)).toBe("PURCHASING");
      }
    }
    for (const f of DEVICE_FIELDS) expect(isMoneyKey(f)).toBe(false);
    expect(isMoneyKey("doc:warranty-slip")).toBe(false);
  });

  it("device fields and the warranty slip follow the class", () => {
    for (const f of DEVICE_FIELDS) {
      expect(fieldOwner(f, "IT")).toBe("IT");
      expect(fieldOwner(f, "PURCHASING")).toBe("PURCHASING");
    }
    expect(fieldOwner("doc:warranty-slip", "IT")).toBe("IT");
    expect(fieldOwner("doc:warranty-slip", "PURCHASING")).toBe("PURCHASING");
  });
});

describe("returnTeamFor", () => {
  it("an asset with a PO returns to the field's owner", () => {
    expect(returnTeamFor("invoiceRef", "IT", { hasPo: true, registeredByRole: "it_staff" })).toBe("PURCHASING");
    expect(returnTeamFor("serial", "IT", { hasPo: true, registeredByRole: "purchasing_staff" })).toBe("IT");
  });

  it("money with no PO returns to whoever registered the batch", () => {
    expect(returnTeamFor("invoiceRef", "IT", { hasPo: false, registeredByRole: "it_staff" })).toBe("IT");
    expect(returnTeamFor("invoiceRef", "PURCHASING", { hasPo: false, registeredByRole: "purchasing_staff" })).toBe("PURCHASING");
    expect(returnTeamFor("cost", "PURCHASING", { hasPo: false, registeredByRole: "it_staff" })).toBe("IT");
    expect(returnTeamFor("doc:invoice", "IT", { hasPo: false, registeredByRole: "purchasing_staff" })).toBe("PURCHASING");
    expect(returnTeamFor("doc:official-receipt", "IT", { hasPo: false, registeredByRole: "it_staff" })).toBe("IT");
  });

  it("money with no PO and an admin or unknown registrant goes to IT for IT gear, else Purchasing", () => {
    for (const registeredByRole of ["admin", null, "finance_staff"] as (Role | null)[]) {
      expect(returnTeamFor("cost", "IT", { hasPo: false, registeredByRole })).toBe("IT");
      expect(returnTeamFor("cost", "PURCHASING", { hasPo: false, registeredByRole })).toBe("PURCHASING");
    }
  });

  it("device fields never use the registrant, PO or not", () => {
    for (const registeredByRole of ["it_staff", "purchasing_staff", "admin", null] as (Role | null)[]) {
      expect(returnTeamFor("serial", "IT", { hasPo: false, registeredByRole })).toBe("IT");
      expect(returnTeamFor("serial", "PURCHASING", { hasPo: false, registeredByRole })).toBe("PURCHASING");
      expect(returnTeamFor("doc:warranty-slip", "IT", { hasPo: false, registeredByRole })).toBe("IT");
    }
  });
});

describe("reasonError", () => {
  it("bounds the trimmed text", () => {
    expect(EDIT_REASON).toEqual({ min: 5, max: 300 });
    expect(reasonError("abcd")).not.toBeNull();
    expect(reasonError("  abcd  ")).not.toBeNull();
    expect(reasonError(undefined)).not.toBeNull();
    expect(reasonError("")).not.toBeNull();
    expect(reasonError("abcde")).toBeNull();
    expect(reasonError("  fixed typo  ")).toBeNull();
    expect(reasonError("x".repeat(300))).toBeNull();
    expect(reasonError("x".repeat(301))).not.toBeNull();
  });
});

// The brief's table, as data. MoneyOk / DeviceOk cells: true = ok with no reason, "reason" = ok with a reason, false = refused.
type Cell = true | "reason" | false;
const MONEY_TABLE: { stage: IntakeStage; purchasing: Cell; it: Cell; finance: Cell; admin: Cell; why: Partial<Record<"purchasing" | "it" | "finance", string>> }[] = [
  { stage: "with-purchasing", purchasing: true, it: false, finance: false, admin: true, why: { it: "It's with Purchasing", finance: "It's with Purchasing" } },
  { stage: "with-it", purchasing: true, it: "reason", finance: false, admin: "reason", why: {} },
  {
    stage: "with-finance", purchasing: false, it: false, finance: "reason", admin: "reason",
    why: { purchasing: "It's with Finance; ask Finance to fix or send it back", it: "It's with Finance; ask Finance to fix or send it back" },
  },
  {
    stage: "approved", purchasing: false, it: false, finance: "reason", admin: "reason",
    why: { purchasing: "Approved: only Finance can change it", it: "Approved: only Finance can change it" },
  },
];
const ROLE_OF = { purchasing: "purchasing_staff", it: "it_staff", finance: "finance_staff", admin: "admin" } as const;

function expectCell(v: ReturnType<typeof canEditField>, cell: Cell, why?: string) {
  if (cell === false) {
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.why.length).toBeGreaterThan(0);
      if (why) expect(v.why).toBe(why);
    }
  } else {
    expect(v).toEqual({ ok: true, reasonRequired: cell === "reason" });
  }
}

describe("canEditField — money fields", () => {
  for (const cls of CLASSES) {
    for (const row of MONEY_TABLE) {
      for (const who of ["purchasing", "it", "finance", "admin"] as const) {
        it(`${cls} / ${row.stage} / ${who}`, () => {
          for (const f of MONEY_FIELDS) {
            expectCell(canEditField(ROLE_OF[who], f, cls, row.stage), row[who], who === "admin" ? undefined : row.why[who]);
          }
        });
      }
    }
  }
});

describe("PO_MONEY_FIELDS (migration 39)", () => {
  it("is the money fields plus PO number, paid by and the seven totals; MONEY_FIELDS is unchanged", () => {
    expect(MONEY_FIELDS).toEqual(["cost", "fees", "purchasedAt", "vendorId", "invoiceRef", "receiptRef"]);
    expect(PO_MONEY_FIELDS).toEqual([...MONEY_FIELDS, "poNumber", "paidBy", ...TOTAL_KEYS]);
  });

  it("Finance may fix a typed total with a reason while it's with Finance", () => {
    expect(canEditField("finance_staff", "totalAmountDue", "PURCHASING", "with-finance")).toEqual({ ok: true, reasonRequired: true });
  });

  it("Purchasing is refused the PO number once approved", () => {
    expect(canEditField("purchasing_staff", "poNumber", "PURCHASING", "approved")).toEqual({
      ok: false, why: "Approved: only Finance can change it",
    });
  });

  for (const cls of CLASSES) {
    for (const row of MONEY_TABLE) {
      for (const who of ["purchasing", "it", "finance", "admin"] as const) {
        it(`follows the money table: ${cls} / ${row.stage} / ${who}`, () => {
          for (const f of PO_MONEY_FIELDS) {
            expectCell(canEditField(ROLE_OF[who], f, cls, row.stage), row[who], who === "admin" ? undefined : row.why[who]);
          }
        });
      }
    }
  }
});

describe("canEditField — device fields", () => {
  const STAGES: IntakeStage[] = ["with-purchasing", "with-it", "with-finance", "approved"];
  for (const cls of CLASSES) {
    for (const stage of STAGES) {
      it(`${cls} / ${stage}`, () => {
        for (const f of DEVICE_FIELDS) {
          const owner = fieldOwner(f, cls);
          expectCell(canEditField("purchasing_staff", f, cls, stage), owner === "PURCHASING" ? true : false);
          expectCell(canEditField("it_staff", f, cls, stage), owner === "IT" ? true : false);
          expectCell(canEditField("admin", f, cls, stage), true);
          const fin = canEditField("finance_staff", f, cls, stage);
          expectCell(fin, false, owner === "IT" ? "Send it back to IT" : "Send it back to Purchasing");
        }
      });
    }
  }
});

describe("canEditField — viewer", () => {
  it("is always refused", () => {
    const STAGES: IntakeStage[] = ["with-purchasing", "with-it", "with-finance", "approved"];
    const all: IntakeField[] = [...MONEY_FIELDS, ...DEVICE_FIELDS];
    for (const cls of CLASSES) for (const stage of STAGES) for (const f of all) {
      expect(canEditField("viewer", f, cls, stage).ok).toBe(false);
    }
  });
});

describe("poMoneyStage", () => {
  it("approved wins over everything", () => {
    expect(poMoneyStage({ state: "SENT_BACK", registeredCount: 3, approvedCount: 1 })).toBe("approved");
    expect(poMoneyStage({ state: "WITH_IT", registeredCount: 0, approvedCount: 2 })).toBe("approved");
  });
  it("sent back is with Purchasing even when assets are registered", () => {
    expect(poMoneyStage({ state: "SENT_BACK", registeredCount: 3, approvedCount: 0 })).toBe("with-purchasing");
    expect(poMoneyStage({ state: "SENT_BACK", registeredCount: 0, approvedCount: 0 })).toBe("with-purchasing");
  });
  it("registered assets put the money with Finance", () => {
    expect(poMoneyStage({ state: "WITH_IT", registeredCount: 1, approvedCount: 0 })).toBe("with-finance");
    expect(poMoneyStage({ state: "READY", registeredCount: 2, approvedCount: 0 })).toBe("with-finance");
  });
  it("nothing registered yet follows the PO state", () => {
    expect(poMoneyStage({ state: "WITH_IT", registeredCount: 0, approvedCount: 0 })).toBe("with-it");
    expect(poMoneyStage({ state: "READY", registeredCount: 0, approvedCount: 0 })).toBe("with-purchasing");
  });
});

describe("assetMoneyStage (no PO)", () => {
  const base = { cls: "PURCHASING" as AssetClass, itVerifiedAt: null, financeConfirmedAt: null, financeReturnedAt: null, financeReturnedTo: null };
  const d = new Date("2026-10-01T00:00:00Z");
  it("approved once Finance confirmed", () => {
    expect(assetMoneyStage({ ...base, financeConfirmedAt: d })).toBe("approved");
    expect(assetMoneyStage({ ...base, cls: "IT", itVerifiedAt: d, financeConfirmedAt: d })).toBe("approved");
  });
  it("a Finance return goes to the team it was returned to", () => {
    expect(assetMoneyStage({ ...base, financeReturnedAt: d, financeReturnedTo: "IT" })).toBe("with-it");
    expect(assetMoneyStage({ ...base, cls: "IT", itVerifiedAt: d, financeReturnedAt: d, financeReturnedTo: "PURCHASING" })).toBe("with-purchasing");
  });
  it("a legacy return with no team goes to the class's team", () => {
    expect(assetMoneyStage({ ...base, cls: "IT", itVerifiedAt: d, financeReturnedAt: d })).toBe("with-it");
    expect(assetMoneyStage({ ...base, financeReturnedAt: d })).toBe("with-purchasing");
  });
  it("an IT asset IT has not checked is with IT", () => {
    expect(assetMoneyStage({ ...base, cls: "IT" })).toBe("with-it");
  });
  it("otherwise it is with Finance", () => {
    expect(assetMoneyStage(base)).toBe("with-finance");
    expect(assetMoneyStage({ ...base, cls: "IT", itVerifiedAt: d })).toBe("with-finance");
  });
});
