"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import {
  addSlot, createPolicy, deletePolicy, removeSlot, setSlotRequired,
} from "@/server/modules/admin/policy-actions";
import type { ActionResult } from "@/server/action-result";

export interface PolicySlotRow {
  id: string;
  name: string;
  typeName: string;
  required: boolean;
}

export interface PolicyCard {
  id: string;
  name: string;
  /** "role: Accountant" | "department: Finance" */
  appliesTo: string;
  slots: PolicySlotRow[];
  /** how many employees this policy currently resolves for */
  employees: number;
}

export interface TypeOption {
  id: string;
  label: string;
}

/**
 * Shared error plumbing: every action returns the same ActionResult union.
 *
 * `claimedFieldKeys` lists the fieldErrors keys this card actually renders a
 * FormError for. A validation refusal must render where the operator is
 * looking (README rule) — src/components/admin/ref-table.tsx solves this by
 * falling back to the first message regardless of key; here, any key no
 * FormError claims falls back into the same banner the conflict path uses,
 * so an unclaimed validation key can never dead-end silently.
 */
function useRunner(claimedFieldKeys: string[] = []) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function run<T>(fn: () => Promise<ActionResult<T>>, okMsg: string, onOk?: () => void) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast(okMsg, "settled");
        onOk?.();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const errs = res.fieldErrors ?? {};
        setFieldErrors(errs);
        const unclaimed = Object.keys(errs).find((key) => !claimedFieldKeys.includes(key));
        if (unclaimed) setError(errs[unclaimed]);
      } else setError(res.message);
    });
  }

  return { pending, error, fieldErrors, retryAfter, setRetryAfter, run };
}

export function PolicyEditor({
  policy,
  types,
  canMutate,
}: {
  policy: PolicyCard;
  types: TypeOption[];
  canMutate: boolean;
}) {
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useRunner(["name", "assetTypeId"]);
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [required, setRequired] = useState(true);

  return (
    <Card>
      <CardHeader
        title={policy.name}
        actions={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[10.5px] text-fg-muted">
              {policy.appliesTo} · {policy.employees} {policy.employees === 1 ? "person" : "people"}
            </span>
            {canMutate && (
              <Menu
                trigger={(props) => (
                  <button
                    type="button"
                    {...props}
                    aria-label={`Actions for ${policy.name}`}
                    className="rounded-(--radius-ctl) px-2 py-0.5 text-fg-muted hover:bg-surface-subtle"
                  >
                    ⋯
                  </button>
                )}
                items={[
                  {
                    label: "Delete policy",
                    danger: true,
                    onSelect: () => run(() => deletePolicy({ id: policy.id }), "Policy deleted"),
                  },
                ]}
              />
            )}
          </span>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}

        <div className="flex flex-wrap items-center gap-1.5">
          {policy.slots.length === 0 && (
            <span className="text-xs text-fg-muted">No slots yet — nothing counts as missing for this policy.</span>
          )}
          {policy.slots.map((slot) => (
            <span key={slot.id} className="inline-flex items-center">
              {/* Solid = required (an unfilled one is the policy gap that lights
                  up on the loadout view and in Home's HIRE rows); grey = optional.
                  For a viewer this is display-only: a mutating affordance must be
                  absent, not disabled, so it renders as a plain span with no
                  onClick and no "click to toggle" in its label. */}
              {canMutate ? (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`${slot.name} · ${slot.typeName} · ${slot.required ? "required" : "optional"} — click to toggle`}
                  onClick={() =>
                    run(
                      () => setSlotRequired({ slotId: slot.id, required: !slot.required }),
                      `${slot.name} is now ${slot.required ? "optional" : "required"}`,
                    )
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
                    slot.required
                      ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                      : "border-border bg-border-faint text-fg-muted",
                    "hover:opacity-80",
                  )}
                >
                  {slot.name}
                  <span className="text-[9px]">{slot.typeName}</span>
                </button>
              ) : (
                <span
                  aria-label={`${slot.name} · ${slot.typeName} · ${slot.required ? "required" : "optional"}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
                    slot.required
                      ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                      : "border-border bg-border-faint text-fg-muted",
                  )}
                >
                  {slot.name}
                  <span className="text-[9px]">{slot.typeName}</span>
                </span>
              )}
              {canMutate && (
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Remove the ${slot.name} slot from ${policy.name}`}
                  onClick={() => run(() => removeSlot({ slotId: slot.id }), `${slot.name} removed`)}
                  className="px-1 text-fg-faint hover:text-fg-secondary"
                >
                  −
                </button>
              )}
            </span>
          ))}
        </div>

        {canMutate && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border-faint pt-3">
            <div className="flex flex-col gap-1">
              <Input
                aria-label={`New slot name for ${policy.name}`}
                placeholder="slot name, e.g. webcam"
                value={name}
                invalid={!!fieldErrors.name}
                className="w-[180px] py-1.5 text-xs"
                onChange={(e) => setName(e.target.value)}
              />
              <FormError>{fieldErrors.name}</FormError>
            </div>
            <div className="flex flex-col gap-1">
              <Select
                aria-label={`Asset type for the new slot in ${policy.name}`}
                value={typeId}
                invalid={!!fieldErrors.assetTypeId}
                className="w-[220px] py-1.5 text-xs"
                onChange={(e) => setTypeId(e.target.value)}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </Select>
              <FormError>{fieldErrors.assetTypeId}</FormError>
            </div>
            <label className="flex items-center gap-1.5 pb-1.5 text-xs text-fg-secondary">
              <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
              required
            </label>
            <Button
              size="sm"
              variant="primary"
              loading={pending}
              onClick={() =>
                run(
                  () => addSlot({ policyId: policy.id, name, assetTypeId: typeId, required }),
                  "Slot added — existing assignments are untouched",
                  () => setName(""),
                )
              }
            >
              Add slot
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function NewPolicyCard({ departments }: { departments: Array<{ id: string; name: string }> }) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("department");
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [title, setTitle] = useState("");
  // createPolicy's "target exactly one" refusal always keys its error as
  // appliesToTitle, even when the department branch is the one showing —
  // that branch renders no FormError for either target field, so the key
  // must fall back to the banner instead of vanishing.
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useRunner(
    target === "title" ? ["name", "appliesToTitle"] : ["name"],
  );

  return (
    <Card>
      <CardHeader title="New policy" />
      <CardBody className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Input
              aria-label="New policy name"
              placeholder="policy name, e.g. Sales standard"
              value={name}
              invalid={!!fieldErrors.name}
              className="w-[200px] py-1.5 text-xs"
              onChange={(e) => setName(e.target.value)}
            />
            <FormError>{fieldErrors.name}</FormError>
          </div>
          <Select
            aria-label="Applies to"
            value={target}
            className="w-[140px] py-1.5 text-xs"
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="department">a department</option>
            <option value="title">a role title</option>
          </Select>
          {target === "department" ? (
            <Select
              aria-label="Department this policy applies to"
              value={departmentId}
              className="w-[180px] py-1.5 text-xs"
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          ) : (
            <div className="flex flex-col gap-1">
              <Input
                aria-label="Role title this policy applies to"
                placeholder="exact job title"
                value={title}
                invalid={!!fieldErrors.appliesToTitle}
                className="w-[180px] py-1.5 text-xs"
                onChange={(e) => setTitle(e.target.value)}
              />
              <FormError>{fieldErrors.appliesToTitle}</FormError>
            </div>
          )}
          <Button
            size="sm"
            variant="primary"
            loading={pending}
            onClick={() =>
              run(
                () =>
                  createPolicy({
                    name,
                    ...(target === "department" ? { appliesToDepartmentId: departmentId } : { appliesToTitle: title }),
                  }),
                "Policy created — add its slots next",
                () => setName(""),
              )
            }
          >
            Create policy
          </Button>
        </div>
        <p className="text-[11px] text-fg-muted">
          A role policy beats a department policy for anyone whose title matches, so target exactly one.
        </p>
      </CardBody>
    </Card>
  );
}
