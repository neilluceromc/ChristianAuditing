import qrcodegen from "nayuki-qr-code-generator";

/**
 * The ONLY file in this codebase that imports the QR dependency.
 *
 * Unlike `code128.ts`, which is hand-rolled, QR is Reed–Solomon over GF(256)
 * plus eight mask patterns scored by four penalty rules. A subtly wrong
 * implementation fails on SOME readers and not others, which is exactly what
 * masking and error correction exist to prevent — so this is a vetted
 * dependency by decision, recorded in the spec's §0.6.
 *
 * Wrapping it in this three-line surface means a future swap touches one file
 * and is answerable by one test (`qr.test.ts` pins a measured vector).
 */
export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. 21 at version 1, +4 per version. */
  readonly size: number;
  /** 1–40. Derived from the payload by the encoder, never chosen here. */
  readonly version: number;
  isDark(x: number, y: number): boolean;
}

/**
 * ECC level MEDIUM (~15% recoverable). LOW would fit a longer URL into a
 * smaller symbol, but these are stickers on hardware that gets handled — a
 * scuffed label with error correction still reads.
 */
export function qrMatrix(text: string): QrMatrix {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  return {
    size: qr.size,
    version: qr.version,
    isDark: (x, y) => qr.getModule(x, y),
  };
}
