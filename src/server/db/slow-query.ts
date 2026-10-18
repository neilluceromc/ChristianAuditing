import type { PrismaClient } from "@prisma/client";

/**
 * Phase 43 (spec §4): the switchable slow-query log. Set SLOW_QUERY_MS to a positive number of milliseconds and
 * every Prisma operation slower than that is logged as `[slow-query] <Model>.<operation> <ms>ms` via console.warn.
 * Unset (or zero, negative, garbage) means off: the client is returned untouched, so nothing is timed at all.
 *
 * Only the model, the operation and the duration are ever logged — never the arguments, which carry emails,
 * password hashes, secrets and free text.
 */

/** The threshold in ms, or null when the log is off. */
export function parseSlowQueryMs(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/** A raw query ($queryRaw, $executeRaw…) has no model, so it is named by its operation alone. */
export function formatSlowQuery(model: string | undefined, operation: string, ms: number): string {
  return `[slow-query] ${model ? `${model}.${operation}` : operation} ${Math.round(ms)}ms`;
}

/** What `$allOperations` receives, narrowed to what the handler reads. */
export interface OperationCall<A, R> {
  model?: string;
  operation: string;
  args: A;
  query: (args: A) => Promise<R>;
}

export interface SlowQueryDeps {
  now: () => number;
  warn: (line: string) => void;
}

const defaultDeps: SlowQueryDeps = {
  now: () => performance.now(),
  warn: (line) => console.warn(line),
};

/**
 * The `$allOperations` body: times the query and warns when it ran longer than the threshold. A query that throws
 * is timed too (a slow timeout is exactly what this log is for) and its error is rethrown unchanged.
 */
export function slowQueryHandler(thresholdMs: number, deps: SlowQueryDeps = defaultDeps) {
  return async function logSlow<A, R>({ model, operation, args, query }: OperationCall<A, R>): Promise<R> {
    const start = deps.now();
    try {
      return await query(args);
    } finally {
      const ms = deps.now() - start;
      if (ms > thresholdMs) deps.warn(formatSlowQuery(model, operation, ms));
    }
  };
}

/**
 * The client with the slow-query log applied when `raw` (SLOW_QUERY_MS) asks for it, else the client itself.
 *
 * Typing: a query-only extension adds no models, methods or result fields, so the extended client has exactly the
 * base client's API. It is cast back to `PrismaClient` on purpose — `$extends`' own return type is a different
 * (structurally richer) type that is not assignable to `PrismaClient`, which would break every consumer that takes
 * `PrismaClient` as a parameter (paged.ts) and every `$transaction(async (tx) => …)` callback that passes `tx` on as
 * `Prisma.TransactionClient`. Query extensions also run inside interactive transactions, so `tx` is logged too.
 */
export function withSlowQueryLog(client: PrismaClient, raw: string | undefined = process.env.SLOW_QUERY_MS): PrismaClient {
  const thresholdMs = parseSlowQueryMs(raw);
  if (thresholdMs === null) return client;
  const logSlow = slowQueryHandler(thresholdMs);
  return client.$extends({
    name: "slow-query-log",
    query: { $allOperations: (call) => logSlow(call) },
  }) as unknown as PrismaClient;
}
