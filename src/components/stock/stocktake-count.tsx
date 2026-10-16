"use client";

import { createContext, useContext, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Pagination, type PaginationLinkProps } from "@/components/ui/pagination";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { waitForAll } from "@/lib/pending-saves";
import { sheetHref, type SheetState } from "@/lib/stocktake";
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

/** A whole, non-negative number, or null for a blank or unusable entry (never saved). */
function parseCount(raw: string | undefined): number | null {
  const t = (raw ?? "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

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
 * uncounted. "Paging never loses a typed value": every save is held in
 * `pending` (one chain per row, so a blur after Enter waits for the Enter's
 * save instead of racing it), and every page, filter or "Review variance"
 * navigation first saves any row still holding an unsaved count, waits for
 * all of them (`waitForAll`), and only then moves — staying put, with the
 * error showing, if one failed. The page keys this component by the URL, so
 * each page starts from the server's values.
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
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.countedQty === null ? "" : String(l.countedQty)])),
  );
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(new Set<Promise<boolean>>());
  const chains = useRef(new Map<string, Promise<boolean>>());
  const savedQty = useRef(new Map<string, number | null>(lines.map((l) => [l.id, l.countedQty])));

  function setValue(id: string, value: string) {
    setValues((s) => ({ ...s, [id]: value }));
    setSaved((s) => ({ ...s, [id]: false }));
  }

  function save(line: CountLine) {
    const countedQty = parseCount(values[line.id]);
    if (countedQty === null) return;
    const prev = chains.current.get(line.id) ?? Promise.resolve(true);
    const p = prev.then(async () => {
      if (savedQty.current.get(line.id) === countedQty) return true; // already saved (Enter, then the blur)
      setError(null);
      try {
        const res = await countStocktakeLine({ lineId: line.id, countedQty });
        if (!res.ok) {
          setError(res.message);
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
  }

  async function go(href: string) {
    for (const l of lines) {
      const qty = parseCount(values[l.id]);
      if (qty !== null && qty !== savedQty.current.get(l.id)) save(l);
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
                    <span className="inline-flex items-center justify-end gap-2">
                      <Input
                        aria-label={`Counted ${l.code}`}
                        type="number"
                        min={0}
                        step={1}
                        autoFocus={i === 0}
                        className="w-24 text-right"
                        value={values[l.id] ?? ""}
                        onChange={(e) => setValue(l.id, e.target.value)}
                        onBlur={() => save(l)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); save(l); }
                        }}
                      />
                      {saved[l.id] && (
                        <span className="text-accent" title="Saved">
                          <span aria-hidden>✓</span>
                          <span className="sr-only">Saved</span>
                        </span>
                      )}
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
