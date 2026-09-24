"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MarkRestDialog, type RestItem } from "./mark-rest-dialog";

/**
 * Shown while two or more items are undecided and unblocked (spec §4.3,
 * §10). `items` is re-evaluated after the dialog's own `router.refresh()`,
 * so a partial refusal (one item filed, one refused) can leave fewer than
 * two listable items on THIS page's data before the operator has seen the
 * refusal — unmounting the button here would unmount `MarkRestDialog` with
 * it, along with the very refusal messages ruling R2 exists to keep on
 * screen. So the gate only hides the trigger once no dialog is open; while
 * `open`, the dialog (and its own state) stays mounted regardless of count.
 */
export function MarkRestButton({ employeeId, name, items }: { employeeId: string; name: string; items: RestItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length < 2 && !open) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Mark the rest as Returned…</Button>
      <MarkRestDialog open={open} onClose={() => setOpen(false)} employeeId={employeeId} name={name} items={items} />
    </>
  );
}
