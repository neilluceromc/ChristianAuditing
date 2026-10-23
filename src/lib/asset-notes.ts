import type { AssetClass, Role } from "@prisma/client";

/*
 * Phase 47 (Task 6, spec §4.2a–§4.4): one shared set of notes and attachments per asset, shown on the Finance asset
 * page and the Inventory record. Reads follow class visibility (canSeeClass); every write — post, reply, resolve,
 * reopen, upload — goes through canPostOnAsset, and the server actions check both.
 */

/**
 * Which classes a role may post, reply, resolve and upload on: admin and Finance on any asset, IT on IT-class,
 * Purchasing on Purchasing-class, the viewer never. Deliberately its own map, not MANAGEABLE_CLASSES (Finance is []
 * there) or VISIBLE_CLASSES (Purchasing sees IT assets but does not post on them).
 */
export const POSTABLE_CLASSES: Record<Role, readonly AssetClass[]> = {
  admin: ["IT", "PURCHASING"],
  finance_staff: ["IT", "PURCHASING"],
  it_staff: ["IT"],
  purchasing_staff: ["PURCHASING"],
  viewer: [],
};

export function canPostOnAsset(role: Role, cls: AssetClass): boolean {
  return POSTABLE_CLASSES[role].includes(cls);
}

/** Whether a role may post on some class at all — lets an action refuse a viewer before reading anything. */
export function canPostAnywhere(role: Role): boolean {
  return POSTABLE_CLASSES[role].length > 0;
}

// ---- notes ----------------------------------------------------------------------------------------------------------

export const NOTE_MAX_CHARS = 2000;

/** C0 control characters other than tab (U+0009) and newline (U+000A). Postgres `text` refuses NUL outright. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F]/;

/**
 * The compose box's rule: 1 to 2,000 characters after trimming, no control characters but newline and tab. A
 * browser sends a textarea's line breaks as CRLF, so CRLF (and a lone CR) become a newline first — the stored body
 * and its length are the text a person typed.
 */
export function checkNoteBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const body = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
  if (!body) return { ok: false, error: "Write a note first" };
  if (CONTROL_CHARS.test(body)) return { ok: false, error: "A note can't contain control characters" };
  if (body.length > NOTE_MAX_CHARS) return { ok: false, error: "A note is at most 2,000 characters" };
  return { ok: true, body };
}

/**
 * An id sent by a client (an action argument or a form field): a string, trimmed, non-empty — else null. Normalise
 * once and use the result everywhere, so an array or a File never reaches a query (`String(["x"])` is "x").
 */
export function normId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id === "" ? null : id;
}

/** One note or reply as the Notes tab shows it. */
export interface AssetNoteView {
  id: string;
  authorId: string | null;
  authorLabel: string;
  /** The author's current role (ROLE_SHORT in finance-history.ts gives its word); null once the user is gone. */
  authorRole: Role | null;
  body: string;
  createdAt: Date;
}

/** A thread (a note with no parent) and its one level of replies. */
export interface AssetNoteThread extends AssetNoteView {
  resolvedAt: Date | null;
  resolvedByLabel: string | null;
  replies: AssetNoteView[];
}

export interface AssetNoteRow extends AssetNoteView {
  parentId: string | null;
  resolvedAt: Date | null;
  resolvedById: string | null;
}

const byTime = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) =>
  a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

const view = (r: AssetNoteRow): AssetNoteView => ({
  id: r.id, authorId: r.authorId, authorLabel: r.authorLabel, authorRole: r.authorRole, body: r.body, createdAt: r.createdAt,
});

/**
 * Threads newest first, each thread's replies oldest first (spec §4.3). A reply whose parent is not a thread of
 * these rows (a missing parent, or a reply to a reply, which the actions never write) is dropped.
 * `names` maps a resolver's user id to their name.
 */
export function threadNotes(rows: readonly AssetNoteRow[], names: Record<string, string>): AssetNoteThread[] {
  const threads = new Map<string, AssetNoteThread>();
  for (const r of rows) {
    if (r.parentId !== null) continue;
    threads.set(r.id, {
      ...view(r),
      resolvedAt: r.resolvedAt,
      resolvedByLabel: r.resolvedAt && r.resolvedById ? (names[r.resolvedById] ?? null) : null,
      replies: [],
    });
  }
  for (const r of [...rows].sort(byTime)) {
    if (r.parentId === null) continue;
    threads.get(r.parentId)?.replies.push(view(r));
  }
  return [...threads.values()].sort((a, b) => byTime(b, a));
}

// ---- attachments ----------------------------------------------------------------------------------------------------

export const ATTACHMENT_KINDS = ["proof-of-payment", "quotation", "photo", "other"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  "proof-of-payment": "Proof of payment", quotation: "Quotation", photo: "Photo", other: "Other",
};

/** AssetDocument.kind for an attachment: `attachment:<kind>`. */
export const ATTACHMENT_DOC_PREFIX = "attachment:";

export function isAttachmentKind(value: unknown): value is AttachmentKind {
  return typeof value === "string" && (ATTACHMENT_KINDS as readonly string[]).includes(value);
}

export function attachmentDocKind(kind: AttachmentKind): string {
  return `${ATTACHMENT_DOC_PREFIX}${kind}`;
}

/** The attachment kind of an AssetDocument.kind, or null when it is not one. */
export function attachmentKindOf(docKind: string): AttachmentKind | null {
  if (!docKind.startsWith(ATTACHMENT_DOC_PREFIX)) return null;
  const kind = docKind.slice(ATTACHMENT_DOC_PREFIX.length);
  return isAttachmentKind(kind) ? kind : null;
}

/** One attachment as the Attachments tab lists it. `size` is null on rows uploaded before Phase 47. */
export interface AssetAttachmentView {
  id: string;
  kind: AttachmentKind;
  fileName: string;
  size: number | null;
  createdAt: Date;
  /** `createdAt` as an ISO string, for the "Uploaded …" line (document preview). */
  uploadedAt: string;
  uploadedBy: string | null;
}
