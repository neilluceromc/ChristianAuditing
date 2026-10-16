"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { setItSetup } from "@/server/modules/employees/setup-actions";
import { SETUP_STATE_LABELS, VPN_CHOICES, notYetCount } from "@/lib/it-setup";
import { useEmployeeRunner } from "./use-employee-runner";

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

type StateRow = { field: "entra" | "autopilot" | "argus"; label: string; key: "entraStatus" | "autopilotStatus" | "argusStatus" };
const ROWS: StateRow[] = [
  { field: "entra", label: "Entra / Intune connected", key: "entraStatus" },
  { field: "autopilot", label: "Autopilot", key: "autopilotStatus" },
  { field: "argus", label: "Argus", key: "argusStatus" },
];

const isChoice = (v: string | null): v is (typeof VPN_CHOICES)[number] => (VPN_CHOICES as readonly string[]).includes(v ?? "");
/** The VPN select's value for a stored string: a fixed choice, Other… for any other text, "" for null. */
const vpnSelectFor = (v: string | null): string => (v === null ? "" : isChoice(v) ? v : OTHER);

/**
 * Phase 37 (spec §4.6): the IT setup card. Each row saves on change; "Other…" for the VPN reveals a text box
 * with its own Save. A viewer sees plain text. Null is "Not recorded" — offered only while nothing is recorded.
 */
export function ItSetupCard({
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
  const [vpnText, setVpnText] = useState(values.vpn !== null && !isChoice(values.vpn) ? values.vpn : "");
  const { error, fieldErrors, retryAfter, setRetryAfter, run } = useEmployeeRunner(["value"]);

  // Follow the server after a refresh, one field at a time, so an unsaved "Other…" survives another row's save.
  useEffect(() => setLocal((l) => ({ ...l, entraStatus: values.entraStatus })), [values.entraStatus]);
  useEffect(() => setLocal((l) => ({ ...l, autopilotStatus: values.autopilotStatus })), [values.autopilotStatus]);
  useEffect(() => setLocal((l) => ({ ...l, argusStatus: values.argusStatus })), [values.argusStatus]);
  useEffect(() => {
    setVpnSelect(vpnSelectFor(values.vpn));
    setVpnText(values.vpn !== null && !isChoice(values.vpn) ? values.vpn : "");
  }, [values.vpn]);
  // A refused save snaps every row back to what is stored.
  useEffect(() => {
    if (!error) return;
    setLocal({ entraStatus: values.entraStatus, autopilotStatus: values.autopilotStatus, argusStatus: values.argusStatus });
    setVpnSelect(vpnSelectFor(values.vpn));
    setVpnText(values.vpn !== null && !isChoice(values.vpn) ? values.vpn : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new error should reset the rows
  }, [error]);

  const notYet = notYetCount(local);

  function saveState(row: StateRow, value: State) {
    setLocal((l) => ({ ...l, [row.key]: value }));
    run(() => setItSetup({ employeeId, field: row.field, value }), "Saved");
  }
  function pickVpn(value: string) {
    setVpnSelect(value);
    if (value === OTHER) return; // the text box's own Save decides
    run(() => setItSetup({ employeeId, field: "vpn", value }), "Saved");
  }
  function saveVpnText() {
    run(() => setItSetup({ employeeId, field: "vpn", value: vpnText }), "Saved");
  }

  return (
    <Card>
      <CardHeader
        title="IT setup"
        actions={
          notYet > 0 ? (
            <span
              className="rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight"
              style={{ background: "var(--st-attention-bg)", color: "var(--st-attention-text)", borderColor: "var(--st-attention-border)" }}
            >
              {notYet} not yet
            </span>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {ROWS.map((row) => {
          const value = local[row.key];
          return (
            <div key={row.field} className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-fg-secondary">{row.label}</span>
              {canEdit ? (
                <Select
                  aria-label={row.label}
                  className="w-[9.5rem] py-1.5 text-[12.5px]"
                  value={value ?? ""}
                  onChange={(e) => saveState(row, e.target.value as State)}
                >
                  {values[row.key] === null && <option value="" disabled>{NOT_RECORDED}</option>}
                  {STATES.map((s) => <option key={s} value={s}>{SETUP_STATE_LABELS[s]}</option>)}
                </Select>
              ) : (
                <span className="text-[12.5px] text-fg">{value ? SETUP_STATE_LABELS[value] : NOT_RECORDED}</span>
              )}
            </div>
          );
        })}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-fg-secondary">VPN</span>
            {canEdit ? (
              <Select
                aria-label="VPN in use"
                className="w-[9.5rem] py-1.5 text-[12.5px]"
                value={vpnSelect}
                onChange={(e) => pickVpn(e.target.value)}
              >
                {values.vpn === null && <option value="" disabled>{NOT_RECORDED}</option>}
                {VPN_CHOICES.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value={OTHER}>Other…</option>
              </Select>
            ) : (
              <span className="text-[12.5px] text-fg">{values.vpn ?? NOT_RECORDED}</span>
            )}
          </div>
          {canEdit && vpnSelect === OTHER && (
            <div className="flex items-start gap-2">
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
          <FormError>{fieldErrors.value ?? error ?? ""}</FormError>
        </div>
      </CardBody>
    </Card>
  );
}
