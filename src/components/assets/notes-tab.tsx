import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import { ROLE_SHORT } from "@/lib/finance-history";
import type { AssetNoteThread, AssetNoteView } from "@/lib/asset-notes";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { NoteForm, ResolveButton } from "./note-forms";

/** Initials avatar, name, role and time over the text: one note or reply. */
function NoteBody({ note, small = false }: { note: AssetNoteView; small?: boolean }) {
  return (
    <div className="flex gap-3">
      <Avatar name={note.authorLabel} size={small ? "md" : "lg"} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
          <span className="font-semibold text-fg">{note.authorLabel}</span>
          {note.authorRole && <span className="text-fg-muted">{ROLE_SHORT[note.authorRole]}</span>}
          <time dateTime={note.createdAt.toISOString()} className="font-mono text-[11px] text-fg-muted">
            {fmtDateTime(note.createdAt)}
          </time>
        </p>
        <p className="whitespace-pre-wrap break-words text-[13px] text-fg-secondary">{note.body}</p>
      </div>
    </div>
  );
}

/**
 * Phase 47 (spec §4.2a, §4.3): the asset's Notes — one shared set, shown on the Finance asset page and the Inventory
 * record (no money in it). The compose box, then threads newest first, each with its replies (oldest first), a Reply
 * box and Mark resolved / Reopen; a resolved thread is dimmed and labelled. `canPost` is `canPostOnAsset(role, cls)`:
 * without it (viewers, or a class the role does not post on) the tab is read only — and the actions refuse anyway.
 * No one edits or deletes a note.
 */
export function NotesTab({ assetId, threads, canPost }: { assetId: string; threads: AssetNoteThread[]; canPost: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {canPost ? (
        <Card>
          <CardBody>
            <NoteForm assetId={assetId} />
          </CardBody>
        </Card>
      ) : (
        <p className="text-xs text-fg-muted">You can read these notes. Posting is for the teams that work on this asset.</p>
      )}

      {threads.length === 0 ? (
        <Card>
          <EmptyState
            title="No notes yet"
            description={canPost ? "Notes are shared with everyone who can see this asset, on its Finance and Inventory pages." : undefined}
          />
        </Card>
      ) : (
        <ol aria-label="Notes" className="flex flex-col gap-3">
          {threads.map((t) => {
            const resolved = t.resolvedAt !== null;
            return (
              <li key={t.id}>
                <article
                  data-resolved={resolved ? "true" : "false"}
                  aria-label={`Note by ${t.authorLabel}${resolved ? ", resolved" : ""}`}
                  className={cn(
                    "flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface px-4 py-3 shadow-card",
                    resolved && "opacity-70",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1"><NoteBody note={t} /></div>
                    {resolved && (
                      <span
                        className="shrink-0 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.06em]"
                        style={{ background: "var(--st-settled-bg)", color: "var(--st-settled-text)", borderColor: "var(--st-settled-border)" }}
                        title={t.resolvedByLabel ? `Resolved by ${t.resolvedByLabel}` : undefined}
                      >
                        Resolved
                      </span>
                    )}
                  </div>

                  {t.replies.length > 0 && (
                    <ol aria-label="Replies" className="ml-[38px] flex flex-col gap-3 border-l-2 border-border-faint pl-3">
                      {t.replies.map((r) => <li key={r.id}><NoteBody note={r} small /></li>)}
                    </ol>
                  )}

                  {canPost && (
                    <div className="ml-[38px] flex flex-col gap-2">
                      {!resolved && <NoteForm assetId={assetId} parentId={t.id} replyTo={t.authorLabel} />}
                      <div><ResolveButton noteId={t.id} resolved={resolved} /></div>
                    </div>
                  )}
                </article>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
