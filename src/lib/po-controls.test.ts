import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { poControls, type PoControlsInput } from "./po-controls";

const it1 = (over: Partial<{ qty: number; registered: number; closedShort: number }> = {}) =>
  ({ id: "l1", cls: "IT" as const, qty: 5, registered: 0, closedShort: 0, ...over });
const non = (over: Partial<{ qty: number; registered: number; closedShort: number }> = {}) =>
  ({ id: "l2", cls: "PURCHASING" as const, qty: 2, registered: 0, closedShort: 0, ...over });

const po = (role: Role, over: Partial<PoControlsInput> = {}): PoControlsInput => ({
  role, state: "WITH_IT", registeredCount: 0, approvedCount: 0, lines: [it1()], ...over,
});

describe("poControls · register", () => {
  it("IT registers IT lines; Purchasing does not", () => {
    expect(poControls(po("it_staff")).register).toBe(true);
    expect(poControls(po("purchasing_staff")).register).toBe(false);
  });
  it("Purchasing registers non-IT lines, even while a mixed PO is with IT", () => {
    expect(poControls(po("purchasing_staff", { lines: [it1(), non()] })).register).toBe(true);
    expect(poControls(po("it_staff", { lines: [non()] })).register).toBe(false);
  });
  it("needs a line with something left", () => {
    expect(poControls(po("it_staff", { lines: [it1({ registered: 5 })] })).register).toBe(false);
    expect(poControls(po("it_staff", { lines: [it1({ registered: 3, closedShort: 2 })] })).register).toBe(false);
    expect(poControls(po("it_staff", { lines: [it1({ registered: 3 })] })).register).toBe(true);
  });
  it("not on a sent-back or cancelled PO, nor for a viewer", () => {
    expect(poControls(po("it_staff", { state: "SENT_BACK" })).register).toBe(false);
    expect(poControls(po("admin", { state: "CANCELLED" })).register).toBe(false);
    expect(poControls(po("viewer")).register).toBe(false);
  });
  it("a legacy line (no class) can be registered by IT, Purchasing or admin, never Finance", () => {
    const legacy = [{ id: "l3", cls: null, qty: 2, registered: 0, closedShort: 0 }];
    expect(poControls(po("it_staff", { lines: legacy })).register).toBe(true);
    expect(poControls(po("purchasing_staff", { lines: legacy, state: "READY" })).register).toBe(true);
    expect(poControls(po("admin", { lines: legacy })).register).toBe(true);
    expect(poControls(po("finance_staff", { lines: legacy })).register).toBe(false);
  });
});

describe("poControls · send back", () => {
  it("IT can while the PO is with IT and nothing is registered", () => {
    expect(poControls(po("it_staff")).sendBack).toBe(true);
  });
  it("IT can't once something is registered (the money is with Finance), nor on READY", () => {
    expect(poControls(po("it_staff", { registeredCount: 1 })).sendBack).toBe(false);
    expect(poControls(po("it_staff", { state: "READY" })).sendBack).toBe(false);
  });
  it("Finance can once something is registered and nothing is approved", () => {
    expect(poControls(po("finance_staff", { registeredCount: 2 })).sendBack).toBe(true);
    expect(poControls(po("finance_staff")).sendBack).toBe(false);
    expect(poControls(po("finance_staff", { registeredCount: 2, approvedCount: 1 })).sendBack).toBe(false);
  });
  it("admin takes whichever path the stage gives, but not on Purchasing's own stage", () => {
    expect(poControls(po("admin")).sendBack).toBe(true);
    expect(poControls(po("admin", { registeredCount: 1 })).sendBack).toBe(true);
    expect(poControls(po("admin", { state: "READY" })).sendBack).toBe(false);
  });
  it("never on a sent-back or cancelled PO, and Purchasing can't send back its own", () => {
    expect(poControls(po("it_staff", { state: "SENT_BACK" })).sendBack).toBe(false);
    expect(poControls(po("admin", { state: "CANCELLED" })).sendBack).toBe(false);
    expect(poControls(po("purchasing_staff")).sendBack).toBe(false);
  });
});

describe("poControls · fix money details (a fix that needs a reason)", () => {
  it("IT while it's with IT; not Purchasing (it just edits)", () => {
    expect(poControls(po("it_staff")).fix).toBe(true);
    expect(poControls(po("purchasing_staff")).fix).toBe(false);
  });
  it("Finance once it's registered, and after approval", () => {
    expect(poControls(po("finance_staff", { registeredCount: 1 })).fix).toBe(true);
    expect(poControls(po("finance_staff", { registeredCount: 1, approvedCount: 1 })).fix).toBe(true);
    expect(poControls(po("finance_staff")).fix).toBe(false);
  });
  it("IT can't fix once it's with Finance", () => {
    expect(poControls(po("it_staff", { registeredCount: 1 })).fix).toBe(false);
  });
  it("not on a cancelled PO, nor for a viewer; admin once it has left Purchasing", () => {
    expect(poControls(po("admin", { state: "CANCELLED" })).fix).toBe(false);
    expect(poControls(po("viewer")).fix).toBe(false);
    expect(poControls(po("admin")).fix).toBe(true);
    expect(poControls(po("admin", { state: "READY" })).fix).toBe(false);
  });
});

describe("poControls · edit, cancel, close short", () => {
  it("Purchasing edits while it's sent back, with IT, or ready with nothing registered", () => {
    expect(poControls(po("purchasing_staff", { state: "SENT_BACK" })).edit).toBe(true);
    expect(poControls(po("purchasing_staff")).edit).toBe(true);
    expect(poControls(po("purchasing_staff", { state: "READY" })).edit).toBe(true);
  });
  it("Purchasing stops editing once assets are registered or the PO is cancelled", () => {
    expect(poControls(po("purchasing_staff", { state: "READY", registeredCount: 1 })).edit).toBe(false);
    expect(poControls(po("purchasing_staff", { state: "CANCELLED" })).edit).toBe(false);
  });
  it("a sent-back PO is editable even when assets are registered (Purchasing holds the money again)", () => {
    expect(poControls(po("purchasing_staff", { state: "SENT_BACK", registeredCount: 2 })).edit).toBe(true);
  });
  it("only Purchasing and admin edit", () => {
    expect(poControls(po("it_staff")).edit).toBe(false);
    expect(poControls(po("finance_staff", { state: "SENT_BACK" })).edit).toBe(false);
  });
  it("cancel needs Purchasing or admin, a live PO and no assets", () => {
    expect(poControls(po("purchasing_staff")).cancel).toBe(true);
    expect(poControls(po("purchasing_staff", { registeredCount: 1 })).cancel).toBe(false);
    expect(poControls(po("purchasing_staff", { state: "CANCELLED" })).cancel).toBe(false);
    expect(poControls(po("it_staff")).cancel).toBe(false);
  });
  it("close short is Purchasing's or admin's on a live PO", () => {
    expect(poControls(po("purchasing_staff")).closeShort).toBe(true);
    expect(poControls(po("it_staff")).closeShort).toBe(false);
    expect(poControls(po("admin", { state: "CANCELLED" })).closeShort).toBe(false);
  });
});
