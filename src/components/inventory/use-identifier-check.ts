"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetClass } from "@prisma/client";
import { tagKey } from "@/lib/tag-key";
import type { IdentifierHits } from "@/lib/register-rows";
import { checkIdentifiers } from "@/server/modules/inventory/actions";

const NONE: IdentifierHits = { tags: [], serials: [] };

/**
 * Phase 30 (spec §5.5): the Register rows' duplicate check, run WHILE TYPING
 * on the house 400 ms debounce (Phase 29's `employee-no-check.tsx`), with
 * `flush()` for blur. One call covers every row, because a batch's hazard is
 * any tag or serial against the register. Only once a category names the
 * class: `checkIdentifiers` is class-scoped, so a guess could flag a
 * collision that exists only in the other class. Advisory — the server still
 * refuses at submit, in the same words.
 *
 * Staleness guard: a response for values the rows have since moved on from
 * is dropped (the change that moved them has already scheduled its own).
 */
export function useIdentifierCheck(tags: readonly string[], serials: readonly string[], cls: AssetClass | null): {
  hits: IdentifierHits;
  flush: () => void;
} {
  const sentTags = tags.map(tagKey).filter((t) => t && t.length <= 20);
  const sentSerials = serials.map((s) => s.trim()).filter(Boolean);
  const key = JSON.stringify([cls, sentTags, sentSerials]);

  const [result, setResult] = useState<{ cls: AssetClass | null; hits: IdentifierHits } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ key, cls, sentTags, sentSerials });
  latest.current = { key, cls, sentTags, sentSerials };
  const mounted = useRef(true);

  const run = useCallback(() => {
    timer.current = null;
    const snap = latest.current;
    if (!snap.cls || (snap.sentTags.length === 0 && snap.sentSerials.length === 0)) {
      setResult({ cls: snap.cls, hits: NONE });
      return;
    }
    void checkIdentifiers({ tags: snap.sentTags, serials: snap.sentSerials, cls: snap.cls }).then((res) => {
      if (!mounted.current || !res.ok) return;
      if (latest.current.key !== snap.key) return;
      setResult({ cls: snap.cls, hits: res.data });
    });
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(run, 400);
  }, [key, run]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A live setTimeout id that `run` and the effect above keep reassigning — reading it at unmount is the point.
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const flush = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    run();
  }, [run]);

  // Hits for another class never apply; hits a keystroke old still do, because
  // `registeredRows` re-tests them against the rows as typed now.
  const hits = result && result.cls === cls ? result.hits : NONE;
  return { hits, flush };
}
