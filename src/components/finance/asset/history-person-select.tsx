"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";

/**
 * Phase 47 (spec §4.5): the Financial history's person filter (Everyone, each actor, System). Choosing one goes to
 * its URL — the hrefs are built on the server, so only strings reach here.
 */
export function HistoryPersonSelect({
  value,
  options,
}: {
  value: string;
  options: Array<{ value: string; label: string; href: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Select
      aria-label="Person"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const href = options.find((o) => o.value === e.target.value)?.href;
        if (href) startTransition(() => router.push(href, { scroll: false }));
      }}
      className="w-auto min-w-[160px] py-1.5 text-xs"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}
