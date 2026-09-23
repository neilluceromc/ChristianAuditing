"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
const COPIED_FOR_MS = 2000;

/**
 * `navigator.clipboard` exists only in a secure context, and the office
 * deployment is plain HTTP on a LAN address — so a hidden textarea and
 * `execCommand("copy")` stand in there. Resolves false when neither works.
 */
async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the textarea route
  }
  // The Copy button keeps focus once the stand-in textarea is gone.
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    back?.focus();
  }
}

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
  // Phase 30 (spec §4.4): storing and revealing no longer share one pending
  // flag — only the clicked row's Reveal spins, and Store keeps its own.
  const [storing, startStore] = useTransition();
  const [revealing, setRevealing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  async function reveal(secretId: string) {
    setError(null);
    setRevealing(secretId);
    try {
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
    } catch {
      // a thrown server action (network drop, server error) must not become an unhandled rejection
      setError("Could not reveal the secret — try again.");
    } finally {
      // a later click on another row owns the spinner now — leave it be
      setRevealing((current) => (current === secretId ? null : current));
    }
  }

  async function copy(secretId: string, value: string) {
    if (!(await copyText(value))) {
      toast("Could not copy — select the value and copy it instead", "fault");
      return;
    }
    setCopied(secretId);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(null), COPIED_FOR_MS);
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setError(null);
    startStore(async () => {
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
                {r && (
                  <Button size="sm" variant="ghost" onClick={() => void copy(secret.id, r.value)}>
                    {copied === secret.id ? "Copied" : "Copy"}
                  </Button>
                )}
                {canReveal && !r && (
                  <Button size="sm" loading={revealing === secret.id} onClick={() => void reveal(secret.id)}>Reveal</Button>
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
            <Button type="submit" variant="primary" loading={storing}>Store encrypted</Button>
          </div>
        </form>
      )}
    </div>
  );
}
