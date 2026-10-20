import { describe, expect, it } from "vitest";
import { ENTITY_PAGE_SIZE, LOG_PAGE_SIZE, PER_PAGE_OPTIONS, pageOf, parseIntParam, parsePage, rowsRange } from "./paging";

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

describe("parseIntParam", () => {
  it("parses an integer param and falls back on absence or garbage", () => {
    expect(parseIntParam(new URLSearchParams("skip=7"), "skip", 0)).toBe(7);
    expect(parseIntParam(new URLSearchParams(""), "skip", 0)).toBe(0);
    expect(parseIntParam(new URLSearchParams("skip=abc"), "skip", 0)).toBe(0);
    expect(parseIntParam(new URLSearchParams("page=0"), "page", 1)).toBe(1); // `||` reads 0 as absent — the behaviour both hand-rolled versions already had (ruling R4)
  });
});

describe("PER_PAGE_OPTIONS", () => {
  it("offers 25, 50 and 100, the first being the default size", () => {
    expect([...PER_PAGE_OPTIONS]).toEqual([25, 50, 100]);
    expect(PER_PAGE_OPTIONS[0]).toBe(ENTITY_PAGE_SIZE);
  });
});

describe("rowsRange", () => {
  it("is the 1-based first and last row on the page", () => {
    expect(rowsRange(1, 25, 900)).toEqual({ from: 1, to: 25 });
    expect(rowsRange(36, 25, 900)).toEqual({ from: 876, to: 900 });
    expect(rowsRange(2, 50, 120)).toEqual({ from: 51, to: 100 });
  });
  it("is 0-0 for an empty list", () => {
    expect(rowsRange(1, 25, 0)).toEqual({ from: 0, to: 0 });
  });
});
