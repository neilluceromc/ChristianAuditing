"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { reportHref } from "@/lib/stock-reports";
import { withSearch, type ListState } from "@/lib/url-state";

/**
 * Phase 39 (spec §4.2, §4.3): the On hand and Expiry search box. Enter applies it and lands on page 1, keeping the
 * Category filter and the report's own params (`extraParams`: the expiry tab and window). Like the stocktake sheet's
 * toolbar it is never keyed by the URL, so focus stays in the box after the page updates; the box is controlled and
 * only takes the URL's `q` when that changes underneath it (a link, Back).
 */
export function ReportSearch({
  basePath,
  state,
  extraParams,
  label,
  placeholder,
}: {
  basePath: string;
  state: ListState;
  extraParams?: Record<string, string>;
  label: string;
  placeholder: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(state.q);
  const [urlQ, setUrlQ] = useState(state.q);
  if (state.q !== urlQ) {
    setUrlQ(state.q);
    setQ(state.q);
  }
  return (
    <div className="relative w-[260px]">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
        <Icon name="search" size={14} />
      </span>
      <Input
        type="search"
        data-page-search
        aria-label={label}
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="pl-8"
        onKeyDown={(e) => {
          if (e.key === "Enter") router.push(reportHref(basePath, withSearch(state, q), extraParams));
        }}
      />
    </div>
  );
}
