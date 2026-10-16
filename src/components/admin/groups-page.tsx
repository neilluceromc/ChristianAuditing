"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Stat } from "@/components/ui/stat";
import { Td, TBody, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { cn } from "@/lib/cn";
import { fmtDate } from "@/lib/format";
import {
  GROUP_NAME_TAKEN, filterGroups, showCounts, sortGroups,
  type GroupKindValue, type GroupRow, type GroupShow,
} from "@/lib/groups";
import { createGroup, renameGroup, setGroupArchived } from "@/server/modules/admin/group-actions";

type Tab = "client" | "internal";
const KIND: Record<Tab, GroupKindValue> = { client: "CLIENT", internal: "INTERNAL" };
const SHOWS: GroupShow[] = ["active", "nopol", "ended", "all"];
const isShow = (v: string | null): v is GroupShow => !!v && (SHOWS as string[]).includes(v);

const WORDS = {
  client: {
    one: "client", tabLabel: "Clients", active: "Active clients", find: "Find a client", add: "Add client",
    ended: "Ended", stop: "End account", sub: "Client account", endedSub: "Ended",
    footer: "Ending a client account keeps its history and takes it off the “Works for” list for new hires. Staff still on it are listed so IT can offboard or move them.",
  },
  internal: {
    one: "department", tabLabel: "Internal departments", active: "Active departments", find: "Find a department", add: "Add department",
    ended: "Archived", stop: "Archive", sub: "Internal department", endedSub: "Archived",
    footer: "Archiving a department keeps its history and takes it off the list for new hires. People still in it stay until moved with a transfer.",
  },
} as const;

/** Phase 37 (spec §2.2): clients and internal departments in one page; search, filter and sort run in the browser. */
export function GroupsPage({ rows, canMutate, initialTab }: { rows: GroupRow[]; canMutate: boolean; initialTab: Tab }) {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get("tab");
    return t === "client" || t === "internal" ? t : initialTab;
  });
  const [show, setShow] = useState<GroupShow>(() => { const s = params.get("show"); return isShow(s) ? s : "active"; });
  const [q, setQ] = useState(() => params.get("q") ?? "");
  const [sort, setSort] = useState<"name" | "people">("name");
  const [dir, setDir] = useState<1 | -1>(1);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const kind = KIND[tab];
  const w = WORDS[tab];

  // tab, filter and search live in the URL (replaceState: no history entry per keystroke)
  useEffect(() => {
    const next = new URLSearchParams();
    if (tab !== "client") next.set("tab", tab);
    if (show !== "active") next.set("show", show);
    if (q.trim()) next.set("q", q);
    const qs = next.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [tab, show, q]);

  useEffect(() => { if (adding) addRef.current?.focus(); }, [adding]);

  const counts = useMemo(() => showCounts(rows, kind), [rows, kind]);
  const activeCounts = useMemo(() => ({ client: showCounts(rows, "CLIENT").active, internal: showCounts(rows, "INTERNAL").active }), [rows]);
  const people = useMemo(
    () => rows.filter((r) => r.kind === kind && !r.archivedAt).reduce((n, r) => n + r.people, 0),
    [rows, kind],
  );
  const shown = useMemo(() => sortGroups(filterGroups(rows, { kind, q, show }), sort, dir), [rows, kind, q, show, sort, dir]);

  const typed = newName.trim().toLowerCase();
  const taken = typed.length > 0 && rows.some((r) => r.name.toLowerCase() === typed);

  function settle(res: Awaited<ReturnType<typeof createGroup>>, onOk: () => void, onField: (m: string) => void) {
    if (res.ok) onOk();
    else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else if (res.kind === "validation") onField(Object.values(res.fieldErrors ?? {})[0] ?? res.message);
    else setError(res.message);
  }

  function add() {
    if (!newName.trim() || taken) return;
    const name = newName.trim();
    setError(null);
    setAddError(null);
    startTransition(async () => {
      settle(await createGroup({ kind, name }), () => {
        toast(`Added ${name}`, "settled");
        setNewName("");
        setAdding(false);
        setQ(name);
        setShow("active");
        router.refresh();
      }, setAddError);
    });
  }

  function saveRename() {
    if (!renaming) return;
    setError(null);
    setRenameError(null);
    startTransition(async () => {
      settle(await renameGroup({ id: renaming.id, name: renaming.name }), () => {
        toast("Renamed", "settled");
        setRenaming(null);
        router.refresh();
      }, setRenameError);
    });
  }

  function archive(row: GroupRow, archived: boolean) {
    setError(null);
    startTransition(async () => {
      settle(await setGroupArchived({ id: row.id, archived }), () => {
        toast(archived ? `${row.kind === "CLIENT" ? "Ended" : "Archived"} ${row.name}` : `Restored ${row.name}`, "settled");
        router.refresh();
      }, setError);
    });
  }

  function toggleSort(col: "name" | "people") {
    if (sort === col) setDir((d) => (d === 1 ? -1 : 1));
    else { setSort(col); setDir(col === "people" ? -1 : 1); }
  }

  const sortOf = (col: "name" | "people") => (sort === col ? (dir === 1 ? "asc" : "desc") : undefined);

  return (
    <div className="flex flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <div role="tablist" aria-label="Kind of staff group" className="flex gap-1 border-b border-border">
        {(["client", "internal"] as const).map((t) => (
          <button
            key={t} type="button" role="tab" id={`groups-tab-${t}`} aria-selected={tab === t} aria-controls="groups-panel"
            onClick={() => { setTab(t); setShow("active"); setQ(""); setAdding(false); setNewName(""); setRenaming(null); }}
            className={cn(
              "relative px-3 py-2 text-[12.5px] font-medium transition-colors duration-(--dur-1)",
              tab === t ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
            )}
          >
            {WORDS[t].tabLabel} <span className="font-mono text-[11px] text-fg-muted">{activeCounts[t]}</span>
            {tab === t && <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] bg-accent" />}
          </button>
        ))}
      </div>

      <div id="groups-panel" role="tabpanel" aria-labelledby={`groups-tab-${tab}`} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="px-4 py-3"><Stat label={w.active} value={counts.active} /></Card>
          <Card className="px-4 py-3"><Stat label="People" value={people} hint="active people in active rows" /></Card>
          <button
            type="button" onClick={() => setShow("nopol")}
            className="rounded-(--radius-card) border border-border bg-surface px-4 py-3 text-left shadow-card hover:bg-surface-subtle"
          >
            <Stat label="Without an equipment policy" value={counts.nopol} tone={counts.nopol > 0 ? "accent" : "neutral"} hint="Show them" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[200px] flex-1 sm:max-w-[280px]">
            <label htmlFor="groups-find" className="sr-only">{w.find}</label>
            <Input
              id="groups-find" type="search" data-page-search value={q} placeholder={`${w.find}…`} className="py-1.5 text-xs"
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div role="group" aria-label="Which rows to show" className="inline-flex rounded-(--radius-btn) border border-border-strong bg-surface-subtle p-0.5">
            {SHOWS.map((s) => (
              <button
                key={s} type="button" aria-pressed={show === s} onClick={() => setShow(s)}
                className={cn(
                  "rounded-[5px] px-3 py-1 text-xs font-medium transition-colors duration-(--dur-1)",
                  show === s ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg-secondary",
                )}
              >
                {s === "active" ? "Active" : s === "nopol" ? "No policy" : s === "ended" ? w.ended : "All"}{" "}
                <span className="font-mono text-[11px]">{counts[s]}</span>
              </button>
            ))}
          </div>
          {canMutate && !adding && (
            <Button size="sm" variant="primary" className="ml-auto" onClick={() => { setAdding(true); setAddError(null); }}>
              + {w.add}
            </Button>
          )}
        </div>

        {canMutate && adding && (
          <div className="flex flex-col gap-1 rounded-(--radius-card) border border-border bg-surface-subtle px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                ref={addRef} aria-label={`Name for the new ${w.one}`} aria-describedby="groups-add-hint"
                placeholder={`Add a ${w.one}…`} value={newName} invalid={taken || !!addError}
                className="max-w-[320px] flex-1 py-1.5 text-xs"
                onChange={(e) => { setNewName(e.target.value); setAddError(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); add(); }
                  if (e.key === "Escape") { setAdding(false); setNewName(""); setAddError(null); }
                }}
              />
              <Button size="sm" variant="primary" loading={pending} disabled={!newName.trim() || taken} onClick={add}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); setAddError(null); }}>Cancel</Button>
            </div>
            {taken || addError ? (
              <p id="groups-add-hint" role="alert" className="text-[11px] font-medium text-danger" style={{ color: "var(--error-text)" }}>
                {taken ? GROUP_NAME_TAKEN : addError}
              </p>
            ) : (
              <p id="groups-add-hint" className="text-[11px] text-fg-muted">
                Next: set up its equipment policy so new staff show what they are missing.
              </p>
            )}
          </div>
        )}

        <div className="max-h-[520px] overflow-auto rounded-(--radius-card) border border-border bg-surface shadow-card">
          <table className="w-full border-collapse text-[12.5px]">
            <THead>
              <Tr className="hover:bg-transparent">
                <Th sort={sortOf("name")} onSort={() => toggleSort("name")}>Name</Th>
                <Th width={110} sort={sortOf("people")} onSort={() => toggleSort("people")}>People</Th>
                <Th width={190}>Equipment policy</Th>
                <Th width={100}>Status</Th>
                <Th width={230} aria-label="Row actions" />
              </Tr>
            </THead>
            <TBody>
              {shown.map((row) => {
                const ended = !!row.archivedAt;
                const rowWords = WORDS[row.kind === "CLIENT" ? "client" : "internal"];
                return (
                  <Tr key={row.id}>
                    <Td>
                      {renaming?.id === row.id ? (
                        <div className="flex flex-col gap-1 py-1.5">
                          <Input
                            aria-label={`New name for ${row.name}`} value={renaming.name} autoFocus invalid={!!renameError}
                            className="py-1.5 text-xs"
                            onChange={(e) => { setRenaming({ id: row.id, name: e.target.value }); setRenameError(null); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); saveRename(); }
                              if (e.key === "Escape") { setRenaming(null); setRenameError(null); }
                            }}
                            onBlur={() => { setRenaming(null); setRenameError(null); }}
                          />
                          {renameError && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{renameError}</p>}
                        </div>
                      ) : (
                        <div className="flex flex-col py-1.5">
                          <span className="text-[12.5px] text-fg">{row.name}</span>
                          <span className="text-[10.5px] text-fg-muted">
                            {ended ? `${rowWords.endedSub} ${fmtDate(row.archivedAt)}` : rowWords.sub}
                          </span>
                        </div>
                      )}
                    </Td>
                    <Td mono>{row.people}</Td>
                    <Td>
                      <Link
                        href={`/admin/equipment-policies?tab=${row.kind === "CLIENT" ? "client" : "internal"}&group=${row.id}`}
                        className="text-accent hover:underline"
                      >
                        {row.policyItems
                          ? `${row.policyItems} ${row.policyItems === 1 ? "item" : "items"}`
                          : "No policy · Set one up"}
                      </Link>
                    </Td>
                    <Td>{ended ? <Pill>{rowWords.ended}</Pill> : <Pill tone="accent">Active</Pill>}</Td>
                    <Td>
                      {row.locked ? (
                        <Pill>LOCKED</Pill>
                      ) : canMutate ? (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" disabled={pending} aria-label={`Rename ${row.name}`}
                            onClick={() => { setRenaming({ id: row.id, name: row.name }); setRenameError(null); }}>
                            Rename
                          </Button>
                          {ended ? (
                            <Button size="sm" variant="ghost" disabled={pending} aria-label={`Restore ${row.name}`} onClick={() => archive(row, false)}>Restore</Button>
                          ) : (
                            <Button size="sm" variant="ghost" disabled={pending}
                              aria-label={row.kind === "CLIENT" ? `End the ${row.name} account` : `Archive ${row.name}`}
                              onClick={() => archive(row, true)}>
                              {rowWords.stop}
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-xs text-fg-muted">
                    {q.trim() ? `No ${w.one} matches “${q.trim()}”.` : "Nothing here."}
                  </td>
                </tr>
              )}
            </TBody>
          </table>
        </div>

        <p className="text-xs text-fg-muted">
          Showing {shown.length} of {counts.all}. {w.footer}
        </p>
      </div>
    </div>
  );
}
