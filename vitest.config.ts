import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "prisma/**/*.test.ts"],
    // Unit tests are node-only by design; component behaviour is covered by Playwright e2e.
    environment: "node",
  },
  // tsconfig keeps JSX as "preserve" for Next; node-side markup tests (renderToStaticMarkup)
  // need the automatic runtime so components don't have to import React.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
