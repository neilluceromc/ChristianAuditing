import { describe, expect, it, vi } from "vitest";

// The menu's Sign out and the sidebar prefs pull in auth and the db.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/auth/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/server/ui-prefs", () => ({ saveUiPref: vi.fn(async () => null) }));

import { accountMenuItems } from "./account-menu";

/* Users & access (spec §4.5): "Account settings" sits in the account menu, before Sign out, for every role. */
describe("accountMenuItems", () => {
  it("lists Account settings before Sign out", () => {
    expect(accountMenuItems({ crisSettings: false, push: () => {} }).map((i) => i.label)).toEqual(["Account settings", "Sign out"]);
  });

  it("keeps Cris settings for the roles that have Cris", () => {
    expect(accountMenuItems({ crisSettings: true, push: () => {} }).map((i) => i.label)).toEqual([
      "Cris settings",
      "Account settings",
      "Sign out",
    ]);
  });

  it("Account settings opens /settings/account", () => {
    const push = vi.fn();
    accountMenuItems({ crisSettings: false, push }).find((i) => i.label === "Account settings")!.onSelect();
    expect(push).toHaveBeenCalledWith("/settings/account");
  });
});
