// Vercel's build command (`npm run vercel-build`; cloud staging spec §4.1).
//
//   1. prisma generate                       always
//   2. prisma migrate deploy                 ONLY when VERCEL_ENV=production, with DATABASE_URL
//                                            overridden to DIRECT_URL (the Supabase session pooler,
//                                            port 5432) for that one command
//   3. next build                            always
//
// A preview or development build never migrates, so a branch can never change the shared staging
// database (previews are also switched off in vercel.json). A production build without DIRECT_URL
// fails loudly instead of migrating through the transaction pooler.
//
// No URL or secret is ever printed: only the command names are logged.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const GENERATE = ["npx", "prisma", "generate"];
const MIGRATE = ["npx", "prisma", "migrate", "deploy"];
const BUILD = ["npx", "next", "build"];

const isMigrate = (step) => step.join(" ") === MIGRATE.join(" ");

/** The commands to run, in order, for this environment. Throws when production lacks DIRECT_URL. */
export function buildSteps(env) {
  if (env.VERCEL_ENV !== "production") return [GENERATE, BUILD];
  if (!env.DIRECT_URL) throw new Error("DIRECT_URL is required for production migrations");
  return [GENERATE, MIGRATE, BUILD];
}

/** The environment one step runs with: the migration gets DATABASE_URL = DIRECT_URL, the rest are unchanged. */
export function stepEnv(step, env) {
  return isMigrate(step) ? { ...env, DATABASE_URL: env.DIRECT_URL } : env;
}

function main() {
  let steps;
  try {
    steps = buildSteps(process.env);
  } catch (err) {
    console.error(`[vercel-build] ${err.message}`);
    process.exit(1);
  }
  console.log(`[vercel-build] VERCEL_ENV=${process.env.VERCEL_ENV ?? "(unset)"}: ${steps.map((s) => s.slice(1).join(" ")).join(" -> ")}`);
  for (const step of steps) {
    console.log(`[vercel-build] $ ${step.join(" ")}`);
    const [cmd, ...args] = step;
    const res = spawnSync(cmd, args, {
      stdio: "inherit",
      env: stepEnv(step, process.env),
      // npx is npx.cmd on Windows; Vercel builds on Linux.
      shell: process.platform === "win32",
    });
    if (res.status !== 0) {
      console.error(`[vercel-build] "${step.join(" ")}" failed (${res.error ? res.error.message : `exit ${res.status ?? res.signal}`})`);
      process.exit(res.status || 1);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
