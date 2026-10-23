import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/inventory", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/notifications/actions", () => ({
  bellCount: vi.fn(async () => ({ count: 0 })),
  bellItems: vi.fn(async () => ({ items: [], next: null })),
  markRead: vi.fn(async () => ({ ok: true, data: { count: 0 } })),
}));

import { NotificationBell, NotificationLink } from "./notification-bell";

/* Task 7 (spec §7 Accessibility): the bell is a real button named with its unread count; arrivals are polite. */

describe("NotificationBell", () => {
  it("is a real button labelled \"Notifications, N unread\", closed, controlling its panel", () => {
    const html = renderToStaticMarkup(<NotificationBell initialCount={3} admin={false} />);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="Notifications, 3 unread"/);
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).toMatch(/aria-haspopup="dialog"/);
    // the count is drawn for sighted users only: the label already says it
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>3<\/span>/);
  });

  it("has a polite live region from the first paint, empty until something arrives", () => {
    const html = renderToStaticMarkup(<NotificationBell initialCount={0} admin={false} />);
    expect(html).toMatch(/<span[^>]*role="status"[^>]*aria-live="polite"[^>]*><\/span>/);
    expect(html).not.toMatch(/<span aria-hidden="true"[^>]*>0<\/span>/);
  });

  it("caps the drawn count at 99+ (the label keeps the real number)", () => {
    const html = renderToStaticMarkup(<NotificationBell initialCount={140} admin={false} />);
    expect(html).toContain('aria-label="Notifications, 140 unread"');
    expect(html).toContain(">99+</span>");
  });
});

describe("the admin's bell (2026-10-23: it reads every team's)", () => {
  it("rings like anyone's: the count is drawn and named", () => {
    const html = renderToStaticMarkup(<NotificationBell initialCount={4} admin />);
    expect(html).toContain('aria-label="Notifications, 4 unread"');
    expect(html).toMatch(/<span aria-hidden="true"[^>]*>4<\/span>/);
  });

  it("each item carries its team for an admin; a team's own list leaves it out", () => {
    const n = {
      id: "n1", team: "PURCHASING" as const, kind: "CHANGED" as const, title: "PO-0214: Finance approved all its assets",
      body: null, href: "/purchases/po1", actorName: "Ana Cruz", createdAt: new Date("2026-10-23T02:00:00Z"), read: false,
    };
    const admin = renderToStaticMarkup(<NotificationLink n={n} onOpen={() => {}} showTeam />);
    expect(admin).toMatch(/>Purchasing<\/span>/);
    const team = renderToStaticMarkup(<NotificationLink n={n} onOpen={() => {}} />);
    expect(team).not.toContain(">Purchasing</span>");
    for (const [t, label] of [["IT", "IT"], ["FINANCE", "Finance"]] as const) {
      expect(renderToStaticMarkup(<NotificationLink n={{ ...n, team: t }} onOpen={() => {}} showTeam />)).toContain(`>${label}</span>`);
    }
  });
});
