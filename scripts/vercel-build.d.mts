// Types for scripts/vercel-build.mjs, so its test type-checks under `tsc --noEmit` (allowJs is off).
type Env = Record<string, string | undefined>;

export function buildSteps(env: Env): string[][];
export function stepEnv(step: string[], env: Env): Env;
