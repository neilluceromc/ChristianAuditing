"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OverrideDialog, type OverrideAsset } from "@/components/finance/override-dialog";

export function SettingsButton({ asset }: { asset: OverrideAsset }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Depreciation settings…</Button>
      <OverrideDialog open={open} onClose={() => setOpen(false)} asset={asset} />
    </>
  );
}
