import { qrBase } from "@/lib/label-qr";
import {
  CALIBRATION_MM, LABEL_CELL_MM, LABEL_COLUMNS, LABELS_PER_PAGE,
  PAGE_MARGIN_MM, PAGE_MM, labelSlots,
} from "@/lib/label-geometry";
import { LabelCell, QR_NOTE } from "./label-cell";

// Re-exported so the labels page's `QR_NOTE` import keeps working after the
// move into `label-cell.tsx`.
export { QR_NOTE };

export interface LabelRow {
  tag: string;
  model: string;
  category: string;
}

/**
 * A Server Component: there is nothing interactive on a sheet of stickers.
 * Each filled slot is a `LabelCell` (`label-cell.tsx`), the same component the
 * Register form's live preview renders.
 *
 * `startAt` (spec §5.1, plan P-11): the first startAt−1 slots of page 1 print
 * blank so a half-used sheet can go back in the printer.
 *
 * `startHref` (Phase 34, plan P-7): when given, the sheet doubles as the
 * on-screen "where do I start" picker. Page 1 is padded with trailing free
 * cells up to a full page, and every blank and free cell gets a link that
 * fills it. The links, their words and the free cells are all `print:hidden`,
 * so the PRINTED sheet is identical to one rendered without `startHref`: the
 * free cells are trailing, so hiding them moves nothing that prints.
 */
export function LabelSheet({
  rows, baseUrl, startAt, startHref,
}: { rows: LabelRow[]; baseUrl?: string; startAt?: number; startHref?: (slot: number) => string }) {
  const byTag = new Map(rows.map((r) => [r.tag, r]));
  // Validated ONCE: the reason a base URL is unusable never depends on the tag,
  // so this is one note per sheet rather than the same refusal on twelve labels.
  const base = qrBase(baseUrl);
  const slots = labelSlots(rows.map((r) => r.tag), startAt ?? 1);
  // An empty picker sheet still shows one page (blanks before the start, then
  // free numbered slots) so the start can be chosen before anything is ticked.
  const pages: (string | null)[][] =
    slots.length === 0 && startHref
      ? [Array<null>(Math.min(Math.max(1, Math.floor(startAt ?? 1)), LABELS_PER_PAGE) - 1).fill(null)]
      : slots;
  return (
    <div className="label-sheets">
      {pages.map((page, p) => (
        <div
          key={p}
          className="label-page"
          style={{
            width: `${PAGE_MM.width}mm`,
            height: `${PAGE_MM.height}mm`,
            padding: `${PAGE_MARGIN_MM}mm`,
            display: "grid",
            gridTemplateColumns: `repeat(${LABEL_COLUMNS}, ${LABEL_CELL_MM.width}mm)`,
            gridAutoRows: `${LABEL_CELL_MM.height}mm`,
            background: "#fff",
            color: "#101828",
            boxSizing: "border-box",
            position: "relative",
          }}
        >
          {page.map((tag, i) => {
            // A skipped slot is an empty cell of the same size, so every label
            // after it still lands on its die-cut.
            if (tag === null) {
              return (
                <div
                  key={`blank-${i}`}
                  data-blank-label=""
                  style={{ boxSizing: "border-box", outline: "0.2mm dashed #C4CAD4", position: "relative" }}
                >
                  {startHref && (
                    <a className="label-slot-link print:hidden" href={startHref(i + 1)} aria-label={`Start at sticker ${i + 1} (used)`}>
                      used
                    </a>
                  )}
                </div>
              );
            }
            const row = byTag.get(tag)!;
            return <LabelCell key={tag} tag={tag} model={row.model} category={row.category} base={base} />;
          })}
          {/* Screen-only free slots after the last label on page 1, so every
              slot of the sheet can be picked as the start. Hidden in print
              along with their links: trailing cells, so the printed page is
              unchanged. */}
          {startHref && p === 0 &&
            Array.from({ length: LABELS_PER_PAGE - page.length }, (_, k) => page.length + k).map((i) => (
              <div
                key={`free-${i}`}
                data-free-slot=""
                className="print:hidden"
                style={{ boxSizing: "border-box", outline: "0.2mm dashed #C4CAD4", position: "relative" }}
              >
                <a className="label-slot-link print:hidden" href={startHref(i + 1)} aria-label={`Start at sticker ${i + 1}`}>
                  {i + 1}
                </a>
              </div>
            ))}
          {/* The only thing that can catch a browser printing at 96%.
              ABSOLUTELY POSITIONED, inside the page's own bottom margin --
              NOT a grid row: 4 rows x 69.25mm + 20mm padding is exactly
              297mm, so a fifth row would push this onto a second sheet and
              a ruler on a different sheet proves nothing about this one.
              BUDGET: this box's total height must never exceed
              PAGE_MARGIN_MM (10mm) minus its own `bottom` offset (2.5mm) =
              7.5mm — that is the exact clearance between this box's bottom
              edge and the first row of label cells above it. maxHeight +
              overflow: hidden enforce that budget no matter how many lines
              the caption wraps to under a different fallback font; a wider
              font that used to wrap the caption to 2 lines could wrap it to
              3 under body's line-height and land inside the grid instead of
              being absorbed by leading. A caption edit must stay inside the
              budget or accept truncation — never remove the cap. */}
          <div
            style={{
              position: "absolute",
              left: `${PAGE_MARGIN_MM}mm`,
              bottom: "2.5mm",
              maxHeight: "7.5mm",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              gap: "2mm",
              fontSize: "2.4mm",
              lineHeight: 1.3,
              color: "#667085",
            }}
          >
            {/* flexShrink: 0 is load-bearing: without it, the flex container
                shrinks this bar to make room for the text sibling and the
                bar quietly measures short of CALIBRATION_MM. A ruler that
                lies about its own length is worse than no ruler — it tells
                an operator to "fix" a scaling problem that doesn't exist. */}
            <span style={{ display: "block", width: `${CALIBRATION_MM}mm`, height: "1.5mm", flexShrink: 0, background: "#101828" }} />
            {/* "Printed at 100%" scopes the claim to the printed sheet: a
                CSS millimetre is not a physical millimetre on screen, where
                display DPI and browser zoom both move it — the on-screen
                banner already says "on the sheet" for the same reason. The
                remedy also names paper size, not just scale: a short bar
                can equally mean Letter was selected for an A4 sheet, whose
                fix is choosing A4, not Scale 100%. */}
            <span style={{ minWidth: 0 }}>
              Printed at 100%, this bar is exactly {CALIBRATION_MM}mm &mdash; measure it. If it is
              short, check Scale 100%, Margins None and A4 paper in the print dialog.
            </span>
            {!base.ok && (
              /* Rule 10: every refusal the rule can return gets a surface. A
                 sheet that silently omits QR codes looks finished and is not
                 — an operator would stick 200 labels before noticing. */
              <span style={{ minWidth: 0, color: "#B42318" }}>
                {QR_NOTE[base.reason]}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
