import { describe, expect, it } from "vitest";
import { buildSteps, stepEnv } from "./vercel-build.mjs";

const GENERATE = ["npx", "prisma", "generate"];
const MIGRATE = ["npx", "prisma", "migrate", "deploy"];
const BUILD = ["npx", "next", "build"];

describe("buildSteps (cloud staging spec §4.1: migrate only on production builds)", () => {
  it("production: generate, migrate deploy, build — in that order", () => {
    expect(buildSteps({ VERCEL_ENV: "production", DIRECT_URL: "postgres://direct" })).toEqual([GENERATE, MIGRATE, BUILD]);
  });

  it("production runs the migration with DATABASE_URL set to DIRECT_URL, and only that step", () => {
    const env = { VERCEL_ENV: "production", DATABASE_URL: "postgres://pooler", DIRECT_URL: "postgres://direct" };
    expect(stepEnv(MIGRATE, env).DATABASE_URL).toBe("postgres://direct");
    expect(stepEnv(GENERATE, env).DATABASE_URL).toBe("postgres://pooler");
    expect(stepEnv(BUILD, env).DATABASE_URL).toBe("postgres://pooler");
  });

  it("preview, development and a local run never migrate", () => {
    for (const env of [{ VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, {}]) {
      expect(buildSteps({ ...env, DIRECT_URL: "postgres://direct" })).toEqual([GENERATE, BUILD]);
      expect(buildSteps(env)).toEqual([GENERATE, BUILD]);
    }
  });

  it("production without DIRECT_URL throws before anything runs", () => {
    for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "production", DIRECT_URL: "" }]) {
      expect(() => buildSteps(env)).toThrow("DIRECT_URL is required for production migrations");
    }
  });
});
