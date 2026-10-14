import Link from "next/link";
import { prisma } from "@/server/db/client";
import { signIn } from "@/server/auth";
import { flagDomain } from "@/lib/auth-shared";
import { parseQuickLoginEmails } from "@/lib/quick-login";
import { ROLE_LABELS } from "@/lib/admin-users";
import { quickSignIn } from "@/server/auth/actions";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; quick?: string }>;
}) {
  const { next, quick } = await searchParams;
  const [ssoFlag, domainFlag] = await Promise.all([
    prisma.featureFlag.findUnique({ where: { key: "m365_sso" } }),
    prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } }),
  ]);
  const domain = flagDomain(domainFlag);
  const showMicrosoft = !!ssoFlag?.enabled && !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  // Staging-only one-click sign-in: off (no query, no buttons) unless
  // QUICK_LOGIN_EMAILS lists accounts. Only existing, enabled accounts show.
  const quickEmails = parseQuickLoginEmails(process.env.QUICK_LOGIN_EMAILS);
  const quickAccounts =
    quickEmails.length === 0
      ? []
      : (
          await prisma.user.findMany({
            where: { email: { in: quickEmails }, disabled: false },
            select: { email: true, role: true },
          })
        ).sort((a, b) => quickEmails.indexOf(a.email) - quickEmails.indexOf(b.email));

  return (
    <div className="w-full max-w-[360px] rounded-[11px] border border-border bg-surface p-6 shadow-card">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="grid size-6 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
          BR
        </span>
        <span className="text-[13px] font-semibold text-fg">Backroom IT</span>
      </div>
      <h1 className="text-xl font-semibold tracking-[-0.015em] text-fg">Sign in</h1>
      {domain && (
        <p className="mt-1 text-[11px] text-fg-muted">Access is limited to @{domain} accounts.</p>
      )}
      {showMicrosoft && (
        <>
          <form
            action={async () => {
              "use server";
              await signIn("microsoft-entra-id");
            }}
            className="mt-4"
          >
            <Button type="submit" variant="secondary" className="w-full">
              Continue with Microsoft
            </Button>
          </form>
          <div aria-hidden className="my-4 flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-[10px] uppercase text-fg-muted">or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <div className={showMicrosoft ? "" : "mt-4"}>
        <LoginForm next={next} />
      </div>
      {quickEmails.length > 0 && (
        <section aria-labelledby="quick-sign-in" className="mt-5 border-t border-border pt-4">
          <h2 id="quick-sign-in" className="text-[13px] font-semibold text-fg">
            Quick sign-in (staging)
          </h2>
          <p className="mt-1 text-[11px] text-fg-muted">One click, no password. Turned on for this server only.</p>
          {quick === "refused" && (
            <div className="mt-3">
              <Banner tone="fault" title="That quick sign-in is not available — the account is missing or disabled." />
            </div>
          )}
          <div className="mt-3 flex flex-col gap-2">
            {quickAccounts.map((a) => (
              <form key={a.email} action={quickSignIn}>
                <input type="hidden" name="email" value={a.email} />
                {next && <input type="hidden" name="next" value={next} />}
                <Button type="submit" variant="secondary" className="w-full justify-between">
                  <span>Sign in as {ROLE_LABELS[a.role]}</span>
                  <span className="font-mono text-[11px] text-fg-muted">{a.email}</span>
                </Button>
              </form>
            ))}
          </div>
        </section>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-fg-muted">
        New here? <Link href="/signup" className="text-accent underline hover:text-accent-hover">Create an account</Link>
        {domain ? " — signup is domain-restricted" : ""}, and your role decides where you land.
      </p>
    </div>
  );
}
