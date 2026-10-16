"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import type { PolicyPreviewResult } from "@/lib/policy-preview";
import { previewPolicy } from "@/server/modules/employees/actions";

/**
 * Phase 37 (spec §5.1, plan P-3): Add employee's right panel — the live policy for what is entered so far,
 * with its numbered lines. Debounced (400 ms) and staleness-guarded the same way `policy-preview.tsx` is;
 * `undefined` = no answer yet for the current group and title, `null` = the group has no policy that applies.
 */
export function PolicyPanel({ title, departmentId, groupName }: { title: string; departmentId: string; groupName: string | null }) {
  const [preview, setPreview] = useState<PolicyPreviewResult | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const latestRef = useRef({ title, departmentId });
  latestRef.current = { title, departmentId };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setPreview(undefined);
    if (!departmentId) return;
    timer.current = setTimeout(() => {
      void previewPolicy({ title, departmentId }).then((res) => {
        if (!mountedRef.current) return;
        const stale = latestRef.current.title !== title || latestRef.current.departmentId !== departmentId;
        if (stale || !res.ok) return;
        setPreview(res.data.preview);
      });
    }, 400);
  }, [title, departmentId]);

  return (
    <Card>
      <CardHeader title="Equipment policy" />
      <CardBody className="flex flex-col gap-2 text-[12.5px]">
        {!departmentId ? (
          <p className="text-fg-muted">Pick who they work for to see their equipment.</p>
        ) : preview === undefined ? (
          <p className="text-fg-muted" aria-busy="true">Checking…</p>
        ) : preview === null ? (
          <p className="text-fg-muted">No equipment policy for {groupName ?? "this group"} yet — they will start with no gaps.</p>
        ) : (
          <>
            <p className="font-medium text-fg">{preview.name}</p>
            {preview.lines.length === 0 ? (
              <p className="text-fg-muted">No items on this policy.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {preview.lines.map((line, i) => (
                  <li key={`${line.label}-${i}`} className="flex items-center justify-between gap-2">
                    <span className="text-fg-secondary">{line.label}</span>
                    <span className="flex gap-1">
                      <Pill tone={line.required ? "accent" : "neutral"}>{line.required ? "Required" : "Optional"}</Pill>
                      {line.loaner && <Pill>Loan</Pill>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
