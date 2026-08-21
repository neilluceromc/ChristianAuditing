import { capRefusalText, idsRefusalText } from "@/lib/export-columns";

/** text/plain, because these are read by a human in a browser tab, not parsed. */
function refusal(text: string): Response {
  return new Response(text, {
    status: 413,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const capRefusal = (count: number) => refusal(capRefusalText(count));
export const idsRefusal = (count: number) => refusal(idsRefusalText(count));

/**
 * The one place download headers are written. `filename` is quoted in the
 * `content-disposition` header — see `exportFilename` for the guarantee that
 * makes that safe.
 */
export function xlsxResponse(filename: string, body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * `assets-2026-08-21.xlsx` — sortable, and unambiguous in a downloads folder.
 *
 * `prefix` is not always a literal: the farewell-report route builds it from
 * `Employee.employeeNo`, which `prisma/schema.prisma` declares `String
 * @unique` with no format constraint and no zod schema anywhere narrows it.
 * A `"` in that field would otherwise break out of `xlsxResponse`'s quoted
 * `content-disposition` attribute. So the guarantee lives HERE, where it can
 * be checked, rather than in a comment asking every caller to remember it:
 * anything outside `[A-Za-z0-9_-]` is stripped before the date is appended.
 * That set is plenty for every prefix this app actually produces — `assets`,
 * `audit`, `employees`, `farewell-EMP-0042` — and CRLF was already unreachable
 * here regardless (`Headers` throws on `\r`/`\n` in a value), so this closes
 * the one gap that was real: attribute breakout via a quote.
 */
export function exportFilename(prefix: string, now: Date): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, "");
  return `${safePrefix}-${now.toISOString().slice(0, 10)}.xlsx`;
}
