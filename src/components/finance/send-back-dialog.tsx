"use client";

import { useEffect, useState } from "react";
import type { AssetClass, Role } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { sendBackToast } from "@/lib/finance-review-ui";
import { isMoneyKey, returnTeamFor } from "@/lib/intake-rules";
import { fieldLabels, REGISTRATION_FIELDS, REG_FIELD_GROUPS, type RegFieldKey } from "@/lib/registration";
import { returnAsset } from "@/server/modules/inventory/actions";
import { useFinanceRunner } from "./use-finance-runner";
import { useFinanceUndo } from "./use-finance-undo";

type Team = "IT" | "PURCHASING";
const TEAM_LABEL: Record<Team, string> = { IT: "IT", PURCHASING: "Purchasing" };

/** The team the first ticked field goes back to (`returnTeamFor`); "Other" alone goes to the class's team. */
export function suggestedTeam(
  keys: readonly RegFieldKey[],
  ctx: { cls: AssetClass; refNo: string | null; registeredByRole: Role | null },
): Team {
  const f = keys.find((k) => k !== "other");
  if (!f) return ctx.cls === "IT" ? "IT" : "PURCHASING";
  return returnTeamFor(f, ctx.cls, { hasPo: ctx.refNo !== null, registeredByRole: ctx.registeredByRole });
}

/**
 * Phase 35 (spec 3.3): Finance's send-back checklist and note. Task 6 (spec §5): Finance picks the team — IT or
 * Purchasing — which starts as the team that owns the first ticked field and follows the ticks until Finance picks one
 * itself. On an asset from a PO the money fields are the PO's, so they can't be ticked here: the PO is sent back.
 */
export function SendBackDialog({
  open, onClose, id, tag, cls, refNo, registeredByRole, hasCost,
}: {
  open: boolean; onClose: () => void; id: string; tag: string; cls: AssetClass;
  /** The asset's PO, when it has one. */
  refNo: string | null;
  /** Who registered its batch: where money goes back on an asset with no PO. */
  registeredByRole: Role | null;
  hasCost: boolean;
}) {
  const runner = useFinanceRunner(["note", "team", "fields"]);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = runner;
  const undo = useFinanceUndo();
  const ctx = { cls, refNo, registeredByRole };
  const moneyLocked = (key: RegFieldKey) => refNo !== null && key !== "other" && isMoneyKey(key);
  const [ticked, setTicked] = useState<Set<RegFieldKey>>(new Set());
  const [note, setNote] = useState("");
  const [team, setTeam] = useState<Team>(cls === "IT" ? "IT" : "PURCHASING");
  const [picked, setPicked] = useState(false);

  useEffect(() => {
    if (!open) return;
    reset();
    const first = new Set<RegFieldKey>(hasCost || refNo !== null ? [] : ["cost"]);
    setTicked(first);
    setNote("");
    setTeam(suggestedTeam([...first], ctx));
    setPicked(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(key: RegFieldKey, on: boolean) {
    const next = new Set(ticked);
    if (on) next.add(key);
    else next.delete(key);
    setTicked(next);
    if (!picked) setTeam(suggestedTeam(REGISTRATION_FIELDS.filter((f) => next.has(f.key)).map((f) => f.key), ctx));
  }

  function send() {
    const fields = REGISTRATION_FIELDS.filter((f) => ticked.has(f.key)).map((f) => f.key);
    run(
      () => returnAsset({ id, team, fields, note }),
      // finance follow-up (spec §4): "Sent BR-LT-0201 back to IT", what was flagged, and Undo
      (d) => sendBackToast({ assetId: id, tag: d.tag, deptLabel: TEAM_LABEL[team], flagged: fieldLabels(fields), note }, undo),
      { onOk: onClose },
    );
  }

  const banner = error ?? fieldErrors.fields ?? fieldErrors.team ?? null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Send ${tag} back`}
      footer={
        <>
          <span className="mr-auto font-mono text-xs text-fg-muted">{ticked.size} ticked</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={send}>Send back to {TEAM_LABEL[team]}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {banner && <Banner tone="fault" title={banner} />}
        {refNo && (
          <p className="text-[13px] text-fg-secondary">
            The money details are {refNo}&apos;s: send {refNo} back to Purchasing, or fix them there.
          </p>
        )}
        {REG_FIELD_GROUPS.map((group) => (
          <fieldset key={group} className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-fg">{group}</legend>
            {REGISTRATION_FIELDS.filter((f) => f.group === group).map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-[13px] text-fg-secondary">
                <Checkbox
                  checked={ticked.has(f.key)}
                  disabled={moneyLocked(f.key)}
                  onChange={(e) => toggle(f.key, e.target.checked)}
                />
                {f.label}
                {moneyLocked(f.key) && <span className="text-[11px] text-fg-muted">· on {refNo}</span>}
              </label>
            ))}
          </fieldset>
        ))}
        <FormField label="Send to" hint="The team that owns what you ticked" error={fieldErrors.team}>
          {(p) => (
            <Select
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={team}
              onChange={(e) => { setTeam(e.target.value as Team); setPicked(true); }}
            >
              <option value="IT">IT</option>
              <option value="PURCHASING">Purchasing</option>
            </Select>
          )}
        </FormField>
        <FormField label={`Note for ${TEAM_LABEL[team]}`} hint="Optional — required for Other" error={fieldErrors.note}>
          {(p) => (
            <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
