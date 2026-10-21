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

  it("Purchasing's sidebar says Purchase orders and New purchase order", () => {
    const items = WORKSPACE_NAV.purchasing.flatMap((s) => s.items);
    const labels = items.flatMap((i) => [i.label, ...(i.views ?? []).map((v) => v.label)]);
    expect(labels).toContain("Purchase orders");
    expect(labels).toContain("New purchase order");
    expect(labels).not.toContain("Register purchase");
    expect(labels).not.toContain("Requests");
  });
});
