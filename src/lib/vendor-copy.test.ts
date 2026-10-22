import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchHeaders } from "./import-assets";
import { SUPPLIER_IMPORT_HEADERS } from "./import-suppliers";
import { matchDestinations, navDestinations } from "./shell";
import { WORKSPACE_NAV } from "./workspaces";

/*
 * Spec §2.2: "Supplier" is "Vendor" everywhere a person reads it — pages, menus, breadcrumbs, filters, exports, toasts,
 * server messages and Cris. Wording only: routes (/purchases/suppliers), identifiers, file names, the database and the
 * audit action codes it stores keep the old word. This greps the copy so "supplier" can't creep back in, and pins the
 * sidebar, the palette synonym and the VAT REG. TIN label (spec §2.3).
 */

const ROOT = process.cwd();
const WORD = /\bsuppliers?\b/i;

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

/** A key the code compares or looks up (`icon: "suppliers"`, `kind: "x"`), not a value a person reads. */
const KEY_PROP = /\b(icon|action|key|kind|type|cause|code|entityType|id|tab|variant|tone|mode|field|scope)\s*:\s*$/;
/** Where a one-word string is shown: a label map's value, a fallback, a ternary branch, a return, a copy attribute. */
const SHOWN_AT = /(\?\?|\?|:|\breturn|=>)\s*$|\b(label|title|placeholder|aria-label|alt|heading|description|sub|hint)=\{?\s*$/;

/** One string literal's text: a bare code token (`"supplier-set"`, `"supplier.created"`) or a lookup key is not copy. */
function literalCopy(text: string, before: string): string {
  if (/^[a-z0-9]+([-.][a-z0-9]+)+$/.test(text)) return "";
  if (/^[a-z]\w*$/.test(text)) return SHOWN_AT.test(before) && !KEY_PROP.test(before) ? text : "";
  return text;
}

/** JSX text alone on its line ("  Add a supplier, then save"), not a line of code. */
function isTextLine(rest: string): boolean {
  if (!/^\s*[A-Za-z][^=;{}<>|&`]*$/.test(rest)) return false;
  if (/^\s*(const|let|var|return|type|interface|case|export|import|await|if|else)\b/.test(rest)) return false;
  if (/\w\(|\?\.|\?\?|\w\.\w|[,(]\s*$|^\s*[\w$.]+[,;]?\s*$|^\s*\w+\s*:/.test(rest)) return false;
  return true;
}

/** A chunk's words: routes, storage paths and template holes (`${supplier.name}`) removed. Compounds stay. */
function wording(chunk: string): string {
  return chunk
    .split(/\s+/)
    .filter((tok) => !/^(\/|\.\/|@\/|https?:)|\$\{|\[|\/.*\/|\/$/.test(tok))
    .join(" ")
    .replace(/\$\{[^}]*\}/g, " ");
}

/**
 * The 1-based lines of `source` that carry a user-visible "supplier": string literals (one-word ones only where they
 * are shown), template text including a multi-line template's continuation lines, and JSX text (between tags, or a
 * line of its own in a .tsx file). Comments, imports, the importers' header aliases and nav synonyms are skipped.
 */
function copyHits(source: string, tsx: boolean): number[] {
  const hits: number[] = [];
  let inTemplate = false;
  source.split(/\r?\n/).forEach((raw, i) => {
    const chunks: string[] = [];
    let line = raw;
    if (inTemplate) {
      const close = line.search(/(?<!\\)`/);
      chunks.push(close < 0 ? line : line.slice(0, close));
      if (close < 0) {
        if (WORD.test(wording(chunks[0]))) hits.push(i + 1);
        return;
      }
      inTemplate = false;
      line = line.slice(close + 1);
    }
    // The importers' header aliases and the palette's synonym keep the old word on purpose (spec §2.2, Task 8).
    if (/\b(labels|also): \[/.test(line)) return;
    const code = stripComment(line);
    if (/^\s*(import|export \* from|\} from)\b/.test(code)) return;
    for (const m of code.matchAll(STRING)) {
      chunks.push(literalCopy(m[1] ?? m[2] ?? m[3] ?? "", code.slice(0, m.index)));
    }
    const rest = code.replace(STRING, '""');
    const open = rest.indexOf("`");
    if (open >= 0) {
      chunks.push(rest.slice(open + 1));
      inTemplate = true;
    }
    if (tsx) {
      const text = rest.replace(/&\w+;/g, "’");
      for (const m of text.matchAll(/>([^<>]*)(?=<|$)/g)) if (!/[{}=;&|]/.test(m[1])) chunks.push(m[1]);
      if (isTextLine(text)) chunks.push(text);
    }
    if (chunks.some((c) => WORD.test(wording(c)))) hits.push(i + 1);
  });
  return hits;
}

describe("the sweep's matcher finds copy, and only copy", () => {
  const COPY: Array<[string, string, boolean]> = [
    ["JSX text with brackets", "      <p>Pick a supplier (optional)</p>", true],
    ["JSX text line with a comma", "          Add a supplier, then save", true],
    ["JSX text line with an apostrophe entity", "          add them on each supplier&apos;s page.", true],
    ["a lowercase one-word copy attribute", '      <Foo label="supplier" />', true],
    ["a one-word placeholder", '      <Input placeholder="supplier" />', true],
    ["a slash compound", '  const t = "Supplier/customer";', true],
    ["a hyphen compound in prose", '  const t = "non-supplier items";', true],
    ["a hyphenated word in prose", '  const t = "the supplier-side total";', true],
    ["a toast", '  run(() => go(), "Supplier restored");', true],
    ["a label-map value", '  vendorId: "supplier",', true],
    ["a fallback", '  sub: v.category ?? "supplier",', true],
    ["a template with a hole", "  title={`A supplier named \"${match.name}\" already exists`}", true],
    ["a lone JSX text line", "          Restore supplier", true],
  ];
  it.each(COPY)("catches %s", (_name, line, tsx) => {
    expect(copyHits(line, tsx)).toEqual([1]);
  });

  it("catches a multi-line template literal's continuation line, in a .ts file", () => {
    const src = ["  return conflict(", "    `This sheet has a bank column. Bank details are entered on the", "    supplier's page, never imported.`,", "  );"].join("\n");
    expect(copyHits(src, false)).toEqual([3]);
  });

  const CODE: Array<[string, string, boolean]> = [
    ["a route", '  <Link href="/purchases/suppliers/new">New vendor</Link>', true],
    ["a route template", "  href={`/purchases/suppliers/${id}/edit`}", true],
    ["a storage prefix", "  stored = await storeUpload(`suppliers/${vendorId}`, file);", false],
    ["an import path", 'import { x } from "@/lib/supplier-schema";', false],
    ["a query key", '  const supplier = params.get("supplier") || null;', true],
    ["a hidden input's name", '  {supplier && <input type="hidden" name="supplier" value={supplier} />}', true],
    ["an icon key", '  icon: "suppliers",', false],
    ["an icon attribute", '  <SectionCard icon="suppliers" title="Vendor">', true],
    ["an audit code", '  action: "supplier.created", diff,', false],
    ["an audit code as a map key", '  "supplier-set": "Vendor set",', false],
    ["a block-cause code", '  block("duplicate-supplier-name", nameRaw);', false],
    ["a datalist id", '  <datalist id="supplier-categories">', true],
    ["a property read", "    po.supplier?.name ?? \"no vendor\",", true],
    ["a destructured prop", "  suppliers,", true],
    ["a call's argument list", "    listPurchases(state, q, page, department, supplier, onlyIds),", true],
    ["a typed field", "  supplier: string | null;", false],
    ["a comment", "  // the supplier's own page", false],
    ["a JSX cell", '  <Td>{row.supplier ?? "—"}</Td>', true],
    ["a union of keys", '  | "requests" | "suppliers" | "stock"', false],
    ["the nav's palette synonym", '          also: ["Suppliers"],', false],
    ["an importer header alias", '  { key: "name", labels: ["name", "supplier", "supplier name"], required: true },', false],
  ];
  it.each(CODE)("leaves %s alone", (_name, line, tsx) => {
    expect(copyHits(line, tsx)).toEqual([]);
  });
});

describe("the vendor wording sweep (spec §2.2)", () => {
  it("leaves no user-visible 'supplier' anywhere under src/", () => {
    const hits: string[] = [];
    for (const dir of ["src/app", "src/components", "src/lib", "src/server"]) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const lines = readFileSync(file, "utf8").split(/\r?\n/);
        for (const n of copyHits(lines.join("\n"), file.endsWith(".tsx"))) {
          hits.push(`${path.relative(ROOT, file)}:${n}: ${lines[n - 1].trim()}`);
        }
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

  it.each([
    ["purchasing", "purchasing_staff"],
    ["finance", "finance_staff"],
  ] as const)("the palette still finds Vendors by 'supplier' (%s)", (workspace, role) => {
    const found = matchDestinations(navDestinations(WORKSPACE_NAV[workspace], role), "supplier");
    expect(found).toContainEqual({ label: "Suppliers", href: "/purchases/suppliers" });
  });

  it("the vendor form and page call the registration number VAT REG. TIN (spec §2.3)", () => {
    for (const file of ["src/components/suppliers/supplier-form.tsx", "src/app/(app)/purchases/suppliers/[id]/page.tsx"]) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      expect(src).toContain('"VAT REG. TIN"');
      expect(src).not.toMatch(/Registration no/i);
    }
  });

  it("the vendor importer still reads an old 'Supplier' name column, and a VAT REG. TIN column", () => {
    const m = matchHeaders(["Supplier", "VAT REG. TIN"], SUPPLIER_IMPORT_HEADERS);
    expect(m.map.get("name")).toBe(0);
    expect(m.map.get("registrationNo")).toBe(1);
    expect(m.unknown).toEqual([]);
  });
});
