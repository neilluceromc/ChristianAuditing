import type Anthropic from "@anthropic-ai/sdk";
import type { CrisSettings } from "@/lib/cris-settings";
import { anthropicModel } from "./anthropic";
import { fakeModel } from "./fake";

export { CrisProviderError, type ProviderFailure } from "./anthropic";

/*
 * Spec §8 "One small interface": the turn talks to a CrisModel, never to a provider directly. v1 ships the
 * Anthropic implementation and the scripted fake. NOT "use server".
 */

export type CrisRequest = { system: string; messages: Anthropic.MessageParam[]; tools: Anthropic.Tool[] };
/**
 * `content` in the API's own block shapes, appended to the history as-is; `stop` is the API's stop_reason;
 * `model` the model that actually served the reply (a server-side fallback may differ from the one asked);
 * `usage.input` is input-equivalent tokens (cris-cost's inputEquivalentTokens).
 */
export type CrisReply = { content: Anthropic.ContentBlock[]; stop: string; model: string; usage: { input: number; output: number } };

export interface CrisModel {
  /** The model id stored with each reply's token usage; "fake" for the scripted model (no usage stored). */
  readonly id: string;
  /** One round. Throws CrisProviderError when the provider fails, times out or has no key. */
  reply(req: CrisRequest): Promise<CrisReply>;
}

/**
 * The fake when `CRIS_MODEL=fake` outside production; otherwise Anthropic with the admin's chosen model. The fake
 * is refused when NODE_ENV is production even if CRIS_MODEL=fake is set (spec §8): production always gets the real
 * model, and without a key crisAvailability() already reports Cris off ("no-key").
 */
export function pickModel(
  settings: Pick<CrisSettings, "model">,
  env: Partial<Record<"CRIS_MODEL" | "NODE_ENV", string | undefined>> = process.env,
): CrisModel {
  if (env.CRIS_MODEL === "fake" && env.NODE_ENV !== "production") return fakeModel;
  return anthropicModel(settings.model);
}
