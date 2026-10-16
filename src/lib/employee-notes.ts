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
