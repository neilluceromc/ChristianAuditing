import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ACTION_LABELS, actionLabel } from "./activity";
import { AUDIT_ACTIONS } from "./audit-actions";
import { APPROVAL_TYPE_LABEL } from "./labels";
import { PURCHASE_ACTION_ROLES } from "./purchase-flow";

/**
 * Final review M5: /audit renders actionLabel(row.action) as words, so every action code the server or the worker
 * writes needs an ACTION_LABELS entry — otherwise the cell shows a raw slug such as `stock.item.created`
 * (spec §6: internal codes never appear in user-facing copy). This greps the written literals the way
 * revalidate-paths.test.ts greps its calls, so a new code without a label fails here.
 */
const SRC = path.resolve(__dirname, "..");
// The worklist's row objects also have an `action` key — a button word ("Open", "Triage"), not an audit code.
const NOT_AUDIT = new Set([path.join("server", "modules", "home", "queries.ts")]);

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const PLAIN = /\b(?:action|auditAction):\s*["']([^"'`]+)["']/g;
const TERNARY = /\baction:\s*[^,\n?]+\?\s*["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;

const written = new Map<string, string>();
for (const file of [...sources(path.join(SRC, "server")), ...sources(path.join(SRC, "worker"))]) {
  const rel = path.relative(SRC, file);
  if (NOT_AUDIT.has(rel)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(PLAIN)) written.set(m[1], rel);
  for (const m of text.matchAll(TERNARY)) { written.set(m[1], rel); written.set(m[2], rel); }
}

describe("audit action codes (final review M5)", () => {
  it("finds the written codes it guards", () => {
    expect(written.size).toBeGreaterThanOrEqual(80);
  });
  it.each([...written])("%s (written in %s) is in AUDIT_ACTIONS", (code) => {
    expect(AUDIT_ACTIONS as readonly string[]).toContain(code);
  });
  it("covers the codes written from a variable: purchase transitions and the worker's executions", () => {
    for (const code of Object.keys(PURCHASE_ACTION_ROLES)) expect(AUDIT_ACTIONS as readonly string[]).toContain(code);
    for (const t of Object.values(APPROVAL_TYPE_LABEL)) expect(AUDIT_ACTIONS as readonly string[]).toContain(`${t} executed`);
  });
  it.each([...AUDIT_ACTIONS])("%s has a label in ACTION_LABELS", (code) => {
    expect(Object.hasOwn(ACTION_LABELS, code), `no ACTION_LABELS entry for ${code}`).toBe(true);
    expect(actionLabel(code)).not.toBe(code);
  });
  it("labels are short words, not codes", () => {
    for (const code of AUDIT_ACTIONS) {
      const label = ACTION_LABELS[code];
      expect(label).toMatch(/^[A-Z]/);
      expect(label).not.toMatch(/[._]|lifecycle/);
    }
  });
});
