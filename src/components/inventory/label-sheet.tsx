import { code128Modules } from "@/lib/code128";
import { qrBase, qrUrlFor, type QrBase } from "@/lib/label-qr";
import { qrMatrix } from "@/lib/qr";
import {
  CALIBRATION_MM, LABEL_CELL_MM, LABEL_COLUMNS, LABEL_PADDING_MM, LABEL_USABLE_MM,
  PAGE_MARGIN_MM, PAGE_MM, QR_QUIET_MODULES, barcodeFit, labelPages, qrFit,
} from "@/lib/label-geometry";

export interface LabelRow {
  tag: string;
  model: string;
}

/**
 * A Server Component: there is nothing interactive on a sheet of stickers.
 * Light-theme-only and absolute mm throughout, matching the two print surfaces
 * that already exist (the farewell report and the accountability form) —
 * these are printed artifacts, not screens.
 */
function Barcode({ tag }: { tag: string }) {
  const fit = barcodeFit(tag);
  if (!fit.encodable) {
    // An unscannable code is worse than none: the sticker would look finished.
    // Cause-NEUTRAL wording: `encodable: false` covers a too-fine module (a
    // very long tag), a character Code 128-B cannot encode, AND an empty
    // tag, so "too long" would be false for two of the three causes. Every
    // write path validates the `BR-XX-9999` tag shape
    // (`src/server/modules/inventory/actions.ts` and `TAG_SHAPE` in
    // `src/lib/import-assets.ts`), so a tag that fails here cannot be
    // created through this application today — but no DB CHECK constraint
    // enforces that, so it is an application invariant, not a guarantee.
    // That is why this renderer degrades one label instead of throwing, and
    // why there is no charset-refusal banner elsewhere on this page: the
    // absence of one is deliberate, not an oversight. The tag text above
    // still prints — a human can read and type what no scanner can.
    return (
      <span style={{ fontSize: "2.4mm", color: "#B42318", fontFamily: "monospace" }}>
        no scannable code
      </span>
    );
  }
  const widths = code128Modules(tag);
  let x = 0;
  const bars: React.ReactElement[] = [];
  widths.forEach((w, i) => {
    const width = w * fit.moduleMm;
    if (i % 2 === 0) {
      bars.push(<rect key={i} x={x} y={0} width={width} height={9} fill="#000" />);
    }
    x += width;
  });
  return (
    <svg
      width={`${fit.widthMm}mm`}
      height="9mm"
      viewBox={`0 0 ${fit.widthMm} 9`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Barcode ${tag}`}
      shapeRendering="crispEdges"
    >
      {bars}
    </svg>
  );
}

/**
 * The quiet zone is drawn as a white rect inside the viewBox rather than left
 * to CSS margin: it is part of the symbol, and a margin could be collapsed or
 * overridden by a print stylesheet without anything looking wrong.
 */
function Qr({ url }: { url: string }) {
  const matrix = qrMatrix(url);
  const fit = qrFit(matrix.size);
  // Cause-neutral, and consistent with Barcode's refusal above: a code too
  // fine for a phone to read is worse than no code, because the sticker looks
  // finished either way. The tag text on the label is still human-readable.
  if (!fit.renderable) {
    return (
      <span style={{ fontSize: "2.4mm", color: "#B42318", fontFamily: "monospace" }}>
        no scannable QR
      </span>
    );
  }

  const total = matrix.size + 2 * QR_QUIET_MODULES;
  const dark: React.ReactElement[] = [];
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (matrix.isDark(x, y)) {
        dark.push(
          <rect
            key={`${x}-${y}`}
            x={x + QR_QUIET_MODULES}
            y={y + QR_QUIET_MODULES}
            width={1}
            height={1}
            fill="#000"
          />,
        );
      }
    }
  }

  return (
    <svg
      width={`${fit.sizeMm}mm`}
      height={`${fit.sizeMm}mm`}
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label={`QR ${url}`}
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={total} height={total} fill="#fff" />
      {dark}
    </svg>
  );
}

/** Named per cause, because "QR unavailable" would send someone hunting the
 *  wrong thing — a loopback base URL and a missing one need different fixes. */
const QR_NOTE: Record<Exclude<QrBase, { ok: true }>["reason"], string> = {
  unset: "No QR: APP_BASE_URL is not set.",
  "not-absolute": "No QR: APP_BASE_URL needs an http:// or https:// scheme.",
  loopback: "No QR: APP_BASE_URL points at this machine, which no phone can reach.",
  "bad-url": "No QR: APP_BASE_URL is not a valid URL.",
};

export function LabelSheet({ rows, baseUrl }: { rows: LabelRow[]; baseUrl?: string }) {
  const byTag = new Map(rows.map((r) => [r.tag, r]));
  // Validated ONCE: the reason a base URL is unusable never depends on the tag,
  // so this is one note per sheet rather than the same refusal on twelve labels.
  const base = qrBase(baseUrl);
  return (
    <div className="label-sheets">
      {labelPages(rows.map((r) => r.tag)).map((page, p) => (
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
          {page.map((tag) => {
            const row = byTag.get(tag)!;
            return (
              <div
                key={tag}
                style={{
                  padding: `${LABEL_PADDING_MM}mm`,
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  overflow: "hidden",
                  // OUTLINE, not border: a border participates in the box
                  // model, so `LABEL_USABLE_MM` (cell width minus padding
                  // only) would be 0.4mm wider than this cell's real content
                  // box and the widest barcodes would clip against
                  // `overflow: hidden` — an unscannable code that looks
                  // finished. An outline paints outside the box without
                  // consuming layout space, so the content box is exactly
                  // `LABEL_CELL_MM.width - 2 * LABEL_PADDING_MM`, matching
                  // what `label-geometry.ts` already assumes. The grid has
                  // no gaps, so adjacent cells' outlines coincide on the
                  // shared edge — a slightly bolder shared guide line, not a
                  // doubled one, which is the desired look here.
                  outline: "0.2mm dashed #C4CAD4",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "1.5mm", minWidth: 0 }}>
                  <span style={{ background: "#101828", color: "#fff", fontFamily: "monospace", fontSize: "2.6mm", padding: "0.6mm 1mm", flex: "none" }}>
                    BR
                  </span>
                  <span style={{ fontSize: "2.6mm", color: "#667085", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.model}
                  </span>
                </div>
                <div style={{ fontFamily: "monospace", fontSize: "4.6mm", fontWeight: 700, letterSpacing: "0.02em" }}>
                  {tag}
                </div>
                {/* flexShrink: 0 on BOTH, for the reason the calibration bar
                    carries it: this cell is a column flex with overflow
                    hidden, so an over-tall child is not clipped visibly — it
                    silently squeezes its siblings, which is how the ruler
                    once measured 89.38mm against a declared 100mm. */}
                <div style={{ width: `${LABEL_USABLE_MM}mm`, flexShrink: 0 }}>
                  <Barcode tag={tag} />
                </div>
                {base.ok && (
                  <div style={{ flexShrink: 0, lineHeight: 0 }}>
                    <Qr url={qrUrlFor(tag, base)} />
                  </div>
                )}
              </div>
            );
          })}
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
