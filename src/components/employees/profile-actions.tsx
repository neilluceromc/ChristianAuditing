"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, IconButton } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { TransferDialog } from "./transfer-dialog";
import { StartOffboardingDialog } from "./start-offboarding-dialog";

/**
 * Phase 29 (spec §4.1): one state-chosen primary, Edit always visible (daily work — decision 1), the rest in More.
 * "Assign kit" and "Fill N gaps" reach the slot grid through one DOM event LoadoutView listens for (plan P-6).
 */
export function ProfileActions({
  employeeId, employeeName, currentTitle, employment, canMutate, primary, departments, defaultDue, minDue,
}: {
  employeeId: string; employeeName: string; currentTitle: string; employment: string; canMutate: boolean;
  primary: { kind: "assign-kit" | "fill-gaps" | "wizard"; label: string } | null;
  departments: Array<{ id: string; name: string }>; defaultDue: string; minDue: string;
}) {
  const router = useRouter();
  const [transferOpen, setTransferOpen] = useState(false);
  const [offboardingOpen, setOffboardingOpen] = useState(false);
  if (!canMutate) return null;

  const items: MenuItem[] = [
    { label: "Timeline", onSelect: () => router.push(`/employees/${employeeId}/timeline`) },
    { label: "Export holdings", onSelect: () => window.location.assign(`/employees/${employeeId}/holdings`) }, // a route handler (download), not a page — ruling R5
  ];
  if (employment === "ACTIVE") {
    items.push({ label: "Transfer…", onSelect: () => setTransferOpen(true) });
    items.push({ label: "Start offboarding…", onSelect: () => setOffboardingOpen(true) });
  }

  function firePrimary() {
    if (!primary) return;
    if (primary.kind === "wizard") { router.push(`/offboarding/${employeeId}`); return; }
    document.getElementById("loadout")?.scrollIntoView({ block: "start" });
    window.dispatchEvent(new CustomEvent("br:loadout", { detail: { action: primary.kind === "assign-kit" ? "fill-first" : "focus-gap" } }));
  }

  return (
    <>
      {primary && <Button variant="primary" onClick={firePrimary}>{primary.label}</Button>}
      <ButtonLink href={`/employees/${employeeId}/edit`}>Edit</ButtonLink>
      <Menu
        align="end"
        items={items}
        trigger={(props) => <IconButton {...props} aria-label="More actions">⋯</IconButton>}
      />
      <TransferDialog open={transferOpen} onClose={() => setTransferOpen(false)} employeeId={employeeId} employeeName={employeeName} currentTitle={currentTitle} departments={departments} />
      {employment === "ACTIVE" && (
        <StartOffboardingDialog open={offboardingOpen} onClose={() => setOffboardingOpen(false)} employeeId={employeeId} employeeName={employeeName} defaultDue={defaultDue} minDue={minDue} />
      )}
    </>
  );
}
