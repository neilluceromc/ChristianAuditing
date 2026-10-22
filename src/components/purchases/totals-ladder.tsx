import { cn } from "@/lib/cn";
import { fmtMoneyExact } from "@/lib/format";
import { checkTotals, itemsTotal, TOTAL_KEYS, TOTAL_LABEL, type TotalKey } from "@/lib/po-totals";

export interface TotalsLadderProps {
  /** The seven totals typed off the sales invoice (null where blank). */
  totals: Record<TotalKey, number | null>;
  /** The PO's stored check (spec §3): false shows the "didn't add up" note; null is a PO never checked. */
  totalsConsistent: boolean | null;
  /** The PO's lines, for the items total the note compares total sales against. */
  lines: ReadonlyArray<{ qty: number; unitPrice: number | null }>;
  /**
   * Today's Fees and Total (the lines' sum), shown instead of the ladder on a legacy PO with no typed totals; a PO
   * with totals that still has old fees shows them under it. Without it, a PO with no totals shows nothing.
   */
  legacy?: { fees: number | null; total: number };
}

const money = (n: number | null) => (n === null ? "—" : fmtMoneyExact(n));

function Row({ k, label, value, strong }: { k?: string; label: string; value: string; strong?: boolean }) {
  return (
    <div
      data-total={k}
      className={cn(
        "flex items-baseline justify-between gap-3",
        strong ? "mt-1 border-t-[1.5px] border-fg pt-2 font-semibold uppercase tracking-[0.02em] text-fg" : "text-fg-secondary",
      )}
    >
      <dt className={strong ? "text-[12.5px]" : "text-[12.5px] font-normal"}>{label}</dt>
      <dd className={cn("font-mono tabular-nums", strong ? "text-[14px]" : "text-xs")}>{value}</dd>
    </div>
  );
}

/**
 * PO form redesign (spec §2.9, §6): the invoice totals, read-only — the seven figures in the invoice's order with
 * TOTAL AMOUNT DUE bold — on the PO page and Finance's group review. When the PO's totals didn't add up when they
 * were last written (`totalsConsistent === false`), a note names each line that doesn't and what it expected
 * (checkTotals against Σ qty × unit price). Never computes a figure: what is shown is what Purchasing typed.
 */
export function TotalsLadder({ totals, totalsConsistent, lines, legacy }: TotalsLadderProps) {
  const typed = TOTAL_KEYS.some((k) => totals[k] !== null);

  if (!typed) {
    if (!legacy) return null;
    return (
      <dl className="flex flex-col gap-1.5">
        <Row label="Fees" value={money(legacy.fees)} />
        <Row label="Total" value={money(legacy.total)} />
      </dl>
    );
  }

  const problems = totalsConsistent === false
    ? checkTotals(itemsTotal(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice }))), totals).problems
    : {};
  const flagged = TOTAL_KEYS.filter((k) => problems[k]);

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-1.5" aria-label="Invoice totals">
        {TOTAL_KEYS.map((k) => (
          <Row key={k} k={k} label={TOTAL_LABEL[k]} value={money(totals[k])} strong={k === "totalAmountDue"} />
        ))}
        {legacy && legacy.fees !== null && <Row label="Fees (before the new form)" value={money(legacy.fees)} />}
      </dl>
      {totalsConsistent === false && (
        <div
          className="rounded-(--radius-card) border px-3 py-2.5"
          style={{ background: "var(--st-attention-bg)", borderColor: "var(--st-attention-border)" }}
        >
          <p className="text-[12.5px] font-semibold" style={{ color: "var(--st-attention-text)" }}>Totals didn&apos;t add up on the PO</p>
          {flagged.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs text-fg-secondary">
              {flagged.map((k) => <li key={k}>{TOTAL_LABEL[k]}: {problems[k]}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-fg-secondary">
              {totals.totalAmountDue === null ? "No total amount due was typed." : "Check the figures against the sales invoice."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
