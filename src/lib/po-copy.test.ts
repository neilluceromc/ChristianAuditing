import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_NAV } from "./workspaces";

/*
 * Purchase orders replace purchase requests (spec §3): the words changed everywhere a person reads them. This greps
 * the UI source so a stray "Purchase request" can't creep back in, and pins the Purchasing sidebar's labels.
 */

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

describe("the purchase-order wording sweep", () => {
  it("leaves no 'purchase request' in src/app or src/components", () => {
    const hits: string[] = [];
    for (const dir of ["src/app", "src/components"]) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
          if (/purchase request/i.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(hits).toEqual([]);
  });

  it("Purchasing's Home labels name purchase orders, not requests (spec §3: everywhere)", () => {
    const hits: string[] = [];
    for (const file of ["src/lib/overview.ts", "src/server/modules/home/overview.ts"]) {
      readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/).forEach((line, i) => {
        // a label the Home shows (title / unit / sub / hint), not a code comment or an icon key
        if (/(title|unit|sub|hint|label): /.test(line) && /\brequests?\b/i.test(line.replace(/icon: "requests"/g, ""))) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the login scene draws the same PO number its caption names", () => {
    const world = readFileSync(path.join(ROOT, "src/components/login/world.ts"), "utf8");
    expect(world).not.toMatch(/PR-\d{4}/);
  });

  it("Purchasing's sidebar says Purchase orders and New purchase order", () => {
    const items = WORKSPACE_NAV.purchasing.flatMap((s) => s.items);
    const labels = items.flatMap((i) => [i.label, ...(i.views ?? []).map((v) => v.label)]);
    expect(labels).toContain("Purchase orders");
    expect(labels).toContain("New purchase order");
    expect(labels).not.toContain("Register purchase");
    expect(labels).not.toContain("Requests");
  });
});
