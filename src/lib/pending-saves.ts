/**
 * Phase 39 (spec §4.1): "paging never loses a typed value". The stocktake count sheet keeps every in-flight row save
 * in a set; before any page or filter navigation it awaits this, and navigates only when it comes back true.
 *
 * Waits until every promise in `pending` has settled, including any added while it waits, and reports whether all
 * of them came back `true`. A rejection counts as a failure rather than throwing. The set is read, never changed:
 * each owner removes its own promise when it settles.
 */
export async function waitForAll(pending: ReadonlySet<Promise<boolean>>): Promise<boolean> {
  const seen = new Set<Promise<boolean>>();
  let ok = true;
  for (;;) {
    const batch = [...pending].filter((p) => !seen.has(p));
    if (batch.length === 0) return ok;
    for (const p of batch) seen.add(p);
    const results = await Promise.allSettled(batch);
    if (results.some((r) => r.status === "rejected" || r.value !== true)) ok = false;
  }
}
