"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { focusOnPasswordShown } from "@/lib/users-panel-focus";

/**
 * Users & access (spec §4.4, Global Constraints): a temporary password, shown once with Copy ("Copied ✓" after).
 * It lives only in the props of whoever got it from the action result: never a URL, a log line or storage. A
 * read-only field, so it can also be selected by hand where the clipboard is refused.
 */
export function TempPasswordBox({
  password,
  label = "Temporary password",
  copiedDefault = false,
  takeFocus = false,
}: {
  password: string;
  label?: string;
  /**
   * Fix round 2 (N-1): focus moves here as it appears (Reset's second step, Add user's created step), so the label and
   * the password are read out instead of focus falling to the page as the button that asked for it goes away.
   */
  takeFocus?: boolean;
  /** tests only: render the copied state */
  copiedDefault?: boolean;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(copiedDefault);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!takeFocus) return;
    for (const selector of focusOnPasswordShown()) {
      const el = root.current?.querySelector<HTMLElement>(selector);
      if (el) {
        el.focus();
        break;
      }
    }
    // mount only: the box appears once per password
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      // The clipboard can be refused (an insecure origin, a denied permission): select it for a manual copy instead.
      field.current?.focus();
      field.current?.select();
    }
  }

  return (
    <div ref={root} className="flex flex-col gap-1.5" data-takes-focus={takeFocus ? "" : undefined}>
      <label htmlFor={id} className="text-xs font-medium text-fg">{label}</label>
      <div className="flex gap-2">
        <input
          ref={field}
          id={id}
          readOnly
          value={password}
          autoComplete="off"
          spellCheck={false}
          data-temp-password=""
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 min-w-0 flex-1 rounded-(--radius-card) border border-border bg-surface-subtle px-3 font-mono text-[15px] tracking-[0.03em] text-fg focus:outline-none focus-visible:border-accent"
        />
        <Button type="button" variant="secondary" className="h-11 shrink-0" data-focus="temp-copy" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">{copied ? "Copied to the clipboard" : ""}</span>
    </div>
  );
}
