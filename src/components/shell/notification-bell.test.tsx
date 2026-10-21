import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/inventory", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/notifications/actions", () => ({
  bellCount: vi.fn(async () => ({ count: 0 })),
  bellItems: vi.fn(async () => ({ items: [], next: null })),
  markRead: vi.fn(async () => ({ ok: true, data: { count: 0 } })),
}));

import { NotificationBell } from "./notification-bell";

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
