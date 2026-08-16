import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { BootstrapForm } from "./bootstrap-form";

export default async function BootstrapPage() {
  const users = await prisma.user.count();
  if (users > 0) notFound(); // permanently 404s after first run (brief §7 Auth)

  return (
    <div data-theme="dark" className="grid min-h-screen w-full place-items-center bg-canvas p-4 text-fg">
      <div className="w-full max-w-[400px] rounded-[11px] border border-border bg-surface p-6 shadow-dialog">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid size-6 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
            BR
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.09em] text-fg-muted">
            First-run setup
          </span>
        </div>
        <h1 className="text-xl font-semibold tracking-[-0.015em]">Create the admin account</h1>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          This screen appears exactly once. The account it creates is the permanent admin —
          its role can never be changed.
        </p>
        <div className="mt-5">
          <BootstrapForm />
        </div>
      </div>
    </div>
  );
}
