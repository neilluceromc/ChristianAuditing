import { describe, expect, it } from "vitest";
import { IT_ACCESS_REFUSAL, itAccessLive, itAccessRefusal, liveAccessFields, setupGuard, newHireStateSchema, notYetCount, setupStateSchema, setupSummary, vpnSchema } from "./it-setup";

describe("setupSummary", () => {
  it("reads Not recorded for every null", () => {
    expect(setupSummary({ entraStatus: null, autopilotStatus: null, argusStatus: null, vpn: null }))
      .toBe("Entra / Intune: Not recorded · Autopilot: Not recorded · Argus: Not recorded · VPN: Not recorded");
  });
  it("names each state and the VPN", () => {
    expect(setupSummary({ entraStatus: "NOT_YET", autopilotStatus: "DONE", argusStatus: "NOT_NEEDED", vpn: "Cloudflare WARP" }))
      .toBe("Entra / Intune: Not yet · Autopilot: Done · Argus: Not needed · VPN: Cloudflare WARP");
  });
});

describe("notYetCount", () => {
  it("counts NOT_YET only", () => {
    expect(notYetCount({ entraStatus: "NOT_YET", autopilotStatus: "NOT_YET", argusStatus: "DONE" })).toBe(2);
    expect(notYetCount({ entraStatus: null, autopilotStatus: "NOT_NEEDED", argusStatus: "DONE" })).toBe(0);
  });
});

describe("vpnSchema", () => {
  it("refuses blank and over-long, trims the rest", () => {
    expect(vpnSchema.safeParse("").error?.issues[0].message).toBe("Name the VPN");
    expect(vpnSchema.safeParse("   ").error?.issues[0].message).toBe("Name the VPN");
    expect(vpnSchema.safeParse("x".repeat(41)).error?.issues[0].message).toBe("At most 40 characters");
    expect(vpnSchema.parse("  OpenVPN ")).toBe("OpenVPN");
    expect(vpnSchema.safeParse("x".repeat(40)).success).toBe(true);
  });
});

describe("setupStateSchema", () => {
  it("accepts the four states only", () => {
    expect(setupStateSchema.safeParse("DONE").success).toBe(true);
    expect(setupStateSchema.safeParse("REMOVED").success).toBe(true);
    expect(setupStateSchema.safeParse("MAYBE").success).toBe(false);
  });
  it("a new hire cannot start as Removed", () => {
    expect(newHireStateSchema.safeParse("NOT_YET").success).toBe(true);
    expect(newHireStateSchema.safeParse("REMOVED").success).toBe(false);
  });
});

describe("setupSummary — Removed", () => {
  it("reads Removed for a removed state and for a removed VPN", () => {
    expect(setupSummary({ entraStatus: "REMOVED", autopilotStatus: "DONE", argusStatus: null, vpn: "Removed" }))
      .toBe("Entra / Intune: Removed · Autopilot: Done · Argus: Not recorded · VPN: Removed");
  });
});

describe("itAccessLive — access is live when it is actually there (spec §7)", () => {
  const none = { entraStatus: null, autopilotStatus: null, argusStatus: null, vpn: null };
  it("nothing recorded is not live", () => {
    expect(itAccessLive(none)).toBe(false);
    expect(liveAccessFields(none)).toEqual([]);
  });
  it("only Done is live for the three states", () => {
    for (const field of ["entraStatus", "autopilotStatus", "argusStatus"] as const) {
      expect(itAccessLive({ ...none, [field]: "DONE" })).toBe(true);
      for (const v of ["NOT_YET", "NOT_NEEDED", "REMOVED", null]) expect(itAccessLive({ ...none, [field]: v })).toBe(false);
    }
  });
  it("a VPN name is live; none, None, Removed and blank are not", () => {
    for (const v of ["Cloudflare WARP", "OpenVPN", "Zscaler"]) expect(itAccessLive({ ...none, vpn: v })).toBe(true);
    for (const v of [null, "None", "Removed", "none", " removed ", ""]) expect(itAccessLive({ ...none, vpn: v })).toBe(false);
  });
  it("names every live row, in card order", () => {
    expect(liveAccessFields({ entraStatus: "DONE", autopilotStatus: "NOT_YET", argusStatus: "DONE", vpn: "OpenVPN" }))
      .toEqual(["entra", "argus", "vpn"]);
  });
});

describe("itAccessRefusal — completeOffboarding's IT-access gate (final review M10)", () => {
  it("refuses with the spec's sentence while any access is live", () => {
    expect(itAccessRefusal({ entraStatus: "DONE", autopilotStatus: null, argusStatus: null, vpn: null })).toBe(IT_ACCESS_REFUSAL);
    expect(itAccessRefusal({ entraStatus: "REMOVED", autopilotStatus: "REMOVED", argusStatus: "REMOVED", vpn: "OpenVPN" })).toBe(IT_ACCESS_REFUSAL);
    expect(IT_ACCESS_REFUSAL).toBe("Remove their IT access first");
  });
  it("lets completion through once everything is removed, not needed or never recorded", () => {
    expect(itAccessRefusal({ entraStatus: "REMOVED", autopilotStatus: "NOT_NEEDED", argusStatus: null, vpn: "Removed" })).toBeNull();
    expect(itAccessRefusal({ entraStatus: null, autopilotStatus: null, argusStatus: null, vpn: null })).toBeNull();
  });
});

describe("setupGuard — the state guard on completeOffboarding's write (final review M3)", () => {
  it("carries exactly the four IT-access values the gate read, so a change in between matches nothing", () => {
    const read = { id: "e1", name: "Sam", entraStatus: "REMOVED", autopilotStatus: null, argusStatus: "NOT_NEEDED", vpn: "None" };
    expect(setupGuard(read)).toEqual({ entraStatus: "REMOVED", autopilotStatus: null, argusStatus: "NOT_NEEDED", vpn: "None" });
  });
});
