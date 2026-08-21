import Link from "next/link";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status";
import { ROLE_LABELS } from "@/lib/admin-users";
import type { AdminHome as AdminHomeData } from "@/server/modules/admin/queries";

export function AdminHomeBody({ data }: { data: AdminHomeData }) {
  const { users, flags, webhooks } = data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Stat label="Accounts" value={users.total} />
        <Stat
          label="Disabled"
          value={users.disabled}
          hint={users.disabled === 0 ? "everyone can sign in" : "blocked from signing in"}
        />
        <Stat label="Endpoints" value={webhooks.endpoints} />
        <Stat
          label="Dead deliveries"
          value={webhooks.dead}
          hint={webhooks.dead === 0 ? "nothing to replay" : "waiting on a replay"}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          Who can get in
        </span>
        <ul className="flex flex-col">
          {users.byRole.map((r) => (
            <li
              key={r.role}
              className="flex items-center justify-between border-b border-border-faint py-1.5 last:border-b-0"
            >
              <span className="text-[12.5px] text-fg">{ROLE_LABELS[r.role]}</span>
              <span className="font-mono text-[11px] text-fg-muted">{r.count}</span>
            </li>
          ))}
        </ul>
        <Link href="/admin/users" className="text-[12px] font-medium text-accent hover:underline">
          Manage users &amp; roles →
        </Link>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          What is switched on
        </span>
        <ul className="flex flex-col">
          {flags.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between border-b border-border-faint py-1.5 last:border-b-0"
            >
              <span className="flex items-center gap-2">
                <StatusDot value={f.enabled ? "EXECUTED" : "SPARE"} />
                <span className="text-[12.5px] text-fg">{f.label}</span>
              </span>
              <span className="font-mono text-[10.5px] text-fg-muted">
                {f.unavailable ? "unavailable" : f.enabled ? "on" : "off"}
              </span>
            </li>
          ))}
        </ul>
        <Link href="/admin/flags" className="text-[12px] font-medium text-accent hover:underline">
          Feature flags →
        </Link>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          Integrations
        </span>
        <p className="text-[12.5px] text-fg-secondary">
          {webhooks.endpoints === 0
            ? "No endpoints configured — nothing outside this system is being told when approvals execute."
            : `${webhooks.delivered} delivered, ${webhooks.dead} dead${
                webhooks.inactive > 0
                  ? `, ${webhooks.inactive} endpoint${webhooks.inactive === 1 ? "" : "s"} disabled`
                  : ""
              }.`}
        </p>
        <Link href="/admin/webhooks" className="text-[12px] font-medium text-accent hover:underline">
          Webhooks →
        </Link>
      </div>
    </div>
  );
}
