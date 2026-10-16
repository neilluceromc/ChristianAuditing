import { describe, expect, it } from "vitest";
import {
  NOTES_PAGE, canDeleteNote, canEditNote, listNotesSchema, noteSchema, notesCountLine, notesWhere,
} from "./employee-notes";

describe("listNotesSchema (Phase 39, spec §2.2)", () => {
  it("needs the employee; trims q and drops a blank one", () => {
    expect(listNotesSchema.safeParse({}).success).toBe(false);
    expect(listNotesSchema.parse({ employeeId: "e1", q: "  laptop " })).toEqual({ employeeId: "e1", q: "laptop" });
    expect(listNotesSchema.parse({ employeeId: "e1", q: "   " })).toEqual({ employeeId: "e1" });
  });
  it("refuses a search over 100 characters", () => {
    expect(listNotesSchema.safeParse({ employeeId: "e1", q: "x".repeat(100) }).success).toBe(true);
    expect(listNotesSchema.safeParse({ employeeId: "e1", q: "x".repeat(101) }).success).toBe(false);
  });
  it("takes a keyset cursor of an ISO time and an id, and refuses a bad time", () => {
    const at = "2026-10-17T02:00:00.000Z";
    expect(listNotesSchema.parse({ employeeId: "e1", before: { at, id: "n1" } }).before).toEqual({ at, id: "n1" });
    expect(listNotesSchema.safeParse({ employeeId: "e1", before: { at: "yesterday", id: "n1" } }).success).toBe(false);
    expect(listNotesSchema.safeParse({ employeeId: "e1", before: { at, id: "" } }).success).toBe(false);
  });
  it("an empty author means anyone", () => {
    expect(listNotesSchema.parse({ employeeId: "e1", authorId: "" })).toEqual({ employeeId: "e1" });
    expect(listNotesSchema.parse({ employeeId: "e1", authorId: "u1" }).authorId).toBe("u1");
  });
});

describe("notesWhere", () => {
  it("is just the person with no filters", () => {
    expect(notesWhere({ employeeId: "e1" })).toEqual({ employeeId: "e1" });
  });
  it("adds a case-insensitive contains and the author", () => {
    expect(notesWhere({ employeeId: "e1", q: "laptop", authorId: "u1" })).toEqual({
      employeeId: "e1", authorId: "u1", text: { contains: "laptop", mode: "insensitive" },
    });
  });
  it("pages on (createdAt desc, id desc): strictly older, or the same instant with a smaller id", () => {
    const at = "2026-10-17T02:00:00.000Z";
    expect(notesWhere({ employeeId: "e1", before: { at, id: "n5" } })).toEqual({
      employeeId: "e1",
      OR: [{ createdAt: { lt: new Date(at) } }, { createdAt: new Date(at), id: { lt: "n5" } }],
    });
  });
  it("pages 20 at a time", () => {
    expect(NOTES_PAGE).toBe(20);
  });
});

describe("notesCountLine", () => {
  it("unfiltered: the total, newest first, and how many are showing", () => {
    expect(notesCountLine({ total: 25, matching: 25, shown: 20, filtering: false })).toBe("25 notes · newest first · showing 20");
    expect(notesCountLine({ total: 1, matching: 1, shown: 1, filtering: false })).toBe("1 note · newest first · showing 1");
  });
  it("filtered: how many of the total match", () => {
    expect(notesCountLine({ total: 25, matching: 3, shown: 3, filtering: true })).toBe("3 of 25 notes match");
    expect(notesCountLine({ total: 25, matching: 0, shown: 0, filtering: true })).toBe("0 of 25 notes match");
  });
});

describe("noteSchema", () => {
  it("refuses blank and over-long notes", () => {
    expect(noteSchema.safeParse("   ").error?.issues[0].message).toBe("Write a note first");
    expect(noteSchema.safeParse("x".repeat(2001)).error?.issues[0].message).toBe("At most 2000 characters");
    expect(noteSchema.parse("  ok  ")).toBe("ok");
  });
  it("accepts exactly 2000 characters", () => {
    expect(noteSchema.safeParse("x".repeat(2000)).success).toBe(true);
  });
});

describe("note permissions", () => {
  const note = { authorId: "u1" };
  it("the author edits and deletes while IT or admin", () => {
    expect(canEditNote(note, { id: "u1", role: "it_staff" })).toBe(true);
    expect(canDeleteNote(note, { id: "u1", role: "it_staff" })).toBe(true);
  });
  it("an author who became a viewer cannot", () => {
    expect(canEditNote(note, { id: "u1", role: "viewer" })).toBe(false);
    expect(canDeleteNote(note, { id: "u1", role: "viewer" })).toBe(false);
  });
  it("admin deletes anyone's but edits only their own", () => {
    expect(canDeleteNote(note, { id: "a", role: "admin" })).toBe(true);
    expect(canEditNote(note, { id: "a", role: "admin" })).toBe(false);
  });
  it("other IT staff cannot touch it", () => {
    expect(canEditNote(note, { id: "u2", role: "it_staff" })).toBe(false);
    expect(canDeleteNote(note, { id: "u2", role: "it_staff" })).toBe(false);
  });
});
