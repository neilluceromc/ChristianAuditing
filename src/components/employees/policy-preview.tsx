"use client";

import { useEffect, useRef, useState } from "react";
import { previewPolicy } from "@/server/modules/employees/actions";

type Preview = { name: string; slots: number; via: "title" | "department" };

/**
 * Phase 29 (spec §5.3): the create form's live policy-match preview under
 * Title — debounced (400 ms) and staleness-guarded the same way
 * `same-name-check.tsx` guards its own live lookup. Renders nothing while
 * Title is empty; otherwise either the matched policy or the "no match yet"
 * line, never both.
 */
export function PolicyPreview({ title, departmentId }: { title: string; departmentId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const latestRef = useRef({ title, departmentId });
  latestRef.current = { title, departmentId };

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!title.trim()) {
      setPreview(null);
      return;
    }
    timer.current = setTimeout(() => {
      void previewPolicy({ title, departmentId }).then((res) => {
        if (!mountedRef.current) return;
        const stale = latestRef.current.title !== title || latestRef.current.departmentId !== departmentId;
        if (stale || !res.ok) return;
        setPreview(res.data.preview);
      });
    }, 400);
  }, [title, departmentId]);

  if (!title.trim()) return null;

  return (
    <p className="text-[11px] text-fg-muted">
      {preview
        ? `matches ${preview.name} · ${preview.slots} slots${preview.via === "department" ? " (department)" : ""}`
        : "no policy matches this title yet"}
    </p>
  );
}
