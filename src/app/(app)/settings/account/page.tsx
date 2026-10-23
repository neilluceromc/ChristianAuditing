import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireUser } from "@/server/auth/guards";
import { accountFacts } from "@/server/modules/account/queries";
import { PageHeader } from "@/components/ui/page-header";
import { YourAccountCard } from "@/components/account/your-account-card";
import { AccountPasswordCard } from "@/components/account/account-password-card";

export const metadata: Metadata = { title: pageTitle("Account settings") };

/** Users & access (spec §4.5, boards Account2 / PhoneAccount2): every role's own account, and their password. */
export default async function AccountSettingsPage() {
  const user = await requireUser();
  const facts = await accountFacts(user.id);
  return (
    <>
      <PageHeader title="Account settings" breadcrumb={[{ label: "Settings" }, { label: "Account" }]} />
      <div className="flex max-w-[720px] flex-col gap-4">
        <YourAccountCard
          name={user.name}
          email={user.email}
          role={user.role}
          employee={facts.employee}
          createdAt={user.createdAt}
          createdByName={facts.createdByName}
        />
        <AccountPasswordCard passwordChangedAt={user.passwordChangedAt?.toISOString() ?? null} />
      </div>
    </>
  );
}
