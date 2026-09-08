"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { CONTRACT_STATUS_LABEL, VENDOR_CONTRACT_STATUSES, type SupplierInput } from "@/lib/supplier-schema";
import { createSupplier, updateSupplier } from "@/server/modules/suppliers/actions";
import { useSupplierRunner } from "./use-supplier-runner";

const EMPTY: SupplierInput = {
  name: "", registeredName: "", category: "", contactPerson: "", phone: "", email: "", address: "",
  registrationNo: "", contractStatus: "NONE", contractStart: "", contractEnd: "", contractTerms: "", notes: "",
};
const CLAIMED = Object.keys(EMPTY);

type Props =
  | { mode: "new"; categories: string[] }
  | { mode: "edit"; id: string; initial: SupplierInput; categories: string[] };

/** One form for both routes (spec §4.3): create redirects to the profile, edit stays and refreshes. */
export function SupplierForm(props: Props) {
  const router = useRouter();
  const [form, setForm] = useState<SupplierInput>(props.mode === "edit" ? props.initial : EMPTY);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useSupplierRunner(CLAIMED);

  function set<K extends keyof SupplierInput>(key: K, value: SupplierInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (props.mode === "new") {
      run(() => createSupplier(form), "Supplier created", {
        refresh: false,
        onOk: (data) => router.push(`/purchases/suppliers/${data.id}`),
      });
    } else {
      run(() => updateSupplier({ id: props.id, ...form }), "Saved");
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-[720px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Card>
        <CardHeader title="Profile" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Name" required error={fieldErrors.name}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.name} onChange={(e) => set("name", e.target.value)} />}
          </FormField>
          <FormField label="Registered name" error={fieldErrors.registeredName}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.registeredName} onChange={(e) => set("registeredName", e.target.value)} />}
          </FormField>
          <FormField label="Category" error={fieldErrors.category}>
            {(p) => (
              <>
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} list="supplier-categories"
                  value={form.category} onChange={(e) => set("category", e.target.value)} />
                <datalist id="supplier-categories">
                  {props.categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </>
            )}
          </FormField>
          <FormField label="Contact person" error={fieldErrors.contactPerson}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />}
          </FormField>
          <FormField label="Phone" error={fieldErrors.phone}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.phone} onChange={(e) => set("phone", e.target.value)} />}
          </FormField>
          <FormField label="Email" error={fieldErrors.email}>
            {(p) => <Input id={p.id} type="email" aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.email} onChange={(e) => set("email", e.target.value)} />}
          </FormField>
          <FormField label="Address" error={fieldErrors.address} className="sm:col-span-2">
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.address} onChange={(e) => set("address", e.target.value)} />}
          </FormField>
          <FormField label="Registration no." error={fieldErrors.registrationNo}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.registrationNo} onChange={(e) => set("registrationNo", e.target.value)} />}
          </FormField>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Contract" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Contract status" error={fieldErrors.contractStatus}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.contractStatus} onChange={(e) => set("contractStatus", e.target.value as SupplierInput["contractStatus"])}>
                {VENDOR_CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>)}
              </Select>
            )}
          </FormField>
          <div aria-hidden />
          <FormField label="Contract start" error={fieldErrors.contractStart}>
            {(p) => <Input id={p.id} type="date" aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.contractStart} onChange={(e) => set("contractStart", e.target.value)} />}
          </FormField>
          <FormField label="Contract end" error={fieldErrors.contractEnd}>
            {(p) => <Input id={p.id} type="date" aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.contractEnd} onChange={(e) => set("contractEnd", e.target.value)} />}
          </FormField>
          <FormField label="Contract terms" error={fieldErrors.contractTerms} className="sm:col-span-2">
            {(p) => <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.contractTerms} onChange={(e) => set("contractTerms", e.target.value)} />}
          </FormField>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Notes" />
        <CardBody>
          <FormField label="Notes" error={fieldErrors.notes}>
            {(p) => <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.notes} onChange={(e) => set("notes", e.target.value)} />}
          </FormField>
        </CardBody>
      </Card>
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          {props.mode === "new" ? "Create supplier" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
