import Link from "next/link";
import { prisma } from "@/server/db/client";
import { signIn } from "@/server/auth";
import { Button } from "@/components/ui/button";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const [ssoFlag, domainFlag] = await Promise.all([
    prisma.featureFlag.findUnique({ where: { key: "m365_sso" } }),
    prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } }),
  ]);
  const domain =
    domainFlag?.enabled && typeof domainFlag.value === "string" ? domainFlag.value : null;
  const showMicrosoft = !!ssoFlag?.enabled && !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;

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
      <p className="mt-4 text-[11px] leading-relaxed text-fg-muted">
        New here? <Link href="/signup" className="text-accent underline hover:text-accent-hover">Create an account</Link>
        {domain ? " — signup is domain-restricted" : ""}, and your role decides where you land.
      </p>
    </div>
  );
}
