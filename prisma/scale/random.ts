/**
 * Phase 43 (spec §3): the scale seed's one source of randomness. mulberry32 is a tiny 32-bit PRNG: the same
 * seed gives the same sequence on every machine, so the scale data set is identical on every run.
 */

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** [0, 1) */
  float(): number {
    return this.next();
  }

  /** An integer in [min, max], both ends included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on an empty list");
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items[items.length - 1][0];
  }

  /** A shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** A uniform instant in [from, to]; `to` before `from` collapses to `from`. */
  between(from: Date | number, to: Date | number): Date {
    const a = typeof from === "number" ? from : from.getTime();
    const b = typeof to === "number" ? to : to.getTime();
    return new Date(b <= a ? a : a + Math.floor(this.next() * (b - a)));
  }

  /** `n` sorted instants in [from, to). */
  sortedBetween(n: number, from: number, to: number): Date[] {
    return Array.from({ length: n }, () => this.between(from, to).getTime()).sort((x, y) => x - y).map((t) => new Date(t));
  }
}

/**
 * Deterministic, cuid-shaped ids ("c" + 24 base-36 characters): a counter keeps them unique, the random tail keeps
 * them from reading as a sequence. The scale seed sets its own ids so every foreign key is known before insert.
 */
export function idFactory(seed: number): () => string {
  const rng = new Rng(seed);
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let counter = 0;
  return () => {
    counter += 1;
    let tail = "";
    for (let i = 0; i < 19; i++) tail += alphabet[rng.int(0, alphabet.length - 1)];
    return `c${counter.toString(36).padStart(5, "0")}${tail}`;
  };
}
