import type { AssetClass } from "@prisma/client";
import { Tabs } from "@/components/ui/tabs";
import { withClsQS } from "@/lib/asset-class";

/** Where "register more" goes: the direct Register, or — for Purchasing, which registers only from a PO — its POs. */
export function registerLink(direct: boolean, cls: AssetClass): { label: string; href: string } {
  return direct
    ? { label: "Register", href: "/inventory/register" + withClsQS("", cls) }
    : { label: "Register from a PO", href: "/purchases?state=READY" };
}

/**
 * Phase 34 (spec §3, plan P-9): two real pages under one heading; the Labels tab counts what waits. `direct: false`
 * (Purchasing, spec §4) points the first tab at the purchase orders ready to register instead of the direct Register.
 */
export function NewEquipmentTabs({ active, cls, waiting, direct = true }: {
  active: "register" | "labels"; cls: AssetClass; waiting: number; direct?: boolean;
}) {
  return (
    <Tabs
      label="New equipment"
      className="mb-4"
      items={[
        { ...registerLink(direct, cls), active: active === "register" },
        {
          label: (
            <span className="inline-flex items-center gap-1.5">
              Labels
              {waiting > 0 && (
                <>
                  <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-semibold text-accent-fg" aria-hidden>{waiting}</span>
                  <span className="sr-only">, {waiting} waiting</span>
                </>
              )}
            </span>
          ),
          href: "/inventory/labels" + withClsQS("", cls),
          active: active === "labels",
        },
      ]}
    />
  );
}
