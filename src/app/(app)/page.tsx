import { cookies } from "next/headers";
import { requireUser } from "@/server/auth/guards";
import { resolveWorkspace, WORKSPACE_NAV, type WorkspaceId } from "@/lib/workspaces";
import { filterSectionsForRole } from "@/components/shell/sidebar";
import { safeSection } from "@/lib/section";
import {
  ageHistogram, claimedByYou, financeHome, fleet, purchasingHome, warrantyRunway, yourShift,
} from "@/server/modules/home/queries";
import { adminHome } from "@/server/modules/admin/queries";
import { AdminHomeBody } from "@/components/home/admin-home";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status";
import { SectionCard } from "@/components/home/section-card";
import { FocusToggle } from "@/components/home/focus-toggle";
import { YourShift } from "@/components/home/your-shift";
import { FleetBar } from "@/components/home/fleet-bar";
import { AgeHistogram } from "@/components/home/age-histogram";
import { WarrantyRunway } from "@/components/home/warranty-runway";
import { JumpTo } from "@/components/home/jump-to";
import Link from "next/link";
import type { TodoRow } from "@/server/modules/home/queries";

/**
 * Focus's only job is hiding SECONDARY sections (fleet/age/warranty/Jump-to
 * on IT, Jump-to on purchasing and finance — see the `!focus` blocks below).
 * The Admin Home has no secondary section: its three lists (users, flags,
 * webhooks) are the whole page. Showing the toggle there would render a
 * control that flips a cookie and re-renders the page identically. That is a
 * NEAR relative of HANDOVER §6a rule 10 rather than an instance of it — rule
 * 10 is about an action guaranteed to FAIL (a Disable button whose rule
 * always refuses); this one succeeds and simply does nothing visible. Same
 * remedy, different failure: don't render a control whose effect the page
 * cannot deliver. A `Record` rather than an inline
 * `ws !== "admin"` so a future secondary section on Admin's Home is a
 * one-word change here, and adding a fifth workspace forces a decision at
 * this table instead of being silently `true` by omission.
 */
const SHOWS_FOCUS_TOGGLE: Record<WorkspaceId, boolean> = {
  it: true,
  purchasing: true,
  finance: true,
  admin: false,
};

function TodoList({ rows, empty }: { rows: TodoRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-xs text-fg-muted">{empty}</p>;
  return (
    <ol className="flex flex-col">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 border-b border-border-faint py-2 last:border-b-0">
          <Link href={r.href} className="font-mono text-[11px] font-medium text-accent hover:underline">{r.refNo}</Link>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-fg">{r.what}</span>
            <span className="block font-mono text-[10.5px] text-fg-muted">{r.meta}</span>
          </span>
          <Link href={r.href} className="shrink-0 text-[12px] font-medium text-accent hover:underline">{r.action}</Link>
        </li>
      ))}
    </ol>
  );
}

export default async function Home() {
  const user = await requireUser();
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const focus = jar.get("br.focus")?.value === "on";
  const sections = filterSectionsForRole(WORKSPACE_NAV[ws], user.role);
  const isViewer = user.role === "viewer";

  const header = (
    <PageHeader
      title={`Hello, ${user.name.split(" ")[0]}`}
      badge={isViewer ? <Pill>READ-ONLY · VIEWER</Pill> : undefined}
      actions={SHOWS_FOCUS_TOGGLE[ws] ? <FocusToggle on={focus} /> : undefined}
    />
  );

  // ── Admin: who can get in, what is switched on, are integrations healthy ─
  if (ws === "admin") {
    const admin = await safeSection("Admin overview", () => adminHome());
    return (
      <>
        {header}
        <div className="flex max-w-[900px] flex-col gap-4">
          {/*
            No "Jump to" here: WORKSPACE_NAV.admin is Users & roles, Webhooks,
            Feature flags, and AdminHomeBody already links to all three
            inline. A Jump-to card would repeat those same three links plus
            one back to this page — the redundancy IT/purchasing/finance
            don't have, because none of their bodies carry inline links.
          */}
          <SectionCard title="System" result={admin}>
            {(data) => <AdminHomeBody data={data} />}
          </SectionCard>
        </div>
      </>
    );
  }

  // ── Purchasing: a to-do list and spend ─────────────────────────────────
  if (ws === "purchasing") {
    const home = await safeSection("Your requests", () => purchasingHome(user.id));
    return (
      <>
        {header}
        <div className="flex max-w-[900px] flex-col gap-4">
          <SectionCard title="Your requests" result={home}>
            {(d) => (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat label="Drafts" value={d.draftCount} />
                  <Stat label="Awaiting IT" value={d.awaitingIT} />
                  <Stat label="Awaiting finance" value={d.awaitingFinance} />
                  <Stat label="Spend this month" value={d.spendThisMonth} />
                </div>
                <TodoList rows={d.todo} empty="Nothing of yours is waiting — every request has moved on." />
              </div>
            )}
          </SectionCard>
          {!focus && (
            <SectionCard title="Jump to" result={{ ok: true, data: sections }}>
              {(s) => <JumpTo sections={s} />}
            </SectionCard>
          )}
        </div>
      </>
    );
  }

  // ── Finance: money and age first, counts second ────────────────────────
  if (ws === "finance") {
    const home = await safeSection("Waiting on you", () => financeHome());
    return (
      <>
        {header}
        <div className="flex max-w-[900px] flex-col gap-4">
          <SectionCard title="Waiting on you" result={home}>
            {(d) => (
              <div className="flex flex-col gap-4">
                <p className="text-[19px] font-semibold leading-tight text-fg">
                  {d.waiting} waiting
                  {d.oldestDays !== null && (
                    <span className="text-fg-muted">
                      , oldest {d.oldestDays} day{d.oldestDays === 1 ? "" : "s"}
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Stat label="Requests waiting" value={d.waitingCount} />
                  <Stat label="Approved this month" value={d.approvedThisMonth} />
                  <Stat label="Capitalized" value={d.capitalized} hint={`${d.capitalizedCount} assets`} />
                </div>
                <TodoList rows={d.queue} empty="Nothing is waiting on finance right now." />
              </div>
            )}
          </SectionCard>
          {!focus && (
            <SectionCard title="Jump to" result={{ ok: true, data: sections }}>
              {(s) => <JumpTo sections={s} />}
            </SectionCard>
          )}
        </div>
      </>
    );
  }

  // ── IT (and admin, and viewer read-only): no KPI row, work first ───────
  const [shift, claims, fleetData, age, warranty] = await Promise.all([
    isViewer
      ? Promise.resolve({ ok: true as const, data: [] })
      : safeSection("Your shift", () => yourShift(user.id)),
    safeSection("Claimed by you", () => claimedByYou(user.id)),
    safeSection("Fleet", () => fleet()),
    safeSection("Age", () => ageHistogram()),
    safeSection("Warranty runway", () => warrantyRunway()),
  ]);

  return (
    <>
      {header}
      <div className="flex max-w-[980px] flex-col gap-4">
        {/* Viewer has no action queue, so it doesn't get one (entry criterion #3). */}
        {!isViewer && (
          <SectionCard title="Your shift" result={shift}>
            {(rows) => <YourShift rows={rows} canAct />}
          </SectionCard>
        )}

        {/* Claims sit ABOVE the pool — a forgotten claim is worse than an unclaimed item. */}
        <SectionCard title="Claimed by you" result={claims}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-xs text-fg-muted">You hold no claims.</p>
            ) : (
              <ol className="flex flex-col">
                {rows.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 border-b border-border-faint py-2 last:border-b-0">
                    <StatusDot value="CLAIMED" />
                    <Link href={`/approvals/${c.id}`} className="font-mono text-[11px] font-medium text-accent hover:underline">
                      {c.refNo}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-secondary">{c.line1}</span>
                    <span className={c.sla.overdue ? "font-mono text-[10.5px] font-semibold text-[color:var(--st-fault-text)]" : "font-mono text-[10.5px] text-fg-muted"}>
                      {c.sla.text}
                    </span>
                  </li>
                ))}
              </ol>
            )
          }
        </SectionCard>

        {!focus && (
          <>
            <SectionCard title="Fleet" result={fleetData}>
              {(d) => <FleetBar fleet={d} />}
            </SectionCard>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SectionCard title="Age" result={age}>
                {(bars) => <AgeHistogram bars={bars} />}
              </SectionCard>
              <SectionCard title="Warranty runway" result={warranty}>
                {(rows) => <WarrantyRunway rows={rows} />}
              </SectionCard>
            </div>

            <SectionCard title="Jump to" result={{ ok: true, data: sections }}>
              {(s) => <JumpTo sections={s} />}
            </SectionCard>
          </>
        )}

        {focus && (
          <p className="font-mono text-[10.5px] text-fg-muted">
            Focus mode — fleet, age, warranty and quick links are hidden. Everything else is still there.
          </p>
        )}
      </div>
    </>
  );
}
