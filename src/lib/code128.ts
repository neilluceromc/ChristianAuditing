/**
 * Code 128-B encoder, hand-rolled on purpose.
 *
 * A library would be untestable in any useful sense here, and any npm install
 * on Windows regenerates package-lock.json without the Linux optional-dep
 * trees and breaks the Alpine production image (HANDOVER §7). This is ~60
 * lines of pure logic a node-environment vitest can reach directly, which is
 * the structural lesson §6a states three times over.
 *
 * Returns MODULE WIDTHS, alternating bar-first: [bar, space, bar, space, ...].
 * It deliberately knows nothing about millimetres, SVG or assets — `labels.ts`
 * owns the physical geometry and `label-sheet.tsx` owns the rendering.
 */

/** 107 symbol patterns, index = symbol value. Each is 6 runs except STOP (7). */
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
] as const;

const START_B = 104;
const STOP = 106;

/** Every character group is 11 modules wide; START + checksum + STOP total 35. */
export const CODE128_MODULES_PER_CHAR = 11;
export const CODE128_FIXED_MODULES = 35;

/** Module count for an n-character string, without encoding it. */
export function code128ModuleCount(charCount: number): number {
  return CODE128_MODULES_PER_CHAR * charCount + CODE128_FIXED_MODULES;
}

export function code128Modules(text: string): number[] {
  if (text.length === 0) throw new Error("Cannot encode an empty string as Code 128.");
  const values: number[] = [START_B];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // Code 128-B covers ASCII 32..126. Anything else would index past the
    // pattern table and emit a symbol that scans as garbage or not at all.
    if (code < 32 || code > 126) {
      throw new Error(`"${ch}" cannot be encoded in Code 128-B (only ASCII 32-126).`);
    }
    values.push(code - 32);
  }
  // Weighted modulo-103 checksum: START counts once, then position 1, 2, ...
  let sum = START_B;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  values.push(STOP);
  return values.flatMap((v) => PATTERNS[v].split("").map(Number));
}
