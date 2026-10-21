import { describe, expect, it } from "vitest";
import {
  arrivalText, bellLabel, decodeCursor, encodeCursor, NOTIFICATION_TABS, notificationsHref, parseNotificationTab, parseTeam,
} from "./notifications";

/* Task 7 (spec §7): the bell's and the notifications page's pure parts. */

describe("the tabs", () => {
  it("Sent back · To check · Changed · All, each its kind (All: every kind)", () => {
    expect(NOTIFICATION_TABS.map((t) => [t.id, t.label, t.kind])).toEqual([
      ["sent-back", "Sent back", "SENT_BACK"],
      ["to-check", "To check", "TO_CHECK"],
      ["changed", "Changed", "CHANGED"],
      ["all", "All", null],
    ]);
  });

  it("an unknown tab reads as All; a team must be one of the three", () => {
    expect(parseNotificationTab("to-check")).toBe("to-check");
    expect(parseNotificationTab("nope")).toBe("all");
    expect(parseNotificationTab(null)).toBe("all");
    expect(parseTeam("FINANCE")).toBe("FINANCE");
    expect(parseTeam("ADMIN")).toBeNull();
  });

  it("the page's links keep the team (admins) and drop the defaults", () => {
    expect(notificationsHref({ tab: "all" })).toBe("/notifications");
    expect(notificationsHref({ tab: "sent-back" })).toBe("/notifications?tab=sent-back");
    expect(notificationsHref({ tab: "all", team: "IT", cursor: "c1" })).toBe("/notifications?team=IT&cursor=c1");
  });
});

describe("the bell's words (spec §7 Accessibility)", () => {
  it("is labelled with its unread count", () => {
    expect(bellLabel(3)).toBe("Notifications, 3 unread");
    expect(bellLabel(0)).toBe("Notifications, 0 unread");
  });

  it("announces arrivals only when the count goes up, once per arrival", () => {
    expect(arrivalText(0, 1)).toBe("1 new notification");
    expect(arrivalText(2, 5)).toBe("3 new notifications");
    expect(arrivalText(5, 5)).toBeNull();
    expect(arrivalText(5, 2)).toBeNull(); // read elsewhere: not news
  });
});

describe("the page cursor", () => {
  it("round-trips the last item's time and id; anything else is no cursor", () => {
    const at = new Date("2026-10-20T01:02:03.004Z");
    expect(decodeCursor(encodeCursor({ createdAt: at, id: "cmabc123" }))).toEqual({ at, id: "cmabc123" });
    expect(decodeCursor("nonsense")).toBeNull();
    expect(decodeCursor("not-a-date~id")).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});
