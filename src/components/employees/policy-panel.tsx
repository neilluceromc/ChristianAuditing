"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/cn";
import type { PolicyPreviewResult } from "@/lib/policy-preview";
import { previewPolicy } from "@/server/modules/employees/actions";

/** One resolved answer, with the group name it was asked for, so a stale answer never borrows the new name. */
type Answer = { preview: PolicyPreviewResult | null; groupName: string | null };

/**
 * Phase 37 (spec §5.1, plan P-3): Add employee's right panel — the live policy for what is entered so far,
 * with its numbered lines. Debounced (400 ms) and staleness-guarded the same way `policy-preview.tsx` is.
 * While a new answer loads, the previous one stays on screen (dimmed) instead of flashing "Checking…" on
 * every keystroke; "Checking…" shows only before the first answer. A failed lookup shows a neutral line —
 * the server resolves the policy itself on create, so nothing is lost.
 */
export function PolicyPanel({ title, departmentId, groupName }: { title: string; departmentId: string; groupName: string | null }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
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
    if (!departmentId) {
      setAnswer(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    const askedFor = groupName;
    timer.current = setTimeout(() => {
      const isCurrent = () =>
        mountedRef.current && latestRef.current.title === title && latestRef.current.departmentId === departmentId;
      previewPolicy({ title, departmentId })
        .then((res) => {
          if (!isCurrent()) return;
          setLoading(false);
          if (res.ok) {
            setAnswer({ preview: res.data.preview, groupName: askedFor });
            setFailed(false);
          } else setFailed(true);
        })
        .catch(() => {
          if (!isCurrent()) return;
          setLoading(false);
          setFailed(true);
        });
    }, 400);
    // groupName follows departmentId; it is read only to label the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, departmentId]);

  return (
    <Card>
      <CardHeader title="Equipment policy" />
      <CardBody className="flex flex-col gap-2 text-[12.5px]">
        {!departmentId ? (
          <p className="text-fg-muted">Pick who they work for to see their equipment.</p>
        ) : failed && !loading ? (
          <p className="text-fg-muted">Couldn&apos;t load the equipment policy — it will be applied when you create them.</p>
        ) : answer === null ? (
          <p className="text-fg-muted" aria-busy="true">Checking…</p>
        ) : (
          <div aria-busy={loading || undefined} className={cn("flex flex-col gap-2 transition-opacity", loading && "opacity-60")}>
            {answer.preview === null ? (
              <p className="text-fg-muted">
                No equipment policy for {answer.groupName ?? "this group"} yet — they will start with no gaps.
              </p>
            ) : (
              <>
                <p className="font-medium text-fg">{answer.preview.name}</p>
                {answer.preview.lines.length === 0 ? (
                  <p className="text-fg-muted">No items on this policy.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {answer.preview.lines.map((line, i) => (
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
          </div>
        )}
      </CardBody>
    </Card>
  );
}
