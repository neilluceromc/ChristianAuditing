"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination, type PaginationLinkProps } from "@/components/ui/pagination";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { waitForAll } from "@/lib/pending-saves";
import { parseCount, sheetHref, type SheetState } from "@/lib/stocktake";
import { countStocktakeLine } from "@/server/modules/stock/stocktake-actions";
import type { FacetOption } from "@/server/modules/inventory/queries";
import { StocktakeSheetToolbar } from "./stocktake-sheet-toolbar";

export interface CountLine {
  id: string; // StocktakeLine id — what countStocktakeLine takes as lineId
  code: string;
  name: string;
  unit: string;
  countedQty: number | null;
}

type Gate = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => void;
const GateContext = createContext<Gate | null>(null);

/** Pagination's page link, held until the row saves land (see `go` below). */
function SaveFirstLink({ href, ...rest }: PaginationLinkProps) {
  const gate = useContext(GateContext);
  return <Link href={href} {...rest} onClick={(e) => gate?.(e, href)} />;
}

const INVALID = "A whole number, zero or more";

/**
 * Spec §5.3, Task 5 Step 4 — the blind count screen. Book quantity is
 * NEVER rendered here (that's the review's job); each row saves itself on
 * blur or Enter (P-3: one line per action, no batch endpoint), independent
 * of every other row's pending/saved state.
 *
 * Leftover 5 (spec §8): the page only ever renders this component when
 * `manage && st.state === "OPEN"` (its sibling `StocktakeReview` branch
 * covers every other case).
 *
 * Phase 39 (spec §4.1): one page of 50 lines, with search, Category and Only
 * uncounted. "Paging never loses a typed value":
 * - every save is held in `pending` (one chain per row, so a blur after
 *   Enter waits for the Enter's save instead of racing it);
 * - every page, filter or "Review variance" navigation (`go`) first stops on
 *   any box holding something that is not a count (inline message, focus
 *   there), saves any row still holding an unsaved count, waits for all of
 *   them (`waitForAll`), and only then moves — staying put, with the error
 *   showing, when a save failed and retrying could help (rate limit, the
 *   network). A refusal retrying cannot fix (the stocktake is no longer
 *   open) lets the navigation through, so nobody is trapped on the page.
 *
 * Focus never falls to the page: the component is not keyed by the URL (the
 * toolbar and pagination stay mounted; the rows reset to the server's values
 * when the URL changes), the first box is focused once on mount only, and
 * under Only uncounted — where a counted row drops out when the save's
 * refresh lands — Enter moves focus on to the next row first.
 */
export function StocktakeCount({
  stocktakeId,
  lines,
  sheet,
  categories,
  page,
  pageCount,
  counted,
  total,
}: {
  stocktakeId: string;
  lines: CountLine[];
  sheet: SheetState;
  categories: FacetOption[];
  page: number;
  pageCount: number;
  /** Over the whole stocktake, not this page. */
  counted: number;
  total: number;
}) {
  const router = useRouter();
  const initialValues = () =>
    Object.fromEntries(lines.map((l) => [l.id, l.countedQty === null ? "" : String(l.countedQty)]));
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  // A page or filter change: the rows start again from the server's values. A save's own refresh keeps the same
  // URL, so it keeps what is being typed.
  const urlKey = sheetHref(stocktakeId, "count", sheet);
  const [shownKey, setShownKey] = useState(urlKey);
  if (urlKey !== shownKey) {
    setShownKey(urlKey);
    setValues(initialValues());
    setSaved({});
    setInvalid({});
    setError(null);
  }

  const pending = useRef(new Set<Promise<boolean>>());
  const chains = useRef(new Map<string, Promise<boolean>>());
  /** What this session saved, per line; the server's `countedQty` otherwise. */
  const savedQty = useRef(new Map<string, number>());
  /** Set once the server refuses a count for good (no longer open): saving stops and navigation is let through. */
  const refused = useRef(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Mount only (never on a page change, which would pull focus off the control just used).
    if (lines[0]) inputs.current.get(lines[0].id)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The box's count; a browser-rejected entry in a number box ("1e", "abc") reads as "" but is still not a count. */
  const entry = (l: CountLine) => (inputs.current.get(l.id)?.validity.badInput ? "invalid" : parseCount(values[l.id]));
  const lastSaved = (l: CountLine) => (savedQty.current.has(l.id) ? savedQty.current.get(l.id)! : l.countedQty);

  function setValue(id: string, value: string) {
    setValues((s) => ({ ...s, [id]: value }));
    setSaved((s) => ({ ...s, [id]: false }));
    setInvalid((s) => ({ ...s, [id]: false }));
  }

  /** Queues the row's save; false when there is nothing to save (blank, not a count, or the stocktake refused). */
  function save(line: CountLine): boolean {
    const countedQty = entry(line);
    if (countedQty === "blank") return false;
    if (countedQty === "invalid") {
      setInvalid((s) => ({ ...s, [line.id]: true }));
      return false;
    }
    if (refused.current) return false;
    const prev = chains.current.get(line.id) ?? Promise.resolve(true);
    const p = prev.then(async () => {
      if (lastSaved(line) === countedQty) return true; // already saved (Enter, then the blur)
      if (refused.current) return true;
      setError(null);
      try {
        const res = await countStocktakeLine({ lineId: line.id, countedQty });
        if (!res.ok) {
          setError(`${line.code}: ${res.message}`);
          // A conflict (no longer open) or forbidden never succeeds on a retry: don't trap the user on this page.
          if (res.kind === "conflict" || res.kind === "forbidden") {
            refused.current = true;
            return true;
          }
          return false;
        }
      } catch {
        setError(`The count for ${line.code} didn't save — try again.`);
        return false;
      }
      savedQty.current.set(line.id, countedQty);
      setSaved((s) => ({ ...s, [line.id]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [line.id]: false })), 3000);
      return true;
    });
    chains.current.set(line.id, p);
    pending.current.add(p);
    void p.then(() => {
      pending.current.delete(p);
      if (chains.current.get(line.id) === p) chains.current.delete(line.id);
    });
    return true;
  }

  async function go(href: string) {
    const bad = lines.filter((l) => entry(l) === "invalid");
    if (bad.length) {
      setInvalid((s) => ({ ...s, ...Object.fromEntries(bad.map((l) => [l.id, true])) }));
      inputs.current.get(bad[0].id)?.focus();
      return;
    }
    for (const l of lines) {
      const qty = entry(l);
      if (typeof qty === "number" && qty !== lastSaved(l)) save(l);
    }
    if (await waitForAll(pending.current)) router.push(href);
  }

  const gate: Gate = (e, href) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // a new tab leaves this one as it is
    e.preventDefault();
    void go(href);
  };

  const reviewHref = `/stock/stocktakes/${stocktakeId}?view=review`;
  const filtered = Boolean(sheet.q) || sheet.cats.length > 0 || sheet.only;

  return (
    <GateContext.Provider value={gate}>
      <div className="flex flex-col gap-3">
        <StocktakeSheetToolbar
          sheet={sheet}
          categories={categories}
          toggleLabel="Only uncounted"
          onChange={(next) => void go(sheetHref(stocktakeId, "count", next))}
          searchRef={searchRef}
        />
        {error && <Banner tone="fault" title={error} />}
        {lines.length === 0 && filtered ? (
          <p className="py-6 text-center text-[12px] text-fg-muted">No item matches.</p>
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Unit</Th>
                <Th align="right">Counted</Th>
              </Tr>
            </THead>
            <TBody>
              {lines.map((l, i) => (
                <Tr key={l.id}>
                  <Td mono>{l.code}</Td>
                  <Td>{l.name}</Td>
                  <Td>{l.unit}</Td>
                  <Td align="right">
                    <span className="inline-flex flex-col items-end gap-1">
                      <span className="inline-flex items-center justify-end gap-2">
                        <Input
                          ref={(el) => {
                            if (el) inputs.current.set(l.id, el);
                            else inputs.current.delete(l.id);
                          }}
                          aria-label={`Counted ${l.code}`}
                          aria-describedby={invalid[l.id] ? `count-invalid-${l.id}` : undefined}
                          invalid={invalid[l.id]}
                          type="number"
                          min={0}
                          step={1}
                          className="w-24 text-right"
                          value={values[l.id] ?? ""}
                          onChange={(e) => setValue(l.id, e.target.value)}
                          onBlur={() => save(l)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            if (save(l) && sheet.only) {
                              // Under Only uncounted this row drops out once the save's refresh lands: move on
                              // first (the next row, else the previous one, else the search) so focus never falls
                              // to the page.
                              const next = lines[i + 1] ?? lines[i - 1];
                              (next ? inputs.current.get(next.id) : searchRef.current)?.focus();
                            }
                          }}
                        />
                        {saved[l.id] && (
                          <span className="text-accent" title="Saved">
                            <span aria-hidden>✓</span>
                            <span className="sr-only">Saved</span>
                          </span>
                        )}
                      </span>
                      {invalid[l.id] && <FormError id={`count-invalid-${l.id}`}>{INVALID}</FormError>}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-fg-muted">{counted}/{total} counted</p>
          <Pagination
            page={page}
            pageCount={pageCount}
            hrefFor={(p) => sheetHref(stocktakeId, "count", { ...sheet, page: p })}
            linkComponent={SaveFirstLink}
          />
          <ButtonLink href={reviewHref} variant="primary" onClick={(e) => gate(e, reviewHref)}>Review variance</ButtonLink>
        </div>
      </div>
    </GateContext.Provider>
  );
}
