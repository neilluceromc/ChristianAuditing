import { z } from "zod";

/** Phase 37 (spec §4.5): a note is 1–2000 characters, trimmed. */
export const noteSchema = z.string().trim().min(1, "Write a note first").max(2000, "At most 2000 characters");

const NOTE_ROLES = ["admin", "it_staff"];

/** Edit: the author only, and only while their role is still admin or it_staff. */
export function canEditNote(note: { authorId: string }, user: { id: string; role: string }): boolean {
  return note.authorId === user.id && NOTE_ROLES.includes(user.role);
}

/** Delete: the author (while admin or it_staff), or any admin. */
export function canDeleteNote(note: { authorId: string }, user: { id: string; role: string }): boolean {
  return canEditNote(note, user) || user.role === "admin";
}

/** Phase 39 (spec §2.2): the notes side panel reads this many at a time. */
export const NOTES_PAGE = 20;

/** A blank string means "no filter", so the select's "Anyone" ("") and an emptied search box drop out. */
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/**
 * `listEmployeeNotes` input: the person, an optional search (≤ 100 characters, trimmed), an optional author and
 * an optional keyset cursor — the last row shown, as its ISO `createdAt` and its `id`.
 */
export const listNotesSchema = z.object({
  employeeId: z.string().min(1),
  q: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
  authorId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  before: z.object({ at: z.string().datetime(), id: z.string().min(1) }).optional(),
});
export type ListNotesInput = z.infer<typeof listNotesSchema>;

/**
 * The Prisma `where` for one page: the person, the author, a case-insensitive `contains` on the text, and — with
 * a cursor — only rows after it in (createdAt desc, id desc) order. Without `before` it is also the "matching"
 * count's filter.
 */
export function notesWhere(input: ListNotesInput) {
  const before = input.before ? new Date(input.before.at) : null;
  return {
    employeeId: input.employeeId,
    ...(input.authorId ? { authorId: input.authorId } : {}),
    ...(input.q ? { text: { contains: input.q, mode: "insensitive" as const } } : {}),
    ...(before && input.before
      ? { OR: [{ createdAt: { lt: before } }, { createdAt: before, id: { lt: input.before.id } }] }
      : {}),
  };
}

/** The panel's count line: "{n} notes · newest first · showing {k}", or "{m} of {n} notes match" while filtering. */
export function notesCountLine({
  total, matching, shown, filtering,
}: { total: number; matching: number; shown: number; filtering: boolean }): string {
  const noun = total === 1 ? "note" : "notes";
  return filtering ? `${matching} of ${total} ${noun} match` : `${total} ${noun} · newest first · showing ${shown}`;
}
