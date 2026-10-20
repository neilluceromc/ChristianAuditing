/**
 * Task 6 review I1 / I3 (spec §7.2): what Inventory's search box does with a search.
 * - Typing or pasting (debounced) filters the list with `replace`, so typing never floods the history. A full tag
 *   typed or pasted only filters.
 * - Enter is the USB scanner contract: it asks the server for an exact tag (`find`, the `findExactTag` action) and
 *   on a hit PUSHES the record, so Back returns to the list. On a miss, or if the lookup fails, it is the ordinary
 *   live search. No `go=1` same-page navigation is involved, so the stuck-navigation fallback can never reload the
 *   page for it (the `go=1` URL contract stays for direct links).
 * - `stillCurrent` is false when a newer search started while the lookup ran; the stale answer is then dropped.
 */
export async function inventorySearchSubmit(
  q: string,
  how: { enter: boolean },
  deps: {
    /** the list's URL for this search (the live search) */
    listHref: string;
    find: (q: string) => Promise<{ id: string } | null>;
    push: (href: string) => void;
    replace: (href: string) => void;
    stillCurrent: () => boolean;
  },
): Promise<void> {
  const text = q.trim();
  if (!how.enter || !text) {
    deps.replace(deps.listHref);
    return;
  }
  let hit: { id: string } | null = null;
  try {
    hit = await deps.find(text);
  } catch {
    hit = null;
  }
  if (!deps.stillCurrent()) return;
  if (hit) deps.push(`/inventory/${hit.id}`);
  else deps.replace(deps.listHref);
}
