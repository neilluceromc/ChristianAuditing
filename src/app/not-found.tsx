import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-8">
      <EmptyState
        title="This page doesn't exist"
        description="The link may be stale, or the record it pointed at is gone."
        actions={
          <Link
            href="/"
            className="rounded-(--radius-btn) bg-accent px-3.5 py-[9px] text-[13px] font-medium text-accent-fg hover:bg-accent-hover"
          >
            Back to home
          </Link>
        }
      />
    </main>
  );
}
