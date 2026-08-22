import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IMPORT_MAX_UPLOAD_BYTES } from "./import-vocabulary";

/**
 * `next.config.ts`'s `serverActions.bodySizeLimit` and this module's
 * `IMPORT_MAX_UPLOAD_BYTES` are two statements of one ceiling, and the config
 * cannot import a TS constant — so a comment on each side asking the next
 * reader to keep them in sync was the whole mechanism. That is §6a rules
 * 26/37/38's shape exactly, and this phase has now closed it twice the same
 * way (`IMPORT_OPTIONS` out of a test file, `KNOWN_UNIMPORTED_COLUMNS` derived
 * from the export spec). Where the value genuinely cannot be shared, a test
 * that reads the other side and fails on drift is the mechanism.
 *
 * Reading the config as TEXT rather than importing it is deliberate: importing
 * it would evaluate a Next config in a vitest node environment, and the thing
 * under test is the literal a human edits.
 */
describe("the upload ceiling and next.config.ts", () => {
  const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");

  function configuredBytes(): number {
    const match = config.match(/bodySizeLimit:\s*"(\d+)(kb|mb)"/i);
    if (!match) throw new Error("bodySizeLimit literal not found in next.config.ts — did its shape change?");
    const [, amount, unit] = match;
    // Next parses this with the `bytes` package, where kb/mb are binary
    // multiples (1mb === 1 << 20), not decimal ones.
    return Number(amount) * (unit.toLowerCase() === "mb" ? 1024 * 1024 : 1024);
  }

  it("keeps the client refusal strictly below the framework's own limit", () => {
    expect(IMPORT_MAX_UPLOAD_BYTES).toBeLessThan(configuredBytes());
  });

  // Below, but not so far below that the named refusal starts rejecting files
  // the server would happily have taken.
  it("stays within a reasonable margin of it, so the ceiling is still honest", () => {
    expect(IMPORT_MAX_UPLOAD_BYTES).toBeGreaterThan(configuredBytes() * 0.9);
  });
});
