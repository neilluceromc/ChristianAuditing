"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { setItSetup } from "@/server/modules/employees/setup-actions";
import { SETUP_LABELS, SETUP_STATE_LABELS, VPN_CHOICES } from "@/lib/it-setup";
import { setupDot } from "@/lib/side-card";
import { useEmployeeRunner } from "../use-employee-runner";
import { StatusDot } from "./status-dot";

type State = keyof typeof SETUP_STATE_LABELS;
const STATES = Object.keys(SETUP_STATE_LABELS) as State[];
const OTHER = "__other";
const NOT_RECORDED = "Not recorded";

export interface SetupValues {
  entraStatus: State | null;
  autopilotStatus: State | null;
  argusStatus: State | null;
  vpn: string | null;
}

type StateKey = "entraStatus" | "autopilotStatus" | "argusStatus";
/** `label` is what the row shows; `name` is the select's accessible name, unchanged since Phase 37 (spec §2.3). */
type StateRow = { field: "entra" | "autopilot" | "argus"; label: string; name: string; key: StateKey };
const ROWS: StateRow[] = [
  { field: "entra", label: SETUP_LABELS.entra, name: "Entra / Intune connected", key: "entraStatus" },
  { field: "autopilot", label: SETUP_LABELS.autopilot, name: "Autopilot", key: "autopilotStatus" },
  { field: "argus", label: SETUP_LABELS.argus, name: "Argus", key: "argusStatus" },
];

const isChoice = (v: string | null): v is (typeof VPN_CHOICES)[number] => (VPN_CHOICES as readonly string[]).includes(v ?? "");
/** The VPN select's value for a stored string: a fixed choice, Other… for any other text, "" for null. */
const vpnSelectFor = (v: string | null): string => (v === null ? "" : isChoice(v) ? v : OTHER);
const vpnTextFor = (v: string | null): string => (v !== null && !isChoice(v) ? v : "");

const LABEL = "flex min-w-0 items-center gap-2 whitespace-nowrap text-[12.5px] text-fg-secondary";
const VALUE = "text-[12.5px] text-fg";
const CONTROL = "w-full py-1.5 text-[12.5px]";

/**
 * Phase 37 (spec §4.6), Phase 39 (spec §2.3): the side card's IT setup tab. A `1fr 150px` grid — dot and label,
 * then a select of one fixed width, so the four rows line up. Each row saves on change; "Other…" for the VPN
 * shows a name box with its own Save on a row of its own. Any refusal (the rate limit included) puts the row
 * back to what is stored. A viewer sees plain values in the same grid. Null is "Not recorded" — offered only
 * while nothing is recorded.
 */
export function SetupTab({
  employeeId, values, canEdit,
}: {
  employeeId: string;
  values: SetupValues;
  canEdit: boolean;
}) {
  const [local, setLocal] = useState({
    entraStatus: values.entraStatus, autopilotStatus: values.autopilotStatus, argusStatus: values.argusStatus,
  });
  const [vpnSelect, setVpnSelect] = useState(vpnSelectFor(values.vpn));
  const [vpnText, setVpnText] = useState(vpnTextFor(values.vpn));
  const { error, fieldErrors, retryAfter, setRetryAfter, run } = useEmployeeRunner(["value"]);
  // What is stored right now — a refusal that lands after another row's refresh must restore the newest value.
  const stored = useRef(values);
  useEffect(() => {
    stored.current = values;
  });

  // Follow the server after a refresh, one field at a time, so an unsaved "Other…" survives another row's save.
  useEffect(() => setLocal((l) => ({ ...l, entraStatus: values.entraStatus })), [values.entraStatus]);
  useEffect(() => setLocal((l) => ({ ...l, autopilotStatus: values.autopilotStatus })), [values.autopilotStatus]);
  useEffect(() => setLocal((l) => ({ ...l, argusStatus: values.argusStatus })), [values.argusStatus]);
  useEffect(() => {
    setVpnSelect(vpnSelectFor(values.vpn));
    setVpnText(vpnTextFor(values.vpn));
  }, [values.vpn]);

  function restoreVpn() {
    setVpnSelect(vpnSelectFor(stored.current.vpn));
    setVpnText(vpnTextFor(stored.current.vpn));
  }
  function saveState(row: StateRow, value: State) {
    setLocal((l) => ({ ...l, [row.key]: value }));
    run(() => setItSetup({ employeeId, field: row.field, value }), "Saved", {
      onFail: () => setLocal((l) => ({ ...l, [row.key]: stored.current[row.key] })),
    });
  }
  function pickVpn(value: string) {
    setVpnSelect(value);
    if (value === OTHER) return; // the name box's own Save decides
    run(() => setItSetup({ employeeId, field: "vpn", value }), "Saved", { onFail: restoreVpn });
  }
  function saveVpnText() {
    // A name the server refuses as invalid stays in the box so it can be fixed; any other refusal restores.
    run(() => setItSetup({ employeeId, field: "vpn", value: vpnText }), "Saved", {
      onFail: (kind) => { if (kind !== "validation") restoreVpn(); },
    });
  }

  const vpnDot = setupDot(values.vpn);

  return (
    <div className="flex flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      <div className="grid grid-cols-[1fr_150px] items-center gap-x-3 gap-y-2.5">
        {ROWS.map((row) => {
          const value = local[row.key];
          return (
            <Fragment key={row.field}>
              <span className={LABEL}>
                <StatusDot dot={setupDot(value)} />
                {row.label}
              </span>
              {canEdit ? (
                <Select
                  aria-label={row.name}
                  className={CONTROL}
                  value={value ?? ""}
                  onChange={(e) => saveState(row, e.target.value as State)}
                >
                  {values[row.key] === null && <option value="" disabled>{NOT_RECORDED}</option>}
                  {STATES.map((s) => <option key={s} value={s}>{SETUP_STATE_LABELS[s]}</option>)}
                </Select>
              ) : (
                <span className={VALUE}>{value ? SETUP_STATE_LABELS[value] : NOT_RECORDED}</span>
              )}
            </Fragment>
          );
        })}

        <span className={LABEL}>
          <StatusDot dot={vpnDot} />
          {SETUP_LABELS.vpn}
        </span>
        {canEdit ? (
          <Select aria-label="VPN in use" className={CONTROL} value={vpnSelect} onChange={(e) => pickVpn(e.target.value)}>
            {values.vpn === null && <option value="" disabled>{NOT_RECORDED}</option>}
            {VPN_CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value={OTHER}>Other…</option>
          </Select>
        ) : (
          <span className={VALUE}>{values.vpn ?? NOT_RECORDED}</span>
        )}

        {canEdit && vpnSelect === OTHER && (
          <div className="col-span-2 flex items-start gap-2">
            <Input
              aria-label="VPN name"
              value={vpnText}
              onChange={(e) => setVpnText(e.target.value)}
              invalid={!!fieldErrors.value}
              className="py-1.5 text-[12.5px]"
            />
            <Button variant="secondary" size="sm" onClick={saveVpnText} className="mt-px shrink-0">Save</Button>
          </div>
        )}
      </div>
      <FormError>{fieldErrors.value ?? error ?? ""}</FormError>
      {canEdit && <p className="text-[11px] text-fg-muted">Saves as you change it.</p>}
    </div>
  );
}
