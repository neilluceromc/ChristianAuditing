"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { FormError, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ModelCombobox } from "@/components/inventory/model-combobox";
import { RegisterRows, rowFeedback } from "@/components/inventory/register-rows";
import { useIdentifierCheck } from "@/components/inventory/use-identifier-check";
import { withClsQS } from "@/lib/asset-class";
import { WARRANTY_COVERED_BY, WARRANTY_COVERED_BY_LABEL } from "@/lib/purchase-summary";
import { categoryModelExample } from "@/lib/register-catalog";
import { pasteColumn, resizeRows, type RegisterRow } from "@/lib/register-rows";
import { TYPE_REQUIRED, typeChoice } from "@/lib/register-type";
import { serialProblems } from "@/lib/serial-rules";
import { registerFromPurchaseOrder } from "@/server/modules/purchases/po-register";
import type { CatalogCategory } from "@/server/modules/inventory/register-queries";
import type { PoRegisterLine } from "@/lib/po-register-line";

interface Draft {
  count: string;
  rows: RegisterRow[];
  categoryId: string;
  typeId: string;
  model: string;
  brand: string;
  warrantyUntil: string;
  coveredBy: string;
  contact: string;
  /** IT's answer to a new IT category: Confirm, or a confirmed IT category to use instead (spec §5b.5). */
  confirm: boolean;
  replaceWith: string;
}

const emptyDraft = (count: number): Draft => ({
  count: String(count), rows: resizeRows([], count), categoryId: "", typeId: "", model: "", brand: "",
  warrantyUntil: "", coveredBy: "", contact: "", confirm: false, replaceWith: "",
});

/** The new-category prompt shows while the line's category is unconfirmed and nothing on it is registered (spec §5b.5). */
const asksCategory = (l: PoRegisterLine) => !!l.categoryId && !l.categoryConfirmed && l.registered === 0;

/** "0".."remaining" as a whole number, else null. */
function countOf(text: string, remaining: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n <= remaining ? n : null;
}

/** A server key for submitted line `i` (`lines.0.units.2.serial`) as the line's own key (`serials.2`). */
function localKey(rest: string): string {
  const unit = rest.match(/^units\.(\d+)\.(tag|serial)$/);
  if (unit) return `${unit[2] === "tag" ? "tags" : "serials"}.${unit[1]}`;
  if (rest === "units") return "count";
  return rest === "" ? "_line" : rest;
}

/**
 * Spec §4 ways 1–2 and "Partial deliveries": the register form pre-filled from a PO. One card per line with units
 * left: how many arrived now (at most what is left), then one row per unit for its tag and serial — tags are typed
 * or scanned whole, as on the Register page (Phase 36: no suggested tags), and the rows reuse its table, paste
 * and live duplicate check. Money is not asked: every asset takes the PO's supplier, SI and OR numbers and date, and
 * its line's unit price. Each submit is one registration group for Finance; it lands on the Labels tab ticked.
 */
export function PoRegisterForm({ poId, refNo, lines, catalog }: {
  poId: string;
  refNo: string;
  lines: PoRegisterLine[];
  catalog: CatalogCategory[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const open = lines.filter((l) => !l.blocked);
  // One line to register: it starts at everything left. Several: each starts at 0, so nothing is registered by accident.
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(open.map((l) => [l.id, emptyDraft(open.length === 1 ? l.remaining : 0)])));
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [attempted, setAttempted] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const categoryOf = (l: PoRegisterLine, d: Draft) => catalog.find((c) => c.id === (d.replaceWith || l.categoryId || d.categoryId));
  const clsOf = (l: PoRegisterLine, d: Draft): AssetClass | null => l.cls ?? categoryOf(l, d)?.cls ?? null;

  function patch(id: string, p: Partial<Draft>) {
    setDrafts((all) => ({ ...all, [id]: { ...all[id], ...p } }));
    setErrors((all) => {
      if (!all[id]) return all;
      const keys = Object.keys(p).flatMap((k) =>
        k === "rows" ? ["tags", "serials"] : k === "confirm" || k === "replaceWith" ? ["categoryAction"] : [k]);
      const mine = Object.fromEntries(Object.entries(all[id]).filter(([k]) => !keys.some((x) => k === x || k.startsWith(`${x}.`))));
      return { ...all, [id]: mine };
    });
  }

  const chosen = open.filter((l) => (countOf(drafts[l.id].count, l.remaining) ?? 0) > 0);
  const total = chosen.reduce((s, l) => s + countOf(drafts[l.id].count, l.remaining)!, 0);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);
    setRetryAfter(null);
    setAttempted(true);

    const found: Record<string, Record<string, string>> = {};
    const say = (id: string, key: string, message: string) => { (found[id] ??= {})[key] = message; };
    // A repeated or malformed tag is already said under its rows (rowFeedback); it only stops the submit.
    let blocked = false;
    for (const l of open) {
      const d = drafts[l.id];
      if (countOf(d.count, l.remaining) === null) say(l.id, "count", `Enter a number from 0 to ${l.remaining}`);
    }
    for (const l of chosen) {
      const d = drafts[l.id];
      const cat = categoryOf(l, d);
      if (!l.categoryId && !d.categoryId) say(l.id, "categoryId", "Pick a category");
      if (d.model.trim().length < 2) say(l.id, "model", "Name the model");
      if (cat && typeChoice(cat.types).required && !d.typeId) say(l.id, "typeId", TYPE_REQUIRED);
      const cls = clsOf(l, d);
      if (cls) {
        serialProblems(d.rows.map((r) => r.serial), cls).forEach((p, j) => {
          if (p === "required") say(l.id, `serials.${j}`, `Row ${j + 1} · ${d.rows[j].tag.trim() || "this row"} needs a serial`);
        });
      }
      blocked ||= rowFeedback({ rows: d.rows, hits: { tags: [], serials: [] }, errors: {}, attempted: true }).blocked;
    }
    if (chosen.length === 0 && Object.keys(found).length === 0) {
      setBanner("Enter how many arrived on at least one line.");
      return;
    }
    if (Object.keys(found).length > 0 || blocked) {
      setErrors(found);
      return;
    }

    const sent = chosen.map((l) => l.id);
    const payload = chosen.map((l) => {
      const d = drafts[l.id];
      const cat = categoryOf(l, d);
      return {
        lineId: l.id,
        categoryId: l.categoryId ? undefined : d.categoryId,
        typeId: d.typeId || (cat ? typeChoice(cat.types).auto ?? undefined : undefined),
        model: d.model,
        brand: d.brand || undefined,
        warrantyUntil: d.warrantyUntil || undefined,
        warrantyCoveredBy: d.coveredBy || undefined,
        warrantyContact: d.contact || undefined,
        units: d.rows.map((r) => ({ tag: r.tag, serial: r.serial.trim() || undefined })),
        categoryAction: !asksCategory(l) ? undefined
          : d.replaceWith ? { replaceWith: d.replaceWith }
          : d.confirm ? ("confirm" as const) : undefined,
      };
    });
    const firstCls = clsOf(chosen[0], drafts[chosen[0].id]);

    startTransition(async () => {
      const res = await registerFromPurchaseOrder({ poId, lines: payload });
      if (!res.ok) {
        if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
        else if (res.kind === "validation") {
          const back: Record<string, Record<string, string>> = {};
          const stray: string[] = [];
          for (const [key, message] of Object.entries(res.fieldErrors ?? {})) {
            const m = key.match(/^lines\.(\d+)(?:\.(.*))?$/);
            const id = m ? sent[Number(m[1])] : undefined;
            if (id) (back[id] ??= {})[localKey(m![2] ?? "")] = message;
            else stray.push(message);
          }
          setErrors(back);
          if (stray.length) setBanner(stray[0]);
        } else setBanner(res.message);
        return;
      }
      toast(`Registered ${res.data.created} from ${refNo}`, "settled");
      router.push("/inventory/labels" + withClsQS(`?just=${encodeURIComponent(res.data.purchaseRecordId)}`, firstCls));
    });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      // A scanner sends Enter after every scan: Enter in a field never submits (the rows move focus themselves).
      onKeyDown={(e) => {
        const t = e.target;
        if (e.key === "Enter" && t instanceof HTMLInputElement && !["button", "submit", "reset"].includes(t.type)) e.preventDefault();
      }}
      className="flex max-w-[1040px] flex-col gap-4"
    >
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {banner && <Banner tone="fault" title={banner} />}

      {lines.map((l) => (
        <LineCard
          key={l.id}
          line={l}
          draft={drafts[l.id]}
          errors={errors[l.id] ?? {}}
          attempted={attempted}
          catalog={catalog}
          onChange={(p) => patch(l.id, p)}
          disabled={pending}
        />
      ))}

      <div data-cris-avoid="" className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border bg-surface py-4">
        <p aria-live="polite" className="mr-auto text-[12.5px] font-medium text-fg-secondary">
          {total > 0 ? `${total} to register · they go to Finance as one group` : "Nothing to register yet"}
        </p>
        <ButtonLink href={`/purchases/${poId}`} variant="ghost">Cancel</ButtonLink>
        <Button type="submit" variant="primary" disabled={pending} loading={pending}>
          {total === 1 ? "Register 1 asset" : `Register ${total} assets`}
        </Button>
      </div>
    </form>
  );
}

function LineCard({ line, draft, errors, attempted, catalog, onChange, disabled }: {
  line: PoRegisterLine;
  draft: Draft | undefined;
  errors: Record<string, string>;
  attempted: boolean;
  catalog: CatalogCategory[];
  onChange: (p: Partial<Draft>) => void;
  disabled: boolean;
}) {
  const base = useId();
  const titleId = `${base}-title`;
  const countId = `${base}-count`;
  const category = catalog.find((c) => c.id === (draft?.replaceWith || line.categoryId || draft?.categoryId));
  const replaceId = `${base}-replace`;
  const askId = `${base}-ask`;
  const cls: AssetClass | null = line.cls ?? category?.cls ?? null;
  const rows = draft?.rows ?? [];
  const { hits, flush } = useIdentifierCheck(rows.map((r) => r.tag), rows.map((r) => r.serial), cls);

  const head = (
    <div className="flex flex-col gap-0.5">
      <h2 id={titleId} className="text-[15px] font-semibold text-fg">
        Line {String(line.index).padStart(2, "0")} · {line.description}
      </h2>
      <p className="font-mono text-[11px] text-fg-muted">
        {[line.progressLabel, `${line.price} each`, line.categoryName ? `${line.categoryName} · ${line.cls === "IT" ? "IT" : "non-IT"}` : "class picked here"]
          .join(" · ")}
      </p>
      {line.specs && <p className="text-[11.5px] text-fg-secondary">{line.specs}</p>}
    </div>
  );

  if (line.blocked || !draft) {
    return (
      <section aria-labelledby={titleId} className="flex flex-col gap-2 rounded-[14px] border border-border bg-surface-subtle p-4">
        {head}
        <p className="text-[12.5px] text-fg-secondary">{line.blocked} — not yours to register here.</p>
      </section>
    );
  }

  const n = countOf(draft.count, line.remaining) ?? 0;
  const feedback = rowFeedback({ rows, hits, errors, attempted });
  const problems = cls ? serialProblems(rows.map((r) => r.serial), cls) : rows.map(() => null);
  const required = cls === "IT";
  const missing = problems.filter((p) => p === "required").length;
  const typeAsk = category ? typeChoice(category.types) : { show: false, required: false, auto: null };

  function setCount(text: string) {
    const c = countOf(text, line.remaining);
    onChange(c === null ? { count: text } : { count: text, rows: resizeRows(rows, c) });
  }

  function paste(field: "tag" | "serial", at: number, values: string[]) {
    const out = pasteColumn(rows, at, values, field);
    const capped = out.rows.slice(0, line.remaining);
    onChange({ rows: capped, count: String(capped.length) });
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-[14px] border border-border bg-surface p-4 sm:p-5">
      {head}
      {errors._line && <FormError>{errors._line}</FormError>}

      {asksCategory(line) && (
        <div role="group" aria-labelledby={askId} className="flex flex-col gap-2 rounded-[10px] border border-accent-soft-border bg-accent-soft p-3">
          <p id={askId} className="text-[12.5px] font-medium text-fg">
            New category &apos;{line.categoryName}&apos; — Confirm or choose another
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button" size="sm" variant={draft.confirm ? "primary" : "secondary"} aria-pressed={draft.confirm} disabled={disabled}
              onClick={() => onChange({ confirm: !draft.confirm, replaceWith: "", typeId: "" })}
            >
              {draft.confirm ? "Confirmed" : "Confirm"}
            </Button>
            <span className="text-[11.5px] text-fg-muted">or</span>
            <label htmlFor={replaceId} className="sr-only">Choose another IT category</label>
            <Select
              id={replaceId} value={draft.replaceWith} disabled={disabled} invalid={!!errors.categoryAction} className="w-auto py-1.5 text-xs"
              onChange={(e) => onChange({ replaceWith: e.target.value, confirm: false, typeId: "" })}
            >
              <option value="">Choose another IT category…</option>
              {catalog.filter((c) => c.cls === "IT" && c.confirmed).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <p className="text-[11px] text-fg-muted">
            Registering without choosing confirms it. If it isn&apos;t IT gear, send the PO back to Purchasing with Category ticked.
          </p>
          <FormError>{errors.categoryAction}</FormError>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={countId} className="text-xs font-medium text-fg">How many arrived now</label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={countId}
            inputMode="numeric"
            autoComplete="off"
            className="w-20 text-center tabular-nums"
            invalid={!!errors.count}
            aria-describedby={`${countId}-hint`}
            value={draft.count}
            disabled={disabled}
            onChange={(e) => setCount(e.target.value)}
          />
          <Button type="button" size="sm" variant="secondary" disabled={disabled || n === line.remaining} onClick={() => setCount(String(line.remaining))}>
            All {line.remaining}
          </Button>
        </div>
        <p id={`${countId}-hint`} className="text-[11px] text-fg-muted">
          Up to {line.remaining}. The rest can be registered when it arrives, or closed short on the purchase order.
        </p>
        <FormError>{errors.count}</FormError>
      </div>

      {n > 0 && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] items-start gap-4">
            {!line.categoryId && (
              <FormField label="Category" required error={errors.categoryId}>
                {(p) => (
                  <Select
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} required
                    value={draft.categoryId}
                    onChange={(e) => onChange({ categoryId: e.target.value, typeId: "" })}
                  >
                    <option value="">Pick a category…</option>
                    {/* An old request's unit: only the categories this person may register (the page scopes the catalog). */}
                    {catalog.filter((c) => c.confirmed).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.cls === "IT" ? "IT" : "non-IT"}</option>)}
                  </Select>
                )}
              </FormField>
            )}
            {typeAsk.show && category && (
              <FormField label="Type" required error={errors.typeId}>
                {(p) => (
                  <Select
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} required
                    value={draft.typeId}
                    onChange={(e) => onChange({ typeId: e.target.value })}
                  >
                    <option value="">Pick a type…</option>
                    {category.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                )}
              </FormField>
            )}
            <FormField label="Model" required error={errors.model}>
              {(p) => (
                <ModelCombobox
                  id={p.id}
                  describedBy={p["aria-describedby"]}
                  invalid={p.invalid}
                  models={category?.models ?? []}
                  value={draft.model}
                  onValue={(v) => onChange({ model: v })}
                  placeholder={categoryModelExample(category?.name, cls ?? "IT")}
                />
              )}
            </FormField>
            <FormField label="Brand" error={errors.brand}>
              {(p) => (
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={draft.brand} onChange={(e) => onChange({ brand: e.target.value })} />
              )}
            </FormField>
            <FormField label="Warranty until" error={errors.warrantyUntil}>
              {(p) => (
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date"
                  value={draft.warrantyUntil} onChange={(e) => onChange({ warrantyUntil: e.target.value })} />
              )}
            </FormField>
            <FormField label="Warranty covered by" error={errors.warrantyCoveredBy}>
              {(p) => (
                <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={draft.coveredBy} onChange={(e) => onChange({ coveredBy: e.target.value })}>
                  <option value="">—</option>
                  {WARRANTY_COVERED_BY.map((v) => <option key={v} value={v}>{WARRANTY_COVERED_BY_LABEL[v]}</option>)}
                </Select>
              )}
            </FormField>
            <FormField label="Who to call for repairs" error={errors.warrantyContact}>
              {(p) => (
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={draft.contact} onChange={(e) => onChange({ contact: e.target.value })} />
              )}
            </FormField>
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="sec">{required ? "Tags and serials" : "Tags (serials optional)"}</h3>
            {required && <p className="text-[11.5px] text-fg-muted">IT gear needs a serial on every unit.</p>}
          </div>
          <RegisterRows
            rows={rows}
            invalidTags={feedback.invalidTags}
            invalidSerials={new Set([...feedback.invalidSerials, ...(attempted ? problems.flatMap((p, i) => (p ? [i] : [])) : [])])}
            serialPlaceholder={required ? "Required" : "Optional"}
            onTag={(i, tag) => onChange({ rows: rows.map((r, j) => (j === i ? { ...r, tag } : r)) })}
            onSerial={(i, serial) => onChange({ rows: rows.map((r, j) => (j === i ? { ...r, serial } : r)) })}
            onPasteTags={(i, values) => paste("tag", i, values)}
            onPasteSerials={(i, values) => paste("serial", i, values)}
            onBlur={flush}
            onLastEnter={() => {}}
          >
            <p className="text-[11px] text-fg-muted">Paste a column of tags or serials into any row to fill it and the rows below.</p>
            {attempted && required && missing > 0 && (
              <FormError>{missing === 1 ? "1 row has no serial — enter it before you register." : `${missing} rows have no serial — enter them before you register.`}</FormError>
            )}
            {feedback.lines.filter((l) => !/ needs a serial$/.test(l.text)).map((l) => <FormError key={l.text}>{l.node}</FormError>)}
          </RegisterRows>
        </>
      )}
    </section>
  );
}
