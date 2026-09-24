"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MarkRestDialog, type RestItem } from "./mark-rest-dialog";

/** Shown while two or more items are undecided and unblocked (spec §4.3, §10). */
export function MarkRestButton({ employeeId, name, items }: { employeeId: string; name: string; items: RestItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length < 2) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Mark the rest as Returned…</Button>
      <MarkRestDialog open={open} onClose={() => setOpen(false)} employeeId={employeeId} name={name} items={items} />
    </>
  );
}
