import { describe, expect, it, vi } from "vitest";

/*
 * Users & access (Task 3 re-review #A): the recovery command clears the Account settings wrong-password bucket by its
 * key. It keeps its own copy of the key (it runs under tsx without the app's db client), so this pins the copy equal
 * to sign-in-limit.ts's: if one changes alone, recovery would leave the bucket behind.
 */

vi.mock("@/server/db/client", () => ({ prisma: {} }));

import { currentPasswordKey as appKey } from "@/server/auth/sign-in-limit";
import { currentPasswordKey as recoverKey } from "./admin-recover";

describe("the recovery command's CURRENT: key", () => {
  it("equals sign-in-limit.ts's for any account id", () => {
    for (const id of ["nina", "clx0abc123", "u-new-1"]) expect(recoverKey(id)).toBe(appKey(id));
    expect(recoverKey("nina")).toBe("CURRENT:nina");
  });
});
