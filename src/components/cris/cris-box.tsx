"use client";

import { Fragment, forwardRef, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import type { CrisViewMessage } from "@/lib/cris-cards";
import { contextLine, greetingLine, liveMessageId, type CrisPageContext, type QuickStart } from "@/lib/cris-box";
import { CrisCardView, chipClass, type CardActions } from "./cris-cards";
import { CrisComposer } from "./cris-composer";

/*
 * Spec §4 "Pressing the mascot opens a small chat box": the header (Cris, the live status, New chat, Make bigger,
 * Close), the message list (`role="log"`, polite), and the message box. Where it sits is the widget's (inline
 * `style` from boxPlacement); what it shows is here.
 */

export type BoxProps = {
  id: string;
  style: React.CSSProperties;
  above: boolean;
  side: "left" | "right";
  big: boolean;
  firstName: string;
  /** Preview mode (no AI key): the Preview pill, the preview greeting, no context chip and no scan button. */
  preview?: boolean;
  status: string;
  busy: boolean;
  messages: CrisViewMessage[];
  /** The reply typing out now (its id and how much shows), and the ones queued after it (hidden until their turn). */
  typing: { id: string; shown: number } | null;
  queued: ReadonlySet<string>;
  history: "loading" | "failed" | "ready";
  more: boolean;
  context: CrisPageContext | null;
  starts: QuickStart[];
  actions: CardActions;
  draft: string;
  placeholder: string;
  left: number;
  scanOpen: boolean;
  /** Bumped when "Scan its label" asks for the scan field, so it takes focus even when already open. */
  scanFocusTick: number;
  /** History is loading (on open, or "Earlier messages"): the log is busy, so the bulk insert is not read aloud. */
  bulkLoading: boolean;
  /** Bumped by each bulk insert from crisHistory; the log stays busy through that commit and clears a frame later. */
  historyTick: number;
  /** Bumped when older messages were put on top, so the list keeps its place instead of jumping to the end. */
  prependTick: number;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  onDraft: (v: string) => void;
  onSend: () => void;
  onScan: (tag: string) => void;
  onScanOpen: (open: boolean) => void;
  onStart: (s: QuickStart) => void;
  onEarlier: () => void;
  onRetryHistory: () => void;
  onNewChat: () => void;
  onBig: () => void;
  onClose: () => void;
};

const iconProps = {
  "aria-hidden": true, width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
} as const;

function Bubble({ m, typing, queued }: { m: CrisViewMessage; typing: BoxProps["typing"]; queued: boolean }) {
  if (m.role === "user") {
    return (
      <div className="cris-msg max-w-[84%] self-end whitespace-pre-wrap break-words rounded-[16px_16px_4px_16px] bg-accent px-[11px] py-2 text-accent-fg shadow-[0_1px_2px_rgba(16,24,40,.08)]">
        {m.text}
      </div>
    );
  }
  if (!m.text || queued) return null;
  const now = typing?.id === m.id ? typing : null;
  return (
    <div className="cris-msg max-w-[92%] self-start whitespace-pre-wrap break-words rounded-[16px_16px_16px_4px] bg-(--cris-bubble) px-[11px] py-2.5">
      {/* One shape, typed or not: the log announces the whole reply once, from the screen-reader copy, which stays
          put when the typing ends; the typing-out is for the eyes only. */}
      <span className="sr-only">{m.text}</span>
      <span aria-hidden>
        {now ? m.text.slice(0, now.shown) : m.text}
        {now && <span className="cris-caret" />}
      </span>
    </div>
  );
}

export const CrisBox = forwardRef<HTMLDivElement, BoxProps>(function CrisBox(p, ref) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const keep = useRef<{ height: number; top: number } | null>(null);
  const lastPrepend = useRef(p.prependTick);
  const live = liveMessageId(p.messages);
  const fresh = p.messages.length === 0 && p.history !== "loading";
  const [quietTick, setQuietTick] = useState(p.historyTick);
  useLayoutEffect(() => {
    if (p.historyTick === quietTick) return;
    const f = requestAnimationFrame(() => setQuietTick(p.historyTick));
    return () => cancelAnimationFrame(f);
  }, [p.historyTick, quietTick]);
  const logBusy = p.bulkLoading || p.historyTick !== quietTick;
  const preview = !!p.preview;
  // The preview looks nothing up, so it never says where you are.
  const chip = preview ? null : contextLine(p.context);

  // New messages and the typing-out keep the list at its end; older messages put on top keep it where it was.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el) return;
    if (p.prependTick !== lastPrepend.current) {
      lastPrepend.current = p.prependTick;
      if (keep.current) el.scrollTop = el.scrollHeight - keep.current.height + keep.current.top;
      keep.current = null;
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [p.messages, p.typing?.shown, p.busy, p.prependTick]);

  const onEarlier = () => {
    const el = logRef.current;
    if (el) keep.current = { height: el.scrollHeight, top: el.scrollTop };
    p.onEarlier();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    p.onClose();
  };

  const busy = p.busy;
  return (
    <div
      ref={ref}
      id={p.id}
      role="dialog"
      aria-label="Chat with Cris"
      className={cn("cris-box", p.above ? "cris-above" : "cris-below", p.side === "right" ? "cris-r" : "cris-l", p.big && "is-big")}
      style={p.style}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center gap-2 border-b border-border-faint py-2.5 pl-3.5 pr-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-[14px] font-semibold leading-tight">Cris</div>
            {preview && <Pill className="px-1.5 py-0 text-[9.5px]">Preview</Pill>}
          </div>
          <div className="flex items-center gap-1.5 text-[11.5px] text-fg-secondary">
            <span
              aria-hidden
              className={cn(
                "size-[7px] shrink-0 rounded-full",
                busy ? "animate-[pulse_1.2s_ease-in-out_infinite] bg-(--st-inflight-dot)" : "bg-(--st-settled-dot)",
              )}
            />
            <span className="truncate">{p.status}</span>
          </div>
        </div>
        <span className="ml-auto flex gap-0.5">
          <IconButton aria-label="New chat" title="New chat" className="size-8" disabled={busy} onClick={p.onNewChat}>
            <svg {...iconProps}>
              <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
              <path d="M14 8l2 2" />
            </svg>
          </IconButton>
          <IconButton
            aria-label={p.big ? "Make the chat smaller" : "Make the chat bigger"}
            title={p.big ? "Make smaller" : "Make bigger"}
            className="size-8 max-[640px]:hidden"
            onClick={p.onBig}
          >
            <svg {...iconProps}>
              <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
            </svg>
          </IconButton>
          <Link
            href="/settings/cris"
            aria-label="Cris settings"
            title="Cris settings"
            className="inline-flex size-8 items-center justify-center rounded-(--radius-btn) text-fg-secondary [transition:background_var(--dur-1)_linear] hover:bg-surface-subtle"
          >
            <svg {...iconProps}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </Link>
          <IconButton aria-label="Close the chat" title="Close (Esc)" className="size-8" onClick={p.onClose}>
            <svg {...iconProps}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </IconButton>
        </span>
      </div>

      <div ref={logRef} role="log"
        aria-live="polite"
        aria-busy={logBusy || undefined}
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
        {p.more && (
          <button
            type="button"
            onClick={onEarlier}
            disabled={busy}
            className="self-center text-[12px] font-medium text-accent-soft-text underline underline-offset-2 disabled:opacity-55"
          >
            Earlier messages
          </button>
        )}
        {p.history === "loading" && <div className="self-center text-[12px] text-fg-muted">Loading the chat…</div>}
        {p.history === "failed" && (
          <div className="self-center text-[12px] text-fg-muted">
            This chat couldn&apos;t load.{" "}
            <button type="button" onClick={p.onRetryHistory} className="font-medium text-accent-soft-text underline underline-offset-2">
              Try again
            </button>
          </div>
        )}
        {fresh && (
          <>
            <div className="px-1.5 pb-1 pt-2 text-center">
              <div className="text-[15px] font-semibold">Hi {p.firstName} — what do you need?</div>
              <div className="mt-0.5 text-[12px] text-fg-secondary">{greetingLine(preview)}</div>
            </div>
            {chip && (
              <div className="flex items-center gap-[7px] rounded-[10px] bg-accent-soft px-2.5 py-[7px] text-[12px] text-accent-soft-text">
                <svg {...iconProps} width={14} height={14}>
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M5 20c1.2-3.6 4-5.2 7-5.2s5.8 1.6 7 5.2" />
                </svg>
                <span>
                  {chip.before}
                  <b className="font-semibold">{chip.name}</b>
                  {chip.after}
                </span>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {p.starts.map((s) => (
                <button key={s.label} type="button" className={chipClass} disabled={busy} onClick={() => p.onStart(s)}>
                  {s.label}
                </button>
              ))}
            </div>
          </>
        )}
        {p.messages.map((m) => {
          const queued = p.queued.has(m.id);
          const typingThis = p.typing?.id === m.id;
          return (
            <Fragment key={m.id}>
              <Bubble m={m} typing={p.typing} queued={queued} />
              {!queued && !typingThis &&
                m.cards.map((c, i) => <CrisCardView key={i} card={c} live={m.id === live} actions={p.actions} />)}
            </Fragment>
          );
        })}
        {busy && (
          <div className="cris-msg self-start rounded-[16px_16px_16px_4px] bg-(--cris-bubble) px-[11px] py-2.5 text-fg-secondary">
            <span className="cris-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <span className="sr-only">Cris is thinking</span>
          </div>
        )}
      </div>

      <CrisComposer
        ref={p.composerRef}
        value={p.draft}
        onChange={p.onDraft}
        onSend={p.onSend}
        onScan={p.onScan}
        busy={busy}
        placeholder={p.placeholder}
        left={p.left}
        scan={!preview}
        scanOpen={p.scanOpen}
        scanFocusTick={p.scanFocusTick}
        onScanOpen={p.onScanOpen}
      />
    </div>
  );
});

