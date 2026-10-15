"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { searchPeople } from "@/server/modules/employees/people-search";
import { PEOPLE_DEBOUNCE_MS, PEOPLE_NONE } from "@/lib/people-search";

const IDLE = "Type a name or employee no.";
const FAILED = "Search is unavailable — try again in a moment.";

/**
 * Phase 36 (spec §4.2): a holder picker that asks the server as you type instead of carrying every
 * active employee. Before typing it lists the user's recent picks; after, the server's top matches.
 * The chosen person's name always shows (`valueLabel` for a preset holder, the picked row after).
 */
export function PeopleCombobox({
  id, "aria-describedby": describedBy, invalid, value, valueLabel, recent, onChange, placeholder, autoFocus,
}: {
  id?: string;
  "aria-describedby"?: string;
  invalid?: boolean;
  value: string | null;
  valueLabel?: string | null;
  recent: ComboOption[];
  onChange: (id: string | null, option?: ComboOption) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ComboOption[] | null>(null); // null = nothing searched for the current text yet
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<ComboOption | null>(null);
  const counter = useRef(0); // out-of-order answers are dropped

  useEffect(() => {
    const q = query.trim();
    const mine = ++counter.current;
    if (!q) { setResults(null); setFailed(false); return; }
    setResults(null);
    const timer = setTimeout(async () => {
      let next: ComboOption[] = [];
      let bad = false;
      try {
        const res = await searchPeople({ q, scope: "active" });
        if (res.ok) next = res.data; else bad = true;
      } catch { bad = true; }
      if (mine !== counter.current) return;
      setFailed(bad);
      setResults(next);
    }, PEOPLE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const options = query.trim() ? (results ?? []) : recent;
  const valueOption = useMemo<ComboOption | null>(() => {
    if (value === null) return null;
    if (picked?.value === value) return picked;
    const known = recent.find((o) => o.value === value);
    if (known) return known;
    return valueLabel ? { value, label: valueLabel } : null;
  }, [value, valueLabel, picked, recent]);
  const emptyText = !query.trim() ? IDLE : results === null ? "Searching…" : failed ? FAILED : PEOPLE_NONE;

  return (
    <EntityCombobox
      id={id} aria-describedby={describedBy} invalid={invalid} placeholder={placeholder} autoFocus={autoFocus}
      options={options} recent={recent.map((o) => o.value)} value={value} valueOption={valueOption}
      serverFiltered emptyText={emptyText} onQuery={setQuery}
      onChange={(v, o) => { setPicked(o ?? null); onChange(v, o); }}
    />
  );
}
