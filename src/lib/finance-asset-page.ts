import type { DepResult, MonthIndex } from "./depreciation";
import {
  HISTORY_KINDS, buildHistory, type AuditRow, type DepLine, type HistoryContext, type HistoryKind, type HistoryResult,
  type HistoryRow,
} from "./finance-history";
import { ATTACHMENT_KINDS, type AttachmentKind } from "./asset-notes";
import { csvTextCell } from "./csv";

/*
 * Phase 47 (Task 7, spec §4): the Finance asset page (mockup Option B · Ledger). Pure: the URL state every tab and
 * filter lives in, the left panel's life summary (read from the engine's result, never recomputed), file sizes, which
 * files preview inline, and the Financial history's CSV.
 */

export type AssetTab = "ledger" | "notes" | "files" | "history";
export const ASSET_TABS: readonly AssetTab[] = ["ledger", "notes", "files", "history"];

export interface AssetPageState {
  tab: AssetTab;
  /** A calendar year of the life, "all" for All years, null for the default year (`defaultLedgerYear`). */
  year: number | "all" | null;
  /** The left panel's document open in the preview (an AssetDocument id). */
  doc: string | null;
  /** History kind filter. */
  hk: HistoryKind | "all";
  /** History person filter: an actor key (user id, or "system"); null = Everyone. */
  hw: string | null;
  /** History page, 1-based (buildHistory clamps it). */
  hp: number;
  /** Attachment kind filter. */
  ak: AttachmentKind | "all";
  /** The attachment open in the preview. */
  att: string | null;
}

export const DEFAULT_ASSET_PAGE_STATE: AssetPageState = {
  tab: "ledger", year: null, doc: null, hk: "all", hw: null, hp: 1, ak: "all", att: null,
};

const text = (v: string | null) => {
  const t = v?.trim();
  return t ? t : null;
};

export function parseAssetPageState(sp: URLSearchParams): AssetPageState {
  const tab = sp.get("tab");
  const rawYear = sp.get("year");
  const yearNum = rawYear !== null && /^\d{4}$/.test(rawYear) ? Number(rawYear) : null;
  const hk = sp.get("hk");
  const ak = sp.get("ak");
  const hp = Number.parseInt(sp.get("hp") ?? "", 10);
  return {
    tab: (ASSET_TABS as readonly string[]).includes(tab ?? "") ? (tab as AssetTab) : "ledger",
    year: rawYear === "all" ? "all" : yearNum,
    doc: text(sp.get("doc")),
    hk: (HISTORY_KINDS as readonly string[]).includes(hk ?? "") ? (hk as HistoryKind) : "all",
    hw: text(sp.get("hw")),
    hp: Number.isFinite(hp) && hp > 1 ? hp : 1,
    ak: (ATTACHMENT_KINDS as readonly string[]).includes(ak ?? "") ? (ak as AttachmentKind) : "all",
    att: text(sp.get("att")),
  };
}

/** The page's URL for `state` with `patch` applied. Defaults are left out, in a stable order. */
export function assetPageHref(id: string, state: AssetPageState, patch: Partial<AssetPageState> = {}): string {
  const s = { ...state, ...patch };
  const p = new URLSearchParams();
  if (s.tab !== "ledger") p.set("tab", s.tab);
  if (s.year !== null) p.set("year", String(s.year));
  if (s.doc) p.set("doc", s.doc);
  if (s.hk !== "all") p.set("hk", s.hk);
  if (s.hw) p.set("hw", s.hw);
  if (s.hp > 1) p.set("hp", String(s.hp));
  if (s.ak !== "all") p.set("ak", s.ak);
  if (s.att) p.set("att", s.att);
  const qs = p.toString();
  return `/finance/assets/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
}

// ---- the left panel -------------------------------------------------------------------------------------------------

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 2029": the panel's "ends Mon YYYY". */
export function shortMonthLabel(m: MonthIndex): string {
  return `${SHORT_MONTHS[((m % 12) + 12) % 12]} ${Math.floor(m / 12)}`;
}

export interface LifeSummary {
  /** Life used, 0–100 (the ring). */
  usedPct: number;
  monthsUsed: number;
  lifeMonths: number;
  monthsLeft: number;
  endsLabel: string;
  costC: number;
  accC: number;
  bookC: number;
  monthlyC: number | null;
  /** Depreciated ÷ cost, 0–100 (the cost-versus-depreciated bar). */
  depreciatedPct: number;
}

/**
 * The ring, bar and figures of the left panel, read from the engine's result and the detail's `monthsUsed`. Null when
 * there is no schedule to show (no cost, not capitalised, not approved, no policy, salvage not below cost).
 */
export function lifeSummary(r: DepResult | null, monthsUsed: number | null): LifeSummary | null {
  if (!r || !r.policy || r.startMonth === null || monthsUsed === null) return null;
  if (r.state !== "depreciating" && r.state !== "fully-depreciated") return null;
  const life = r.policy.lifeMonths;
  const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.max(0, Math.round((n / d) * 100))) : 0);
  return {
    usedPct: pct(monthsUsed, life),
    monthsUsed,
    lifeMonths: life,
    monthsLeft: Math.max(0, life - monthsUsed),
    endsLabel: shortMonthLabel(r.startMonth + life - 1),
    costC: r.cost,
    accC: r.accumulated,
    bookC: r.bookValue,
    monthlyC: r.monthly,
    depreciatedPct: pct(r.accumulated, r.cost),
  };
}

/**
 * The ledger's "why there is no schedule" (spec §4.2): not capitalised, no cost, not yet approved — else the engine's
 * own state note (no policy, salvage not below cost).
 */
export function noScheduleReason(a: { notCapitalised: boolean; costC: number | null; approvedAt: Date | null; note: string | null }): string {
  if (a.notCapitalised) return "Not capitalised: this asset was expensed, so it is not depreciated.";
  if (a.costC === null) return "No cost recorded: the schedule starts once the cost is in and Finance approves it.";
  if (a.approvedAt === null) return "Not approved yet: the schedule starts once Finance approves this asset.";
  return a.note ?? "This asset has no depreciation schedule.";
}

// ---- files ----------------------------------------------------------------------------------------------------------

/** "512 B", "2 KB", "1.5 MB" (decimal units, as the 4 MB cap is 4,000,000 bytes). Older rows have no size: "—". */
export function fmtFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${Number((bytes / 1_000_000).toFixed(1))} MB`;
}

/** How a file previews inline (the download route's `?inline=1` serves exactly these): a frame, an image, or not at all. */
export function previewKind(fileName: string): "pdf" | "image" | null {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "pdf") return "pdf";
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return "image";
  return null;
}

/** The asset document download route (Task 4): `inline` previews a PDF or an image in the page. */
export function assetDocHref(assetId: string, docId: string, inline = false): string {
  return `/inventory/${encodeURIComponent(assetId)}/documents/${encodeURIComponent(docId)}/download${inline ? "?inline=1" : ""}`;
}

// ---- the history ---------------------------------------------------------------------------------------------------

/**
 * The Financial history for the page's (or the export's) URL state. A person filter naming no one in this asset's
 * history (a stale or hand-edited `?hw=`) is treated as Everyone, so the select and the list never disagree; the
 * returned `hw` is the filter actually applied.
 */
export function assetHistory(
  audit: AuditRow[],
  lines: DepLine[],
  state: Pick<AssetPageState, "hk" | "hw" | "hp">,
  ctx: HistoryContext,
  pageSize?: number,
): { history: HistoryResult; hw: string | null } {
  const run = (person: string | null) =>
    buildHistory(audit, lines, { kind: state.hk, person: person ?? undefined, page: state.hp, pageSize }, ctx);
  const history = run(state.hw);
  if (state.hw && !history.actors.some((a) => a.key === state.hw)) return { history: run(null), hw: null };
  return { history, hw: state.hw };
}

// ---- the history CSV ------------------------------------------------------------------------------------------------

/** The kind pill's word for one entry (the filter's labels are plural). */
export const HISTORY_KIND_PILL: Record<HistoryKind, string> = {
  approval: "Approval", review: "Review", cost: "Cost", settings: "Settings", docs: "Documents", notes: "Note", dep: "Depreciation",
};

/**
 * Export log (spec §4.5): the filtered entries as CSV — RFC 4180 quoting, CRLF line ends, a UTF-8 BOM so a
 * spreadsheet reads the peso sign.
 */
export function historyCsv(rows: readonly HistoryRow[]): string {
  const head = ["Reference", "Exact time", "Who", "Role", "Kind", "What", "Changes", "Reason", "Source", "Signed in as", "Related"];
  const lines = rows.map((r) => [
    r.ref, r.exact, r.actor, r.role ?? "", HISTORY_KIND_PILL[r.kind], r.verb,
    r.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join("; "),
    r.reason ?? "", r.sourceLabel, r.account ?? "", r.related,
  ].map(csvTextCell).join(","));
  return `﻿${[head.join(","), ...lines].join("\r\n")}`;
}
