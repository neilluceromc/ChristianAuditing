import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Users & access (Task 5): the seed's accounts, as SQL-text checks in the style of the migration tests. Running the
 * seed is `npm run db:seed`, not this file.
 */
const seed = readFileSync(fileURLToPath(new URL("./seed.ts", import.meta.url)), "utf8");
const schema = readFileSync(fileURLToPath(new URL("./schema.prisma", import.meta.url)), "utf8");

const SEEDED = ["admin", "it", "purchasing", "finance", "viewer"].map((n) => `${n}@thebackroomop.com`);
const createOf = (email: string) => {
  const at = seed.indexOf(`email: "${email}"`);
  expect(at, email).toBeGreaterThan(-1);
  return seed.slice(at, seed.indexOf("}", at));
};

describe("the seed's accounts", () => {
  it("leaves the five accounts APPROVED through the column default, with the shared seed password", () => {
    expect(schema).toMatch(/approvalState\s+AccountApprovalState\s+@default\(APPROVED\)/);
    for (const email of SEEDED) {
      const create = createOf(email);
      expect(create, email).not.toContain("approvalState");
      expect(create, email).not.toContain("disabled");
      expect(create, email).toContain("passwordHash: hash");
    }
  });

  it("seeds one sign-up waiting for approval, turned off as a self sign-up is", () => {
    const create = createOf("pending@thebackroomop.com");
    expect(create).toContain('approvalState: "PENDING"');
    expect(create).toContain("disabled: true");
    expect(create).toContain('role: "viewer"');
  });

  it("truncates the sign-in pause's failures, so no run inherits a paused email", () => {
    const truncate = seed.slice(seed.indexOf("TRUNCATE"), seed.indexOf("CASCADE"));
    expect(truncate).toContain('"SignInAttempt"');
    expect(truncate).toContain('"User"');
  });
});
