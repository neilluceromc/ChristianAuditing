import { describe, expect, it } from "vitest";
import { signUpProblem } from "./signup-rules";
const ok = { name: "Ana Reyes", email: "ana.reyes@thebackroomop.com", password: "0123456789" };
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
  it("enforces the allowed domain", () =>
    expect(signUpProblem({ ...ok, email: "ana@gmail.com" }, "thebackroomop.com")).toEqual({ error: "Signup is limited to @thebackroomop.com addresses.", field: "email" }));
  it("skips the domain check when no domain is set", () =>
    expect(signUpProblem({ ...ok, email: "ana@gmail.com" }, null)).toBeNull());
  it("reports the first problem in name, email, password order", () =>
    expect(signUpProblem({ name: "", email: "x", password: "1" }, null)?.field).toBe("name"));
});
