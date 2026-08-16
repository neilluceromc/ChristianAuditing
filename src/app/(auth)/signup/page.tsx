import Link from "next/link";
import { prisma } from "@/server/db/client";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const domainFlag = await prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } });
  const domain =
    domainFlag?.enabled && typeof domainFlag.value === "string" ? domainFlag.value : null;
  return (
    <div className="w-full max-w-[360px] rounded-[11px] border border-border bg-surface p-6 shadow-card">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="grid size-6 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
          BR
        </span>
        <span className="text-[13px] font-semibold text-fg">Backroom IT</span>
      </div>
      <h1 className="text-xl font-semibold tracking-[-0.015em] text-fg">Create account</h1>
      <p className="mt-1 text-[11px] text-fg-muted">
        {domain ? `Limited to @${domain} addresses. ` : ""}New accounts start read-only; an
        admin assigns your role.
      </p>
      <div className="mt-4">
        <SignupForm />
      </div>
      <p className="mt-4 text-[11px] text-fg-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:text-accent-hover">Sign in</Link>
      </p>
    </div>
  );
}
