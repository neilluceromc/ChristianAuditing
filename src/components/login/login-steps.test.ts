import { describe, expect, it } from "vitest";
import {
  crisLine,
  emailProblem,
  errorLine,
  firstFromEmail,
  firstWord,
  initialStep,
  initials,
  isBackward,
  stepForField,
} from "./login-steps";

describe("initialStep", () => {
  it("starts on Welcome unless the login step is asked for", () => {
    expect(initialStep("login", undefined)).toBe("welcome");
    expect(initialStep("login", "login")).toBe("login-email");
    expect(initialStep("login", "admin")).toBe("welcome");
  });
  it("starts sign-up on its first step", () => {
    expect(initialStep("signup", undefined)).toBe("signup-name");
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

describe("names and initials", () => {
  it("makes initials from the local part", () => {
    expect(initials("neil.lucero@thebackroomop.com")).toBe("NL");
    expect(initials("it@thebackroomop.com")).toBe("I");
    expect(initials("@x.com")).toBe("?");
  });
  it("takes the first name from the email's local part", () => {
    expect(firstFromEmail("neil.lucero@x.com")).toBe("Neil");
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
  it("has no line on Welcome", () => expect(crisLine("welcome", { email: "", name: "" })).toBeNull());
  it("greets each step", () => {
    expect(crisLine("login-email", { email: "", name: "" })).toBe("Hi again! What's your work email?");
    expect(crisLine("signup-name", { email: "", name: "" })).toBe("Hi, I'm Cris! Let's set up your account.");
    expect(crisLine("signup-done", { email: "", name: "" })).toBe("You're all set! An admin will give you a role soon.");
  });
  it("names the person on the password step when the email gives a first name", () => {
    expect(crisLine("login-password", { email: "neil.lucero@x.com", name: "" })).toBe(
      "Thanks, Neil. Now your password. I won't peek.",
    );
    expect(crisLine("login-password", { email: "", name: "" })).toBe("Thanks. Now your password. I won't peek.");
  });
  it("uses the first word of the name on the sign-up password step", () =>
    expect(crisLine("signup-password", { email: "", name: "Ana Reyes" })).toBe(
      "Nice to meet you, Ana. Pick a password with at least 10 characters.",
    ));
});

describe("errorLine", () => {
  it("prefixes the message with Hmm.", () => expect(errorLine("Enter your name.")).toBe("Hmm. Enter your name."));
});

describe("isBackward", () => {
  it("is backward on the way to Welcome from any other step", () => {
    expect(isBackward("login-email", "welcome")).toBe(true);
    expect(isBackward("welcome", "welcome")).toBe(false);
  });
  it("is backward for an earlier step in the same flow", () => {
    expect(isBackward("login-password", "login-email")).toBe(true);
    expect(isBackward("signup-password", "signup-name")).toBe(true);
    expect(isBackward("login-email", "login-password")).toBe(false);
  });
  it("treats a move between the two flows as forward", () => {
    expect(isBackward("signup-name", "login-email")).toBe(false);
    expect(isBackward("welcome", "signup-name")).toBe(false);
  });
});
