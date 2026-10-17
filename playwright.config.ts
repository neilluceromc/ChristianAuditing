import { defineConfig } from "@playwright/test";

// E2E_PORT lets the suite run beside another instance of this app on the same
// machine (the staging laptop serves :3000 from Docker). Default unchanged.
const PORT = process.env.E2E_PORT ?? "3000";
export const E2E_BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: E2E_BASE_URL },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: E2E_BASE_URL,
    // Reuse a local dev server for fast iteration, but never in CI — reusing
    // whatever sits on :3000 can green the suite against stale/wrong-branch code.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Phase 41 (spec §8, §10): Cris answers from the scripted fake model — no key, no cost, deterministic.
    // Refused when NODE_ENV=production. A reused server (above) keeps the env it was started with.
    env: { ...process.env, CRIS_MODEL: "fake" } as Record<string, string>,
  },
});
