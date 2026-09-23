"use client";

import { createContext, useCallback, useContext, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * Phase 30 (spec §6.2, Doherty): every list navigation the inventory page makes in code — a search,
 * a facet Apply, a Purchased pick, a Clear search, and (from the table) a sort — runs inside ONE
 * shared transition, so the list region can say "working" while the server renders the next view
 * instead of sitting still under a stale table. Plain links (the class pills, chips, pagination)
 * are Next's own navigations and do not pass through here.
 */
interface ListNavigation {
  /** true while a navigation started through `navigate` is in flight */
  pending: boolean;
  /** `router.push(href)` inside the shared transition */
  navigate: (href: string) => void;
}

const ListNavigationContext = createContext<ListNavigation | null>(null);

export function ListNavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigate = useCallback(
    (href: string) => startTransition(() => router.push(href)),
    [router],
  );
  const value = useMemo(() => ({ pending, navigate }), [pending, navigate]);
  return <ListNavigationContext.Provider value={value}>{children}</ListNavigationContext.Provider>;
}

/**
 * The list's navigation, for any client component under `ListNavigationProvider`. Outside one it
 * falls back to a plain `router.push` with `pending` always false, so a component that uses it
 * never breaks when rendered on its own.
 */
export function useListNavigation(): ListNavigation {
  const ctx = useContext(ListNavigationContext);
  const router = useRouter();
  const fallback = useMemo<ListNavigation>(() => ({ pending: false, navigate: (href) => router.push(href) }), [router]);
  return ctx ?? fallback;
}

/** The region a list navigation replaces: dimmed and marked busy while one is in flight. */
export function ListPendingRegion({ className, children }: { className?: string; children: React.ReactNode }) {
  const { pending } = useListNavigation();
  return (
    <div
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      className={cn("transition-opacity duration-(--dur-2)", pending && "opacity-60", className)}
    >
      {children}
    </div>
  );
}
