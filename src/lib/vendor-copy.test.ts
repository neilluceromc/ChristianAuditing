import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_NAV } from "./workspaces";

/*
 * Spec §2.2: "Supplier" is "Vendor" everywhere a person reads it — pages, menus, breadcrumbs, filters, exports, toasts,
 * server messages and Cris. Wording only: routes (/purchases/suppliers), identifiers, file names, the database and the
 * audit action codes it stores keep the old word. This greps the copy so "supplier" can't creep back in, and pins the
 * sidebar and the VAT REG. TIN label (spec §2.3).
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

/** The line without its comment: a `//` that isn't inside a string or a URL, or a block-comment line. */
function stripComment(line: string): string {
  const t = line.trim();
  if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("//") || t.startsWith("{/*")) return "";
  return line.replace(/(^|[^:"'`])\/\/.*$/, "$1").replace(/\/\*.*?\*\//g, "");
}

const STRING = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

/**
 * What a person could read on this line: string literals, template text and JSX text. A bare one-word string is a
 * key, not copy (`params.get("supplier")`, `icon="suppliers"`), unless it is a value a label map or a fallback shows
 * (`vendorId: "supplier"`, `?? "supplier"`).
 */
function readableChunks(line: string, tsx: boolean): string[] {
  const code = stripComment(line);
  if (/^\s*(import|export \* from|\} from)\b/.test(code)) return [];
  const chunks: string[] = [];
  for (const m of code.matchAll(STRING)) {
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    const before = code.slice(0, m.index);
    const shown = /(\?\?|\b(?!icon\b|action\b|key\b|kind\b|type\b)\w+:)\s*$/.test(before);
    chunks.push(/^[a-z]\w*$/.test(text) && !shown ? "" : text);
  }
  if (tsx) {
    const rest = code.replace(STRING, '""').replace(/&\w+;/g, "’");
    // JSX text between tags (`>Supplier<`), and a line that is nothing but JSX text ("  Restore supplier").
    for (const m of rest.matchAll(/>([^<>]*)(?=<|$)/g)) if (!/[(){}=;&|]/.test(m[1])) chunks.push(m[1]);
    const textLine = /^\s*[A-Za-z][^=;(){}<>"'`,]*$/.test(rest) && !/\?\.|\?\?|\w\.\w/.test(rest);
    if (textLine && !/^\s*(const|let|return|type|interface|case)\b/.test(rest)) chunks.push(rest);
  }
  return chunks;
}

/** A chunk with the identifiers taken out: paths (`/purchases/suppliers/new`), hyphenated and dotted codes. */
function wording(chunk: string): string {
  return chunk.replace(/\S*\/\S*/g, " ").replace(/\S*[\w$]-\S*|\S*-[\w$]\S*/g, " ").replace(/\S*\w\.\w\S*/g, " ");
}

/** The importers' header aliases: an old sheet's "Supplier" column still maps, on purpose (spec §2.2, Task 8). */
const ALIAS_LINE = /\blabels: \[/;

describe("the vendor wording sweep (spec §2.2)", () => {
  it("leaves no user-visible 'supplier' anywhere under src/", () => {
    const hits: string[] = [];
    for (const dir of ["src/app", "src/components", "src/lib", "src/server"]) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const tsx = file.endsWith(".tsx");
        readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
          if (ALIAS_LINE.test(line)) return;
          if (readableChunks(line, tsx).some((c) => /\bsuppliers?\b/i.test(wording(c)))) {
            hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(hits).toEqual([]);
  });

  it("the sidebar says Vendors, All vendors, New vendor and Import vendors", () => {
    const labels = Object.values(WORKSPACE_NAV)
      .flat()
      .flatMap((s) => s.items)
      .flatMap((i) => [i.label, ...(i.views ?? []).map((v) => v.label)]);
    for (const want of ["Vendors", "All vendors", "New vendor", "Import vendors"]) expect(labels).toContain(want);
    expect(labels.filter((l) => /supplier/i.test(l))).toEqual([]);
  });

  it("the vendor form and page call the registration number VAT REG. TIN (spec §2.3)", () => {
    for (const file of ["src/components/suppliers/supplier-form.tsx", "src/app/(app)/purchases/suppliers/[id]/page.tsx"]) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      expect(src).toContain('"VAT REG. TIN"');
      expect(src).not.toMatch(/Registration no/i);
    }
  });

  it("the vendor importer still reads the old headers, and reads a VAT REG. TIN column", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/import-suppliers.ts"), "utf8");
    const name = src.split(/\r?\n/).find((l) => l.includes('key: "name"')) ?? "";
    const reg = src.split(/\r?\n/).find((l) => l.includes('key: "registrationNo"')) ?? "";
    expect(name).toMatch(/"supplier"/);
    expect(reg).toMatch(/"registration no"/);
    expect(reg).toMatch(/"vat reg tin"/);
  });
});
