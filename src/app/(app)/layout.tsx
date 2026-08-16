import { requireUser } from "@/server/auth/guards";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser(); // layer-2: catches disabled accounts middleware can't see
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-(--radius-btn) focus:bg-accent focus:px-3 focus:py-2 focus:text-[13px] focus:text-accent-fg"
      >
        Skip to content
      </a>
      {/* Sidebar (Task 9) and Topbar (Task 11) mount here */}
      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" tabIndex={-1} className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
