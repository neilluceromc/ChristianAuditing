"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import {
  EVENT_LABELS,
  ROTATION_WARNING,
  SIGNATURE_HEADER,
  WEBHOOK_EVENTS,
  deleteBlockedReason,
  parseEvents,
  type WebhookEvent,
} from "@/lib/webhooks";
import {
  createEndpoint, deleteEndpoint, rotateSecret, setEndpointActive, updateEndpoint,
} from "@/server/modules/admin/webhook-actions";
import type { EndpointRow } from "@/server/modules/admin/queries";
import type { ActionResult } from "@/server/action-result";

/**
 * Scope decision #5: this is the only moment the plaintext secret exists outside
 * the worker. It is deliberately loud and deliberately NOT dismissible by a
 * refresh — the operator has to acknowledge it, because there is no second copy.
 */
function SecretOnce({ secret, onDone }: { secret: string; onDone: () => void }) {
  return (
    <Banner tone="attention" title="Copy this signing secret now — it is not shown again">
      <span className="flex flex-col gap-2">
        <code className="select-all break-all rounded-(--radius-ctl) border border-border bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg">
          {secret}
        </code>
        <span className="text-[11px] text-fg-muted">
          Paste it into the receiving system as the shared secret for the{" "}
          {/* SIGNATURE_HEADER, not a literal: `signPayload` builds the value and
              the worker sends it, so a rename that left this string behind would
              be wrong in the one place a human ever reads it. */}
          <code className="font-mono">{SIGNATURE_HEADER}</code> header. If you lose it, rotate — the
          value can&apos;t be read back out of the database.
        </span>
        <span>
          <Button size="sm" variant="secondary" onClick={onDone}>
            I&apos;ve copied it
          </Button>
        </span>
      </span>
    </Banner>
  );
}

/**
 * Shared plumbing: the same ActionResult ladder as every other admin screen.
 *
 * `acting` is a per-CONTROL key rather than one boolean, copied from
 * `flag-rows.tsx`/`user-table.tsx`: a single shared `pending` would spin every
 * button on a card while one of them is in flight, and — worse — a card here
 * has five controls, of which Rotate hands back a value that is only ever
 * shown once. Every control gates on `acting !== null`, so a double-click on
 * Rotate cannot race a second rotation whose response would silently win in
 * the database while the banner shows the other one (§6a rule 29).
 *
 * The rate limit is stored as a DEADLINE, not a duration: `RateLimitNotice`
 * restarts its own countdown on every mount, and this component mounts it in
 * two places (inline, and inside the Rotate dialog). A captured
 * `retryAfterSec` would restart the clock each time the operator crossed that
 * boundary — Task 3's bug, fixed once in `flag-rows.tsx` and copied here
 * rather than re-solved.
 */
function useRunner(claimedFieldKeys: string[]) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  function run<T>(
    actingKey: string,
    fn: () => Promise<ActionResult<T>>,
    okMsg: string,
    onOk?: (data: T) => void,
  ) {
    setError(null);
    setFieldErrors({});
    setActing(actingKey);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          toast(okMsg, "settled");
          onOk?.(res.data);
          // Unconditional, even where the server wrote nothing: the actions
          // return early on a no-op, and the only way to reach that branch
          // from here is props that are already stale — in which case the
          // refresh IS the remedy (§6a rule 12).
          router.refresh();
        } else if (res.kind === "rate_limited") {
          setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
        } else if (res.kind === "validation") {
          const errs = res.fieldErrors ?? {};
          setFieldErrors(errs);
          // A key no FormError claims must not dead-end silently (the Phase 7
          // lesson): fall it back into the banner. Reachable today only via
          // `zodFieldErrors`' indexed keys (`events.0`), which the checkboxes
          // can't produce — but a refusal that routes nowhere is a silent
          // failure waiting for the day it isn't.
          const unclaimed = Object.keys(errs).find((k) => !claimedFieldKeys.includes(k));
          if (unclaimed) setError(errs[unclaimed]);
        } else {
          // forbidden or conflict — including `deleteEndpoint`'s
          // history refusal and every `updatedAt` guard's "someone else just
          // changed that endpoint".
          setError(res.message);
        }
      } finally {
        setActing(null);
      }
    });
  }

  return {
    acting,
    error,
    setError,
    fieldErrors,
    retryAfterSec,
    clearRetry: () => setRetryDeadline(null),
    run,
  };
}

function EventChecks({
  selected,
  disabled,
  onToggle,
  namePrefix,
}: {
  selected: WebhookEvent[];
  disabled: boolean;
  onToggle: (event: WebhookEvent, on: boolean) => void;
  namePrefix: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {WEBHOOK_EVENTS.map((event) => (
        <label key={event} className="flex items-center gap-2 text-[11.5px] text-fg-secondary">
          <Checkbox
            checked={selected.includes(event)}
            disabled={disabled}
            aria-label={`${namePrefix}: ${EVENT_LABELS[event]}`}
            onChange={(e) => onToggle(event, e.target.checked)}
          />
          <span>{EVENT_LABELS[event]}</span>
          <span className="font-mono text-[10px] text-fg-faint">{event}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * Toggling rebuilds the selection through `parseEvents`, which returns
 * `WEBHOOK_EVENTS` order — so this state is canonically ordered by
 * construction rather than in click order. That is what makes the `dirty`
 * comparison below sound: an untick-then-retick has to compare EQUAL to the
 * row's (also canonical) `events`, or the card offers a Save whose server-side
 * no-op check returns early, and the toast claims success with no audit entry
 * behind it (§6a rule 6's phantom-entry shape).
 */
function toggleCanonical(prev: WebhookEvent[], event: WebhookEvent, on: boolean): WebhookEvent[] {
  return parseEvents(on ? [...prev, event] : prev.filter((e) => e !== event));
}

export function EndpointCard({ endpoint }: { endpoint: EndpointRow }) {
  const { acting, error, setError, fieldErrors, retryAfterSec, clearRetry, run } = useRunner([
    "url",
    "events",
  ]);
  const [url, setUrl] = useState(endpoint.url);
  const [events, setEvents] = useState<WebhookEvent[]>(endpoint.events);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const busy = acting !== null;
  // `urlSchema` trims, so comparing the RAW box against the stored value would
  // keep offering a Save for a whitespace-only edit that writes nothing — the
  // normalizing-no-op shape of §6a rule 23. Compared trimmed, and the box is
  // reset to the trimmed value on success, so neither surface can keep a
  // version the database doesn't have.
  const trimmedUrl = url.trim();
  const dirty = trimmedUrl !== endpoint.url || events.join(",") !== endpoint.events.join(",");

  // Stated before the click rather than discovered by it: `deleteEndpoint`
  // refuses an endpoint with delivery history, and this is the same sentence
  // it would return (§6a rule 10 — consume every refusal the rule can make).
  // The action keeps its own check for the race where a delivery lands between
  // this render and the click.
  const deleteBlocked = deleteBlockedReason(endpoint.attempts);
  const unknown = endpoint.unknownEvents;
  // Removing every unrecognised name from a row whose recognised set is empty
  // would leave an endpoint with no events at all, which `eventsSchema`
  // refuses — so the affordance is replaced by the sentence that says what to
  // do first, rather than rendering a click guaranteed to fail.
  const canRemoveUnknown = endpoint.events.length > 0;
  const them = unknown.length === 1 ? "it" : "them";

  return (
    <Card>
      {/* `min-w-0` + `break-all` on the title, `shrink-0` on the actions: a URL
          is one unbreakable token, and CardHeader is a flex row whose h3 will
          not shrink below its content without both. Left alone, a long endpoint
          URL pushed the whole card past the viewport at 375px — /admin/flags
          does not, so that was this page's bug and not the app's accepted
          behaviour. */}
      <CardHeader
        title={<span className="block min-w-0 break-all font-mono text-[12.5px]">{endpoint.url}</span>}
        actions={
          <span className="flex shrink-0 items-center gap-2">
            {!endpoint.active && <Pill>DISABLED</Pill>}
            {endpoint.dead > 0 && (
              <Link
                href="/admin/webhooks/deliveries?state=DEAD"
                className="font-mono text-[10.5px] text-accent hover:underline"
              >
                {endpoint.dead} dead
              </Link>
            )}
            <span className="font-mono text-[10.5px] text-fg-muted">
              {endpoint.attempts} {endpoint.attempts === 1 ? "attempt" : "attempts"}
            </span>
            <Menu
              trigger={(props) => (
                <button
                  type="button"
                  {...props}
                  aria-label={`Actions for ${endpoint.url}`}
                  className="rounded-(--radius-ctl) px-2 py-0.5 text-fg-muted hover:bg-surface-subtle"
                >
                  ⋯
                </button>
              )}
              items={[
                {
                  label: endpoint.active ? "Disable endpoint" : "Enable endpoint",
                  disabled: busy,
                  onSelect: () =>
                    run(
                      "active",
                      () => setEndpointActive({ id: endpoint.id, active: !endpoint.active }),
                      endpoint.active ? "Endpoint disabled" : "Endpoint enabled",
                    ),
                },
                {
                  label: "Rotate signing secret",
                  disabled: busy,
                  // Never fired straight from the menu: rotating is a hard
                  // cutover for the receiver, so ROTATION_WARNING is stated
                  // first and the dialog's own button is the only way through.
                  onSelect: () => {
                    setError(null);
                    clearRetry();
                    setConfirmRotate(true);
                  },
                },
                {
                  label: "Delete endpoint",
                  danger: true,
                  disabled: busy || deleteBlocked !== null,
                  onSelect: () =>
                    run("delete", () => deleteEndpoint({ id: endpoint.id }), "Endpoint deleted"),
                },
              ]}
            />
          </span>
        }
      />
      <CardBody className="flex flex-col gap-3">
        {/* Both suppressed while the Rotate dialog is open — the dialog carries
            its own copies, so leaving these mounted underneath would show the
            same refusal twice (the flag-rows precedent). */}
        {retryAfterSec !== null && !confirmRotate && (
          <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} />
        )}
        {error && !confirmRotate && <Banner tone="fault" title={error} />}
        {freshSecret && <SecretOnce secret={freshSecret} onDone={() => setFreshSecret(null)} />}

        {unknown.length > 0 && (
          <Banner
            tone="attention"
            title={
              unknown.length === 1
                ? "This endpoint subscribes to an event this build no longer sends"
                : "This endpoint subscribes to events this build no longer sends"
            }
          >
            <span className="flex flex-col gap-2">
              <span className="flex flex-wrap gap-1.5">
                {unknown.map((event) => (
                  <code
                    key={event}
                    className="rounded-(--radius-ctl) border border-border bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-fg"
                  >
                    {event}
                  </code>
                ))}
              </span>
              {/* The correction that matters: saving PRESERVES these. An earlier
                  draft of this banner said a save would remove them, which was
                  true of Task 6's `parseEvents` and is false of Task 7's
                  shipped `updateEndpoint` — built from the old sentence, the
                  page would tell the admin the opposite of what Save does.
                  The "button below" clause is gated on the button actually
                  being there: in the no-known-events branch the removal is
                  replaced by the sentence that says what to do first, and a
                  promise of a button that isn't rendered is §6a rule 16 in
                  miniature. */}
              <span className="text-[11px] text-fg-muted">
                Nothing is emitted for {them} — a rename or a removed integration left {them} behind.
                Saving this endpoint keeps {them} exactly as {unknown.length === 1 ? "it is" : "they are"}
                {canRemoveUnknown ? `, and the only thing that drops ${them} is the button below.` : "."}
              </span>
              {canRemoveUnknown ? (
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={acting === "remove-unknown"}
                    disabled={busy && acting !== "remove-unknown"}
                    onClick={() =>
                      run(
                        "remove-unknown",
                        () =>
                          // The endpoint's OWN stored url and events, not this
                          // card's drafts: this button removes the
                          // unrecognised names and nothing else, so an
                          // in-progress URL edit is not smuggled into the save.
                          // `removeUnknown` names them exactly — the action
                          // never infers a removal from absence.
                          updateEndpoint({
                            id: endpoint.id,
                            url: endpoint.url,
                            events: endpoint.events,
                            removeUnknown: unknown,
                          }),
                        unknown.length === 1
                          ? "Unrecognised subscription removed"
                          : "Unrecognised subscriptions removed",
                      )
                    }
                  >
                    {unknown.length === 1 ? "Remove it" : `Remove all ${unknown.length}`}
                  </Button>
                </span>
              ) : (
                <span className="text-[11px] text-fg-muted">
                  Tick at least one recognised event and save before removing {them} — this endpoint
                  has no recognised events left, and one with no events at all would never fire, so
                  the removal would be refused.
                </span>
              )}
            </span>
          </Banner>
        )}

        <div className="flex flex-col gap-1">
          <Input
            aria-label={`URL for ${endpoint.url}`}
            value={url}
            disabled={busy}
            invalid={!!fieldErrors.url}
            className="w-full max-w-[420px] py-1.5 font-mono text-xs"
            onChange={(e) => setUrl(e.target.value)}
          />
          <FormError>{fieldErrors.url}</FormError>
        </div>

        <div className="flex flex-col gap-1">
          <EventChecks
            selected={events}
            disabled={busy}
            namePrefix={endpoint.url}
            onToggle={(event, on) => setEvents((prev) => toggleCanonical(prev, event, on))}
          />
          {/* The "pick at least one event" refusal lands where the operator is
              looking. `useRunner` claims `events` above, so it does not also
              appear in the banner. */}
          <FormError>{fieldErrors.events}</FormError>
        </div>

        {deleteBlocked && (
          <p className="border-l-2 border-border-strong pl-2.5 text-[11px] leading-snug text-fg-muted">
            {deleteBlocked}
          </p>
        )}

        {dirty && (
          <span>
            <Button
              size="sm"
              variant="primary"
              loading={acting === "save"}
              disabled={busy && acting !== "save"}
              onClick={() =>
                run(
                  "save",
                  () => updateEndpoint({ id: endpoint.id, url: trimmedUrl, events }),
                  "Endpoint saved",
                  // Reset to what was actually sent, so a trailing space the
                  // server trimmed away can't survive in the box (rule 23).
                  () => setUrl(trimmedUrl),
                )
              }
            >
              Save changes
            </Button>
          </span>
        )}
      </CardBody>

      {/* Rotation is a hard cutover and the sentence for it already exists in
          `src/lib/webhooks.ts` — rendered, never retyped (§6a rules 5 and 11).
          `deliverWebhook` decrypts at attempt time, so rotating re-signs
          in-flight deliveries with the new key; a receiver still holding the
          old one answers 401, which Task 10 classifies as permanent. */}
      <Dialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        title="Rotate this endpoint's signing secret?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRotate(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={acting === "rotate"}
              onClick={() =>
                run(
                  "rotate",
                  () => rotateSecret({ id: endpoint.id }),
                  "Secret rotated — copy the new one",
                  (data) => {
                    setFreshSecret(data.secret);
                    setConfirmRotate(false);
                  },
                )
              }
            >
              Rotate secret
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {retryAfterSec !== null && (
            <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} />
          )}
          {error && <Banner tone="fault" title={error} />}
          <p>{ROTATION_WARNING}</p>
          <p className="text-fg-muted">
            The new secret is shown once, on this card, and can never be read back out of the
            database.
          </p>
        </div>
      </Dialog>
    </Card>
  );
}

export function NewEndpointCard() {
  const { acting, error, fieldErrors, retryAfterSec, clearRetry, run } = useRunner(["url", "events"]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);

  const busy = acting !== null;

  return (
    <Card>
      <CardHeader title="New endpoint" />
      <CardBody className="flex flex-col gap-3">
        {retryAfterSec !== null && (
          <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} />
        )}
        {error && <Banner tone="fault" title={error} />}
        {freshSecret && <SecretOnce secret={freshSecret} onDone={() => setFreshSecret(null)} />}

        <div className="flex flex-col gap-1">
          <Input
            aria-label="New endpoint URL"
            placeholder="https://example.com/hooks/backroom"
            value={url}
            disabled={busy}
            invalid={!!fieldErrors.url}
            className="w-full max-w-[420px] py-1.5 font-mono text-xs"
            onChange={(e) => setUrl(e.target.value)}
          />
          <FormError>{fieldErrors.url}</FormError>
        </div>

        <div className="flex flex-col gap-1">
          <EventChecks
            selected={events}
            disabled={busy}
            namePrefix="New endpoint"
            onToggle={(event, on) => setEvents((prev) => toggleCanonical(prev, event, on))}
          />
          <FormError>{fieldErrors.events}</FormError>
        </div>

        <span>
          <Button
            size="sm"
            variant="primary"
            loading={acting === "create"}
            onClick={() =>
              run(
                "create",
                () => createEndpoint({ url: url.trim(), events }),
                "Endpoint created — copy its secret",
                (data) => {
                  setFreshSecret(data.secret);
                  setUrl("");
                  setEvents([]);
                },
              )
            }
          >
            Create endpoint
          </Button>
        </span>
      </CardBody>
    </Card>
  );
}
