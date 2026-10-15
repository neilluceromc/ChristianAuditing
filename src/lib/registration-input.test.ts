import { describe, expect, it } from "vitest";
import { approveSchema, resubmitSchema, sendBackSchema } from "./registration-input";

describe("sendBackSchema", () => {
  it("accepts ticked fields with or without a note", () => {
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost", "doc:invoice"] }).success).toBe(true);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost"], note: "Invoice is for PO-90" }).success).toBe(true);
  });
  it("refuses none ticked, unknown or duplicate keys (Review Focus 4)", () => {
    expect(sendBackSchema.safeParse({ id: "a", fields: [] }).success).toBe(false);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost", "hacker"] }).success).toBe(false);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost", "cost"] }).success).toBe(false);
  });
  it("Other needs a note; a note is 3-500 characters", () => {
    expect(sendBackSchema.safeParse({ id: "a", fields: ["other"] }).success).toBe(false);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["other"], note: "Box was opened" }).success).toBe(true);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost"], note: "no" }).success).toBe(false);
    expect(sendBackSchema.safeParse({ id: "a", fields: ["cost"], note: "x".repeat(501) }).success).toBe(false);
  });
});

describe("resubmitSchema / approveSchema", () => {
  it("reply optional, 3-500 when given", () => {
    expect(resubmitSchema.safeParse({ id: "a" }).success).toBe(true);
    expect(resubmitSchema.safeParse({ id: "a", reply: "" }).success).toBe(true);
    expect(resubmitSchema.safeParse({ id: "a", reply: "ok" }).success).toBe(false);
    expect(resubmitSchema.safeParse({ id: "a", reply: "Uploaded the right invoice" }).success).toBe(true);
  });
  it("approve takes an optional notCapitalised flag", () => {
    expect(approveSchema.safeParse({ id: "a" }).success).toBe(true);
    expect(approveSchema.safeParse({ id: "a", notCapitalised: true }).success).toBe(true);
  });
});
