import { describe, expect, it } from "vitest";
import { signUpProblem } from "./signup-rules";
// Users & access (spec §4.3): a password needs letters and at least one number, so the fixture has both.
const ok = { name: "Ana Reyes", email: "ana.reyes@thebackroomop.com", password: "abcdefghi1" };
describe("signUpProblem", () => {
  it("accepts a valid sign-up", () => expect(signUpProblem(ok, "thebackroomop.com")).toBeNull());
  it("needs a name of at least 2 characters after trimming", () => {
    expect(signUpProblem({ ...ok, name: "   " }, null)).toEqual({ error: "Enter your name.", field: "name" });
    expect(signUpProblem({ ...ok, name: " A " }, null)).toEqual({ error: "Enter your name.", field: "name" });
  });
  it("needs a valid email", () =>
    expect(signUpProblem({ ...ok, email: "ana@" }, null)).toEqual({ error: "Enter a valid email.", field: "email" }));
  it("needs 10+ character passwords", () =>
    expect(signUpProblem({ ...ok, password: "123456789" }, null)).toEqual({ error: "Password must be at least 10 characters.", field: "password" }));
  it("needs letters and at least one number (the shared password rules)", () => {
    expect(signUpProblem({ ...ok, password: "0123456789" }, null)).toEqual({ error: "Password must use letters and at least one number.", field: "password" });
    expect(signUpProblem({ ...ok, password: "abcdefghij" }, null)?.field).toBe("password");
  });
  it("enforces the allowed domain", () =>
    expect(signUpProblem({ ...ok, email: "ana@gmail.com" }, "thebackroomop.com")).toEqual({ error: "Signup is limited to @thebackroomop.com addresses.", field: "email" }));
  it("skips the domain check when no domain is set", () =>
    expect(signUpProblem({ ...ok, email: "ana@gmail.com" }, null)).toBeNull());
  it("reports the first problem in name, email, password order", () =>
    expect(signUpProblem({ name: "", email: "x", password: "1" }, null)?.field).toBe("name"));
});
