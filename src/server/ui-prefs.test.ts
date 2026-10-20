import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 47 spec §5.4: settings follow the person. saveUiPref merges a toggle's change over what is stored;
 * restoreUiPrefs rewrites all six cookies from the person's stored prefs, or the defaults (Review Focus #4).
 */

const h = vi.hoisted(() => ({
  user: { id: "u1", role: "admin" } as { id: string; role: string } | null,
  stored: new Map<string, unknown>(),
  upserts: [] as Array<{ where: unknown; update: { value: unknown }; create: { userId: string; key: string; value: unknown } }>,
  set: [] as Array<{ name: string; value: string; options: unknown }>,
  deleted: [] as string[],
}));

vi.mock("@/server/auth/guards", () => ({ actionUser: async () => h.user }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: unknown) => h.set.push({ name, value, options }),
    delete: (name: string) => h.deleted.push(name),
  }),
}));
vi.mock("@/server/db/client", () => ({
  prisma: {
    userPreference: {
      findUnique: async ({ where }: { where: { userId_key: { userId: string; key: string } } }) => {
        const v = h.stored.get(`${where.userId_key.userId}|${where.userId_key.key}`);
        return v === undefined ? null : { value: v };
      },
      upsert: async (args: (typeof h.upserts)[number]) => {
        h.upserts.push(args);
        h.stored.set(`${args.create.userId}|${args.create.key}`, args.update.value);
        return {};
      },
    },
  },
}));

const { restoreUiPrefs, saveUiPref } = await import("./ui-prefs");

beforeEach(() => {
  h.user = { id: "u1", role: "admin" };
  h.stored = new Map();
  h.upserts = [];
  h.set = [];
  h.deleted = [];
});

describe("saveUiPref", () => {
  it("merges the change over what is stored, under ui:prefs", async () => {
    h.stored.set("u1|ui:prefs", { theme: "dark", density: "compact", sidebar: "rail", focus: true, workspace: "finance" });
    const r = await saveUiPref({ sidebar: "full" });
    expect(r).toEqual({ theme: "dark", density: "compact", sidebar: "full", focus: true, workspace: "finance" });
    expect(h.upserts).toHaveLength(1);
    expect(h.upserts[0].where).toEqual({ userId_key: { userId: "u1", key: "ui:prefs" } });
    expect(h.upserts[0].create).toEqual({ userId: "u1", key: "ui:prefs", value: r });
  });

  it("starts from the defaults when nothing is stored", async () => {
    expect(await saveUiPref({ theme: "dark" })).toEqual({
      theme: "dark", density: "comfortable", sidebar: "full", focus: false, workspace: null,
    });
  });

  it("drops bad fields instead of resetting the stored ones", async () => {
    h.stored.set("u1|ui:prefs", { theme: "dark", density: "compact", sidebar: "rail", focus: true, workspace: "it" });
    const r = await saveUiPref({ theme: "neon", density: "dense" } as never);
    expect(r).toMatchObject({ theme: "dark", density: "dense" });
  });

  it("never stores a workspace the person's role can't open", async () => {
    h.user = { id: "u1", role: "it_staff" };
    h.stored.set("u1|ui:prefs", { workspace: "it" });
    expect((await saveUiPref({ workspace: "finance" }))?.workspace).toBe("it");
  });

  it("writes nothing for someone signed out", async () => {
    h.user = null;
    expect(await saveUiPref({ theme: "dark" })).toBeNull();
    expect(h.upserts).toHaveLength(0);
  });
});

describe("restoreUiPrefs (Review Focus #4: another person on the same browser)", () => {
  const byName = () => Object.fromEntries(h.set.map((c) => [c.name, c.value]));

  it("rewrites all six cookies from the person's saved prefs and stamps br.uid", async () => {
    h.stored.set("u1|ui:prefs", { theme: "dark", density: "dense", sidebar: "rail", focus: true, workspace: "finance" });
    const r = await restoreUiPrefs();
    expect(r).toMatchObject({ theme: "dark", density: "dense" });
    expect(byName()).toEqual({
      "br.theme": "dark", "br.density": "dense", "br.sidebar": "rail", "br.focus": "on", "br.dept": "finance", "br.uid": "u1",
    });
    for (const c of h.set) expect(c.options).toEqual({ path: "/", maxAge: 31536000, sameSite: "lax", httpOnly: false });
    expect(h.deleted).toEqual([]);
  });

  it("writes the defaults for someone with nothing saved, and clears the workspace cookie", async () => {
    h.user = { id: "u2", role: "it_staff" };
    h.stored.set("u1|ui:prefs", { theme: "dark", density: "dense", sidebar: "rail", focus: true, workspace: "finance" });
    await restoreUiPrefs();
    expect(byName()).toEqual({
      "br.theme": "light", "br.density": "comfortable", "br.sidebar": "full", "br.focus": "off", "br.uid": "u2",
    });
    expect(h.deleted).toEqual(["br.dept"]);
  });

  it("never restores a workspace the role no longer has", async () => {
    h.user = { id: "u1", role: "it_staff" };
    h.stored.set("u1|ui:prefs", { workspace: "finance" });
    await restoreUiPrefs();
    expect(byName()["br.dept"]).toBeUndefined();
    expect(h.deleted).toEqual(["br.dept"]);
  });

  it("does nothing for someone signed out", async () => {
    h.user = null;
    expect(await restoreUiPrefs()).toBeNull();
    expect(h.set).toEqual([]);
  });
});
