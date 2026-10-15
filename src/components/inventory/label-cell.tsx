import { code128Modules } from "@/lib/code128";
import { qrUrlFor, type QrBase } from "@/lib/label-qr";
import { qrMatrix } from "@/lib/qr";
import {
  LABEL_CELL_MM, LABEL_LAYOUT_MM, LABEL_PADDING_MM, LABEL_USABLE_MM, QR_QUIET_MODULES, barcodeFit, qrFit,
} from "@/lib/label-geometry";

/**
 * Phase 34 (spec §6, plan P-7): ONE sticker, rendered by both the printable
 * sheet and the Register form's live preview, so what the preview shows is
 * what prints. A pure render with no hooks, no "use client" and no
 * server-only imports — `code128`, `qr` and `label-qr` are pure — so a Server
 * Component and a Client Component can both import it. Light-theme-only and
 * absolute mm throughout, matching the two print surfaces that already exist
 * (the farewell report and the accountability form) — these are printed
 * artifacts, not screens.
 */
export function Barcode({ tag }: { tag: string }) {
  const fit = barcodeFit(tag);
  if (!fit.encodable) {
    // An unscannable code is worse than none: the sticker would look finished.
    // Cause-NEUTRAL wording: `encodable: false` covers a too-fine module (a
    // very long tag), a character Code 128-B cannot encode, AND an empty
    // tag, so "too long" would be false for two of the three causes. Every
    // write path validates `TAG_SHAPE`
    // (`src/lib/tag-key.ts`: at most 20 characters, which fit the barcode), so
    // a tag that fails here cannot be created through this application today — but no DB CHECK constraint
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
export function Qr({ url }: { url: string }) {
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
export const QR_NOTE: Record<Exclude<QrBase, { ok: true }>["reason"], string> = {
  unset: "No QR: APP_BASE_URL is not set.",
  "not-absolute": "No QR: APP_BASE_URL needs an http:// or https:// scheme.",
  loopback: "No QR: APP_BASE_URL points at this machine, which no phone can reach.",
  "bad-url": "No QR: APP_BASE_URL is not a valid URL.",
};

/**
 * One sticker, cell box included, sized to `LABEL_CELL_MM` so it lays out the
 * same inside the sheet's grid (whose tracks are exactly that size) and
 * standing alone in a preview. Rows, top to bottom (spec §6): BR · Backroom IT
 * · category; QR beside the model; the tag; the full-width barcode. Row
 * heights are `LABEL_LAYOUT_MM`, whose sum the geometry test checks against
 * the cell height.
 */
export function LabelCell({ tag, model, category, base }: { tag: string; model: string; category: string; base: QrBase }) {
  return (
    <div
      style={{
        width: `${LABEL_CELL_MM.width}mm`,
        height: `${LABEL_CELL_MM.height}mm`,
        padding: `${LABEL_PADDING_MM}mm`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        overflow: "hidden",
        background: "#fff",
        color: "#101828",
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
      <div style={{ display: "flex", alignItems: "center", gap: "1.5mm", minWidth: 0, height: `${LABEL_LAYOUT_MM.topRow}mm` }}>
        <span style={{ background: "#101828", color: "#fff", fontFamily: "monospace", fontSize: "2.6mm", padding: "0.6mm 1mm", flex: "none" }}>BR</span>
        <span style={{ fontSize: "2.6mm", fontWeight: 600, flex: "none" }}>Backroom IT</span>
        <span style={{ marginLeft: "auto", fontSize: "2.4mm", color: "#475467", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{category}</span>
      </div>
      {/* flexShrink: 0 on the QR row, the QR, the tag AND the barcode, for
          the reason the calibration bar carries it: this cell is a column
          flex with overflow hidden, so an over-tall child is not clipped
          visibly — it silently squeezes its siblings, which is how the
          ruler once measured 89.38mm against a declared 100mm. */}
      <div style={{ display: "flex", gap: "3mm", alignItems: "center", minWidth: 0, flexShrink: 0 }}>
        {base.ok ? <div style={{ flexShrink: 0, lineHeight: 0 }}><Qr url={qrUrlFor(tag, base)} /></div> : null}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "1.2mm" }}>
          <span style={{ fontSize: "2.6mm", color: "#344054", lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{model}</span>
          {base.ok && <span style={{ fontSize: "2.2mm", color: "#667085" }}>Scan to open</span>}
        </div>
      </div>
      <div style={{ fontFamily: "monospace", fontSize: `${LABEL_LAYOUT_MM.tag}mm`, fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>{tag}</div>
      <div style={{ width: `${LABEL_USABLE_MM}mm`, flexShrink: 0 }}><Barcode tag={tag} /></div>
    </div>
  );
}
