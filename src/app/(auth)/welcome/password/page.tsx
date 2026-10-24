import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requirePasswordOwedUser } from "@/server/auth/guards";
import { signOutAction } from "@/server/auth/actions";
import { FirstPasswordForm } from "@/components/account/first-password-form";

export const metadata: Metadata = { title: pageTitle("Choose your own password") };

/**
 * Users & access (spec §4.3, board PhoneFirst2): after signing in with a temporary password, the person chooses
 * their own before anything else opens. A centred card; full-screen on phones. Only someone who owes a new password
 * gets here (requirePasswordOwedUser sends anyone else Home); Sign out is always offered.
 */
export default async function ChooseYourOwnPasswordPage() {
  const user = await requirePasswordOwedUser();
  return (
    <main className="flex min-h-screen items-stretch justify-center sm:items-center sm:p-6">
      <div className="flex w-full flex-col gap-5 bg-surface px-5 py-8 sm:max-w-[420px] sm:rounded-(--radius-card) sm:border sm:border-border sm:px-7 sm:shadow-card">
        <span aria-hidden className="text-[13px] font-bold leading-none tracking-[0.02em] text-fg">
          CRIS
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold leading-tight tracking-[-0.015em] text-fg">Choose your own password</h1>
          <p className="text-[13px] text-fg-muted">
            Signed in as <span className="font-medium break-all text-fg-secondary">{user.email}</span>
          </p>
          <p className="text-[13px] text-fg-muted">You signed in with a temporary password. Choose one only you know.</p>
        </div>
        <FirstPasswordForm />
        <form action={signOutAction} className="text-center">
          <button type="submit" className="text-xs font-medium text-fg-secondary underline-offset-2 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
