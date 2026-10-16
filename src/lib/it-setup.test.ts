import { describe, expect, it } from "vitest";
import { notYetCount, setupStateSchema, setupSummary, vpnSchema } from "./it-setup";

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
  it("accepts the three states only", () => {
    expect(setupStateSchema.safeParse("DONE").success).toBe(true);
    expect(setupStateSchema.safeParse("MAYBE").success).toBe(false);
  });
});
