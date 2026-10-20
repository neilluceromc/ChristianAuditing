import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authHeaders, readUpload, storageDriver, writeObject } from "./storage";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function useSupabase() {
  vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
}

const BAD_PATHS = ["../x", "a/../../b", "a/..", "/etc/passwd", "a\\b", "..\\x", ""];

describe("storageDriver", () => {
  it.each([
    ["", "", "local"],
    ["https://proj.supabase.co", "", "local"],
    ["", "key", "local"],
    ["https://proj.supabase.co", "key", "supabase"],
  ])("URL=%j KEY=%j -> %s", (url, key, expected) => {
    vi.stubEnv("SUPABASE_URL", url);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", key);
    expect(storageDriver()).toBe(expected);
  });

  it("is local when both are unset", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(storageDriver()).toBe("local");
  });
});

describe("authHeaders", () => {
  it("a new secret key (sb_secret_…) goes in apikey only", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc");
    expect(authHeaders()).toEqual({ apikey: "sb_secret_abc" });
  });

  it("a legacy service_role JWT goes in apikey and Authorization: Bearer", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJhbGciOi.x.y");
    expect(authHeaders()).toEqual({ apikey: "eyJhbGciOi.x.y", authorization: "Bearer eyJhbGciOi.x.y" });
  });
});

describe("supabase driver", () => {
  beforeEach(useSupabase);

  it("writes with POST to the documents bucket, apikey auth, content-type and no upsert", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await writeObject("lots/1/123-a b.pdf", Buffer.from("hi"), "application/pdf");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/documents/lots/1/123-a%20b.pdf");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("service-key");
    expect(init.headers.authorization).toBeUndefined();
    expect(init.headers["content-type"]).toBe("application/pdf");
    expect(init.headers["x-upsert"]).toBe("false");
    expect(Buffer.from(init.body).toString()).toBe("hi");
  });

  it("throws when the write is refused", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 400 }));
    await expect(writeObject("a/b.pdf", Buffer.from("x"), "application/pdf")).rejects.toThrow();
  });

  it("reads 200 -> bytes via the authenticated route", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const out = await readUpload("lots/1/a.pdf");
    expect(out).toEqual(Buffer.from([1, 2, 3]));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/authenticated/documents/lots/1/a.pdf");
    expect(init.headers.apikey).toBe("service-key");
    expect(init.headers.authorization).toBeUndefined();
  });

  it("reads 404 -> null", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await readUpload("lots/1/a.pdf")).toBeNull();
  });

  it("reads 500 -> throws", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(readUpload("lots/1/a.pdf")).rejects.toThrow();
  });

  it("reads 400 with statusCode \"404\" in the body -> null", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" }), { status: 400 }));
    expect(await readUpload("lots/1/a.pdf")).toBeNull();
  });

  it("reads 400 with error not_found in the body -> null", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "not_found" }), { status: 400 }));
    expect(await readUpload("lots/1/a.pdf")).toBeNull();
  });

  it("reads 400 with any other body -> throws", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ statusCode: "400", error: "InvalidKey" }), { status: 400 }));
    await expect(readUpload("lots/1/a.pdf")).rejects.toThrow(/400/);
    fetchMock.mockResolvedValue(new Response("not json", { status: 400 }));
    await expect(readUpload("lots/1/a.pdf")).rejects.toThrow(/400/);
  });

  it("encodes unicode, # and ? per segment and keeps the slashes", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
    await readUpload("emp/1/résumé 收据#1?.pdf");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://proj.supabase.co/storage/v1/object/authenticated/documents/emp/1/r%C3%A9sum%C3%A9%20%E6%94%B6%E6%8D%AE%231%3F.pdf",
    );
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await writeObject("a#b/c?d.pdf", Buffer.from("x"), "application/pdf");
    expect(fetchMock.mock.calls[0][0]).toBe("https://proj.supabase.co/storage/v1/object/documents/a%23b/c%3Fd.pdf");
  });

  it("puts up to 200 characters of the response body in read and write errors, never the key", async () => {
    const long = "x".repeat(500);
    fetchMock.mockImplementation(async () => new Response(`bad bucket ${long}`, { status: 403 }));
    const readErr = await readUpload("a/b.pdf").catch((e: Error) => e);
    const writeErr = await writeObject("a/b.pdf", Buffer.from("x"), "application/pdf").catch((e: Error) => e);
    for (const err of [readErr, writeErr]) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      expect(msg).toContain("403");
      expect(msg).toContain("bad bucket");
      expect(msg.length).toBeLessThan(260);
      expect(msg).not.toContain("service-key");
    }
  });

  it.each(BAD_PATHS)("read of %j -> null without calling fetch", async (p) => {
    expect(await readUpload(p)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(BAD_PATHS)("write of %j throws without calling fetch", async (p) => {
    await expect(writeObject(p, Buffer.from("x"), "application/pdf")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("local driver", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "storage-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips under uploads/ and never calls fetch", async () => {
    await writeObject("lots/1/a.pdf", Buffer.from("hello"), "application/pdf");
    expect((await readFile(path.join(dir, "uploads", "lots", "1", "a.pdf"))).toString()).toBe("hello");
    expect((await readUpload("lots/1/a.pdf"))?.toString()).toBe("hello");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null for a missing file", async () => {
    expect(await readUpload("nope/a.pdf")).toBeNull();
  });

  it.each(BAD_PATHS)("read of %j -> null even when a file sits outside uploads/", async (p) => {
    await mkdir(path.join(dir, "uploads"), { recursive: true });
    await writeFile(path.join(dir, "x"), "secret");
    await writeFile(path.join(dir, "b"), "secret");
    expect(await readUpload(p)).toBeNull();
  });

  it.each(BAD_PATHS)("write of %j throws and writes nothing", async (p) => {
    await expect(writeObject(p, Buffer.from("x"), "application/pdf")).rejects.toThrow();
  });
});
