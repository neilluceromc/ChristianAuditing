import type { Role } from "@prisma/client";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { ROLE_LABELS, roleWorkspaces } from "@/lib/admin-users";
import { fmtDayMonthYear } from "@/lib/format";

export const ACCOUNT_HELP_COPY = "Something here wrong? Ask an admin to change it.";

/** What the role opens, from ROLE_WORKSPACES: "Opens Finance", "Opens IT · read-only", "Opens all four workspaces". */
export function roleOpens(role: Role): string {
  const ws = roleWorkspaces(role);
  return ws === "all four" ? "Opens all four workspaces" : `Opens ${ws}`;
}

/**
 * Account settings' "Your account" card (spec §4.5, boards Account2 / PhoneAccount2). Read-only: people don't edit
 * their own name, email or role (spec §5); the help line says who can.
 */
export function YourAccountCard({
  name,
  email,
  role,
  employee,
  createdAt,
  createdByName,
}: {
  name: string;
  email: string;
  role: Role;
  employee: { name: string; employeeNo: string } | null;
  createdAt: Date | string;
  /** the admin who created the account; null for a sign-up or a seeded account */
  createdByName: string | null;
}) {
  const created = `Account created ${fmtDayMonthYear(createdAt)}${createdByName ? ` by ${createdByName}` : ""}`;
  return (
    <Card>
      <CardHeader title="Your account" />
      <CardBody className="flex flex-col gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={name} size="xl" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-fg">{name}</p>
            <p className="truncate text-[13px] text-fg-muted">{email}</p>
          </div>
        </div>
        <DescriptionList
          items={[
            {
              label: "Role",
              value: (
                <span className="flex flex-col">
                  <span className="text-fg">{ROLE_LABELS[role]}</span>
                  <span className="text-xs text-fg-muted">{roleOpens(role)}</span>
                </span>
              ),
            },
            {
              label: "Employee record",
              value: employee ? `${employee.name} · ${employee.employeeNo}` : "Not linked",
            },
            { label: "Created", value: created },
          ]}
        />
        <p className="border-t border-border-faint pt-3 text-xs text-fg-muted">{ACCOUNT_HELP_COPY}</p>
      </CardBody>
    </Card>
  );
}
