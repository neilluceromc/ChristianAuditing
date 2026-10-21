import { describe, expect, it } from "vitest";
import {
  FACTS,
  crisLine,
  emailProblem,
  enterLines,
  errorLine,
  firstFromEmail,
  firstWord,
  initialStep,
  nextFact,
  segments,
  sequenceEmail,
  stepForField,
} from "./login-steps";

describe("initialStep", () => {
  it("opens /login on the sign-in form and /signup on its first step", () => {
    expect(initialStep("login")).toBe("login");
    expect(initialStep("signup")).toBe("signup-name");
  });
});

describe("segments", () => {
  it("has no progress bars on the sign-in form", () => expect(segments("login")).toEqual([]));
  it("shows three bars through sign-up, done ones before the current", () => {
    expect(segments("signup-name")).toEqual(["on", "", ""]);
    expect(segments("signup-password")).toEqual(["done", "on", ""]);
    expect(segments("signup-done")).toEqual(["done", "done", "on"]);
  });
});

describe("emailProblem", () => {
  it("asks for an email when empty", () => expect(emailProblem("", null)).toBe("Enter your work email."));
  it("rejects text that is not an email", () =>
    expect(emailProblem("neil@", null)).toBe("That doesn't look like an email address. Check for typos."));
  it("checks the allowed domain", () => {
    expect(emailProblem("neil@gmail.com", "thebackroomop.com")).toBe("Use your @thebackroomop.com email.");
    expect(emailProblem("a@x.thebackroomop.com", "thebackroomop.com")).toBe("Use your @thebackroomop.com email.");
  });
  it("trims and ignores case when matching the domain", () =>
    expect(emailProblem("  Neil.Lucero@TheBackroomOp.com ", "thebackroomop.com")).toBe(""));
  it("accepts any well-formed email when no domain is set", () => expect(emailProblem("neil@gmail.com", null)).toBe(""));
});

describe("names", () => {
  it("takes the first name from the email's local part", () => {
    expect(firstFromEmail("neil.lucero@x.com")).toBe("Neil");
    expect(firstFromEmail("IT@x.com")).toBe("It");
    expect(firstFromEmail("@x.com")).toBe("");
  });
  it("takes the first word of a name", () => expect(firstWord("  Ana  Reyes ")).toBe("Ana"));
});

describe("stepForField", () => {
  it("sends name and email to sign-up 1 and password to sign-up 2", () => {
    expect(stepForField("name")).toBe("signup-name");
    expect(stepForField("email")).toBe("signup-name");
    expect(stepForField("password")).toBe("signup-password");
  });
});

describe("crisLine", () => {
  const none = { email: "", name: "" };
  it("greets the sign-in form and each sign-up step", () => {
    expect(crisLine("login", none)).toBe("Hi again! What's your work email?");
    expect(crisLine("signup-name", none)).toBe("Hi, I'm Cris! Let's set up your account.");
    expect(crisLine("signup-done", none)).toBe("Account created! An admin will take it from here.");
  });
  it("names the person when they reach the password with an email that gives a first name", () => {
    expect(crisLine("login-password", { email: "neil.lucero@x.com", name: "" })).toBe(
      "Thanks, Neil. Now your password. I won't peek.",
    );
    expect(crisLine("login-password", none)).toBe("Thanks. Now your password. I won't peek.");
  });
  it("uses the first word of the name on the sign-up password step", () => {
    expect(crisLine("signup-password", { email: "", name: "Ana Reyes" })).toBe(
      "Nice to meet you, Ana. Pick a password with at least 10 characters.",
    );
    expect(crisLine("signup-password", none)).toBe("Nice to meet you. Pick a password with at least 10 characters.");
  });
});

describe("errorLine", () => {
  it("prefixes the message with Hmm.", () => expect(errorLine("Enter your name.")).toBe("Hmm. Enter your name."));
});

describe("enterLines", () => {
  it("talks through loading the workspace, the progress bar only ever running forward", () => {
    const lines = enterLines("Neil");
    expect(lines.map((l) => l.text)).toEqual([
      "Checking your badge…",
      "Unlocking the stockroom…",
      "Counting your assets…",
      "Welcome back, Neil!",
      "Opening your dashboard…",
    ]);
    const bars = lines.map((l) => l.bar);
    expect([...bars].sort((a, b) => a - b)).toEqual(bars);
    expect(bars.at(-1)).toBe(1);
  });
  it("welcomes without a name when there is none (Microsoft)", () => expect(enterLines("")[3]!.text).toBe("Welcome back!"));
});

describe("sequenceEmail", () => {
  it("a password sign-in shows the typed email, trimmed", () => {
    expect(sequenceEmail(true, "  neil.lucero@x.com ")).toBe("neil.lucero@x.com");
  });
  it("a Microsoft sign-in shows none, whatever was typed (final review)", () => {
    expect(sequenceEmail(false, "someone.else@x.com")).toBe("");
  });
});

describe("FACTS", () => {
  it("names no real people (owner's decision, 2026-10-21)", () => {
    const text = FACTS.map((f) => `${f.q} ${f.a ?? ""}`).join(" ");
    for (const name of ["Neil", "Salem", "Princess", "Christian", "Sir ", "Miss "]) expect(text).not.toContain(name);
    // nor points at one (final review): the creator is a real person
    expect(text.toLowerCase()).not.toContain("creator");
    expect(FACTS.length).toBeGreaterThan(0);
  });
});

describe("nextFact", () => {
  const first = () => 0; // a fixed shuffle
  it("deals every fact once before any repeats", () => {
    let bag: number[] = [];
    let last: number | null = null;
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nextFact(bag, last, 5, first);
      seen.push(r.index);
      bag = r.bag;
      last = r.index;
    }
    expect(new Set(seen).size).toBe(4);
  });
  it("never tells the same fact twice in a row when a new bag starts", () => {
    for (let last = 0; last < 3; last++) expect(nextFact([], last, 3, Math.random).index).not.toBe(last);
  });
  it("still deals the only fact there is", () => expect(nextFact([], 0, 1).index).toBe(0));
});
