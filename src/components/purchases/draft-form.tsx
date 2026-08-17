"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { useToast } from "@/components/ui/toast";
import { createDraft, saveDraft } from "@/server/modules/purchases/draft-actions";
import { submitRequest } from "@/server/modules/purchases/actions";
import type { PolicyLoadout } from "@/server/modules/purchases/queries";
import type { ActionResult } from "@/server/action-result";

export interface UnitDraft {
  id?: string;
  description: string;
  specs: string;
  qty: string;
  unitPrice: string;
}

const emptyRow = (): UnitDraft => ({ description: "", specs: "", qty: "1", unitPrice: "" });

const AUTOSAVE_MS = 2500;

/** The wire shape: strings from the inputs become numbers exactly once, here. */
function toPayload(units: UnitDraft[]) {
  return units
    .filter((u) => u.description.trim().length >= 2)
    .map((u) => ({
      id: u.id,
      description: u.description.trim(),
      specs: u.specs.trim(),
      qty: Number.parseInt(u.qty, 10) || 1,
      unitPrice: u.unitPrice.trim() === "" ? null : Number(u.unitPrice),
    }));
}

/**
 * Units are rows, not a repeated form (README 3f). The DRAFT row itself is
 * created by the FIRST autosave — opening this page and walking away leaves no
 * junk PR behind — and every later autosave edits that same row in place, so
 * typing is never interrupted by a navigation. Reloading /purchases/new
 * deliberately starts a new draft; the chip links to the saved one.
 */
export function DraftForm({
  loadouts,
  initial,
}: {
  loadouts: PolicyLoadout[];
  initial?: { id: string; refNo: string; units: UnitDraft[] };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [units, setUnits] = useState<UnitDraft[]>(initial?.units.length ? initial.units : [emptyRow()]);
  const [draft, setDraft] = useState<{ id: string; refNo: string } | null>(
    initial ? { id: initial.id, refNo: initial.refNo } : null,
  );
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [loadoutId, setLoadoutId] = useState("");
  const lastSaved = useRef<string>(JSON.stringify(toPayload(initial?.units ?? [])));
  // Guards the FIRST createDraft: while it's in flight, `draft` is still
  // null, so anything else that would otherwise fire its own createDraft
  // (a later autosave tick, or the Submit button) joins this promise instead.
  const createInFlight = useRef<ReturnType<typeof createDraft> | null>(null);

  const handleFailure = useCallback((res: Extract<ActionResult<unknown>, { ok: false }>) => {
    if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else setError(res.fieldErrors ? Object.values(res.fieldErrors)[0] ?? res.message : res.message);
  }, []);

  /**
   * Single chokepoint for "write these units somewhere" — every caller routes
   * through here rather than choosing between createDraft/saveDraft itself.
   * Without this, two callers that both observe `draft === null` (e.g. an
   * autosave tick firing while an earlier createDraft is still awaiting its
   * response, or the user hitting Submit during that same window) would each
   * mint a fresh PR-#### row for what the user experiences as one draft.
   *
   * Because nothing awaits between reading `createInFlight.current` and
   * writing it below, a second caller arriving before the first create
   * resolves always observes the in-flight promise (JS runs synchronously
   * between await points) and joins it rather than starting a second one. A
   * joiner's own payload may already be newer than what that create actually
   * persisted, so once the id exists it still saves its payload via
   * saveDraft rather than assuming the create covered it.
   */
  const persist = useCallback(
    async (payload: ReturnType<typeof toPayload>) => {
      if (draft) return saveDraft({ id: draft.id, units: payload });
      if (createInFlight.current) {
        const first = await createInFlight.current;
        if (!first.ok) return first;
        return saveDraft({ id: first.data.id, units: payload });
      }
      const p = createDraft({ units: payload });
      createInFlight.current = p;
      try {
        return await p;
      } finally {
        createInFlight.current = null;
      }
    },
    [draft],
  );

  /** Autosave: debounce, skip when unchanged, never fire on an empty request. */
  useEffect(() => {
    const payload = toPayload(units);
    if (payload.length === 0) return;
    const serialized = JSON.stringify(payload);
    if (serialized === lastSaved.current) return;

    const timer = setTimeout(() => {
      setSaving(true);
      setError(null);
      startTransition(async () => {
        const res = await persist(payload);
        setSaving(false);
        if (res.ok) {
          lastSaved.current = serialized;
          setDraft({ id: res.data.id, refNo: res.data.refNo });
          setSavedAt(new Date(res.data.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        } else {
          handleFailure(res);
        }
      });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [units, persist, handleFailure]);

  const set = (i: number, key: keyof UnitDraft) => (value: string) =>
    setUnits((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  function addLoadout() {
    const policy = loadouts.find((l) => l.id === loadoutId);
    if (!policy) return;
    setUnits((rows) => [
      ...rows.filter((r) => r.description.trim() || r.unitPrice.trim()),
      ...policy.slots.map((s) => ({
        description: `${s.name}${s.type ? ` (${s.type})` : ""}`,
        specs: s.required ? "Required by policy" : "Optional",
        qty: "1",
        unitPrice: "",
      })),
    ]);
  }

  function submit() {
    const payload = toPayload(units);
    if (payload.length === 0) {
      setError("Add at least one line before submitting.");
      return;
    }
    if (payload.some((u) => u.unitPrice === null)) {
      setError("Every line needs a price — IT review sharpens specs, it doesn't invent budgets.");
      return;
    }
    setError(null);
    startTransition(async () => {
      // save first: submit acts on what the database holds, not on the
      // inputs. persist() is the same chokepoint autosave uses, so a create
      // still in flight from a recent autosave tick is joined, not duplicated.
      const saved = await persist(payload);
      if (!saved.ok) {
        handleFailure(saved);
        return;
      }
      lastSaved.current = JSON.stringify(payload);
      setDraft({ id: saved.data.id, refNo: saved.data.refNo });
      const res = await submitRequest({ id: saved.data.id });
      if (!res.ok) {
        handleFailure(res);
        return;
      }
      toast(`${res.data.refNo} submitted for IT review`, "settled");
      router.push(`/purchases/${saved.data.id}`);
    });
  }

  return (
    <div className="flex max-w-[900px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <Card>
        <CardHeader
          title="Lines"
          actions={
            <span className="flex items-center gap-2" aria-live="polite">
              {draft ? (
                <Link href={`/purchases/${draft.id}`} className="font-mono text-[10px] text-accent hover:underline">
                  {draft.refNo}
                </Link>
              ) : null}
              <Pill tone={draft ? "accent" : "neutral"}>
                {saving ? "SAVING…" : savedAt ? `DRAFT · SAVED ${savedAt}` : "DRAFT · NOT SAVED YET"}
              </Pill>
            </span>
          }
        />
        <CardBody className="flex flex-col gap-3">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th scope="col" className="w-[26px] pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">#</th>
                <th scope="col" className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">Description</th>
                <th scope="col" className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">Specs</th>
                <th scope="col" className="w-[76px] pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">Qty</th>
                <th scope="col" className="w-[128px] pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">Unit price ₱</th>
                <th scope="col" className="w-[40px] pb-2" />
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id ?? `row-${i}`}>
                  <td className="py-1 pr-2 font-mono text-[10.5px] text-fg-muted">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Line ${i + 1} description`}
                      value={u.description}
                      onChange={(e) => set(i, "description")(e.target.value)}
                      placeholder="27-inch monitors"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Line ${i + 1} specs`}
                      value={u.specs}
                      onChange={(e) => set(i, "specs")(e.target.value)}
                      placeholder="IPS, USB-C 90W"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Line ${i + 1} quantity`}
                      type="number" min="1" step="1" inputMode="numeric"
                      value={u.qty}
                      onChange={(e) => set(i, "qty")(e.target.value)}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    {/* centavos must not stepMismatch — Decimal(12,2) upstream */}
                    <Input
                      aria-label={`Line ${i + 1} unit price`}
                      type="number" min="0" step="0.01" inputMode="decimal"
                      value={u.unitPrice}
                      onChange={(e) => set(i, "unitPrice")(e.target.value)}
                    />
                  </td>
                  <td className="py-1">
                    <IconButton
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => setUnits((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows))}
                    >
                      −
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setUnits((rows) => [...rows, emptyRow()])}>Add line</Button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Select
              aria-label="Policy loadout"
              value={loadoutId}
              onChange={(e) => setLoadoutId(e.target.value)}
              className="max-w-[220px]"
            >
              <option value="">Add from a policy loadout…</option>
              {loadouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Button size="sm" disabled={!loadoutId} onClick={addLoadout}>Add rows</Button>
          </div>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button variant="primary" loading={pending} onClick={submit}>Submit for IT review</Button>
        <span className="text-xs text-fg-muted">
          Vague specs are fine — that is what IT review is for. Prices are not.
        </span>
      </div>
    </div>
  );
}
