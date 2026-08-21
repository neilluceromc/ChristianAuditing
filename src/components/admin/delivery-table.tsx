"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { replayAllDead, replayDelivery } from "@/server/modules/admin/webhook-actions";
import type { DeliveryRow } from "@/server/modules/admin/queries";
import type { ActionResult } from "@/server/action-result";

/**
 * The same ActionResult ladder as every other admin screen, with the two
 * details `endpoint-editor.tsx` had to get right.
 *
 * `acting` is a per-CONTROL key rather than one shared boolean: this table
 * renders a Replay on every replayable row plus the batch control, and a
 * single `pending` would spin all of them while one was in flight — and,
 * worse, would leave every other row clickable, so a second click could queue
 * a different delivery while the first was still resolving.
 *
 * The rate limit is stored as a DEADLINE, not a duration. `RateLimitNotice`
 * keys its countdown on the `retryAfterSec` prop, so a second refusal that
 * happened to compute the same number of seconds would not restart the clock;
 * a deadline changes on every refusal.
 */
function useRunner() {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  function run<T>(actingKey: string, fn: () => Promise<ActionResult<T>>, onOk: (data: T) => void) {
    setError(null);
    setActing(actingKey);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          onOk(res.data);
          // Unconditional, even where the server wrote nothing: the only way
          // to reach a no-op from here is props that are already stale, in
          // which case the refresh IS the remedy (§6a rule 12).
          router.refresh();
        } else if (res.kind === "rate_limited") {
          setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
        } else {
          // forbidden or conflict — "already queued for another attempt", the
          // disabled-endpoint refusal, and the status guard's "someone else
          // just changed that delivery" all land here. Neither action can
          // return `validation` for input this component builds itself (a row
          // id it was handed), so there is no field-error branch to route.
          setError(res.message);
        }
      } finally {
        setActing(null);
      }
    });
  }

  return { acting, error, setError, retryAfterSec, clearRetry: () => setRetryDeadline(null), toast, run };
}

export function DeliveryTable({
  rows,
  total,
  deadReplayable,
  empty,
}: {
  rows: DeliveryRow[];
  total: number;
  deadReplayable: number;
  /**
   * Rendered in place of the table when this tab has no rows. It comes in
   * from the page rather than the empty branch living there, because the batch
   * control below is deliberately NOT tab-filtered: an operator sitting on an
   * empty Delivered tab must still be offered the dead-lettered replay, and a
   * page that returned early would take the offer away.
   */
  empty: React.ReactNode;
}) {
  const { acting, error, setError, retryAfterSec, clearRetry, toast, run } = useRunner();
  const busy = acting !== null;

  return (
    <div className="flex flex-col gap-3">
      {retryAfterSec !== null && (
        <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={clearRetry} />
      )}
      {error && <Banner tone="fault" title={error} />}

      {deadReplayable > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-(--radius-card) border border-border bg-surface-subtle px-3 py-2">
          <span className="text-[12px] text-fg-secondary">
            {deadReplayable} dead-lettered{" "}
            {deadReplayable === 1 ? "delivery is" : "deliveries are"} waiting on a live endpoint.
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            loading={acting === "all"}
            onClick={() =>
              run("all", replayAllDead, ({ queued, attempted, blocked }) => {
                if (queued === attempted) {
                  toast(`Queued ${queued} for another attempt`, "settled");
                  return;
                }
                // The count that actually went, never the count on the button.
                // A batch can fall short — a delivery queued between this
                // render and the click, or the actor's rate budget running out
                // part-way — and "Replaying 4" over a queue of two is exactly
                // the kind of claim a page gets believed on. The reason goes
                // in the banner rather than the toast, because a toast that
                // says "2 of 4" and then vanishes sends the operator back to
                // guess why.
                toast(`Queued ${queued} of ${attempted}`, "fault");
                setError(
                  blocked
                    ? `Queued ${queued} of ${attempted}. The rest stopped here: ${blocked}`
                    : `Queued ${queued} of ${attempted}.`,
                );
              })
            }
          >
            Replay {deadReplayable} dead-lettered
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        empty
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th width={150}>When</Th>
              <Th>Endpoint</Th>
              <Th width={210}>Event</Th>
              <Th width={140}>Status</Th>
              <Th width={90} aria-label="Row actions" />
            </Tr>
          </THead>
          <TBody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td mono>{row.when}</Td>
                <Td>
                  <span className="block truncate font-mono text-[11px] text-fg">
                    {row.endpointUrl}
                  </span>
                  {row.lastError && (
                    // The reason it died is the most useful thing on the row
                    // while it waits — visible, rather than behind a disclosure.
                    // It survives a replay too: `replayDelivery` deliberately
                    // keeps `lastError` until the next attempt overwrites it.
                    <span className="block truncate text-[10.5px] text-fg-muted" title={row.lastError}>
                      {row.lastError}
                    </span>
                  )}
                </Td>
                <Td mono>{row.event}</Td>
                <Td>
                  {/* `value` is the raw status and `label` is the stage: passing
                      the label where the value belongs greys every chip in the
                      table with no error anywhere. `ns="delivery"`, or PENDING
                      resolves to the approval family and a healthy queued
                      delivery goes amber — the same colour as a failing one. */}
                  <StatusPill value={row.status} label={row.stageLabel} ns="delivery" />
                </Td>
                <Td>
                  {/* `replayable` already excludes all three of
                      `replayDelivery`'s refusals — landed, disabled endpoint,
                      already queued — so no Replay rendered here has a
                      guaranteed-failing click (§6a rule 10). */}
                  {row.replayable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      loading={acting === row.id}
                      onClick={() =>
                        run(
                          row.id,
                          () => replayDelivery({ id: row.id }),
                          () => toast("Queued for another attempt", "settled"),
                        )
                      }
                    >
                      Replay
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {total > rows.length && (
        <p className="text-[11px] text-fg-muted">
          Showing {rows.length} of {total}. Older attempts aren&apos;t paged through yet.
        </p>
      )}
    </div>
  );
}
