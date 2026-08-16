import Link from "next/link";
import { cookies } from "next/headers";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/server/auth/guards";
import { resolveWorkspace, WORKSPACE_NAV } from "@/lib/workspaces";

export default async function Home() {
  const user = await requireUser();
  const jar = await cookies();
  const ws = resolveWorkspace(user.role, jar.get("br.dept")?.value);
  const links = WORKSPACE_NAV[ws]
    .flatMap((s) => s.items)
    .filter((i) => i.href !== "/" && (!i.roles || i.roles.includes(user.role)))
    .slice(0, 8);
  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} />
      <Card className="max-w-xl">
        <CardHeader title="Jump to" />
        <CardBody className="grid grid-cols-2 gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-(--radius-ctl) px-2.5 py-1.5 text-[12.5px] text-fg-secondary hover:bg-surface-subtle hover:text-fg"
            >
              {l.label}
            </Link>
          ))}
        </CardBody>
      </Card>
      <p className="mt-4 text-[11px] text-fg-muted">
        The full dashboard (your shift, fleet, warranty runway) arrives in Phase 6.
      </p>
    </>
  );
}
