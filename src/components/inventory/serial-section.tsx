"use client";

import Link from "next/link";
import type { AssetClass } from "@prisma/client";
import { FormError } from "@/components/ui/form-field";
import { fieldClasses } from "@/components/ui/input";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { badTags, registeredRows, type IdentifierHits, type RegisterRow } from "@/lib/register-rows";
import { serialRequired, type SerialProblem } from "@/lib/serial-rules";
import { RegisterRows } from "./register-rows";

export const SERIAL_REQUIRED = "Enter the serial number before you register.";
const NEEDS_SERIAL = / needs a serial$/;

/**
 * Phase 34 (spec §4.3): the serial — required on every IT unit, optional for
 * Purchasing. One unit gets one big scan-or-type box with its tag beside it;
 * a batch keeps the Register rows table with a status per row. Enter never
 * submits from either (Review Focus 2): a scanner sends one after every scan.
 */
export function SerialSection({
  cls,
  rows,
  problems,
  attempted,
  hits,
  onSerial,
  onPasteSerials,
  onPasteTags,
  onTag,
  onLastEnter,
  invalidTags,
  invalidSerials,
  lines,
  pasteNote,
  onBlur,
  serialRef,
  copy = { label: "Serial number", hint: "Required. It’s on the box label or the sticker under the device." },
}: {
  cls: AssetClass;
  /** What the box asks for — a Windows licence asks for its licence / COA number (categorySerialCopy). */
  copy?: { label: string; hint: string };
  rows: readonly RegisterRow[];
  problems: SerialProblem[];
  attempted: boolean;
  hits: IdentifierHits;
  onSerial: (i: number, v: string) => void;
  onPasteSerials: (i: number, values: string[]) => void;
  onPasteTags: (i: number, values: string[]) => void;
  onTag: (i: number, v: string) => void;
  /** Enter in the one-unit box, or in the last row's serial. */
  onLastEnter: () => void;
  invalidTags: Set<number>;
  invalidSerials: Set<number>;
  /** `rowFeedback`'s lines: repeats, records already registered, the server's row messages. */
  lines: Array<{ text: string; node: React.ReactNode }>;
  pasteNote: string | null;
  onBlur: () => void;
  serialRef?: React.Ref<HTMLInputElement>;
}) {
  const required = serialRequired(cls);
  const single = rows.length === 1;
  const live = registeredRows(rows, hits);
  const hintId = "register-serial-hint";
  const errorId = "register-serial-error";
  const missing = single && required && attempted && problems[0] === "required";
  // The per-row "needs a serial" refusals are said once, here, and by each row's status.
  const missingRows = problems.filter((p) => p === "required").length;
  // One unit: the empty or bad tag is said under the Tag box itself, without a row number.
  const badTag = single && attempted ? badTags(rows).message : null;
  const tagMessage = badTag ? badTag.replace(/^Row 1 · /, "") : null;
  const tagErrorId = "register-tag-error";
  const shown = lines.filter((l) => !NEEDS_SERIAL.test(l.text) && !l.text.endsWith(SERIAL_REQUIRED) && l.text !== badTag);

  function status(i: number): React.ReactNode {
    const tagHit = live.tags.find((t) => t.row === i);
    const serialHit = live.serials.find((s) => s.row === i);
    const hit = serialHit ?? tagHit;
    if (hit) {
      return (
        <Link href={`/inventory/${hit.id}`} className="font-medium underline" style={{ color: "var(--error-text)" }}>
          already registered
        </Link>
      );
    }
    if (problems[i] === "duplicate") return <span className="font-medium text-[var(--st-attention-text)]">duplicate</span>;
    if (problems[i] === "required") {
      return attempted
        ? <span className="font-medium" style={{ color: "var(--error-text)" }}>required</span>
        : <span className="text-fg-muted">missing</span>;
    }
    return <span className="text-[var(--st-settled-text)]">✓ ready</span>;
  }

  return (
    <section aria-labelledby="register-serial-title" className="flex flex-col gap-3 border-t border-border pt-6">
      <div className="flex flex-col gap-1">
        <h2 id="register-serial-title" className="sec">
          {required ? copy.label : `${copy.label} (optional)`}
          {required && <span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>}
        </h2>
        {required && (
          <p id={hintId} className="text-[11.5px] text-fg-muted">{copy.hint}</p>
        )}
      </div>

      {single ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="register-tag" className="text-xs font-medium text-fg">
              Tag
              <span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>
            </label>
            <Input
              id="register-tag"
              autoComplete="off"
              spellCheck={false}
              invalid={invalidTags.has(0)}
              aria-describedby={tagMessage ? tagErrorId : undefined}
              className="max-w-[320px] font-mono"
              value={rows[0].tag}
              onChange={(e) => onTag(0, e.target.value)}
              onBlur={onBlur}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                document.getElementById("register-serial")?.focus();
              }}
            />
            {tagMessage && <p id={tagErrorId} className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{tagMessage}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
          <label htmlFor="register-serial" className="text-xs font-medium text-fg">
            {copy.label}
            {required && <span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={serialRef}
              id="register-serial"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={missing || invalidSerials.has(0) || undefined}
              aria-describedby={[required ? hintId : null, missing ? errorId : null].filter(Boolean).join(" ") || undefined}
              placeholder={required ? "Scan or type the serial" : "Optional"}
              enterKeyHint="next"
              className={cn(fieldClasses(missing || invalidSerials.has(0)), "h-[54px] w-auto min-w-0 flex-1 px-3.5 font-mono text-[16px]")}
              value={rows[0].serial}
              onChange={(e) => onSerial(0, e.target.value)}
              onBlur={onBlur}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                // Review Focus 2: a scanner's trailing Enter moves on, it never submits.
                e.preventDefault();
                onLastEnter();
              }}
            />
          </div>
          {missing && <p id={errorId} className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{SERIAL_REQUIRED}</p>}
          {shown.map((l) => <FormError key={l.text}>{l.node}</FormError>)}
          </div>
        </div>
      ) : (
        <RegisterRows
          rows={rows}
          invalidTags={invalidTags}
          invalidSerials={invalidSerials}
          serialPlaceholder={required ? "Required" : "Optional"}
          status={status}
          onTag={onTag}
          onSerial={onSerial}
          onPasteSerials={onPasteSerials}
          onPasteTags={onPasteTags}
          onBlur={onBlur}
          onLastEnter={onLastEnter}
        >
          <p className="text-[11px] text-fg-muted">Paste a column of tags or serials into any row to fill it and the rows below.</p>
          {pasteNote && <p role="status" className="text-[11px] text-fg-secondary">{pasteNote}</p>}
          {attempted && required && missingRows > 0 && (
            <FormError>{missingRows === 1 ? "1 row has no serial — enter it before you register." : `${missingRows} rows have no serial — enter them before you register.`}</FormError>
          )}
          {shown.map((l) => <FormError key={l.text}>{l.node}</FormError>)}
        </RegisterRows>
      )}
    </section>
  );
}
