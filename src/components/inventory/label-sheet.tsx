import { code128Modules } from "@/lib/code128";
import {
  CALIBRATION_MM, LABEL_CELL_MM, LABEL_COLUMNS, LABEL_PADDING_MM, LABEL_USABLE_MM,
  PAGE_MARGIN_MM, PAGE_MM, barcodeFit, labelPages,
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

export function LabelSheet({ rows }: { rows: LabelRow[] }) {
  const byTag = new Map(rows.map((r) => [r.tag, r]));
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
                  border: "0.2mm dashed #C4CAD4",
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
                <div style={{ width: `${LABEL_USABLE_MM}mm` }}>
                  <Barcode tag={tag} />
                </div>
              </div>
            );
          })}
          {/* The only thing that can catch a browser printing at 96%.
              ABSOLUTELY POSITIONED, inside the page's own bottom margin --
              NOT a grid row: 4 rows x 69.25mm + 20mm padding is exactly
              297mm, so a fifth row would push this onto a second sheet and
              a ruler on a different sheet proves nothing about this one. */}
          <div style={{ position: "absolute", left: `${PAGE_MARGIN_MM}mm`, bottom: "2.5mm", display: "flex", alignItems: "center", gap: "2mm", fontSize: "2.4mm", color: "#667085" }}>
            {/* flexShrink: 0 is load-bearing: without it, the flex container
                shrinks this bar to make room for the text sibling and the
                bar quietly measures short of CALIBRATION_MM. A ruler that
                lies about its own length is worse than no ruler — it tells
                an operator to "fix" a scaling problem that doesn't exist. */}
            <span style={{ display: "block", width: `${CALIBRATION_MM}mm`, height: "1.5mm", flexShrink: 0, background: "#101828" }} />
            <span style={{ minWidth: 0 }}>
              this bar is exactly {CALIBRATION_MM}mm &mdash; measure it. If it is short, the print
              dialog is scaling: set Scale 100% and Margins None.
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
