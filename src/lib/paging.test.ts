import { describe, expect, it } from "vitest";
import { ENTITY_PAGE_SIZE, LOG_PAGE_SIZE, pageOf, parsePage } from "./paging";

describe("pageOf", () => {
  it("names the two sizes the app already uses", () => {
    expect(ENTITY_PAGE_SIZE).toBe(25);
    expect(LOG_PAGE_SIZE).toBe(50);
  });
  it("an empty list is one empty page", () => {
    expect(pageOf(0, 1, 25)).toEqual({ page: 1, pageCount: 1, skip: 0, take: 25, total: 0 });
  });
  it("clamps below 1 and above the last page", () => {
    expect(pageOf(60, 0, 25).page).toBe(1);
    expect(pageOf(60, 99, 25)).toEqual({ page: 3, pageCount: 3, skip: 50, take: 25, total: 60 });
  });
  it("an exact multiple has no empty trailing page", () => {
    expect(pageOf(50, 2, 25)).toEqual({ page: 2, pageCount: 2, skip: 25, take: 25, total: 50 });
    expect(pageOf(50, 3, 25).page).toBe(2);
  });
});

describe("parsePage", () => {
  it("mirrors parseListState's lower clamp", () => {
    expect(parsePage(new URLSearchParams(""))).toBe(1);
    expect(parsePage(new URLSearchParams("page=4"))).toBe(4);
    expect(parsePage(new URLSearchParams("page=0"))).toBe(1);
    expect(parsePage(new URLSearchParams("page=abc"))).toBe(1);
  });
});
