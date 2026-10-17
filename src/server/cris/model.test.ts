import { beforeEach, describe, expect, it, vi } from "vitest";
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

const message = (content: unknown[], stop = "end_turn") => ({
  id: "msg", type: "message", role: "assistant", model: "m", content, stop_reason: stop, stop_details: null,
  stop_sequence: null, usage: { input_tokens: 11, output_tokens: 7 }, container: null, diagnostics: null,
});
const req = { system: "S", messages: [{ role: "user", content: "hi" }] as Anthropic.MessageParam[], tools: [] };

beforeEach(() => {
  h.create.mockReset();
  h.betaCreate.mockReset();
});

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
  it("asks Haiku with the plan's request: 2000 tokens, auto tool choice, low effort, no fallback", async () => {
    h.create.mockResolvedValue(message([{ type: "text", text: "hello", citations: null }]));
    const r = await pickModel({ model: "claude-haiku-5-5" }, {}).reply(req);
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      model: "claude-haiku-5-5", max_tokens: 2000, system: "S", messages: req.messages, tools: [],
      tool_choice: { type: "auto" }, output_config: { effort: "low" },
    }));
    expect(h.create.mock.calls[0][0]).not.toHaveProperty("fallbacks");
    expect(h.betaCreate).not.toHaveBeenCalled();
    expect(r).toEqual({ content: [{ type: "text", text: "hello", citations: null }], stop: "end_turn", usage: { input: 11, output: 7 } });
  });

  it.each(["claude-sonnet-5-5", "claude-opus-5-5"] as const)("adds the server-side refusal fallback for %s", async (model) => {
    h.betaCreate.mockResolvedValue(message([{ type: "text", text: "ok", citations: null }]));
    await pickModel({ model }, {}).reply(req);
    expect(h.betaCreate).toHaveBeenCalledWith(expect.objectContaining({
      model, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", output_config: { effort: "low" },
    }));
    expect(h.create).not.toHaveBeenCalled();
  });

  it("echoes only what follows a fallback marker", async () => {
    h.betaCreate.mockResolvedValue(message([
      { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-sonnet-5" } },
      { type: "text", text: "from the fallback", citations: null },
    ]));
    const r = await pickModel({ model: "claude-sonnet-5-5" }, {}).reply(req);
    expect(r.content).toEqual([{ type: "text", text: "from the fallback", citations: null }]);
  });

  it("passes the refusal stop reason through for the turn to word", async () => {
    h.create.mockResolvedValue(message([], "refusal"));
    expect((await pickModel({ model: "claude-haiku-5-5" }, {}).reply(req)).stop).toBe("refusal");
  });

  it("turns the SDK's typed errors into a provider failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const model = pickModel({ model: "claude-haiku-5-5" }, {});
    const cases: Array<[unknown, string]> = [
      [new Anthropic_.RateLimitError(429, undefined, "slow down", new Headers()), "rate-limited"],
      [new Anthropic_.InternalServerError(529, undefined, "overloaded", new Headers()), "api"],
      [new Anthropic_.AuthenticationError(401, undefined, "bad key", new Headers()), "auth"],
      [new Anthropic_.APIConnectionTimeoutError(), "timeout"],
      [new Anthropic_.APIConnectionError({ message: "down" }), "connection"],
      [new Anthropic_.AnthropicError("no key"), "no-key"],
    ];
    for (const [err, kind] of cases) {
      h.create.mockRejectedValueOnce(err);
      const thrown = await model.reply(req).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(CrisProviderError);
      expect((thrown as InstanceType<typeof CrisProviderError>).kind).toBe(kind);
    }
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
