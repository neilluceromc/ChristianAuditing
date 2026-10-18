import { describe, expect, it } from "vitest";
import { PREVIEW_ABOUT, PREVIEW_LINES, asksWhatCrisDoes, previewReply } from "./cris-preview";

describe("previewReply (preview mode: no key, placeholder replies only)", () => {
  it("has the five owner's lines and the about line, word for word", () => {
    expect(PREVIEW_LINES).toEqual([
      "Hello! I'm Cris — I'm still in development. Soon I'll check items, assign and replace laptops for you.",
      "Hi there! I'm still learning the ropes. For now, the screens do everything I'll soon help with.",
      "Thanks for saying hi! I'm still in development, so I can't look anything up yet.",
      "I'm Cris, your IT inventory assistant — still in training. Check back soon!",
      "Good to meet you! I'm a preview for now: I can chat, but I can't see or change any records yet.",
    ]);
    expect(PREVIEW_ABOUT).toBe(
      "Soon I'll check someone's items, assign and replace laptops, find who has a tag, and list spares in stock — every change waiting for your Confirm. For now I'm a preview, so I can only chat.",
    );
  });

  it("picks a line by the index it is given, wrapping round", () => {
    expect(previewReply("Hello!", 0)).toBe(PREVIEW_LINES[0]);
    expect(previewReply("Hello!", 3)).toBe(PREVIEW_LINES[3]);
    expect(previewReply("Hello!", 5)).toBe(PREVIEW_LINES[0]);
    expect(previewReply("Hello!", 7)).toBe(PREVIEW_LINES[2]);
  });

  it("never fails on an odd index", () => {
    expect(previewReply("hey", -1)).toBe(PREVIEW_LINES[4]);
    expect(previewReply("hey", 2.7)).toBe(PREVIEW_LINES[2]);
    expect(previewReply("hey", Number.NaN)).toBe(PREVIEW_LINES[0]);
    expect(previewReply("hey", Number.POSITIVE_INFINITY)).toBe(PREVIEW_LINES[0]);
  });

  it("answers what Cris will do when asked, whatever the index", () => {
    for (const q of ["What will you do?", "what can you do", "Can you help me?", "HELP", "Can you replace Ana's laptop?", "what's this?"]) {
      expect(previewReply(q, 0)).toBe(PREVIEW_ABOUT);
      expect(previewReply(q, 4)).toBe(PREVIEW_ABOUT);
    }
  });

  it("reads only whole words", () => {
    expect(asksWhatCrisDoes("Hello!")).toBe(false);
    expect(asksWhatCrisDoes("Good morning")).toBe(false);
    expect(asksWhatCrisDoes("helpful")).toBe(false);
    expect(asksWhatCrisDoes("Whatever")).toBe(false);
    expect(asksWhatCrisDoes("doing great")).toBe(false);
    expect(asksWhatCrisDoes("I can't wait")).toBe(false);
    expect(asksWhatCrisDoes("what")).toBe(true);
    expect(asksWhatCrisDoes("how do I start")).toBe(true);
    expect(asksWhatCrisDoes("can you")).toBe(true);
  });
});
