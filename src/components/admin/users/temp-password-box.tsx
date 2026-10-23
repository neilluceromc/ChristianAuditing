"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Users & access (spec §4.4, Global Constraints): a temporary password, shown once with Copy ("Copied ✓" after).
 * It lives only in the props of whoever got it from the action result: never a URL, a log line or storage. A
 * read-only field, so it can also be selected by hand where the clipboard is refused.
 */
export function TempPasswordBox({
  password,
  label = "Temporary password",
  copiedDefault = false,
}: {
  password: string;
  label?: string;
  /** tests only: render the copied state */
  copiedDefault?: boolean;
}) {
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(copiedDefault);

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
    <div className="flex flex-col gap-1.5">
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
        <Button type="button" variant="secondary" className="h-11 shrink-0" onClick={copy}>
          {copied ? "Copied ✓" : "Copy"}
        </Button>
      </div>
      <span aria-live="polite" className="sr-only">{copied ? "Copied to the clipboard" : ""}</span>
    </div>
  );
}
