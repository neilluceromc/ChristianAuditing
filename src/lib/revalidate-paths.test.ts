import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase 31 guard. A typed `revalidatePath(pattern, "page" | "layout")` is matched by Next.js
 * against the route's FILE path — route groups included (`/(app)/inventory/[id]/(record)/page`).
 * A pattern written as the URL (`/inventory/[id]`) matches nothing and is silently inert; five
 * such calls shipped before this test. Every typed pattern must name a real folder under
 * `src/app`, and a "page" pattern a folder that holds a page.tsx.
 */
const SRC = path.resolve(__dirname, "..");
const APP = path.join(SRC, "app");
// Any quote style for the pattern ("…", '…' or a static `…`); a template with ${} is not a pattern.
const CALL = /revalidatePath\(\s*(["'`])([^"'`$]+)\1\s*,\s*["'`](page|layout)["'`]\s*\)/g;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const calls = sources(SRC).flatMap((file) =>
  [...fs.readFileSync(file, "utf8").matchAll(CALL)].map((m) => ({ file: path.relative(SRC, file), pattern: m[2], type: m[3] })),
);

describe("typed revalidatePath patterns (Phase 31)", () => {
  it("finds the typed calls it guards", () => {
    expect(calls.length).toBeGreaterThanOrEqual(5);
  });
  it.each(calls)("$file: $pattern ($type) names a real route folder", ({ pattern, type }) => {
    const dir = path.join(APP, ...pattern.split("/").filter(Boolean));
    expect(fs.existsSync(dir) && fs.statSync(dir).isDirectory(), `no folder src/app${pattern}`).toBe(true);
    if (type === "page") expect(fs.existsSync(path.join(dir, "page.tsx")), `no page.tsx in src/app${pattern}`).toBe(true);
  });
});
