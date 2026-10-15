"use client";

import { useState } from "react";
import { IconButton } from "@/components/ui/button";
import { Menu } from "@/components/ui/menu";
import { OverrideDialog, type OverrideAsset } from "./override-dialog";

/** Phase 35 (spec 4.1): the row's menu, one item, rendered for capitalised rows only (the caller decides). */
export function AssetRowMenu(props: OverrideAsset) {
  const [open, setOpen] = useState(false);
  return (
    <span className="shrink-0">
      <Menu
        align="end"
        items={[{ label: "Depreciation for this asset…", onSelect: () => setOpen(true) }]}
        trigger={(p) => <IconButton {...p} aria-label={`Actions for ${props.tag}`}>⋯</IconButton>}
      />
      <OverrideDialog open={open} onClose={() => setOpen(false)} asset={props} />
    </span>
  );
}
