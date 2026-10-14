import type { AssetClass } from "@prisma/client";
import { Tabs } from "@/components/ui/tabs";
import { withClsQS } from "@/lib/asset-class";

/** Phase 34 (spec §3, plan P-9): two real pages under one heading; the Labels tab counts what waits. */
export function NewEquipmentTabs({ active, cls, waiting }: { active: "register" | "labels"; cls: AssetClass; waiting: number }) {
  return (
    <Tabs
      label="New equipment"
      className="mb-4"
      items={[
        { label: "Register", href: "/inventory/register" + withClsQS("", cls), active: active === "register" },
        {
          label: (
            <span className="inline-flex items-center gap-1.5">
              Labels
              {waiting > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-semibold text-white" aria-label={`${waiting} waiting`}>{waiting}</span>
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
