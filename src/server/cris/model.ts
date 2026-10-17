import type Anthropic from "@anthropic-ai/sdk";
import { crisModeFrom, type CrisEnv, type CrisSettings } from "@/lib/cris-settings";
import { anthropicModel } from "./anthropic";
import { fakeModel } from "./fake";
import { previewModel } from "./preview";

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
  /**
   * The model id stored with each reply's token usage; "fake" for the scripted model (no usage stored); "preview"
   * for the no-key placeholder replies (zero usage, never priced).
   */
  readonly id: string;
  /** One round. Throws CrisProviderError when the provider fails, times out or has no key. */
  reply(req: CrisRequest): Promise<CrisReply>;
}

/**
 * By crisModeFrom: the fake when `CRIS_MODEL=fake` outside production; Anthropic with the admin's chosen model when
 * a key is set; otherwise the preview's placeholder replies (added 2026-10-18). The fake is refused when NODE_ENV is
 * production even if CRIS_MODEL=fake is set (spec §8): production gets the real model, or the preview without a key.
 */
export function pickModel(settings: Pick<CrisSettings, "model">, env: CrisEnv = process.env): CrisModel {
  const mode = crisModeFrom(env);
  if (mode === "fake") return fakeModel;
  if (mode === "preview") return previewModel;
  return anthropicModel(settings.model);
}
