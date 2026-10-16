import { describe, expect, it } from "vitest";
import { canDeleteNote, canEditNote, noteSchema } from "./employee-notes";

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
