// Focus mode's geometry (spec §6): where the card slides to, where the forward Cris stands beside it, and where
// its speech bubble goes. Pure, so the placement is tested without the DOM. Ported from the mockup's
// focusPoint() / placeBubble() / updateDx(). All values are hero pixels.

/** What focus mode measures: the hero, the card (untransformed) and the room banner. */
export type FocusLayout = {
  /** At or below the 900 px breakpoint. */
  narrow: boolean;
  heroWidth: number;
  heroHeight: number;
  cardWidth: number;
  /** The card's left edge without its focus-mode shift (offsetLeft ignores transforms). */
  cardLeft: number;
  /** The room scene's box in the hero (the full hero on desktop, the banner on narrow screens). */
  scene: { left: number; top: number; width: number; height: number };
};

/** A Cris position: the orb's centre and its scale (1 = 200 px). */
export type FocusPoint = { x: number; y: number; scale: number };

/** The forward Cris's speech bubble: above Cris on desktop, to its right (`side`) on narrow screens. */
export type FocusBubble = { left: number; top: number; maxWidth: number; side: boolean; tail: number };

/** Half the orb's 200 px box. */
const HALF = 100;

/** The card's left edge once centred in the hero. */
export function centredCardLeft(l: FocusLayout): number {
  return (l.heroWidth - l.cardWidth) / 2;
}

/** How far the card moves to be centred (desktop only; on narrow screens it stays in the column). */
export function cardShift(l: FocusLayout): number {
  return l.narrow ? 0 : centredCardLeft(l) - l.cardLeft;
}

/** Where the forward Cris stands: left of the centred card (desktop) or in the banner (narrow). */
export function focusPoint(l: FocusLayout): FocusPoint {
  if (l.narrow) {
    const { left, top, width, height } = l.scene;
    return { x: left + (width * 28) / 100, y: top + height / 2, scale: Math.min(1, height / 280) };
  }
  const scale = 1.3;
  // max(154, cardLeftCentred − 170): the 260 px orb clear of the hero's left edge and of the card.
  return {
    x: Math.max(HALF * scale + 24, centredCardLeft(l) - HALF * scale - 40),
    y: (l.heroHeight * 54) / 100,
    scale,
  };
}

/** The room Cris's point (scene pixels, from the room loop) in hero pixels. */
export function roomPoint(p: FocusPoint, l: FocusLayout): FocusPoint {
  return { x: l.scene.left + p.x, y: l.scene.top + p.y, scale: p.scale };
}

/** The bubble's max width, set before measuring it. */
export function bubbleMaxWidth(p: FocusPoint, l: FocusLayout): number {
  if (l.narrow) return Math.max(140, l.heroWidth - sideLeft(p) - 12);
  return Math.max(180, Math.min(300, centredCardLeft(l) - 36));
}

const sideLeft = (p: FocusPoint) => p.x + HALF * p.scale + 14;

/**
 * The bubble's placement for its measured width. Desktop: above Cris (the bubble is drawn translateY(−100%), so
 * `top` is its bottom edge), its right edge kept 24 px left of the centred card, the tail pointing at Cris and
 * kept on the bubble. Narrow: to Cris's right, vertically centred, the tail on its left (CSS).
 */
export function focusBubble(p: FocusPoint, l: FocusLayout, width: number): FocusBubble {
  const maxWidth = bubbleMaxWidth(p, l);
  if (l.narrow) return { left: sideLeft(p), top: p.y, maxWidth, side: true, tail: 0 };
  const left = Math.max(12, Math.min(p.x - width * 0.35, centredCardLeft(l) - 24 - width));
  const tail = Math.round(Math.max(16, Math.min(width - 30, p.x - left - 6)));
  return { left, top: p.y - HALF * p.scale - 10, maxWidth, side: false, tail };
}
