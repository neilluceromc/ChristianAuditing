import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      // R-5, round 2: Next 15's default is 1MB, and this module's own
      // ceilings can legally produce more than that — 2,000 rows with Notes
      // at this module's 2,000-character cap is 2.63MB via `toXlsxBuffer`,
      // so a file legal by every rule `import-vocabulary.ts` states would
      // die at the framework boundary with an opaque error instead of a
      // named refusal (never `rowCapRefusal`, never a `conflict` banner).
      // 4MB covers that worst legal file with room, while still bounding
      // the buffer — `readGrid` itself gets no size guard (T11's, if ever).
      // Mirrored as `IMPORT_MAX_UPLOAD_BYTES` in `src/lib/import-vocabulary.ts`
      // so the import wizard can refuse an oversized file by name before
      // ever sending it — this file cannot import that TS constant, so the
      // number is duplicated by necessity; keep the two in sync by hand.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
