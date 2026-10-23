import { describe, expect, it } from "vitest";
import { generateTempPassword, TEMP_PASSWORD_WORDS } from "./temp-password";
import { passwordChecks } from "@/lib/password-rules";

/* Users & access (spec §4.3): a temporary password is Word-NNNN-word, about 16 characters, from crypto.randomInt. */

describe("generateTempPassword", () => {
  it("has the Word-NNNN-word shape and a length of 14–20", () => {
    for (let i = 0; i < 500; i += 1) {
      const pw = generateTempPassword();
      expect(pw).toMatch(/^[A-Z][a-z]+-\d{4}-[a-z]+$/);
      expect(pw.length).toBeGreaterThanOrEqual(14);
      expect(pw.length).toBeLessThanOrEqual(20);
    }
  });

  it("1000 calls give at least 990 distinct values", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateTempPassword()));
    expect(seen.size).toBeGreaterThanOrEqual(990);
  });

  it("passes the password rules itself (letters, a number, 10+)", () => {
    const c = passwordChecks(generateTempPassword(), {});
    expect(c.long && c.mixed).toBe(true);
  });

  it("uses no 0 or 1 in the digits, which read as O and l", () => {
    for (let i = 0; i < 300; i += 1) expect(generateTempPassword().split("-")[1]).toMatch(/^[2-9]{4}$/);
  });
});

describe("the word list", () => {
  it("has at least 64 distinct lower-case words of 4–7 letters", () => {
    expect(TEMP_PASSWORD_WORDS.length).toBeGreaterThanOrEqual(64);
    expect(new Set(TEMP_PASSWORD_WORDS).size).toBe(TEMP_PASSWORD_WORDS.length);
    for (const w of TEMP_PASSWORD_WORDS) expect(w).toMatch(/^[a-z]{4,7}$/);
  });

  it("avoids look-alikes: no word starts with i, l or o (capitalised they read as l, I or 0), none has rn (reads as m)", () => {
    for (const w of TEMP_PASSWORD_WORDS) {
      expect(w).not.toMatch(/^[ilo]/);
      expect(w).not.toContain("rn");
    }
  });
});

describe("calm words (fix round 1, M2)", () => {
  it("leaves out words that are awkward read aloud or have two spellings", () => {
    for (const w of ["honey", "cherry", "ginger", "desert", "harbor"]) expect(TEMP_PASSWORD_WORDS).not.toContain(w);
  });

  it("keeps no copper/pepper near-twins (Users & access, Task 5)", () => {
    expect(TEMP_PASSWORD_WORDS).toContain("copper");
    expect(TEMP_PASSWORD_WORDS).not.toContain("pepper");
    expect(TEMP_PASSWORD_WORDS).toContain("button");
    expect(TEMP_PASSWORD_WORDS.length).toBeGreaterThanOrEqual(64);
  });
});
