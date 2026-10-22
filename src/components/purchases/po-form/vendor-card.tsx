"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { Badge, Eyebrow, Field, RING, SectionCard, tintFor } from "./fields";
import { initials } from "./po-form-model";

export interface PoVendor {
  id: string;
  name: string;
  /** "Owned & operated by" — the registered name on the invoice's seller block. */
  registeredName: string | null;
  /** Shown as VAT REG. TIN. */
  registrationNo: string | null;
  address: string | null;
}

const has = (s: string | null | undefined): s is string => !!s && s.trim() !== "";

/** "Infoworx Inc. · TIN 004-845-988-00004", or "· no TIN on file". Searchable: the picker filters on it too. */
const vendorSub = (v: PoVendor) =>
  `${has(v.registeredName) ? v.registeredName : v.name} · ${has(v.registrationNo) ? `TIN ${v.registrationNo}` : "no TIN on file"}`;

/** Opens beside the form, so what is typed here survives; the form refreshes its lists when the tab regains focus. */
const NEW_TAB = { target: "_blank", rel: "noopener" } as const;

/**
 * A3's Vendor card: a searchable picker (initials, name, registered name and TIN) with "Add a new vendor", then the
 * chosen vendor's seller block, read-only — Owned & operated by, VAT REG. TIN (amber when missing) and Address —
 * with Edit vendor.
 */
export function VendorCard({
  vendors, vendorId, onChange, error, flagged,
}: {
  vendors: PoVendor[];
  vendorId: string;
  onChange: (id: string) => void;
  error?: string;
  flagged: boolean;
}) {
  const vendor = vendors.find((v) => v.id === vendorId) ?? null;
  const options: ComboOption[] = vendors.map((v) => ({
    value: v.id,
    label: v.name,
    sub: vendorSub(v),
    icon: <Badge text={initials(v.name)} style={tintFor(v.name)} />,
  }));

  return (
    <SectionCard id="po-vendor" icon="suppliers" title="Vendor" sub="The seller's block at the top of the invoice.">
      <div className="flex flex-col gap-4 px-4 pb-5 pt-4 sm:px-5">
        <Field label="Vendor" required error={error} flagged={flagged}>
          {(p) => (
            <div className="flex items-center gap-2.5">
              {vendor && <Badge text={initials(vendor.name)} style={tintFor(vendor.name)} className="size-8 rounded-(--radius-btn) text-[11.5px]" />}
              <div className={cn("min-w-0 flex-1 rounded-(--radius-card)", flagged && RING)}>
                <EntityCombobox
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  invalid={p.invalid}
                  options={options}
                  value={vendorId || null}
                  onChange={(v) => onChange(v ?? "")}
                  placeholder="Search by name or TIN…"
                  emptyText="No vendor matches."
                  footer={() => (
                    <Link
                      href="/purchases/suppliers/new"
                      {...NEW_TAB}
                      className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-xs font-medium text-accent-soft-text hover:bg-accent-tint"
                    >
                      <Icon name="add" size={14} />
                      Add a new vendor
                      <span className="sr-only"> (opens in a new tab)</span>
                    </Link>
                  )}
                />
              </div>
            </div>
          )}
        </Field>

        {vendor ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-5 gap-y-3 rounded-(--radius-card) border border-border-faint bg-surface-subtle px-4 py-3.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <Eyebrow>Owned &amp; operated by</Eyebrow>
              <span className="text-[13.5px] text-fg">{has(vendor.registeredName) ? vendor.registeredName : "—"}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <Eyebrow>VAT REG. TIN</Eyebrow>
              {has(vendor.registrationNo) ? (
                <span className="font-mono text-[13.5px] text-fg">{vendor.registrationNo}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "var(--st-attention-text)" }}>
                  <Icon name="alert" size={14} />
                  Not on file — add it from the invoice
                </span>
              )}
            </div>
            <div className="col-span-full flex min-w-0 flex-col gap-0.5">
              <Eyebrow>Address</Eyebrow>
              <span className="text-[13.5px] text-fg-secondary">{has(vendor.address) ? vendor.address : "—"}</span>
            </div>
            <div className="col-span-full flex flex-wrap items-center justify-between gap-2.5 border-t border-border-faint pt-2.5">
              <span className="text-xs text-fg-muted">Doesn&apos;t match the invoice? Fix it once on the vendor and every PO uses it.</span>
              <Link
                href={`/purchases/suppliers/${vendor.id}/edit`}
                {...NEW_TAB}
                className="rounded-(--radius-btn) px-2 py-1 text-[13px] font-medium text-accent-soft-text hover:bg-accent-tint"
              >
                Edit vendor<span className="sr-only"> (opens in a new tab)</span>
              </Link>
            </div>
          </div>
        ) : (
          <p className="rounded-(--radius-card) border border-dashed border-border-strong bg-surface-subtle px-4 py-3 text-xs text-fg-muted">
            Pick the vendor to see their registered name, VAT REG. TIN and address.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
