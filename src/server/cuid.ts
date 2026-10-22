import { randomInt } from "node:crypto";
import { hostname } from "node:os";

/*
 * Final review M3: a new PO's id is minted before its files are stored, so they live under requests/<poId>/ like
 * every other PO document. The schema's ids are `@default(cuid())`, which Prisma's engine makes and doesn't export,
 * and no cuid library is in package.json, so this is cuid v1's own recipe (the one Prisma follows): "c", the time in
 * base 36, a counter, a host fingerprint and two random blocks — 25 lowercase base-36 characters. Server only.
 */

const BASE = 36;
const BLOCK = 4;
const DISCRETE = BASE ** BLOCK;

const pad = (s: string, size: number) => s.padStart(size, "0").slice(-size);
const randomBlock = () => pad(randomInt(0, DISCRETE).toString(BASE), BLOCK);

let counter = randomInt(0, DISCRETE);
function nextCount(): string {
  counter = counter < DISCRETE - 1 ? counter + 1 : 0;
  return pad(counter.toString(BASE), BLOCK);
}

const FINGERPRINT = (() => {
  const host = hostname();
  const hostSum = host.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), host.length + BASE);
  return pad(process.pid.toString(BASE), 2) + pad(hostSum.toString(BASE), 2);
})();

/** A new id shaped like Prisma's `cuid()`: "c" + 24 lowercase base-36 characters. */
export function cuid(): string {
  return `c${pad(Date.now().toString(BASE), 8)}${nextCount()}${FINGERPRINT}${randomBlock()}${randomBlock()}`;
}
