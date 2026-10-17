import Anthropic from "@anthropic-ai/sdk";
import type { CrisModelId } from "@/lib/cris-settings";
import { inputEquivalentTokens } from "@/lib/cris-cost";
import type { CrisModel, CrisReply, CrisRequest } from "./model";

/*
 * Spec §8: the Anthropic implementation of CrisModel. One non-streaming request per round (v1 does not stream).
 * NOT "use server". The key is read from ANTHROPIC_API_KEY by the SDK — never stored, never shown.
 */

/**
 * Why a request did not get a reply. "bad-request" (HTTP 400) means the API refused what was sent — perhaps a
 * conversation history it will no longer accept, perhaps not (an exhausted credit balance or spend limit is a 400
 * too) — so the turn retries once without the history to tell which; every other kind gets "I couldn't reach my
 * brain…" (Review Focus #4). "sdk" is any other SDK error before a reply.
 */
export type ProviderFailure = "no-key" | "auth" | "bad-request" | "rate-limited" | "timeout" | "connection" | "api" | "sdk";

/** The provider failed, timed out, refused the request, or there is no usable key. */
export class CrisProviderError extends Error {
  /**
   * `type` is the API's own error type from the response body (e.g. "invalid_request_error"), for the server log
   * only. Never the message text, a header or the key.
   */
  constructor(readonly kind: ProviderFailure, readonly status?: number, readonly type?: string) {
    super(`Cris could not reach the model (${kind}${status ? ` ${status}` : ""}${type ? ` ${type}` : ""})`);
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

/** The API's error type from a response body (`{ type: "error", error: { type, message } }`), when it has one. */
function errorType(err: InstanceType<typeof Anthropic.APIError>): string | undefined {
  const type = (err.error as { error?: { type?: unknown } } | undefined)?.error?.type;
  return typeof type === "string" ? type : undefined;
}

/** The SDK's typed errors, most specific first (never matched on their text). */
function failure(err: unknown): CrisProviderError | null {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new CrisProviderError("timeout");
  if (err instanceof Anthropic.APIConnectionError) return new CrisProviderError("connection");
  if (err instanceof Anthropic.BadRequestError) return new CrisProviderError("bad-request", err.status, errorType(err));
  if (err instanceof Anthropic.AuthenticationError) return new CrisProviderError("auth", err.status, errorType(err));
  if (err instanceof Anthropic.RateLimitError) return new CrisProviderError("rate-limited", err.status, errorType(err));
  if (err instanceof Anthropic.APIError) return new CrisProviderError("api", err.status, errorType(err));
  if (err instanceof Anthropic.AnthropicError) return new CrisProviderError("sdk");
  return null;
}

/**
 * A fallback reply's blocks as the next request should echo them (the documented rule): before the LAST `fallback`
 * marker, omit only thinking, redacted_thinking and tool_use blocks; everything else, and everything after the
 * marker, echoes unchanged. The marker itself is an audit marker and is dropped.
 */
const DROPPED_BEFORE_FALLBACK: ReadonlySet<string> = new Set(["thinking", "redacted_thinking", "tool_use"]);
export function echoable(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.ContentBlock[] {
  let marker = -1;
  content.forEach((b, i) => { if (b.type === "fallback") marker = i; });
  return content.filter((b, i) => {
    if (i === marker) return false;
    return i > marker || !DROPPED_BEFORE_FALLBACK.has(b.type);
  }) as unknown as Anthropic.ContentBlock[];
}

export function anthropicModel(model: CrisModelId): CrisModel {
  return {
    id: model,
    async reply({ system, messages, tools }: CrisRequest): Promise<CrisReply> {
      // Checked here, not left to the SDK: without a key the SDK throws a plain Error, not one of its typed errors.
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error("cris: no ANTHROPIC_API_KEY is set");
        throw new CrisProviderError("no-key");
      }
      const params = {
        model,
        // Adaptive thinking counts toward max_tokens; the round cap (CRIS_MAX_ROUNDS) bounds the cost.
        max_tokens: 4000,
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
          return {
            content: echoable(r.content), stop: r.stop_reason ?? "end_turn", model: r.model,
            usage: { input: inputEquivalentTokens(r.usage), output: r.usage.output_tokens },
          };
        }
        const r = await anthropic().messages.create(params);
        return {
          content: r.content, stop: r.stop_reason ?? "end_turn", model: r.model,
          usage: { input: inputEquivalentTokens(r.usage), output: r.usage.output_tokens },
        };
      } catch (err) {
        const f = failure(err);
        if (!f) throw err;
        console.error(`cris: ${f.message}`);
        throw f;
      }
    },
  };
}
