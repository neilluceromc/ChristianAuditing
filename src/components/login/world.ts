// The back room of the Cris login page, drawn as one SVG string.
// Ported from the approved mockup (docs/mockups/2026-10-19-login-cris.html, "room builder").
// Every class and id carries the `lw-` prefix; colours come from `--lw-*` custom properties
// that the login page CSS defines.

export const WORLD_W = 3960;
export const WORLD_H = 760;

const W = WORLD_W;
const H = WORLD_H;

// Rect and text helpers take the bare class name and add the `lw-` prefix.
const R = (x: number, y: number, w: number, h: number, c: string, e = ""): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="lw-${c}" ${e}/>`;
const T = (x: number, y: number, t: string, c: string, e = ""): string =>
  `<text x="${x}" y="${y}" class="lw-${c}" ${e}>${t}</text>`;

const lamp = (x: number): string =>
  `<circle cx="${x}" cy="170" r="210" fill="url(#lw-glow)" class="lw-glow"/><polygon points="${x - 34},116 ${x + 34},116 ${x + 180},610 ${x - 180},610" fill="url(#lw-cone)"/><line x1="${x}" y1="22" x2="${x}" y2="82" class="lw-cord"/><path d="M${x - 42} 116 L${x - 18} 82 L${x + 18} 82 L${x + 42} 116 Z" class="lw-lamp"/><ellipse cx="${x}" cy="116" rx="40" ry="5" class="lw-bulb"/>`;

const sign = (cx: number, label: string): string => {
  const w = label.length * 11.6 + 48;
  return R(cx - w / 2, 34, w, 38, "sign", 'rx="6"') + T(cx, 59, label, "signt", 'text-anchor="middle"');
};

const win = (x: number, y: number, w: number, h: number): string =>
  R(x, y, w, h, "frame", 'rx="4"') +
  R(x + 10, y + 10, w - 20, h - 20, "sky") +
  R(x + 10, y + 10, w - 20, h - 20, "nightv") +
  R(x + 10, y + 10, w - 20, 8, "shade") +
  R(x + w / 2 - 3, y + 10, 6, h - 20, "frame") +
  R(x + 10, y + h / 2 - 3, w - 20, 6, "frame") +
  R(x - 12, y + h, w + 24, 12, "frame", 'rx="3"') +
  R(x + w - 52, y + h - 26, 26, 26, "pot", 'rx="3"') +
  `<ellipse cx="${x + w - 39}" cy="${y + h - 34}" rx="18" ry="12" class="lw-leaf"/><ellipse cx="${x + w - 50}" cy="${y + h - 44}" rx="8" ry="14" class="lw-leaf"/><ellipse cx="${x + w - 30}" cy="${y + h - 46}" rx="7" ry="13" class="lw-leaf"/>`;

const shaft = (x: number, w: number): string =>
  `<polygon points="${x + 16},548 ${x + w - 16},548 ${x + w + 120},760 ${x + 70},760" class="lw-shaft"/>`;

const shadow = (cx: number, cy: number, rx: number): string =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="9" class="lw-shadow"/>`;

const qr = (x: number, y: number, c: number): string => {
  let o = "";
  const f = (fx: number, fy: number): void => {
    o +=
      R(x + fx * c, y + fy * c, 3 * c, 3 * c, "qr") +
      R(x + fx * c + c * 0.5, y + fy * c + c * 0.5, 2 * c, 2 * c, "paper") +
      R(x + fx * c + c, y + fy * c + c, c, c, "qr");
  };
  f(0, 0);
  f(4, 0);
  f(0, 4);
  const bits = [
    [3, 1],
    [3, 3],
    [4, 4],
    [5, 5],
    [6, 4],
    [4, 6],
    [6, 6],
    [3, 5],
    [5, 3],
    [1, 3],
    [6, 3],
  ];
  bits.forEach(([a, b]) => {
    o += R(x + a * c, y + b * c, c, c, "qr");
  });
  return o;
};

const box = (x: number, y: number, w: number, h: number): string =>
  R(x, y, w, h, "kraft", 'rx="2"') +
  R(x + 1, y + 1, w - 2, 6, "krafttop") +
  R(x + w / 2 - 5, y, 10, Math.round(h * 0.5), "tape") +
  R(x + 7, y + h - 17, Math.min(28, w * 0.4), 10, "tag");

type ShelfGap = { row: number; x: number };

const chair = (x: number): string =>
  R(x - 36, 452, 72, 86, "chair", 'rx="16"') +
  R(x - 28, 460, 56, 5, "hi", 'rx="2.5"') +
  R(x - 44, 534, 88, 16, "chair", 'rx="7"') +
  R(x - 4, 550, 8, 46, "metal") +
  `<path d="M${x} 598 L${x - 46} 614 M${x} 598 L${x + 46} 614 M${x} 598 L${x - 18} 621 M${x} 598 L${x + 18} 621" style="stroke:var(--lw-metal);stroke-width:5;stroke-linecap:round"/>` +
  [
    [-46, 618],
    [46, 618],
    [-18, 625],
    [18, 625],
  ]
    .map(([d, y]) => `<circle cx="${x + d}" cy="${y}" r="5" class="lw-chair"/>`)
    .join("");

export function buildWorld(): string {
  // The shelf stock is random but seeded, and the seed resets on every call so the
  // room is identical each time it is built.
  let seed = 11;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  function shelf(x0: number, w: number, code: string, shelfGap?: ShelfGap): string {
    let gap: ShelfGap | null | undefined = shelfGap;
    let o = shadow(x0 + w / 2, 572, w / 2 + 10) + R(x0 + 10, 126, w - 20, 434, "shelfback");
    const planks = [216, 314, 412, 510];
    planks.forEach((py, ri) => {
      let x = x0 + 18;
      while (x < x0 + w - 34) {
        if (gap && gap.row === ri && x >= gap.x) {
          o += `<g class="lw-a-gap">${R(x, py - 76, 26, 76, "gapr", 'rx="3"')}</g>`;
          x += 32;
          gap = null;
          continue;
        }
        if (rand() < 0.15 && x < x0 + w - 96) {
          const bw = 62 + ((rand() * 14) | 0);
          const bh = 44 + ((rand() * 18) | 0);
          o += box(x, py - bh, bw, bh);
          x += bw + 6;
        } else {
          const sh = 66 + ((rand() * 12) | 0);
          o +=
            R(x, py - sh, 22, sh, rand() < 0.5 ? "sl1" : "sl2", 'rx="3"') +
            R(x + 2, py - sh + 4, 2, sh - 12, "hi") +
            R(x, py - 8, 22, 8, "shade") +
            R(x + 5, py - sh + 8, 12, 7, "tag");
          x += 26;
        }
      }
      o +=
        R(x0, py - 4, w, 5, "planktop") +
        R(x0, py, w, 10, "plank") +
        R(x0 + 16, py + 10, 36, 15, "lbl", 'rx="2"') +
        T(x0 + 34, py + 21.5, code + (ri + 1), "lblt", 'text-anchor="middle"');
    });
    o +=
      R(x0, 118, w, 8, "plank") +
      R(x0, 118, 12, 450, "metal") +
      R(x0 + w - 12, 118, 12, 450, "metal") +
      R(x0, 556, w, 10, "plank");
    o += box(x0 + 30, 70, 92, 48) + box(x0 + 132, 84, 70, 34);
    return o;
  }

  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="lw-wallg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--lw-wall2)"/><stop offset=".5" style="stop-color:var(--lw-wall1)"/></linearGradient>
    <linearGradient id="lw-floorg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--lw-floor)"/><stop offset="1" style="stop-color:var(--lw-floor2)"/></linearGradient>
    <linearGradient id="lw-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--lw-sky1)"/><stop offset="1" style="stop-color:var(--lw-sky2)"/></linearGradient>
    <radialGradient id="lw-glow"><stop offset="0" stop-color="#ffd68a" stop-opacity=".28"/><stop offset="1" stop-color="#ffd68a" stop-opacity="0"/></radialGradient>
    <linearGradient id="lw-cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:#ffe2a6;stop-opacity:var(--lw-coneop)"/><stop offset="1" style="stop-color:#ffe2a6;stop-opacity:0"/></linearGradient>
    <linearGradient id="lw-glare" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="lw-blur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="16"/></filter>
    <clipPath id="lw-doorclip"><rect x="2136" y="196" width="308" height="332"/></clipPath>
    <pattern id="lw-haz" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="24" fill="#f5b400"/><rect x="12" width="12" height="24" fill="#1f2937"/></pattern>
  </defs>`;

  // shell
  s +=
    R(0, 0, W, 540, "wall") +
    R(0, 0, W, 20, "ceil") +
    R(0, 452, W, 76, "wains") +
    R(0, 446, W, 8, "rail") +
    R(0, 524, W, 16, "baseb");
  [260, 1060, 1580, 2700, 3290].forEach((x) => {
    s += R(x, 484, 18, 26, "furn", 'rx="3"') + R(x + 5, 492, 2.5, 6, "plank") + R(x + 10.5, 492, 2.5, 6, "plank");
  });
  s += win(1380, 130, 170, 270) + win(2620, 130, 170, 270);
  s +=
    sign(760, "STOCKROOM") +
    sign(1840, "PURCHASING") +
    sign(2290, "RECEIVING") +
    sign(3060, "FINANCE") +
    sign(3560, "OFFBOARDING");
  s += `<g transform="translate(2062 130)"><circle r="40" class="lw-clockrim"/><circle r="34" class="lw-clockface"/>${Array.from(
    { length: 12 },
    (_, i) => `<line x1="0" y1="-30" x2="0" y2="${i % 3 ? -26 : -22}" transform="rotate(${i * 30})" class="lw-clocktick"/>`,
  ).join(
    "",
  )}<line id="lw-hour" x1="0" y1="4" x2="0" y2="-17" class="lw-clockh"/><line id="lw-minute" x1="0" y1="6" x2="0" y2="-27" class="lw-clockm"/><circle r="3.5" class="lw-clockdot"/></g>`;
  s += R(0, 540, W, 220, "floor");
  [566, 602, 650, 712].forEach((y) => {
    s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="lw-fline"/>`;
  });
  s += shaft(1380, 170) + shaft(2620, 170);
  [1380, 2620].forEach((x) =>
    [
      [90, 700, 0],
      [150, 660, 1.6],
      [120, 730, 3.1],
      [210, 690, 4.4],
      [70, 640, 5.6],
      [180, 620, 2.4],
    ].forEach(([dx, y, d]) => {
      s += `<circle cx="${x + dx}" cy="${y}" r="2.2" class="lw-mote" style="animation-delay:${d}s"/>`;
    }),
  );

  // stockroom A + check-in bench
  s += shelf(120, 440, "A");
  s += `<g class="lw-a-row">${R(132, 236, 416, 80, "hl", 'rx="4"')}</g>`;
  s +=
    shadow(730, 612, 140) +
    R(596, 434, 268, 8, "furntop", 'rx="2"') +
    R(600, 440, 260, 14, "furn", 'rx="2"') +
    R(608, 454, 244, 18, "furn2") +
    R(616, 472, 10, 138, "metal") +
    R(834, 472, 10, 138, "metal");
  s +=
    R(716, 432, 118, 8, "metal", 'rx="2"') +
    R(700, 330, 150, 104, "lid", 'rx="8"') +
    R(712, 344, 76, 76, "paper", 'rx="3"') +
    qr(718, 350, 8) +
    T(794, 368, "BR-LT", "stkt") +
    T(794, 380, "0230", "stkt");
  s += `<g class="lw-a-beam"><polygon points="676,300 676,324 716,348 716,428" class="lw-beam"/><g class="lw-a-scanline">${R(712, 350, 80, 3, "beamline")}</g></g>`;
  s += `<g class="lw-a-scanner">${
    R(640, 316, 18, 54, "scanner", 'rx="6"') + R(626, 292, 58, 32, "scanner", 'rx="9"') + R(670, 298, 10, 20, "scanwin", 'rx="2"')
  }</g>`;
  s +=
    R(676, 176, 208, 136, "sglow", 'rx="24" filter="url(#lw-blur)"') +
    R(690, 186, 180, 116, "bezel", 'rx="10"') +
    R(700, 196, 160, 96, "uibg", 'rx="4"') +
    R(774, 302, 12, 14, "metal");
  s += T(712, 216, "ASSET CHECK-IN", "uism") + T(712, 242, "BR-LT-0230", "uit") + T(712, 258, "Returned by D. Cruz", "uir");
  s += `<g class="lw-a-pending">${R(712, 268, 76, 18, "chipw", 'rx="9"') + T(750, 281, "Scanning…", "chiptw", 'text-anchor="middle"')}</g>`;
  s += `<g class="lw-a-done">${
    R(712, 268, 112, 18, "chipg", 'rx="9"') + T(768, 281, "In stock · Shelf A2", "chiptg", 'text-anchor="middle"')
  }</g>`;
  s += `<g class="lw-a-ok"><circle cx="864" cy="190" r="15" class="lw-good"/><path d="M857 190 l5 5 9-10" class="lw-tick"/></g>`;

  // stockroom B with the missing laptop
  s += shelf(900, 420, "B", { row: 2, x: 1176 });
  s += R(1166, 424, 72, 16, "paper", 'rx="2"') + T(1202, 435.5, "BR-LT-0027", "stkt", 'text-anchor="middle"');
  s += `<g class="lw-a-sticky">${
    R(1276, 300, 58, 52, "sticky", 'rx="2" transform="rotate(5 1305 326)"') +
    T(1305, 324, "WHERE", "stickyt", 'text-anchor="middle" transform="rotate(5 1305 326)"') +
    T(1305, 338, "IS IT?", "stickyt", 'text-anchor="middle" transform="rotate(5 1305 326)"')
  }</g>`;
  s += `<g class="lw-a-q">${T(1244, 330, "?", "qmark")}</g>`;
  s += `<g class="lw-a-mag"><circle cx="1189" cy="372" r="27" class="lw-lens"/><line x1="1209" y1="392" x2="1236" y2="420" class="lw-lensh"/></g>`;

  // purchasing desk
  s +=
    shadow(1810, 616, 220) +
    R(1596, 440, 428, 8, "furntop", 'rx="2"') +
    R(1600, 446, 420, 16, "furn", 'rx="2"') +
    R(1880, 462, 130, 150, "furn2") +
    R(1612, 462, 12, 150, "metal");
  [492, 540, 588].forEach((y) => {
    s += R(1924, y - 6, 42, 5, "handle", 'rx="2"');
  });
  s +=
    R(1848, 410, 16, 36, "metal") +
    R(1818, 440, 76, 7, "metal", 'rx="3"') +
    R(1700, 200, 320, 226, "sglow", 'rx="30" filter="url(#lw-blur)"') +
    R(1720, 214, 280, 198, "bezel", 'rx="10"') +
    R(1730, 224, 260, 170, "uibg", 'rx="3"');
  s +=
    R(1730, 224, 260, 22, "uibar") +
    T(1742, 239, "PURCHASING · REQUESTS", "uism") +
    T(1742, 268, "PR-1042", "uit") +
    T(1742, 284, "For the November new hires", "uism");
  s += `<g class="lw-a-pend">${R(1906, 255, 72, 18, "chipw", 'rx="9"') + T(1942, 268, "Pending", "chiptw", 'text-anchor="middle"')}</g>`;
  s += `<g class="lw-a-appr">${R(1900, 255, 80, 18, "chipg", 'rx="9"') + T(1940, 268, "Approved", "chiptg", 'text-anchor="middle"')}</g>`;
  s +=
    R(1742, 293, 236, 1, "uiline") +
    T(1742, 311, "USB headset", "uir") +
    T(1978, 311, "× 5", "uib", 'text-anchor="end"') +
    T(1742, 328, "Unit cost", "uir") +
    T(1978, 328, "₱2,450", "uir", 'text-anchor="end"');
  s +=
    R(1742, 336, 236, 1, "uiline") +
    T(1742, 354, "Total", "uib") +
    T(1820, 354, "₱12,250", "uib") +
    R(1896, 362, 82, 24, "btnp", 'rx="5"') +
    T(1937, 378, "Approve", "btnt", 'text-anchor="middle"');
  s += `<g transform="translate(1942 377)"><g class="lw-a-cursor"><path d="M0 0 L0 19 L5 14 L9 23 L13 21 L9 13 L16 13 Z" style="fill:var(--lw-ink);stroke:var(--lw-ui-bg);stroke-width:1.5"/></g></g>`;
  s +=
    R(1960, 414, 26, 32, "furn2", 'rx="3"') +
    `<line x1="1966" y1="414" x2="1962" y2="396" class="lw-cord"/><line x1="1974" y1="414" x2="1978" y2="398" class="lw-cord"/>`;

  // receiving dock
  s +=
    R(2112, 168, 356, 30, "metal", 'rx="4"') +
    R(2120, 192, 340, 336, "furn2") +
    R(2136, 196, 308, 332, "outside") +
    R(2136, 196, 308, 230, "sky") +
    R(2136, 196, 308, 230, "nightv");
  s += R(2136, 470, 308, 58, "outside");
  s +=
    R(2186, 414, 214, 72, "van", 'rx="9"') +
    R(2398, 434, 44, 52, "van", 'rx="7"') +
    R(2404, 442, 30, 20, "sky", 'rx="3"') +
    R(2206, 432, 130, 10, "vanstripe", 'rx="3"') +
    `<circle cx="2236" cy="490" r="15" class="lw-tyre"/><circle cx="2392" cy="490" r="15" class="lw-tyre"/>`;
  let sl = "";
  for (let y = 196; y < 528; y += 16) {
    sl += R(2136, y, 308, 16, "shutter") + `<line x1="2136" y1="${y + 15}" x2="2444" y2="${y + 15}" class="lw-slat"/>`;
  }
  s += `<g clip-path="url(#lw-doorclip)"><g class="lw-a-shutter">${sl}${R(2136, 512, 308, 16, "metal")}${R(2270, 500, 40, 8, "handle", 'rx="3"')}</g></g>`;
  s += `<polygon points="2120,546 2460,546 2470,560 2110,560" fill="url(#lw-haz)" opacity=".9"/>`;
  s +=
    shadow(2310, 636, 170) +
    R(2160, 600, 300, 14, "pallet") +
    [2170, 2295, 2420].map((x) => R(x, 614, 30, 14, "pallet")).join("") +
    R(2160, 628, 300, 6, "pallet");
  let n = 0;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 5; i++) {
      const x = 2166 + i * 58;
      const y = row === 0 ? 552 : 504;
      if (row === 1 && i === 4) {
        s += `<g class="lw-a-miss">${R(x, y, 54, 46, "miss", 'rx="3"')}</g>`;
        continue;
      }
      s += `<g class="lw-a-hb" style="--d:${(n++ * 0.09).toFixed(2)}s">${R(x, y, 54, 46, "hbox", 'rx="3"')}<path d="M${x + 15} ${y + 28} a12 12 0 0 1 24 0" class="lw-hicon"/>${R(x + 11, y + 26, 7, 10, "qr", 'rx="2"')}${R(x + 36, y + 26, 7, 10, "qr", 'rx="2"')}</g>`;
    }
  }
  s += R(2486, 244, 110, 156, "clipb", 'rx="6"') + R(2494, 258, 94, 136, "paper", 'rx="2"') + R(2521, 238, 40, 14, "metal", 'rx="4"');
  s += T(2502, 278, "PO-2219", "pt") + T(2502, 294, "USB headset", "ps") + T(2502, 320, "Ordered", "ps") + T(2580, 320, "10", "pt", 'text-anchor="end"');
  s +=
    T(2502, 340, "Received", "ps") +
    `<g class="lw-a-recv">${T(2580, 341, "9", "pbad", 'text-anchor="end"')}</g>` +
    R(2502, 350, 78, 1.5, "cald") +
    T(2502, 372, "SHORT 1", "pbad");
  s += R(2600, 474, 22, 66, "ext", 'rx="7"') + R(2604, 466, 14, 10, "metal", 'rx="2"');

  // finance desk
  s +=
    shadow(3060, 616, 230) +
    R(2836, 440, 468, 8, "furntop", 'rx="2"') +
    R(2840, 446, 460, 16, "furn", 'rx="2"') +
    R(2852, 462, 120, 150, "furn2") +
    R(3286, 462, 12, 150, "metal");
  [492, 540, 588].forEach((y) => {
    s += R(2891, y - 6, 42, 5, "handle", 'rx="2"');
  });
  s +=
    R(3102, 410, 16, 36, "metal") +
    R(3072, 440, 76, 7, "metal", 'rx="3"') +
    R(2940, 184, 340, 242, "sglow", 'rx="30" filter="url(#lw-blur)"') +
    R(2960, 198, 300, 214, "bezel", 'rx="10"') +
    R(2970, 208, 280, 186, "uibg", 'rx="3"');
  s +=
    R(2970, 208, 280, 22, "uibar") +
    T(2982, 223, "FINANCE · DEPRECIATION", "uism") +
    T(2982, 250, "BR-LT-0188 · Laptop", "uib") +
    T(2982, 265, "Cost ₱72,000 · 36 months · straight line", "uism");
  const cx0 = 2986;
  const cx1 = 3236;
  const cy0 = 286;
  const cy1 = 372;
  const X = (m: number): number => cx0 + ((cx1 - cx0) * m) / 36;
  const Y = (m: number): number => cy0 + ((cy1 - cy0) * m) / 36;
  let past = `M${X(0)} ${Y(0)}`;
  for (let m = 1; m <= 7; m++) past += ` H${X(m).toFixed(1)} V${Y(m).toFixed(1)}`;
  let fut = `M${X(7).toFixed(1)} ${Y(7).toFixed(1)}`;
  for (let m = 8; m <= 36; m++) fut += ` H${X(m).toFixed(1)} V${Y(m).toFixed(1)}`;
  s += `<line x1="${cx0}" y1="${cy1}" x2="${cx1}" y2="${cy1}" class="lw-axis"/><line x1="${cx0}" y1="${cy0 - 4}" x2="${cx0}" y2="${cy1}" class="lw-axis"/>`;
  s += `<g class="lw-a-future"><path d="${fut}" class="lw-future"/></g><path d="${past}" class="lw-past lw-a-past" pathLength="1"/>`;
  s += `<circle cx="${X(7).toFixed(1)}" cy="${Y(7).toFixed(1)}" r="6" class="lw-depdot lw-a-dot"/>`;
  s += `<g class="lw-a-val">${T(X(7) + 12, Y(7) - 2, "₱58,000", "uib")}${T(X(7) + 12, Y(7) + 11, "Book value · month 7", "uism")}</g>`;
  s += T(cx0, 386, "M1", "uism") + T(cx1, 386, "M36", "uism", 'text-anchor="end"');
  s +=
    R(3226, 396, 44, 50, "bezel", 'rx="5"') +
    R(3232, 402, 32, 12, "chipg", 'rx="2"') +
    T(3262, 411.5, "58,000", "chiptg", 'text-anchor="end" style="font-size:7.5px"');
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) s += R(3233 + c * 11, 419 + r * 8, 8, 5, "plank", 'rx="1"');
  }
  s += R(2808, 112, 92, 104, "paper", 'rx="3"') + R(2808, 112, 92, 24, "calhead", 'rx="3"') + T(2854, 129, "OCT 2026", "calt", 'text-anchor="middle"');
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 7; c++) s += `<circle cx="${2820 + c * 11.5}" cy="${150 + r * 16}" r="2.4" class="lw-cald"/>`;
  }
  s += `<circle cx="${2820 + 2 * 11.5}" cy="${150 + 3 * 16 + 16}" r="7" class="lw-calring"/>` + `<circle cx="${2820 + 2 * 11.5}" cy="${150 + 4 * 16}" r="2.4" class="lw-cald"/>`;
  s += R(3000, 414, 26, 32, "furn2", 'rx="5"') + `<path d="M3026 422 h6 a6 6 0 0 1 0 14 h-6" style="fill:none;stroke:var(--lw-edge);stroke-width:3"/>`;

  // offboarding counter + exit
  s +=
    shadow(3540, 628, 240) +
    R(3316, 414, 448, 8, "furntop", 'rx="2"') +
    R(3320, 420, 440, 18, "furn", 'rx="3"') +
    R(3330, 438, 420, 182, "furn2") +
    `<line x1="3540" y1="438" x2="3540" y2="620" style="stroke:var(--lw-edge);stroke-width:2"/>` +
    R(3330, 612, 420, 10, "metal");
  s +=
    R(3366, 474, 156, 42, "furn", 'rx="5"') +
    T(3444, 500, "RETURN DESK", "signt", 'text-anchor="middle" style="font-size:12px;letter-spacing:2px"');
  s += R(3464, 406, 262, 14, "tray", 'rx="4"');
  s += `<g class="lw-a-item" style="--d:.5s">${R(3482, 390, 96, 16, "lid", 'rx="4"')}${R(3482, 402, 96, 4, "metal")}</g>`;
  s += `<g class="lw-a-item" style="--d:1.1s"><path d="M3600 402 a22 22 0 0 1 44 0" style="fill:none;stroke:var(--lw-ink2);stroke-width:5;stroke-linecap:round"/>${R(3594, 390, 14, 18, "metal", 'rx="5"')}${R(3636, 390, 14, 18, "metal", 'rx="5"')}</g>`;
  s += `<g class="lw-a-item" style="--d:1.7s"><path d="M3676 362 l14 14 l14 -14" style="fill:none;stroke:var(--lw-accent);stroke-width:3"/>${R(3676, 376, 30, 32, "paper", 'rx="3"')}${R(3683, 381, 16, 12, "sl1", 'rx="2"')}${R(3681, 397, 20, 3, "cald")}</g>`;
  s += R(3566, 132, 170, 210, "clipb", 'rx="6"') + R(3574, 146, 154, 188, "paper", 'rx="2"') + R(3631, 126, 40, 14, "metal", 'rx="4"');
  s += T(3586, 168, "RETURN KIT", "pt") + T(3586, 184, "Ana Reyes · last day 17 Oct", "ps", 'style="font-size:9px"');
  (
    [
      ["Laptop BR-LT-0144", 0.5],
      ["Headset", 1.1],
      ["ID badge", 1.7],
    ] as const
  ).forEach(([label, d], i) => {
    const y = 206 + i * 32;
    s +=
      R(3586, y, 18, 18, "cb", 'rx="4"') +
      `<path d="M3590 ${y + 9} l5 5 l9 -10" class="lw-ticka lw-a-tick" pathLength="1" style="--d:${d}s"/>` +
      T(3614, y + 13.5, label, "ps");
  });
  s += `<g class="lw-a-done3">${T(3586, 318, "3 OF 3 RETURNED", "donet")}</g>`;
  s +=
    R(3800, 186, 120, 342, "furn", 'rx="2"') +
    R(3810, 196, 100, 332, "door") +
    R(3892, 360, 8, 30, "handle", 'rx="3"') +
    R(3818, 146, 84, 28, "exit", 'rx="3"') +
    T(3860, 166, "EXIT", "exitt", 'text-anchor="middle"');

  // screen glare, then chairs in front of the desks
  s += R(700, 196, 160, 96, "glare", 'rx="4"') + R(1730, 224, 260, 170, "glare", 'rx="3"') + R(2970, 208, 280, 186, "glare", 'rx="3"');
  s += shadow(1790, 630, 64) + chair(1790) + shadow(3170, 630, 64) + chair(3170);

  // ceiling lamps last so they hang in front of the wall
  [330, 790, 1240, 1830, 2300, 2760, 3070, 3550].forEach((x) => {
    s += lamp(x);
  });
  s += "</svg>";
  return s;
}
