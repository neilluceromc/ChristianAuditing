"use client";

import { forwardRef, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/*
 * Spec §4 "Message box": grows to about four lines; Enter sends, Shift+Enter adds a line; the scan button opens a
 * one-line field for a USB or Bluetooth scanner (which types the tag and Enter), the same as the palette's "Scan a
 * tag" — no camera; the footer counts the questions left today.
 */

/** Four lines of 12.5 px text at 1.4, plus the field's own padding. */
const MAX_HEIGHT = 96;

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  /** A tag from the scan field (Enter). */
  onScan: (tag: string) => void;
  busy: boolean;
  placeholder: string;
  left: number;
  /** Whether the scan button shows (not in preview, where Cris looks nothing up). Default true. */
  scan?: boolean;
  scanOpen: boolean;
  /** Bumped to put focus in the scan field again, even when it is already open. */
  scanFocusTick?: number;
  onScanOpen: (open: boolean) => void;
};

export const CrisComposer = forwardRef<HTMLTextAreaElement, Props>(function CrisComposer(
  { value, onChange, onSend, onScan, busy, placeholder, left, scan = true, scanOpen, onScanOpen, scanFocusTick = 0 },
  ref,
) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [tag, setTag] = useState("");

  // Grow with the text, up to four lines; then it scrolls.
  useLayoutEffect(() => {
    const el = own.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useLayoutEffect(() => {
    if (scanOpen) scanRef.current?.focus();
  }, [scanOpen, scanFocusTick]);

  const setRefs = (el: HTMLTextAreaElement | null) => {
    own.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!busy && value.trim()) onSend();
  };

  const closeScan = () => {
    setTag("");
    onScanOpen(false);
    own.current?.focus();
  };
  const onScanKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // Closes the scan field only; a second Esc closes the box.
      e.preventDefault();
      e.stopPropagation();
      closeScan();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = tag.trim();
      if (!t || busy) return;
      onScan(t);
      closeScan();
    }
  };

  const canSend = !busy && value.trim().length > 0;
  return (
    <div className="flex flex-col gap-[5px] rounded-b-[18px] border-t border-border-faint px-2.5 py-2">
      {scan && scanOpen && (
        <div className="flex items-center gap-1.5 rounded-[10px] border border-accent-soft-border bg-accent-tint px-2.5 py-1 focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--focus-shadow)]">
          <Icon name="scan" size={14} className="text-accent-soft-text" />
          <input
            ref={scanRef}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={onScanKey}
            aria-label="Scanner input"
            placeholder="Scan the label, or type the tag"
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-fg-muted"
          />
          <button type="button" onClick={closeScan} className="text-[11.5px] font-medium text-accent-soft-text underline-offset-2 hover:underline">
            Cancel
          </button>
        </div>
      )}
      <div className="flex items-end gap-1 rounded-[12px] border border-border-strong py-[5px] pl-2.5 pr-[5px] [transition:border-color_var(--dur-1),box-shadow_var(--dur-1)] focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--focus-shadow)]">
        <textarea
          ref={setRefs}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          aria-label="Your message"
          placeholder={placeholder}
          maxLength={2000}
          className="min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[12.5px] leading-[1.4] outline-none placeholder:text-fg-muted focus-visible:outline-none"
          style={{ maxHeight: MAX_HEIGHT }}
        />
        {scan && (
          <IconButton
            type="button"
            aria-label="Scan a tag"
            title="Scan a tag"
            aria-pressed={scanOpen}
            className="size-8"
            onClick={() => (scanOpen ? closeScan() : onScanOpen(true))}
          >
            <Icon name="scan" size={16} />
          </IconButton>
        )}
        <IconButton type="button" variant="primary" aria-label="Send" className="size-8 rounded-[9px]" disabled={!canSend} onClick={onSend}>
          <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h13M13 6l6 6-6 6" />
          </svg>
        </IconButton>
      </div>
      <div className="flex justify-between gap-2 px-0.5 text-[10.5px] text-fg-muted">
        <span className="max-[400px]:hidden">Enter to send · Shift+Enter for a new line</span>
        <span className="ml-auto font-mono">{left === 1 ? "1 question left today" : `${left} questions left today`}</span>
      </div>
    </div>
  );
});
