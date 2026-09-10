"use client";

import { useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Checkbox } from "@/components/ui/checkbox";
import { checkSameName } from "@/server/modules/employees/actions";

/**
 * Phase 20 (spec §5): the create form's live duplicate-directory nudge —
 * debounced (400 ms) so every keystroke does not fire a request, and never a
 * write (`checkSameName` is read-only). `excludeId` is carried in the props
 * shape for an edit-mode caller to exclude its own record, mirroring the
 * server action's own parameter, even though Task 4's only caller (the
 * create form) never passes one.
 *
 * The warning and the confirm checkbox appear ONLY while a match is on
 * screen; `onConfirmChange` lifts the tick to the form so its create payload
 * can carry `confirmSameName` — clearing the match (name/department edited
 * back out of a collision) resets the tick so a stale confirmation can never
 * silently survive onto an unrelated match later.
 */
export function SameNameCheck({
  name,
  departmentId,
  excludeId,
  onConfirmChange,
}: {
  name: string;
  departmentId: string;
  excludeId?: string;
  onConfirmChange: (confirmed: boolean) => void;
}) {
  const [match, setMatch] = useState<{ employeeNo: string; department: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Staleness guard, same shape as asset-form.tsx's own live check: a 400 ms
  // response can land after the fields have already moved on.
  const latestRef = useRef({ name, departmentId });
  latestRef.current = { name, departmentId };

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!name.trim() || !departmentId) {
      setMatch(null);
      setConfirmed(false);
      onConfirmChange(false);
      return;
    }
    timer.current = setTimeout(() => {
      void checkSameName({ name, departmentId, excludeId }).then((res) => {
        if (!mountedRef.current) return;
        const stale = latestRef.current.name !== name || latestRef.current.departmentId !== departmentId;
        if (stale || !res.ok) return;
        setMatch(res.data.match);
        if (!res.data.match) {
          setConfirmed(false);
          onConfirmChange(false);
        }
      });
    }, 400);
    // onConfirmChange is a setState setter from the caller — including it
    // would refire this effect every render for no reason; it's stable in
    // every caller this component actually has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, departmentId, excludeId]);

  if (!match) return null;

  return (
    <Banner tone="attention" title={`Another ${name} exists in ${match.department} (${match.employeeNo})`}>
      <label className="flex items-center gap-2">
        <Checkbox
          aria-label="This is a different person"
          checked={confirmed}
          onChange={(e) => {
            setConfirmed(e.target.checked);
            onConfirmChange(e.target.checked);
          }}
        />
        This is a different person
      </label>
    </Banner>
  );
}
