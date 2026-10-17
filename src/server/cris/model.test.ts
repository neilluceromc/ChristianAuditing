import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

/*
 * pickModel, the Anthropic adapter (the SDK client stubbed, its typed errors real) and the fake adapter's
 * content-block shapes.
 */

const h = vi.hoisted(() => ({
  create: vi.fn(),
  betaCreate: vi.fn(),
  options: [] as unknown[],
}));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  const Real = actual.default;
  class Stub extends Real {
    constructor(opts: ConstructorParameters<typeof Real>[0]) {
      super({ ...opts, apiKey: "test-key" });
      h.options.push(opts);
      (this as unknown as { messages: unknown }).messages = { create: h.create };
      (this as unknown as { beta: unknown }).beta = { messages: { create: h.betaCreate } };
    }
  }
  return { ...actual, default: Stub };
});

const { pickModel, CrisProviderError } = await import("./model");
const { fakeModel } = await import("./fake");
const { default: Anthropic_ } = await import("@anthropic-ai/sdk");
const { userTurn } = await import("@/lib/cris-prompt");


const message = (content: unknown[], stop = "end_turn", usage: Record<string, unknown> = { input_tokens: 11, output_tokens: 7 }, model = "claude-haiku-5-5") => ({
  id: "msg", type: "message", role: "assistant", model, content, stop_reason: stop, stop_details: null,
  stop_sequence: null, usage, container: null, diagnostics: null,
});
const req = { system: "S", messages: [{ role: "user", content: "hi" }] as Anthropic.MessageParam[], tools: [] };

beforeEach(() => {
  h.create.mockReset();
  h.betaCreate.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("pickModel (spec §8: the fake is refused in production)", () => {
  it("gives the fake with CRIS_MODEL=fake outside production", () => {
    expect(pickModel({ model: "claude-haiku-5-5" }, { CRIS_MODEL: "fake", NODE_ENV: "development" }).id).toBe("fake");
    expect(pickModel({ model: "claude-haiku-5-5" }, { CRIS_MODEL: "fake", NODE_ENV: "test" }).id).toBe("fake");
  });
  it("never gives the fake in production, even with CRIS_MODEL=fake", () => {
    expect(pickModel({ model: "claude-haiku-5-5" }, { CRIS_MODEL: "fake", NODE_ENV: "production" }).id).toBe("claude-haiku-5-5");
  });
  it("gives the admin's chosen model otherwise", () => {
    expect(pickModel({ model: "claude-opus-5-5" }, {}).id).toBe("claude-opus-5-5");
  });
});

describe("the Anthropic adapter", () => {
  it("asks Haiku with the plan's request: 4000 tokens (thinking counts), auto tool choice, low effort, no fallback", async () => {
    h.create.mockResolvedValue(message([{ type: "text", text: "hello", citations: null }]));
    const r = await pickModel({ model: "claude-haiku-5-5" }, {}).reply(req);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-haiku-5-5", max_tokens: 4000, system: "S", messages: req.messages, tools: [],
      tool_choice: { type: "auto" }, output_config: { effort: "low" },
    }));
    expect(h.create.mock.calls[0][0]).not.toHaveProperty("fallbacks");
    expect(h.betaCreate).not.toHaveBeenCalled();
    expect(r).toEqual({
      content: [{ type: "text", text: "hello", citations: null }], stop: "end_turn", model: "claude-haiku-5-5", usage: { input: 11, output: 7 },
    });
  });

  it("counts cache writes (1.25×) and reads (0.1×) into the input tokens it reports", async () => {
    h.create.mockResolvedValue(message([{ type: "text", text: "hi", citations: null }], "end_turn", {
      input_tokens: 50, output_tokens: 9, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30_000,
    }));
    const r = await pickModel({ model: "claude-haiku-5-5" }, {}).reply(req);
    expect(r.usage).toEqual({ input: 50 + 2500 + 3000, output: 9 });
  });

  it.each(["claude-sonnet-5-5", "claude-opus-5-5"] as const)("adds the server-side refusal fallback for %s", async (model) => {
    h.betaCreate.mockResolvedValue(message([{ type: "text", text: "ok", citations: null }], "end_turn", undefined, model));
    await pickModel({ model }, {}).reply(req);
    expect(h.betaCreate).toHaveBeenCalledWith(expect.objectContaining({
      model, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "low" },
    }));
    expect(h.create).not.toHaveBeenCalled();
  });

  it("reports the model that served a fallback reply, with its cache tokens counted", async () => {
    h.betaCreate.mockResolvedValue(message([{ type: "text", text: "ok", citations: null }], "end_turn",
      { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: null }, "claude-sonnet-5"));
    const r = await pickModel({ model: "claude-sonnet-5-5" }, {}).reply(req);
    expect(r.model).toBe("claude-sonnet-5");
    expect(r.usage).toEqual({ input: 20, output: 1 });
  });

  it("echoes a fallback reply by the documented rule: before the last marker only thinking and tool calls go", async () => {
    const before = [
      { type: "thinking", thinking: "", signature: "s1" },
      { type: "text", text: "partial", citations: null },
      { type: "redacted_thinking", data: "x" },
      { type: "tool_use", id: "t0", name: "find_people", input: { q: "a" }, caller: { type: "direct" } },
      { type: "some_future_block", value: 1 },
    ];
    const after = [
      { type: "thinking", thinking: "", signature: "s2" },
      { type: "text", text: "from the fallback", citations: null },
      { type: "tool_use", id: "t1", name: "find_people", input: { q: "b" }, caller: { type: "direct" } },
    ];
    h.betaCreate.mockResolvedValue(message([...before, { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-sonnet-5" } }, ...after]));
    const r = await pickModel({ model: "claude-sonnet-5-5" }, {}).reply(req);
    expect(r.content).toEqual([before[1], before[4], ...after]);
  });

  it("leaves a reply with no fallback marker exactly as it came", async () => {
    const content = [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: "ok", citations: null }];
    h.betaCreate.mockResolvedValue(message(content));
    expect((await pickModel({ model: "claude-opus-5-5" }, {}).reply(req)).content).toEqual(content);
  });

  it("passes the refusal stop reason through for the turn to word", async () => {
    h.create.mockResolvedValue(message([], "refusal"));
    expect((await pickModel({ model: "claude-haiku-5-5" }, {}).reply(req)).stop).toBe("refusal");
  });

  it("fails as no-key, before any request, when no key is set", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const thrown = await pickModel({ model: "claude-haiku-5-5" }, {}).reply(req).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(CrisProviderError);
    expect((thrown as InstanceType<typeof CrisProviderError>).kind).toBe("no-key");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("turns the SDK's typed errors into a provider failure, a 400 as its own kind", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const model = pickModel({ model: "claude-haiku-5-5" }, {});
    const cases: Array<[unknown, string]> = [
      [new Anthropic_.BadRequestError(400, undefined, "thinking block mismatch", new Headers()), "bad-request"],
      [new Anthropic_.RateLimitError(429, undefined, "slow down", new Headers()), "rate-limited"],
      [new Anthropic_.InternalServerError(529, undefined, "overloaded", new Headers()), "api"],
      [new Anthropic_.AuthenticationError(401, undefined, "bad key", new Headers()), "auth"],
      [new Anthropic_.APIConnectionTimeoutError(), "timeout"],
      [new Anthropic_.APIConnectionError({ message: "down" }), "connection"],
      [new Anthropic_.AnthropicError("other"), "sdk"],
    ];
    for (const [err, kind] of cases) {
      h.create.mockRejectedValueOnce(err);
      const thrown = await model.reply(req).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(CrisProviderError);
      expect((thrown as InstanceType<typeof CrisProviderError>).kind).toBe(kind);
    }
  });

  it("carries the API's error type (for the log) and the status, never the message text", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low" } };
    h.create.mockRejectedValueOnce(new Anthropic_.BadRequestError(400, body, "Your credit balance is too low", new Headers()));
    const thrown = (await pickModel({ model: "claude-haiku-5-5" }, {}).reply(req).catch((e: unknown) => e)) as InstanceType<typeof CrisProviderError>;
    expect(thrown).toMatchObject({ kind: "bad-request", status: 400, type: "invalid_request_error" });
    expect(thrown.message).toBe("Cris could not reach the model (bad-request 400 invalid_request_error)");
    expect(logged.mock.calls.flat().join(" ")).not.toContain("credit balance");
  });

  it("lets anything that isn't the SDK's error surface as it is", async () => {
    h.create.mockRejectedValueOnce(new TypeError("bug"));
    await expect(pickModel({ model: "claude-haiku-5-5" }, {}).reply(req)).rejects.toThrow(TypeError);
  });
});


describe("the fake adapter answers in the API's shapes", () => {
  const ctx = { firstName: "Neil", todayManila: "Saturday 17 October 2026", page: { path: "/", employeeId: null, assetId: null } };

  it("calls a tool with a tool_use block and the tool_use stop reason", async () => {
    const r = await fakeModel.reply({ system: "S", tools: [], messages: [userTurn(ctx, "Check Ana Reyes's items")] });
    expect(r.stop).toBe("tool_use");
    expect(r.content).toEqual([{ type: "tool_use", id: "toolu_fake_1", name: "find_people", input: { q: "Ana Reyes" }, caller: { type: "direct" } }]);
  });

  it("reads this turn's tool results and earlier turns from the messages", async () => {
    const people = { people: [{ employeeId: "e-ana", name: "Ana Reyes", employeeNo: "EMP-0101" }], picked: true };
    const holdings = { person: { name: "Ana Reyes" }, items: [{ assetId: "a1", tag: "BR-LT-0148", model: "Dell", type: "Laptop" }], gaps: [], holds: [] };
    const messages: Anthropic.MessageParam[] = [
      userTurn(ctx, "Check Ana Reyes's items"),
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "find_people", input: { q: "Ana Reyes" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: JSON.stringify(people) }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t2", name: "get_holdings", input: { employeeId: "e-ana" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: JSON.stringify(holdings) }] },
    ];
    const r = await fakeModel.reply({ system: "S", tools: [], messages });
    expect(r.stop).toBe("end_turn");
    expect(r.content).toEqual([{ type: "text", text: "Ana Reyes has 1 item: BR-LT-0148 (Dell).", citations: null }]);
    expect(r.usage).toEqual({ input: 0, output: 0 });
  });
});
