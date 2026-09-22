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
 *
 * `preview` is three-valued (review round 1, finding 2): `undefined` means
 * "no resolved check for the CURRENT title/department yet" — either nothing
 * has been typed long enough to debounce, or the request for these exact
 * inputs is still in flight — and renders nothing, same as an empty title.
 * `null` means a check actually resolved and found no match (renders the
 * no-match line); a `Preview` object means it resolved with one. Every
 * change to `title`/`departmentId` resets straight back to `undefined`
 * before the new debounce even starts, so the no-match line can never show
 * against fields it wasn't actually checked against (e.g. on the very first
 * keystroke, or while retyping mid-check).
 */
export function PolicyPreview({ title, departmentId }: { title: string; departmentId: string }) {
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
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
    // Pending for these inputs until a response actually resolves below —
    // covers both "just typed, debounce hasn't fired" and "request for a
    // now-superseded title/department still in flight".
    setPreview(undefined);
    if (!title.trim()) return;
    timer.current = setTimeout(() => {
      void previewPolicy({ title, departmentId }).then((res) => {
        if (!mountedRef.current) return;
        const stale = latestRef.current.title !== title || latestRef.current.departmentId !== departmentId;
        if (stale || !res.ok) return;
        setPreview(res.data.preview);
      });
    }, 400);
  }, [title, departmentId]);

  if (!title.trim() || preview === undefined) return null;

  return (
    <p className="text-[11px] text-fg-muted">
      {preview
        ? `matches ${preview.name} · ${preview.slots} slots${preview.via === "department" ? " (department)" : ""}`
        : "no policy matches this title yet"}
    </p>
  );
}
