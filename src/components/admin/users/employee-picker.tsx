"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-field";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { PEOPLE_DEBOUNCE_MS } from "@/lib/people-search";
import { searchLinkableEmployees } from "@/server/modules/admin/employee-link-search";

const IDLE = "Type a name or employee no.";
const NONE = "No active employee without an account matches.";
const FAILED = "Search is unavailable — try again in a moment.";

/** The closest match first: the exact name, then names starting with the text, then the rest (server order kept). */
export function rankByName(options: ComboOption[], name: string): ComboOption[] {
  const want = name.trim().toLowerCase();
  if (!want) return options;
  const score = (o: ComboOption) => {
    const label = o.label.toLowerCase();
    return label === want ? 0 : label.startsWith(want) ? 1 : 2;
  };
  return options.map((o, i) => ({ o, i })).sort((a, b) => score(a.o) - score(b.o) || a.i - b.i).map(({ o }) => o);
}

/**
 * Users & access (spec §4.4; Users2's Add user): the employee record picker — a search field with the matches listed
 * under it (ACTIVE employees with no account yet, from `searchLinkableEmployees`). `initialQuery` searches at once
 * (Approve sign-up passes the person's name, so the closest match shows first; a full name that finds no one falls
 * back to the first name once). Picking the picked one again un-picks it.
 */
export function EmployeePicker({
  label,
  hint,
  initialQuery = "",
  value,
  onPick,
  error,
  disabled,
}: {
  label: React.ReactNode;
  hint?: string;
  initialQuery?: string;
  value: ComboOption | null;
  onPick: (option: ComboOption | null) => void;
  error?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ComboOption[] | null>(null); // null: no answer yet for this text
  const [failed, setFailed] = useState(false);
  const counter = useRef(0);
  /** the pre-search fell back to the first name (it then still ranks by the full name) */
  const autoFell = useRef(false);
  /** the person typed: no more fallback, and the typed text ranks */
  const typed = useRef(false);

  useEffect(() => {
    const q = query.trim();
    const mine = ++counter.current;
    if (!q) { setResults(null); setFailed(false); return; }
    setResults(null);
    const timer = setTimeout(async () => {
      let next: ComboOption[] = [];
      let bad = false;
      try {
        const res = await searchLinkableEmployees(q);
        if (res.ok) next = res.data; else bad = true;
      } catch { bad = true; }
      if (mine !== counter.current) return;
      // The pre-search with a full name found no one: try the first name once, so a near match still shows.
      const first = initialQuery.trim().split(/\s+/)[0] ?? "";
      if (!bad && next.length === 0 && !typed.current && !autoFell.current && q === initialQuery.trim() && first && first !== q) {
        autoFell.current = true;
        setQuery(first);
        return;
      }
      setFailed(bad);
      setResults(rankByName(next, typed.current ? q : initialQuery || q));
    }, PEOPLE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, initialQuery]);

  const listed = results ?? [];
  const emptyText = !query.trim() ? IDLE : results === null ? "Searching…" : failed ? FAILED : NONE;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-fg">{label}</label>
      <Input
        id={id}
        type="search"
        value={query}
        disabled={disabled}
        maxLength={60}
        placeholder="Search name or EMP number"
        autoComplete="off"
        invalid={!!error}
        aria-describedby={[hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        className="h-11"
        onChange={(e) => { typed.current = true; setQuery(e.currentTarget.value); }}
        // Enter searches as typing does; it must never submit the form around it (Add user's Create account)
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      />
      {hint && <p id={hintId} className="text-[11px] text-fg-muted">{hint}</p>}
      <FormError id={errorId}>{error}</FormError>
      {value && (
        <p className="text-[12px] text-fg-secondary">
          Linked: <span className="font-medium text-fg">{value.label}</span>
          {value.sub && <span className="text-fg-muted"> · {value.sub}</span>}
        </p>
      )}
      <ul aria-label="Matching employees" aria-busy={query.trim() !== "" && results === null} className="flex flex-col rounded-(--radius-card) border border-border p-1">
        {listed.length === 0 ? (
          <li className="px-2.5 py-2 text-[12.5px] text-fg-muted" aria-live="polite">{emptyText}</li>
        ) : (
          listed.map((o) => {
            const on = value?.value === o.value;
            return (
              <li key={o.value}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => onPick(on ? null : o)}
                  className={cn(
                    "flex min-h-[44px] w-full items-center gap-2.5 rounded-(--radius-btn) px-2.5 text-left",
                    on ? "bg-accent-soft text-accent-soft-text" : "hover:bg-surface-subtle",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{o.label}</span>
                  {o.sub && <span className="shrink-0 text-[11.5px] text-fg-muted">{o.sub}</span>}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
