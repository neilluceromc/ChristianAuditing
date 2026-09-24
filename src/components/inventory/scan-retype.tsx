"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Spec §6: an unknown tag is often a misread one. Re-type it here, or search
 * the register for what was scanned.
 */
export function ScanRetype({ tag }: { tag: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = value.trim().toUpperCase();
    if (!next) return;
    router.push(`/inventory/scan/${encodeURIComponent(next)}`);
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <form onSubmit={submit} className="flex items-end gap-2">
        <FormField label="Tag" className="flex-1">
          {(p) => (
            <Input
              {...p}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              className="font-mono"
            />
          )}
        </FormField>
        <Button type="submit" variant="primary" className="min-h-11">Look up</Button>
      </form>
      <Link href={`/inventory?q=${encodeURIComponent(tag)}`} className="text-[13px] text-accent underline hover:text-accent-hover">
        Search inventory for &quot;{tag}&quot;
      </Link>
    </div>
  );
}
