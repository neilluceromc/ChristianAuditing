import Anthropic from "@anthropic-ai/sdk";
import type { CrisModelId } from "@/lib/cris-settings";
import type { CrisModel, CrisReply, CrisRequest } from "./model";

/*
 * Spec §8: the Anthropic implementation of CrisModel. One non-streaming request per round (v1 does not stream).
 * NOT "use server". The key is read from ANTHROPIC_API_KEY by the SDK — never stored, never shown.
 */

/** Why a request did not get a reply. The turn treats every one the same (Review Focus #4); the kind is for the log. */
export type ProviderFailure = "no-key" | "auth" | "rate-limited" | "timeout" | "connection" | "api";

/** The provider failed, timed out, or there is no usable key: the turn says "I couldn't reach my brain…". */
export class CrisProviderError extends Error {
  constructor(readonly kind: ProviderFailure, readonly status?: number) {
    super(`Cris could not reach the model (${kind}${status ? ` ${status}` : ""})`);
    this.name = "CrisProviderError";
  }
}

/** Sonnet and Opus get Anthropic's server-side refusal fallback; Haiku has none (a declined request stays declined). */
const WITH_FALLBACK: ReadonlySet<CrisModelId> = new Set<CrisModelId>(["claude-sonnet-5-5", "claude-opus-5-5"]);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | null = null;
/** One client per server process. A short timeout and one retry: the person is waiting on a spinner. */
function anthropic(): Anthropic {
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 1 });
  return client;
}

/** The SDK's typed errors, most specific first (never matched on their text). */
function failure(err: unknown): CrisProviderError | null {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new CrisProviderError("timeout");
  if (err instanceof Anthropic.APIConnectionError) return new CrisProviderError("connection");
  if (err instanceof Anthropic.AuthenticationError) return new CrisProviderError("auth", err.status);
  if (err instanceof Anthropic.RateLimitError) return new CrisProviderError("rate-limited", err.status);
  if (err instanceof Anthropic.APIError) return new CrisProviderError("api", err.status);
  // The SDK's own errors before any request — e.g. no key set (constructing the client).
  if (err instanceof Anthropic.AnthropicError) return new CrisProviderError("no-key");
  return null;
}

/**
 * A fallback reply's blocks as the next request should echo them: only what follows the last `fallback` marker (a
 * non-streaming mid-output decline omits the declined partial, and the marker itself may be dropped), and only the
 * block types this app sends — text, thinking and tool calls — unchanged.
 */
function echoable(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.ContentBlock[] {
  let start = 0;
  content.forEach((b, i) => { if (b.type === "fallback") start = i + 1; });
  return content
    .slice(start)
    .filter((b) => b.type === "text" || b.type === "thinking" || b.type === "redacted_thinking" || b.type === "tool_use") as unknown as Anthropic.ContentBlock[];
}

export function anthropicModel(model: CrisModelId): CrisModel {
  return {
    id: model,
    async reply({ system, messages, tools }: CrisRequest): Promise<CrisReply> {
      const params = {
        model,
        max_tokens: 2000,
        system,
        messages,
        tools,
        tool_choice: { type: "auto" as const },
        output_config: { effort: "low" as const },
        // The frozen system prompt and tools, then the append-only history: each round re-reads the turn so far.
        cache_control: { type: "ephemeral" as const },
      };
      try {
        if (WITH_FALLBACK.has(model)) {
          const r = await anthropic().beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" });
          return { content: echoable(r.content), stop: r.stop_reason ?? "end_turn", usage: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
        }
        const r = await anthropic().messages.create(params);
        return { content: r.content, stop: r.stop_reason ?? "end_turn", usage: { input: r.usage.input_tokens, output: r.usage.output_tokens } };
      } catch (err) {
        const f = failure(err);
        if (!f) throw err;
        console.error(`cris: ${f.message}`);
        throw f;
      }
    },
  };
}
