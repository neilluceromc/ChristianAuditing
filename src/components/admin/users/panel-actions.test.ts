import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRow } from "@/server/modules/admin/queries";

/*
 * Users & access (Task 4 fix round 1, review Minor 9): the page's action wiring. Every write that can carry the row's
 * version does, Save sends exactly the drafted changes, and a conflict refreshes the list.
 */

const h = vi.hoisted(() => ({
  updateUser: vi.fn(), setUserDisabled: vi.fn(), approveSignup: vi.fn(), declineSignup: vi.fn(),
}));
vi.mock("@/server/modules/admin/user-actions", () => h);
vi.mock("@/server/modules/admin/employee-link-search", () => ({ searchLinkableEmployees: vi.fn() }));

import { leavingAfterDirtyChange, panelHandlers, runUserAction, type ActionDeps, type RunAction } from "./panel-actions";
import { draftChanges } from "./user-panel";

const row = {
  id: "nina", name: "Nina Reyes", email: "nina@thebackroomop.com", role: "it_staff", updatedAt: "2026-10-20T03:00:00.000Z",
  employee: { id: "emp-1", employeeNo: "EMP-1042", name: "Nina Reyes", groupLabel: "IT", offboarded: false },
} as unknown as UserRow;

/** A run that awaits the action at once and records the done message for the data given. */
function capture() {
  const calls: Array<{ done: (d: unknown) => string; result: Promise<unknown> }> = [];
  const run: RunAction = (_row, action, done) => { calls.push({ done: done as (d: unknown) => string, result: action() }); };
  return { run, calls };
}

function deps(): ActionDeps & { notices: unknown[] } {
  const notices: unknown[] = [];
  return { toast: vi.fn(), refresh: vi.fn(), setNotice: vi.fn((_id, n) => { notices.push(n); }), notices };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(h)) fn.mockResolvedValue({ ok: true, data: { changed: true } });
});

describe("panelHandlers", () => {
  it("Save sends exactly the changed fields, with the version the drafts were made on", async () => {
    const { run, calls } = capture();
    panelHandlers(row, run, vi.fn()).onSave({ role: "finance_staff", employeeId: null }, "2026-10-19T00:00:00.000Z");
    await calls[0].result;
    expect(h.updateUser).toHaveBeenCalledWith({
      id: "nina", expectedUpdatedAt: "2026-10-19T00:00:00.000Z", role: "finance_staff", employeeId: null,
    });
    expect(calls[0].done({ changed: true })).toBe("Nina Reyes is now Finance staff · signed out");
  });

  it("the switch and Approve pass the row's updatedAt; Decline and Reset (ruled) do not", async () => {
    const openReset = vi.fn();
    const { run, calls } = capture();
    const on = panelHandlers(row, run, openReset);
    on.onSetActive(false);
    on.onApprove("viewer", "emp-2");
    on.onDecline();
    on.onReset();
    await Promise.all(calls.map((c) => c.result));
    expect(h.setUserDisabled).toHaveBeenCalledWith({ userId: "nina", disabled: true, expectedUpdatedAt: row.updatedAt });
    expect(h.approveSignup).toHaveBeenCalledWith({ id: "nina", role: "viewer", employeeId: "emp-2", expectedUpdatedAt: row.updatedAt });
    expect(h.declineSignup).toHaveBeenCalledWith({ id: "nina" });
    expect(openReset).toHaveBeenCalledWith(row);
    expect(calls[0].done(null)).toBe("Nina Reyes's account is off · signed out");
  });
});

describe("runUserAction", () => {
  it("a write that stood: a toast and a refresh, and no notice", async () => {
    const d = deps();
    await runUserAction(row, async () => ({ ok: true as const, data: null }), () => "Done", d);
    expect(d.toast).toHaveBeenCalledWith("Done", "settled");
    expect(d.refresh).toHaveBeenCalledTimes(1);
    expect(d.notices).toEqual([null]);
  });

  it("a conflict shows in the panel and refreshes, so the stale row is replaced", async () => {
    const d = deps();
    await runUserAction(row, async () => ({ ok: false as const, kind: "conflict" as const, message: "Changed by someone else since — try again" }), () => "x", d);
    expect(d.setNotice).toHaveBeenLastCalledWith("nina", { message: "Changed by someone else since — try again" });
    expect(d.refresh).toHaveBeenCalledTimes(1);
    expect(d.toast).not.toHaveBeenCalled();
  });

  it("a validation refusal goes to its fields, with no refresh (the drafts stay)", async () => {
    const d = deps();
    await runUserAction(row, async () => ({ ok: false as const, kind: "validation" as const, message: "", fieldErrors: { email: "Use an @x.com address." } }), () => "x", d);
    expect(d.setNotice).toHaveBeenLastCalledWith("nina", { fieldErrors: { email: "Use an @x.com address." } });
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("forbidden is a toast", async () => {
    const d = deps();
    await runUserAction(row, async () => ({ ok: false as const, kind: "forbidden" as const, message: "Choose your own password first" }), () => "x", d);
    expect(d.toast).toHaveBeenCalledWith("Choose your own password first", "fault");
  });
});

describe("draftChanges: one Save writes every changed field", () => {
  const saved = { role: row.role, name: row.name, email: row.email, employee: { value: "emp-1", label: "Nina Reyes" } };

  it("nothing when the draft is the row (a trimmed name and a differently cased email count as the same)", () => {
    expect(draftChanges(row, saved)).toEqual({});
    expect(draftChanges(row, { ...saved, name: "  Nina Reyes ", email: " Nina@TheBackroomOp.com" })).toEqual({});
  });

  it("every differing field at once", () => {
    expect(
      draftChanges(row, { role: "viewer", name: "Nina B. Reyes", email: "nina.reyes@thebackroomop.com", employee: null }),
    ).toEqual({ role: "viewer", name: "Nina B. Reyes", email: "nina.reyes@thebackroomop.com", employeeId: null });
    expect(draftChanges(row, { ...saved, employee: { value: "emp-2", label: "Ana Lim" } })).toEqual({ employeeId: "emp-2" });
  });
});

// Fix round 2 (N-3): a pending move away is forgotten once the drafts match the row again, so a later edit doesn't
// ask "Discard unsaved changes?" with nowhere to go.
describe("leavingAfterDirtyChange", () => {
  it("clears the pending move when the drafts stop differing, and keeps it while they still do", () => {
    expect(leavingAfterDirtyChange({ to: "ana" }, false)).toBeNull();
    expect(leavingAfterDirtyChange({ to: null }, false)).toBeNull();
    expect(leavingAfterDirtyChange({ to: "ana" }, true)).toEqual({ to: "ana" });
    expect(leavingAfterDirtyChange(null, true)).toBeNull();
  });
});

