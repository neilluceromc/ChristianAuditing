"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FormError } from "@/components/ui/form-field";
import { checkEmployeeNo, nextEmployeeNo } from "@/server/modules/employees/actions";

/**
 * Phase 29 (spec §5.2): the create form's live employee-number affordance —
 * two states that never show at once. Empty field: the next free number,
 * suggested (not prefilled) with a one-click "Use it". Non-empty field:
 * debounced (400 ms) taken-number check, staleness-guarded the same way
 * `same-name-check.tsx` guards its own live lookup.
 */
export function EmployeeNoCheck({ value, onUse }: { value: string; onUse: (no: string) => void }) {
  const [next, setNext] = useState<string | null>(null);
  const [taken, setTaken] = useState<{ id: string; name: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const latestRef = useRef(value);
  latestRef.current = value;

  const empty = !value.trim();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /**
   * Phase 29 (final review I-3): asked once on mount, "Next free" went stale
   * the moment "Create and add another" consumed it — the form clears the
   * field, the empty-field branch re-renders the mount-time answer, and "Use
   * it" filled a number the live check refuses 400 ms later. This is the bulk
   * -add flow the suggestion exists for, so the question is asked again every
   * time the field RETURNS to empty (keyed on that, not on every keystroke).
   * Staleness-guarded like the taken check: a slow answer for an empty field
   * the operator has since typed into must not resurrect the line.
   */
  useEffect(() => {
    if (!empty) return;
    void nextEmployeeNo().then((res) => {
      if (!mountedRef.current || !res.ok) return;
      if (latestRef.current.trim()) return;
      setNext(res.data.next);
    });
  }, [empty]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setTaken(null);
      return;
    }
    timer.current = setTimeout(() => {
      void checkEmployeeNo({ employeeNo: value }).then((res) => {
        if (!mountedRef.current) return;
        // A response for a value the field has since moved on from must not
        // label whatever is there now.
        if (latestRef.current !== value) return;
        if (!res.ok) return;
        setTaken(res.data.taken);
      });
    }, 400);
  }, [value]);

  if (!value.trim()) {
    if (!next) return null;
    const freeNo = next;
    return (
      <p className="text-[11px] text-fg-muted">
        Next free: <span className="font-mono">{freeNo}</span>{" "}
        <button type="button" className="ml-1 text-accent underline" onClick={() => onUse(freeNo)}>
          Use it
        </button>
      </p>
    );
  }

  if (!taken) return null;

  return (
    <FormError>
      {value.trim()} is already{" "}
      <Link href={`/employees/${taken.id}`} className="underline">
        {taken.name}
      </Link>
      &apos;s
    </FormError>
  );
}
