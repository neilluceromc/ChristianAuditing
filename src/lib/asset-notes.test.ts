import { describe, expect, it } from "vitest";
import type { AssetClass, Role } from "@prisma/client";
import {
  ATTACHMENT_KINDS, ATTACHMENT_KIND_LABELS, NOTE_MAX_CHARS, attachmentDocKind, attachmentKindOf, canPostOnAsset,
  checkNoteBody, isAttachmentKind, normId, threadNotes,
} from "./asset-notes";
import { canSeeClass } from "./asset-class";

/*
 * Phase 47 (Task 6, spec §4.2a–§4.4): the one permission rule for posting, replying, resolving and uploading on an
 * asset, the note body's limits, the attachment kinds, and the grouping of notes into threads.
 */

const ROLES: Role[] = ["admin", "finance_staff", "it_staff", "purchasing_staff", "viewer"];

describe("canPostOnAsset (spec §4.2a)", () => {
  const expected: Record<Role, Record<AssetClass, boolean>> = {
    admin: { IT: true, PURCHASING: true },
    finance_staff: { IT: true, PURCHASING: true },
    it_staff: { IT: true, PURCHASING: false },
    purchasing_staff: { IT: false, PURCHASING: true },
    viewer: { IT: false, PURCHASING: false },
  };
  it.each(ROLES.flatMap((role) => (["IT", "PURCHASING"] as const).map((cls) => [role, cls] as const)))(
    "%s on %s",
    (role, cls) => {
      expect(canPostOnAsset(role, cls)).toBe(expected[role][cls]);
    },
  );
  it("never lets a role post where it cannot see", () => {
    for (const role of ROLES) for (const cls of ["IT", "PURCHASING"] as const) {
      if (canPostOnAsset(role, cls)) expect(canSeeClass(role, cls)).toBe(true);
    }
  });
  it("Review Focus 3: the roles that can see but not post", () => {
    expect(canSeeClass("viewer", "IT") && !canPostOnAsset("viewer", "IT")).toBe(true);
    expect(canSeeClass("purchasing_staff", "IT") && !canPostOnAsset("purchasing_staff", "IT")).toBe(true);
  });
});

describe("checkNoteBody", () => {
  it("trims and accepts 1 to 2,000 characters", () => {
    expect(checkNoteBody("  Paid in full.  ")).toEqual({ ok: true, body: "Paid in full." });
    expect(checkNoteBody("x")).toEqual({ ok: true, body: "x" });
    const max = "y".repeat(NOTE_MAX_CHARS);
    expect(checkNoteBody(`\n ${max} \n`)).toEqual({ ok: true, body: max });
  });
  it("refuses an empty or whitespace-only body", () => {
    for (const raw of ["", "   ", "\n\t", null, undefined, 42]) {
      expect(checkNoteBody(raw)).toEqual({ ok: false, error: "Write a note first" });
    }
  });
  it("refuses more than 2,000 characters after trimming", () => {
    expect(NOTE_MAX_CHARS).toBe(2000);
    expect(checkNoteBody("z".repeat(2001))).toEqual({ ok: false, error: "A note is at most 2,000 characters" });
  });
});

describe("checkNoteBody: control characters (fix round 1)", () => {
  const ERR = { ok: false, error: "A note can't contain control characters" };
  it("refuses NUL and the other C0 controls", () => {
    for (const c of ["\u0000", "\u0001", "\u0007", "\u0008", "\u000B", "\u000C", "\u001B", "\u001F"]) {
      expect(checkNoteBody(`Paid${c} in full`)).toEqual(ERR);
    }
  });
  it("keeps newlines and tabs, and turns a browser's CRLF (and a lone CR) into newlines", () => {
    expect(checkNoteBody("Line one\n\tindented")).toEqual({ ok: true, body: "Line one\n\tindented" });
    expect(checkNoteBody("One\r\nTwo\rThree\r\n")).toEqual({ ok: true, body: "One\nTwo\nThree" });
  });
  it("measures the length after CRLF becomes LF", () => {
    const body = `${"a".repeat(999)}\r\n${"b".repeat(1000)}`; // 2,001 sent, 2,000 stored
    expect(checkNoteBody(body)).toEqual({ ok: true, body: `${"a".repeat(999)}\n${"b".repeat(1000)}` });
  });
});

describe("normId (fix round 1)", () => {
  it("is a trimmed, non-empty string", () => {
    expect(normId(" cmabc123 ")).toBe("cmabc123");
    expect(normId("cmabc123")).toBe("cmabc123");
  });
  it("refuses anything else", () => {
    for (const bad of ["", "   ", ["cmabc123"], 42, null, undefined, { id: "x" }, new Blob(["x"])]) expect(normId(bad)).toBeNull();
  });
});

describe("attachment kinds (spec §4.4)", () => {
  it("are the four kinds, in order, each with a label", () => {
    expect(ATTACHMENT_KINDS).toEqual(["proof-of-payment", "quotation", "photo", "other"]);
    expect(ATTACHMENT_KIND_LABELS).toEqual({
      "proof-of-payment": "Proof of payment", quotation: "Quotation", photo: "Photo", other: "Other",
    });
  });
  it("store as attachment:<kind> and read back", () => {
    expect(attachmentDocKind("quotation")).toBe("attachment:quotation");
    expect(attachmentKindOf("attachment:proof-of-payment")).toBe("proof-of-payment");
    expect(attachmentKindOf("invoice")).toBeNull();
    expect(attachmentKindOf("attachment:receipt")).toBeNull();
  });
  it("isAttachmentKind refuses anything else", () => {
    expect(isAttachmentKind("photo")).toBe(true);
    for (const bad of ["invoice", "attachment:photo", "", null, undefined, 3]) expect(isAttachmentKind(bad)).toBe(false);
  });
});

describe("threadNotes", () => {
  const at = (d: number) => new Date(Date.UTC(2026, 9, d, 2));
  const row = (id: string, day: number, parentId: string | null = null) => ({
    id, parentId, authorId: "u1", authorLabel: "Ana Cruz", authorRole: "finance_staff" as Role, body: id,
    createdAt: at(day), resolvedAt: null, resolvedById: null,
  });
  it("threads newest first, replies oldest first, resolver named", () => {
    const rows = [
      row("t1", 1), row("r1b", 5, "t1"), row("t2", 3), row("r1a", 2, "t1"),
      { ...row("t3", 4), resolvedAt: at(6), resolvedById: "u2" },
    ];
    const threads = threadNotes(rows, { u2: "Ben Reyes" });
    expect(threads.map((t) => t.id)).toEqual(["t3", "t2", "t1"]);
    expect(threads[2].replies.map((r) => r.id)).toEqual(["r1a", "r1b"]);
    expect(threads[0]).toMatchObject({ resolvedAt: at(6), resolvedByLabel: "Ben Reyes", replies: [] });
    expect(threads[1]).toMatchObject({ resolvedAt: null, resolvedByLabel: null });
  });
  it("drops a reply whose thread is missing, and a reply to a reply", () => {
    const threads = threadNotes([row("t1", 1), row("orphan", 2, "gone"), row("r1", 3, "t1"), row("rr", 4, "r1")], {});
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["r1"]);
  });
});
