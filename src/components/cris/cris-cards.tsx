"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { fmtDayMonth } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type {
  ChipsCard, ConfirmCard, CrisCard, CrisReturnOutcome, PersonCard, PersonRef, ResultCard, SparesCard, WhichCard,
} from "@/lib/cris-cards";
import { firstWord, gapLine, spareMeta, undoSecondsLeft } from "@/lib/cris-box";

/*
 * Spec §4 "Structured cards": rendered from the server's cards, never from the model's prose. Only the newest
 * message's cards are live (take a pick, a scan or a Confirm); older ones are a record.
 */

export type CardActions = {
  busy: boolean;
  /** pendingIds whose Confirm was pressed, or can no longer be (already done, expired). */
  confirmed: ReadonlySet<string>;
  /** pendingIds whose Undo is gone (done, or refused). */
  undone: ReadonlySet<string>;
  now: number;
  /** The first name for a result card's next step, from the Confirm card it answers. */
  firstFor: (pendingId: string) => string | null;
  onPickPerson: (p: PersonRef) => void;
  onPickSpare: (spare: { assetId: string; tag: string }) => void;
  onMoreSpares: () => void;
  onScan: () => void;
  onConfirm: (card: ConfirmCard) => void;
  onChange: () => void;
  onUndo: (card: ResultCard) => void;
  onChip: (text: string) => void;
};

const OUTCOME_LABEL: Record<CrisReturnOutcome, string> = { DEFECTIVE: "Defective", TRIAGE: "Triage", MISSING: "Missing" };

const tagClass = "font-mono text-[11.5px] font-semibold text-accent-soft-text";
const optClass =
  "flex w-full items-center gap-[9px] rounded-[12px] border border-border-strong bg-surface px-2.5 py-2 text-left text-[12.5px] text-fg " +
  "[transition:border-color_var(--dur-2),background_var(--dur-2)] enabled:hover:border-accent-soft-border enabled:hover:bg-accent-tint " +
  "disabled:opacity-55";
export const chipClass =
  "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-[11px] py-[5px] text-left text-[12px] text-fg-secondary " +
  "[transition:border-color_var(--dur-2),background_var(--dur-2),color_var(--dur-2)] hover:border-accent-soft-border hover:bg-accent-tint hover:text-accent-soft-text " +
  "disabled:pointer-events-none disabled:opacity-55";

function Initials({ person, size = 30 }: { person: PersonRef; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-accent-soft font-bold text-accent-soft-text"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {person.initials}
    </span>
  );
}

function Who({ person }: { person: PersonRef }) {
  return (
    <div className="flex items-center gap-[9px]">
      <Initials person={person} />
      <div className="min-w-0">
        <b className="font-semibold">{person.name}</b>
        <div className="font-mono text-[11px] text-fg-muted">
          {person.employeeNo} · {person.worksFor}
        </div>
      </div>
    </div>
  );
}

function PersonView({ card }: { card: PersonCard }) {
  const gap = gapLine(card.gaps);
  return (
    <div className="cris-msg flex max-w-[92%] flex-col gap-[7px] self-start rounded-[16px_16px_16px_4px] bg-(--cris-bubble) px-[11px] py-2.5">
      <Who person={card.person} />
      {card.items.length === 0 ? (
        <div className="text-fg-secondary">No items held.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {card.items.map((it) => (
            <li key={it.assetId} className="flex items-start gap-[7px]">
              <Icon name="laptop" size={14} className="mt-0.5 text-fg-secondary" />
              <span>
                <Link href={`/inventory/${it.assetId}`} className={cn(tagClass, "underline-offset-2 hover:underline")}>
                  {it.tag}
                </Link>{" "}
                {it.model}
                {it.since && <span className="text-fg-muted"> · since {fmtDayMonth(it.since)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {gap && (
        <div className="rounded-[9px] bg-(--st-attention-bg) px-[9px] py-1.5 text-[12px] text-(--st-attention-text)">{gap}</div>
      )}
      {card.holds.length > 0 && (
        <div className="text-[12px] text-fg-secondary">
          Kept for them: <span className="font-mono">{card.holds.join(", ")}</span>
        </div>
      )}
      <Link href={`/employees/${card.person.id}`} className="self-start text-[12px] font-medium text-accent-soft-text underline-offset-2 hover:underline">
        Open {firstWord(card.person.name)}&apos;s profile →
      </Link>
    </div>
  );
}

function WhichView({ card, live, a }: { card: WhichCard; live: boolean; a: CardActions }) {
  return (
    <div className="cris-msg flex flex-col gap-1.5 self-stretch">
      {card.choices.map((p) => (
        <button key={p.id} type="button" className={optClass} disabled={!live || a.busy} onClick={() => a.onPickPerson(p)}>
          <Initials person={p} size={26} />
          <span>
            <b className="font-semibold">{p.name}</b>
            <span className="block font-mono text-[11px] text-fg-muted">
              {p.employeeNo} · {p.worksFor}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function SparesView({ card, live, a }: { card: SparesCard; live: boolean; a: CardActions }) {
  const name = useId();
  const [sel, setSel] = useState<string | null>(null);
  const chosen = live ? card.options.find((o) => o.assetId === sel) ?? null : null;
  const off = !live || a.busy;
  if (card.options.length === 0) {
    return (
      <div className="cris-msg self-start rounded-[16px_16px_16px_4px] bg-(--cris-bubble) px-[11px] py-2.5 text-fg-secondary">
        No spares to pick from right now.
      </div>
    );
  }
  return (
    <div className="cris-msg flex flex-col gap-[7px] self-stretch rounded-[16px_16px_16px_4px] bg-(--cris-pick) px-[11px] py-2.5">
      <fieldset className="flex flex-col gap-1.5" disabled={!live}>
        <legend className="sr-only">Pick a spare</legend>
        {card.options.map((o) => {
          const on = chosen?.assetId === o.assetId;
          return (
            <label
              key={o.assetId}
              className={cn(
                optClass,
                "cursor-pointer has-[:disabled]:cursor-default has-[:disabled]:opacity-55",
                on && "border-[1.5px] border-accent bg-accent-tint px-[9.5px] py-[7.5px]",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.assetId}
                checked={on}
                onChange={() => setSel(o.assetId)}
                className="size-3.5 shrink-0 accent-(--accent)"
              />
              <span>
                <span className={tagClass}>{o.tag}</span> {o.model}
                <span className="block text-[11px] text-fg-muted">{spareMeta(o)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {live && (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!chosen || a.busy}
              onClick={() => chosen && a.onPickSpare({ assetId: chosen.assetId, tag: chosen.tag })}
            >
              {chosen ? `Use ${chosen.tag}` : "Pick one above"}
            </Button>
            <Button type="button" size="sm" disabled={off} onClick={a.onScan}>
              <Icon name="scan" size={14} />
              Scan its label
            </Button>
          </div>
          {card.more && (
            <button
              type="button"
              disabled={off}
              onClick={a.onMoreSpares}
              className="self-start text-[12px] font-semibold text-accent-soft-text underline underline-offset-2 disabled:opacity-55"
            >
              None of these — show 3 more
            </button>
          )}
          <div className="text-[11px] text-fg-muted">Tip: you can also just type the tag.</div>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] items-start gap-2 border-t border-border-faint py-[7px]">
      <span className="pt-px text-[11.5px] text-fg-secondary">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ConfirmView({ card, live, a }: { card: ConfirmCard; live: boolean; a: CardActions }) {
  const open = live && !a.confirmed.has(card.pendingId);
  return (
    <div className="cris-msg flex flex-col gap-2 self-stretch rounded-[14px] border-[1.5px] border-accent-soft-border bg-surface p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-accent-soft-text">Check before you confirm</div>
      <Who person={card.person} />
      <Row label="Gets">
        <div className="flex items-start justify-between gap-2">
          <span>
            <span className={tagClass}>{card.gets.tag}</span> {card.gets.model}
            <span className="block font-mono text-[11px] text-fg-muted">{card.gets.serial ? `SN ${card.gets.serial}` : "No serial"}</span>
          </span>
          {card.gets.scanned && (
            <span className="inline-flex h-5 shrink-0 items-center gap-[3px] rounded-full bg-(--st-settled-bg) px-[7px] text-[11px] font-semibold text-(--st-settled-text)">
              Scanned ✓
            </span>
          )}
        </div>
      </Row>
      {card.returns && (
        <Row label="Returns">
          <span className={tagClass}>{card.returns.tag}</span> → {OUTCOME_LABEL[card.returns.outcome]}
          <span className="block text-[11px] text-fg-muted">“{card.returns.reason}”</span>
        </Row>
      )}
      {card.reason && (
        <Row label="Reason">
          <span className="text-fg-secondary">“{card.reason}”</span>
        </Row>
      )}
      {open && (
        <>
          <div className="mt-1 flex gap-1.5">
            <Button type="button" variant="primary" size="sm" className="flex-1" disabled={a.busy} onClick={() => a.onConfirm(card)}>
              {card.kind === "replace" ? "Confirm replacement" : "Confirm assignment"}
            </Button>
            <Button type="button" size="sm" disabled={a.busy} onClick={a.onChange}>
              Change
            </Button>
          </div>
          <div className="text-[11px] text-fg-muted">Cris checks everything again the moment you confirm.</div>
        </>
      )}
    </div>
  );
}

function ResultView({ card, a }: { card: ResultCard; a: CardActions }) {
  const secs = undoSecondsLeft(card.undoUntil, a.now);
  const canUndo = secs > 0 && !a.undone.has(card.pendingId);
  const first = a.firstFor(card.pendingId);
  return (
    <div className="cris-msg flex flex-col gap-1.5 self-stretch">
      <div className="flex items-start gap-[9px] rounded-[12px] bg-(--st-settled-bg) px-[11px] py-2.5 text-(--st-settled-text)">
        <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0">
          <path d="M5 12.5l4.2 4.2L19 7" />
        </svg>
        <div className="text-fg">
          <b className="font-semibold">{card.head}</b> {card.text}
          <div className="mt-1 flex items-center gap-3">
            {canUndo && (
              <button
                type="button"
                aria-label="Undo"
                disabled={a.busy}
                onClick={() => a.onUndo(card)}
                className="font-semibold text-accent-soft-text underline underline-offset-2 disabled:opacity-55"
              >
                Undo <span aria-hidden>· {secs} s</span>
              </button>
            )}
            <Link href={`/employees/${card.employeeId}`} className="text-accent-soft-text underline-offset-2 hover:underline">
              Open profile
            </Link>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Link href={`/employees/${card.employeeId}/form`} className={chipClass}>
          {first ? `Print ${first}'s accountability form` : "Print the accountability form"}
        </Link>
      </div>
    </div>
  );
}

function ChipsView({ card, live, a }: { card: ChipsCard; live: boolean; a: CardActions }) {
  if (!live) return null;
  return (
    <div className="cris-msg flex flex-wrap gap-1.5">
      {card.items.map((t) => (
        <button key={t} type="button" className={chipClass} disabled={a.busy} onClick={() => a.onChip(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

export function CrisCardView({ card, live, actions }: { card: CrisCard; live: boolean; actions: CardActions }) {
  switch (card.type) {
    case "person":
      return <PersonView card={card} />;
    case "which":
      return <WhichView card={card} live={live} a={actions} />;
    case "spares":
      return <SparesView card={card} live={live} a={actions} />;
    case "confirm":
      return <ConfirmView card={card} live={live} a={actions} />;
    case "result":
      return <ResultView card={card} a={actions} />;
    case "chips":
      return <ChipsView card={card} live={live} a={actions} />;
  }
}
