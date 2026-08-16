import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Reuse a local dev server for fast iteration, but never in CI — reusing
    // whatever sits on :3000 can green the suite against stale/wrong-branch code.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
