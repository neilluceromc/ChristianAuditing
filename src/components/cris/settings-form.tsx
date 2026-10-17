"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { cn } from "@/lib/cn";
import { aboutUsd } from "@/lib/cris-cost";
import { resolveColor } from "@/lib/cris-mood";
// After "Put Cris back in the corner" saves, the mascot is told directly: a refresh that hands the widget the same
// props it already had (it was dragged without a refresh) wouldn't move it. The widget listens for this.
import { CRIS_RESET_POSITION_EVENT } from "@/lib/cris-placement";
import { CRIS_PREF_DEFAULTS, type CrisPrefs } from "@/lib/cris-prefs";
import { CRIS_DAILY_MAX, CRIS_DAILY_MIN, CRIS_MODELS, type CrisModelId, type CrisSettings } from "@/lib/cris-settings";
import { saveCrisPrefs, saveCrisSettings } from "@/server/cris/settings";
import { CrisOrb } from "./orb";

/** Spec §5 / mockup board 3: the four colour tiles, in the mockup's order and words. */
const COLOR_TILES: Array<{ value: CrisPrefs["color"]; label: string; note: string }> = [
  { value: "gold", label: "Gold", note: "the film’s Cris" },
  { value: "sky", label: "Sky blue", note: "bright and shining" },
  { value: "silver", label: "Silver", note: "white glass" },
  { value: "auto", label: "Match theme", note: "Sky blue / Silver" },
];

const MOTIONS: Array<{ value: CrisPrefs["motion"]; label: string }> = [
  { value: "lively", label: "Lively" },
  { value: "calm", label: "Calm" },
  { value: "still", label: "Still" },
];

const MODEL_LABELS: Record<CrisModelId, string> = {
  "claude-haiku-5-5": "Claude Haiku 5.5 (Anthropic)",
  "claude-sonnet-5-5": "Claude Sonnet 5.5 (Anthropic)",
  "claude-opus-5-5": "Claude Opus 5.5 (Anthropic)",
};

/** Spec §8, verbatim. */
const KEY_SET_TEXT = "Key: set on the server ✓";
const NO_KEY_TEXT = "Cris is off — no AI key is set on the server";

/** When a save action throws (network, 500) rather than returning a refusal. */
const SAVE_FAILED_TEXT = "Couldn't save — check your connection and try again.";

/** The preview orbs: 130 px from `sm` up, 96 px on phones (CSS size wins over the svg's width/height attributes). */
const PREVIEW_ORB = "[&_svg]:size-24 sm:[&_svg]:size-[130px]";

export interface CrisAdminView {
  settings: CrisSettings;
  /** Only whether a key is set — the key itself never reaches the browser. */
  keySet: boolean;
  usage: { questions: number; costUsd: number };
}

/** A "retry after" kept as a deadline, so a remount of the notice doesn't restart the clock (flag-rows.tsx). */
function useRetryDeadline() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const left = deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  return {
    left,
    start: (sec: number | undefined) => setDeadline(Date.now() + (sec ?? 60) * 1000),
    clear: () => setDeadline(null),
  };
}

export function CrisSettingsForm({
  prefs: initialPrefs,
  admin,
  off,
}: {
  prefs: CrisPrefs;
  /** "Cris for everyone" — null for anyone who isn't an admin, and then not rendered at all. */
  admin: CrisAdminView | null;
  /** Why Cris is off right now, if it is. */
  off: "off" | "no-key" | null;
}) {
  return (
    <div className="grid max-w-[1100px] items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <YourCrisAndPreview initialPrefs={initialPrefs} admin={admin} off={off} />
    </div>
  );
}

/**
 * "Your Cris" and the preview share the person's choices, so they live in one component; the admin card sits
 * between them in the left column. Each choice saves at once (a partial merge on the server) and the preview
 * follows immediately; a refused save puts that field back.
 */
function YourCrisAndPreview({
  initialPrefs,
  admin,
  off,
}: {
  initialPrefs: CrisPrefs;
  admin: CrisAdminView | null;
  off: "off" | "no-key" | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [prefs, setPrefs] = useState(initialPrefs);
  // What the server last confirmed, so a refused save can put back only the field it touched.
  const confirmed = useRef(initialPrefs);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const retry = useRetryDeadline();
  const resetting = useRef(false);
  const [resetBusy, setResetBusy] = useState(false);
  const colourLabelId = useId();
  const motionHintId = useId();
  const showId = useId();

  /**
   * Resolves to what the server kept, or null when the save was refused or never arrived. Never rejects: a
   * thrown action (network, 500) rolls the choice back and says so, instead of leaving it on screen unsaved.
   */
  async function save(patch: Partial<CrisPrefs>): Promise<CrisPrefs | null> {
    setError(null);
    setStatus("");
    setPrefs((p) => ({ ...p, ...patch }));
    const rollBack = () => {
      const back = Object.fromEntries(Object.keys(patch).map((k) => [k, confirmed.current[k as keyof CrisPrefs]]));
      setPrefs((p) => ({ ...p, ...back }));
    };
    try {
      const res = await saveCrisPrefs(patch);
      if (res.ok) {
        confirmed.current = res.data;
        setStatus("Saved");
        // The mascot is drawn by the shared layout from these prefs; refresh so it matches at once.
        startTransition(() => router.refresh());
        return res.data;
      }
      rollBack();
      if (res.kind === "rate_limited") retry.start(res.retryAfterSec);
      else setError(res.message);
      return null;
    } catch {
      rollBack();
      setError(SAVE_FAILED_TEXT);
      return null;
    }
  }

  // Always saves, even when this page thinks Cris is already there: the mascot on this very page may have
  // been dragged since it loaded. A same-value prop refresh doesn't move it, so the widget is told directly.
  async function backToCorner() {
    if (resetting.current) return;
    resetting.current = true;
    setResetBusy(true);
    try {
      const saved = await save({ side: CRIS_PREF_DEFAULTS.side, bottom: CRIS_PREF_DEFAULTS.bottom });
      if (saved) {
        window.dispatchEvent(
          new CustomEvent(CRIS_RESET_POSITION_EVENT, { detail: { side: saved.side, bottom: saved.bottom } }),
        );
        toast("Cris is back in the corner", "settled");
      }
    } finally {
      resetting.current = false;
      setResetBusy(false);
    }
  }

  const lightColor = resolveColor(prefs.color, "light");
  const darkColor = resolveColor(prefs.color, "dark");
  // The tiles keep to a slow float at most, so four orbs side by side don't compete with the preview.
  const tileMotion = prefs.motion === "still" ? "still" : "calm";

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4">
        {off && !admin && (
          <Banner tone="neutral" title={off === "no-key" ? NO_KEY_TEXT : "Cris is off — an admin has turned Cris off for everyone"}>
            Your choices below are kept for when Cris is back.
          </Banner>
        )}

        <Card>
          <CardBody className="flex flex-col gap-4 py-4">
            <div>
              <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-secondary">Your Cris</h2>
              <p className="text-xs text-fg-muted">Only you see these choices.</p>
              <p role="status" className="sr-only">{status}</p>
            </div>

            {retry.left !== null && <RateLimitNotice retryAfterSec={retry.left} onExpire={retry.clear} />}
            {error && <Banner tone="fault" title={error} />}

            <div className="flex flex-col gap-2">
              <span id={colourLabelId} className="text-[13px] font-semibold text-fg">Colour</span>
              <div role="group" aria-labelledby={colourLabelId} className="flex flex-wrap gap-2.5">
                {COLOR_TILES.map((t) => {
                  const on = prefs.color === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => { if (!on) void save({ color: t.value }); }}
                      className={cn(
                        "flex w-[120px] flex-col items-center gap-1 rounded-(--radius-card) border bg-surface px-2 py-3 text-fg",
                        "transition-colors duration-(--dur-1) hover:bg-surface-subtle",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                        on ? "border-accent bg-surface-accent ring-1 ring-accent" : "border-border-strong",
                      )}
                    >
                      <CrisOrb color={resolveColor(t.value, "light")} mood="idle" motion={tileMotion} size={56} decorative />
                      <span className="text-[13px] font-semibold">{t.label}</span>
                      <span className="text-[11.5px] text-fg-muted">{t.note}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-fg-muted">&ldquo;Match theme&rdquo; shows Sky blue in light mode and Silver in dark mode.</p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold text-fg" aria-hidden>Motion</span>
              <SegmentedControl
                aria-label="Motion"
                aria-describedby={motionHintId}
                options={MOTIONS}
                value={prefs.motion}
                onChange={(v) => void save({ motion: v as CrisPrefs["motion"] })}
                className="self-start"
              />
              <p id={motionHintId} className="text-xs text-fg-muted">
                Lively: every mood (talking, searching, sad…). Calm: a slow float only. Still: no motion.
                &ldquo;Reduce motion&rdquo; on your computer always wins.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <Switch id={showId} checked={prefs.show} onCheckedChange={(v) => void save({ show: v })} />
              <label htmlFor={showId} className="text-[13px] text-fg">
                Show Cris in the bottom-right corner of every page
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <p className="text-xs text-fg-muted">
                Cris stays wherever you drag Cris on the page, on every computer you sign in to.
              </p>
              <Button size="sm" variant="secondary" aria-busy={resetBusy || undefined} onClick={() => void backToCorner()}>
                Put Cris back in the corner
              </Button>
            </div>
          </CardBody>
        </Card>

        {admin && <CrisForEveryone admin={admin} />}
      </div>

      <div className="flex min-w-0 flex-col gap-2.5 lg:sticky lg:top-4">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-secondary">Preview</h2>
        <Card>
          {/* Fits a 360 px phone: the orbs drop to 96 px under `sm`, and the panels wrap rather than overflow. */}
          <CardBody className="flex flex-row flex-wrap gap-3 p-3">
            {/* Fixed light and dark surfaces, whatever the app's own theme is right now: the point is to show both. */}
            <div
              className="flex min-w-[116px] flex-1 flex-col items-center gap-1.5 rounded-(--radius-card) px-2.5 py-4"
              style={{ background: "#ffffff", border: "1px solid #e4e7ec", color: "#101828" }}
            >
              <CrisOrb color={lightColor} mood="talk" motion={prefs.motion} size={130} className={PREVIEW_ORB} label="Cris in light mode" />
              <span className="text-xs font-semibold">Light mode</span>
            </div>
            <div
              className="flex min-w-[116px] flex-1 flex-col items-center gap-1.5 rounded-(--radius-card) px-2.5 py-4"
              style={{ background: "#0f1115", border: "1px solid #262b34", color: "#e6e9ef" }}
            >
              <CrisOrb color={darkColor} mood="talk" motion={prefs.motion} size={130} className={PREVIEW_ORB} label="Cris in dark mode" />
              <span className="text-xs font-semibold">Dark mode</span>
            </div>
          </CardBody>
        </Card>
        <p className="text-xs text-fg-muted">
          Pick a colour or a motion on the left: the preview changes at once, then Cris looks like this everywhere you
          use the app.
        </p>
      </div>
    </>
  );
}

/** Spec §9, "Cris for everyone" — admins only. One Save for the switch, the daily limit and the model. */
function CrisForEveryone({ admin }: { admin: CrisAdminView }) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const { settings, keySet, usage } = admin;
  const [on, setOn] = useState(settings.on);
  const [limit, setLimit] = useState(String(settings.dailyLimit));
  const [model, setModel] = useState<CrisModelId>(settings.model);
  const [limitError, setLimitError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const limitRef = useRef<HTMLInputElement>(null);
  const retry = useRetryDeadline();
  const onId = useId();

  // router.refresh() hands in new props without a remount; keyed on the values, so a refresh after a save
  // (or another admin's change) shows what is stored.
  const storedKey = `${settings.on}|${settings.dailyLimit}|${settings.model}`;
  useEffect(() => {
    setOn(settings.on);
    setLimit(String(settings.dailyLimit));
    setModel(settings.model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  /** Puts the error on the limit and the keyboard there with it. */
  function limitRefused(message: string) {
    setLimitError(message);
    limitRef.current?.focus();
  }

  // Awaited directly, not inside an async transition: a throw there would reach the error boundary and
  // blank the page. A thrown action (network, 500) is caught and said, never left silent.
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    setError(null);
    setLimitError(undefined);
    const trimmed = limit.trim();
    const n = Number(trimmed);
    if (!/^\d+$/.test(trimmed) || n < CRIS_DAILY_MIN || n > CRIS_DAILY_MAX) {
      limitRefused(`Enter a whole number from ${CRIS_DAILY_MIN} to ${CRIS_DAILY_MAX}.`);
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      const res = await saveCrisSettings({ on, dailyLimit: n, model });
      if (res.ok) {
        toast(res.data.changed ? "Cris's settings saved" : "Nothing to save — these are already Cris's settings", "settled");
        startTransition(() => router.refresh());
      } else if (res.kind === "rate_limited") {
        retry.start(res.retryAfterSec);
      } else if (res.kind === "validation" && res.fieldErrors?.dailyLimit) {
        limitRefused(res.fieldErrors.dailyLimit);
      } else {
        setError(res.message);
      }
    } catch {
      setError(SAVE_FAILED_TEXT);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  const questions = `${usage.questions} ${usage.questions === 1 ? "question" : "questions"}`;

  return (
    <Card>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <CardBody className="flex flex-col gap-4 py-4">
          <div className="flex items-center gap-2">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-secondary">Cris for everyone</h2>
            <Pill>Admins only</Pill>
          </div>

          {retry.left !== null && <RateLimitNotice retryAfterSec={retry.left} onExpire={retry.clear} />}
          {error && <Banner tone="fault" title={error} />}

          <div className="flex items-center gap-2.5">
            <Switch id={onId} checked={on} onCheckedChange={setOn} />
            <label htmlFor={onId} className="text-[13px] text-fg">Cris is on</label>
          </div>

          <p className="text-xs text-fg-muted">Who can use Cris: IT staff and admins.</p>

          <FormField label="Questions per person per day" error={limitError} className="max-w-[280px]">
            {(p) => (
              <Input
                {...p}
                ref={limitRef}
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            )}
          </FormField>

          <div className="flex flex-col gap-1">
            <FormField label="AI model" className="max-w-[280px]">
              {(p) => (
                <Select {...p} value={model} onChange={(e) => setModel(e.target.value as CrisModelId)}>
                  {CRIS_MODELS.map((m) => (
                    <option key={m} value={m}>{MODEL_LABELS[m]}</option>
                  ))}
                </Select>
              )}
            </FormField>
            <p className="text-[11.5px] text-fg-muted">{keySet ? KEY_SET_TEXT : NO_KEY_TEXT}</p>
          </div>

          <p className="text-xs leading-relaxed text-fg-muted">
            This month: <b className="text-fg">{questions}</b>, about <b className="text-fg">{aboutUsd(usage.costUsd)}</b>,
            counted by the app. The monthly spending cap is set in the AI provider&apos;s own console.
          </p>

          <div>
            {/* The name stays "Save" throughout; aria-busy and the status line carry the in-flight state. */}
            <Button type="submit" variant="primary" size="sm" aria-busy={saving || undefined}>
              Save
            </Button>
            <span role="status" className="sr-only">{saving ? "Saving…" : ""}</span>
          </div>
        </CardBody>
      </form>
    </Card>
  );
}
