import { describe, expect, it } from "vitest";
import { qrMatrix } from "./qr";

const URL_59 = "http://inventory.backroom.local:3000/inventory?q=BR-LT-0166";

describe("qrMatrix", () => {
  // Pinned to a measured vector. If the dependency is ever swapped, THIS is
  // the test that says whether the replacement encodes identically.
  it("encodes a realistic label URL at the observed version and size", () => {
    const m = qrMatrix(URL_59);
    expect(URL_59.length).toBe(59);
    expect(m.version).toBe(4);
    expect(m.size).toBe(33);
  });

  // The three finder patterns are always dark at their outer corners. This is
  // a structural invariant of QR, so it holds for any payload — a cheap check
  // that we are reading a real symbol and not an empty matrix.
  it("places dark finder modules at the three corners", () => {
    const m = qrMatrix(URL_59);
    expect(m.isDark(0, 0)).toBe(true);
    expect(m.isDark(m.size - 1, 0)).toBe(true);
    expect(m.isDark(0, m.size - 1)).toBe(true);
  });

  // A QR is roughly half dark by construction; a matrix that is all-dark or
  // all-light means we are rendering garbage that would still LOOK like a code.
  it("produces a plausible dark-module ratio", () => {
    const m = qrMatrix(URL_59);
    let dark = 0;
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.isDark(x, y)) dark++;
    expect(dark).toBe(559);
    expect(dark / (m.size * m.size)).toBeGreaterThan(0.3);
    expect(dark / (m.size * m.size)).toBeLessThan(0.7);
  });

  // Version must follow the payload, never be assumed: the realistic URL above
  // clears version 4's 62-byte capacity by THREE bytes.
  it("grows the version as the payload grows", () => {
    expect(qrMatrix("http://a.io/inventory?q=BR-LT-0166").version).toBeLessThan(
      qrMatrix(`${URL_59}${"x".repeat(40)}`).version,
    );
  });
});
