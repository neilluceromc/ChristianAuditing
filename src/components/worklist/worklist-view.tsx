"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { SEE_ALL_HREF, sectionStats, WORK_SECTIONS, type WorkGroup, type WorkItem, type WorkSectionId } from "@/lib/worklist";
import {
  BULK, COLUMNS, DEFAULT_SORT, FILTERED_EMPTY, NO_FILTERS, TAB_LABEL, capNote, categoryChips, emptyQueue, filterRows, filtersActive,
  PER_PAGE, ROW_PX, drawerStays, focusAfterDecision, focusIsFree, refusedRowLeft, rowsThatFit, shouldRefocusAfterRefresh,
  filtersFor, headerCounts, nextSort, pageLabel, pageOfKey, paginate, queueTabs, selectAfter, sortRows, workHref,
  type WorkFilters, type WorkSort,
} from "@/lib/worklist-view";
import { DetailsPanel } from "./details-panel";
import { HiddenToday } from "./hidden-today";
import { QueueFilters, type BulkButton } from "./queue-filters";
import { QueueSummary } from "./queue-summary";
import { QueuePager, QueueTable } from "./queue-table";
import { QueueTabs } from "./queue-tabs";
import { useWorklistUndo } from "./use-worklist-undo";

/** From 1100 px the panel sits beside the table; below, it opens in a drawer (plan call 9). */
const WIDE = "(min-width: 1100px)";

function subscribeWide(on: () => void) {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", on);
  return () => m.removeEventListener("change", on);
}
const wideNow = () => window.matchMedia(WIDE).matches;
// the server renders the wide layout; CSS hides the aside below 1100 px until the client knows
const wideOnServer = () => true;

function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, wideNow, wideOnServer);
}

/**
 * Row height (final review ruling): a constant 52 px from 640 px up; how many rows a page shows flexes instead —
 * 6 to 10, as many as the table's box holds (`rowsThatFit`, measured with a ResizeObserver). Below 640 px the rows
 * stack at their own height, a page is ten rows, and the page may scroll.
 */
export const ROW_HEIGHT = `[--wl-row:auto] sm:[--wl-row:${ROW_PX}px]`;
/**
 * The one screen: the viewport less the top bar and main's padding — and, while Cris shows in the corner, less
 * Cris's clearance too (`--cris-clear`, 88 px, cris-widget.css: #main ends with that room so no page's last row sits
 * under Cris), or the document would scroll by exactly that much (Task 4's browser check at 1440×900).
 */
export const SCREEN_HEIGHT = "sm:h-[calc(100dvh-100px-var(--cris-clear,0px))]";
/** From 640 px the screen is fixed and rows per page are measured; below it the list stacks. */
const SCREEN = "(min-width: 640px)";

export interface WorklistInitial { q: WorkSectionId; page: number; sel: string | null }

/**
 * The Worklist (H4): one screen — the header, the queue tabs, then the open queue's summary, filters (or the bulk
 * bar), sortable paged table, and the details panel holding the queue's actions. Every queue is read once by the
 * page; tabs, filters, sort, paging and selection are client state. The queue, page and selected row are mirrored
 * into the URL (`?q=&page=&sel=`) by replacing the history entry, so Back and refresh keep the place without a
 * server round trip per arrow key.
 */
export function WorklistView({ groups, initial, canAct, cleared }: {
  groups: WorkGroup<WorkItem>[];
  initial: WorklistInitial;
  canAct: boolean;
  /** "Cleared today {n}" (clearedToday) */
  cleared: number;
}) {
  const wide = useWide();
  const [queue, setQueue] = useState<WorkSectionId>(initial.q);
  const [page, setPage] = useState(initial.page);
  const [sel, setSel] = useState<string | null>(initial.sel);
  const [filters, setFilters] = useState<WorkFilters>(NO_FILTERS);
  const [sort, setSort] = useState<WorkSort | null>(DEFAULT_SORT[initial.q]);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  /** rows a decision took off the list, hidden until the refreshed list drops them (or an Undo puts them back) */
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [drawer, setDrawer] = useState(false);
  /** rows per page: ten until measured, then as many as fit (6–10) */
  const [perPage, setPerPage] = useState(PER_PAGE);
  const focusRow = useRef(false);
  /**
   * A row to bring into view once the list holds it: the URL's `sel` on arrival (dropped at once when the list does
   * not hold it — fix round 1, M7 — so it can never snap back later), or a row an Undo put back (`wait`: the refresh
   * that brings it is still on its way).
   */
  const reveal = useRef<{ key: string; wait: boolean } | null>(initial.sel ? { key: initial.sel, wait: false } : null);
  /**
   * A decision took a row off: once the answer is in, focus goes where focusAfterDecision says (fix round 1, I1).
   * A counter, not a flag (final review I1): every request runs the focus move exactly once, and nothing stays armed
   * for a later ↑/↓ to set off.
   */
  const [focusTick, requestFocus] = useReducer((n: number) => n + 1, 0);
  const focusDone = useRef(0);
  /** a row refused as changed elsewhere: when the refresh drops it, focus (on its panel) must move on too */
  const refused = useRef<string | null>(null);
  const tableBox = useRef<HTMLElement>(null);
  const scrollBox = useRef<HTMLDivElement>(null);
  const panelBox = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const panelTitleId = useId();

  const group = groups.find((g) => g.section.id === queue);
  const live = useMemo(() => (group?.rows ?? []).filter((r) => !gone.has(r.key)), [group, gone]);
  const list = useMemo(() => sortRows(filterRows(live, filters), sort), [live, filters, sort]);
  const slice = paginate(list, page, perPage);
  const selected = slice.rows.find((r) => r.key === sel) ?? slice.rows[0] ?? null;
  const selKey = selected?.key ?? null;
  // no row left to show: the drawer closes for good, so an Undo that brings one back doesn't reopen it unasked
  if (drawer && !drawerStays(drawer, selKey)) setDrawer(false);

  // a refreshed list no longer holding a row a decision took off: forget it, so it can come back one day
  useEffect(() => {
    const present = new Set(groups.flatMap((g) => g.rows.map((r) => r.key)));
    if (refusedRowLeft(refused.current, present)) {
      const key = refused.current;
      refused.current = null;
      // only when there is work to do (final review I1): `latest` still holds the selection from before this refresh
      const active = document.activeElement;
      if (shouldRefocusAfterRefresh(key, latest.current.selKey, !active || active === document.body)) requestFocus();
    }
    setGone((g) => (g.size && [...g].some((k) => !present.has(k)) ? new Set([...g].filter((k) => present.has(k))) : g));
  }, [groups]);

  // the URL holds the place: replaced, never pushed, so Back leaves the page rather than walking each selection
  useEffect(() => {
    const href = workHref(queue, slice.page, selKey);
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(window.history.state, "", href);
  }, [queue, slice.page, selKey]);

  useEffect(() => {
    const r = reveal.current;
    if (!r) return;
    const p = pageOfKey(list, r.key, perPage);
    if (!p) {
      if (!r.wait) reveal.current = null;
      return;
    }
    reveal.current = null;
    setSel(r.key);
    setPage(p);
  }, [list, perPage]);

  // rows per page: measured on the table's box before the first paint, and again whenever it changes size
  useLayoutEffect(() => {
    const box = scrollBox.current;
    if (!box) return;
    const measure = () => {
      const head = box.querySelector("thead");
      const n = window.matchMedia(SCREEN).matches ? rowsThatFit(box.clientHeight - (head?.offsetHeight ?? 0)) : PER_PAGE;
      setPerPage((p) => (p === n ? p : n));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(box);
    return () => watch.disconnect();
  }, []);

  // ↑/↓ moved the selection: the row it landed on takes focus (it may be on the next page)
  useEffect(() => {
    if (!focusRow.current || !selKey) return;
    focusRow.current = false;
    tableBox.current?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(selKey)}"]`)?.focus();
  }, [selKey, slice.page]);

  // a decision's answer arrives after the person may have moved on: it reads the list and selection as they are then
  const latest = useRef({ list, selKey, sel, page });
  useEffect(() => { latest.current = { list, selKey, sel, page }; }, [list, selKey, sel, page]);

  // a new rows-per-page (another window size, or the first measurement): the selected row keeps its place — the URL's
  // `sel` wins over its `page` on arrival — and the page index is recomputed (the URL effect rewrites ?page=)
  const lastPerPage = useRef(perPage);
  useEffect(() => {
    if (lastPerPage.current === perPage) return;
    lastPerPage.current = perPage;
    const { list: now, sel: want, selKey: at, page: was } = latest.current;
    const key = want && now.some((r) => r.key === want) ? want : at;
    setPage(pageOfKey(now, key, perPage) ?? Math.min(was, Math.max(1, Math.ceil(now.length / perPage))));
    if (key) setSel(key);
  }, [perPage]);

  /** Select a row and show its page. */
  const select = useCallback((key: string | null, rows: WorkItem[] = list) => {
    reveal.current = null;
    setSel(key);
    const p = pageOfKey(rows, key, perPage);
    if (p) setPage(p);
  }, [list, perPage]);

  const decisions = useWorklistUndo({
    clear: (keys) => {
      const { list: now, selKey: at } = latest.current;
      requestFocus();
      refused.current = null;
      const drop = new Set(keys);
      setGone((g) => new Set([...g, ...keys]));
      setChecked((c) => new Set([...c].filter((k) => !drop.has(k))));
      select(selectAfter(now, drop, at), now.filter((r) => !drop.has(r.key)));
    },
    restore: (keys) => {
      setGone((g) => new Set([...g].filter((k) => !keys.includes(k))));
      reveal.current = keys[0] ? { key: keys[0], wait: true } : null;
    },
    moveOn: (key) => {
      const { list: now, selKey: at } = latest.current;
      requestFocus();
      refused.current = key;
      select(selectAfter(now, new Set([key]), at), now.filter((r) => r.key !== key));
    },
  });

  // decide → next, for the keyboard too: the element that had focus is gone (the row left, the buttons remounted),
  // so focus moves on with the selection — never to the page body — once the answer is in
  const busy = decisions.busy;
  useEffect(() => {
    if (focusTick === focusDone.current || busy) return;
    focusDone.current = focusTick;
    const target = focusAfterDecision(selKey, wide);
    // a frame later: the drawer (and its own focus handling) has settled, and the next row's panel is mounted
    requestAnimationFrame(() => {
      // someone typing (the search box, a reason) keeps their place: the answer never pulls focus away
      if (!focusIsFree(document.activeElement as HTMLInputElement | null)) return;
      const el = document.querySelector<HTMLElement>(target.selector) ?? document.getElementById(titleId);
      el?.focus();
    });
  }, [focusTick, selKey, busy, wide, titleId]);

  function pick(q: WorkSectionId) {
    reveal.current = null;
    refused.current = null;
    setQueue(q); setPage(1); setSel(null); setFilters(NO_FILTERS); setSort(DEFAULT_SORT[q]); setChecked(new Set()); setDrawer(false);
  }

  /**
   * Ruling (fix round 1, M6): a filter keeps the selected row and shows its page while it still matches; when the
   * filter hides it, the first visible row is selected, so the old key can't snap back when the filter clears.
   */
  function changeFilters(f: WorkFilters) {
    setFilters(f);
    const rows = sortRows(filterRows(live, f), sort);
    const p = pageOfKey(rows, selKey, perPage);
    reveal.current = null;
    if (p) setPage(p);
    else { setPage(1); setSel(rows[0]?.key ?? null); }
  }

  function openPanel() {
    if (!selected) return;
    if (!wide) setDrawer(true);
    // Enter: the panel's first action (or, for a viewer, its record link) takes focus
    requestAnimationFrame(() => {
      const root = wide ? panelBox.current : document.querySelector<HTMLElement>("[data-worklist-drawer]");
      root?.querySelector<HTMLElement>("[data-panel-actions] button:not([disabled]), [data-panel-actions] a[href], [data-panel-actions] textarea")?.focus();
    });
  }

  const bulk: readonly BulkButton[] = canAct ? BULK[queue] ?? [] : [];
  const ticks = bulk.length > 0;
  const checkedRows = list.filter((r) => checked.has(r.key));
  const counts = headerCounts(groups);
  const label = TAB_LABEL[queue];
  const section = WORK_SECTIONS.find((s) => s.id === queue)!;
  const stats = group ? sectionStats({ ...group, rows: live, total: Math.max(0, group.total - (group.rows.length - live.length)) }) : [{ label: "Items", value: "0" }];
  const active = filtersActive(filters);

  const empty = live.length === 0
    ? <><span className="block font-medium text-fg">{emptyQueue(queue).title}</span>{emptyQueue(queue).text}</>
    : list.length === 0
      ? <>{FILTERED_EMPTY}{" "}<Button variant="ghost" className="h-11 text-accent" onClick={() => changeFilters(NO_FILTERS)}>Clear filters</Button></>
      : null;

  const panel = (
    <DetailsPanel
      item={selected} section={queue} canAct={canAct} decisions={decisions} headingId={panelTitleId}
      filtered={live.length > 0 && list.length === 0}
    />
  );

  return (
    <div className={`flex flex-col gap-3 ${SCREEN_HEIGHT} ${ROW_HEIGHT}`}>
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold leading-tight tracking-[-0.015em] text-fg">Worklist</h1>
        <span className="text-[13.5px] text-fg-muted">
          {counts.waiting} waiting on IT
          {counts.overdue > 0 && <> · <span className="text-(--st-fault-text)">{counts.overdue} overdue</span></>}
        </span>
        <span className="ml-auto text-[12.5px] text-fg-muted">Cleared today <b className="font-semibold tabular-nums text-fg">{cleared}</b></span>
      </header>

      <QueueTabs tabs={queueTabs(groups, queue)} onPick={pick} />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_384px]">
        <section
          ref={tableBox}
          aria-labelledby={titleId}
          data-per-page={perPage}
          className="flex min-h-0 flex-col overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card"
        >
          <QueueSummary
            id={titleId} title={label} blurb={section.blurb} stats={stats}
            link={queue === "purchases" ? { href: SEE_ALL_HREF.purchases, label: "Open in Purchase orders →" } : undefined}
          />
          <QueueFilters
            queue={label}
            chips={categoryChips(live)}
            offers={filtersFor(queue)}
            filters={filters}
            onFilters={changeFilters}
            checked={checkedRows.length}
            bulk={bulk}
            onBulk={(id) => (id === "CHECK" ? decisions.checkBulk(checkedRows) : decisions.triageBulk(checkedRows, id))}
            onClearChecks={() => setChecked(new Set())}
            busy={decisions.busy}
          />
          <QueueTable
            label={label}
            boxRef={scrollBox}
            columns={COLUMNS[queue]}
            rows={slice.rows}
            sort={sort}
            onSort={(key, numeric) => {
              // the selected row keeps its place: the page follows it into the new order
              const next = nextSort(sort, key, numeric);
              setSort(next);
              setPage(pageOfKey(sortRows(filterRows(live, filters), next), selKey, perPage) ?? 1);
            }}
            selected={selKey}
            onSelect={(key) => { select(key); if (!wide) setDrawer(true); }}
            onMove={(delta) => {
              const i = list.findIndex((r) => r.key === selKey);
              const next = list[Math.min(list.length - 1, Math.max(0, i + delta))];
              if (!next) return;
              focusRow.current = true;
              select(next.key);
            }}
            onOpen={openPanel}
            ticks={ticks}
            checked={checked}
            onCheck={(key, on) => setChecked((c) => { const n = new Set(c); if (on) n.add(key); else n.delete(key); return n; })}
            onCheckAll={(on) => setChecked((c) => { const n = new Set(c); for (const r of slice.rows) { if (on) n.add(r.key); else n.delete(r.key); } return n; })}
            empty={empty}
          />
          <QueuePager
            label={pageLabel(slice)}
            note={active ? null : capNote(group, slice)}
            seeAll={SEE_ALL_HREF[queue]}
            page={slice.page}
            pageCount={slice.pageCount}
            onPage={(p) => { const s = paginate(list, p, perPage); reveal.current = null; setPage(s.page); setSel(s.rows[0]?.key ?? null); }}
            extra={canAct && group && group.hidden.length > 0 ? <HiddenToday rows={group.hidden} /> : null}
          />
        </section>

        {wide && (
          <aside
            ref={panelBox}
            aria-labelledby={selected ? panelTitleId : undefined}
            aria-label={selected ? undefined : "Details"}
            data-worklist-panel=""
            className="hidden min-h-0 flex-col rounded-(--radius-card) border border-border bg-surface px-5 py-4 shadow-card min-[1100px]:flex"
          >
            {panel}
          </aside>
        )}
      </div>

      {!wide && selected && (
        <Drawer open={drawer} onClose={() => setDrawer(false)} title={label} width={384}>
          <div data-worklist-drawer="" className="flex h-full min-h-0 flex-col">{panel}</div>
        </Drawer>
      )}
    </div>
  );
}
