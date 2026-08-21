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
 * The one place download headers are written. `filename` is quoted and the
 * name is built by the caller from a fixed prefix plus a date — never from
 * user input, which is what keeps this free of a header-injection question.
 */
export function xlsxResponse(filename: string, body: Buffer): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

/** `assets-2026-08-21.xlsx` — sortable, and unambiguous in a downloads folder. */
export function exportFilename(prefix: string, now: Date): string {
  return `${prefix}-${now.toISOString().slice(0, 10)}.xlsx`;
}
