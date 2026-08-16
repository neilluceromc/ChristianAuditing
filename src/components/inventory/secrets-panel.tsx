"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { addSecret, revealSecret } from "@/server/modules/inventory/secret-actions";

export interface SecretRowDto {
  id: string;
  label: string;
  createdAt: string;
}

const HIDE_AFTER_S = 30;

interface Revealed {
  value: string;
  revealedAtLabel: string;
  expiresAt: number;
}

export function SecretsPanel({
  assetId,
  secrets,
  canReveal,
}: {
  assetId: string;
  secrets: SecretRowDto[];
  canReveal: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState<Record<string, Revealed>>({});
  const [now, setNow] = useState(() => Date.now());
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  // One ticking clock drives every countdown; entries drop at 0 (30 s auto-hide).
  useEffect(() => {
    if (Object.keys(revealed).length === 0) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setRevealed((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, r]) => r.expiresAt > t));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [revealed]);

  function reveal(secretId: string) {
    setError(null);
    startTransition(async () => {
      const res = await revealSecret({ assetId, secretId });
      if (res.ok) {
        setRevealed((prev) => ({
          ...prev,
          [secretId]: {
            value: res.data.value,
            revealedAtLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
            expiresAt: Date.now() + HIDE_AFTER_S * 1000,
          },
        }));
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setError(null);
    startTransition(async () => {
      const res = await addSecret({ assetId, label, value });
      if (res.ok) {
        toast("Secret stored encrypted — audit entry written", "settled");
        setLabel("");
        setValue("");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
      else setError(res.message);
    });
  }

  return (
    <div className="flex max-w-[640px] flex-col gap-4">
      <Banner tone="attention" title="Reads are audited">
        Revealing a value writes a <span className="font-mono">SECRET_READ</span> entry with your name
        on it, and the value hides itself after {HIDE_AFTER_S} s.
      </Banner>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      {secrets.length === 0 ? (
        <p className="py-4 text-center text-xs text-fg-muted">No credentials stored for this asset.</p>
      ) : (
        <ul className="flex flex-col rounded-(--radius-card) border border-border bg-surface shadow-card">
          {secrets.map((secret) => {
            const r = revealed[secret.id];
            const left = r ? Math.max(0, Math.ceil((r.expiresAt - now) / 1000)) : 0;
            return (
              <li key={secret.id} className="flex items-center gap-3 border-b border-border-faint px-3 py-2.5 last:border-b-0">
                <span className="w-[140px] shrink-0 font-mono text-xs text-fg">{secret.label}</span>
                {r ? (
                  <span className="min-w-0 flex-1 font-mono text-xs text-fg-secondary">
                    {r.value}
                    <span className="ml-2 text-[10px] text-fg-faint">
                      revealed {r.revealedAtLabel} · hides in {left}s
                    </span>
                  </span>
                ) : (
                  <span aria-label="hidden" className="flex-1 font-mono text-xs tracking-widest text-fg-faint">
                    ••••••••••••
                  </span>
                )}
                {canReveal && !r && (
                  <Button size="sm" loading={pending} onClick={() => reveal(secret.id)}>Reveal</Button>
                )}
                <span className="shrink-0 font-mono text-[10.5px] text-fg-faint">{secret.createdAt}</span>
              </li>
            );
          })}
        </ul>
      )}

      {canReveal && (
        <form onSubmit={add} className="flex flex-col gap-3 rounded-(--radius-card) border border-border bg-surface p-4 shadow-card">
          <p className="text-[13px] font-semibold text-fg">Add a credential</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Label" required error={fieldErrors.label} hint="e.g. BIOS password, local admin">
              {(p) => (
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={label} onChange={(e) => setLabel(e.target.value)} />
              )}
            </FormField>
            <FormField label="Value" required error={fieldErrors.value} hint="Stored AES-256-GCM encrypted.">
              {(p) => (
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  type="password" autoComplete="off"
                  value={value} onChange={(e) => setValue(e.target.value)} />
              )}
            </FormField>
          </div>
          <div>
            <Button type="submit" variant="primary" loading={pending}>Store encrypted</Button>
          </div>
        </form>
      )}
    </div>
  );
}
