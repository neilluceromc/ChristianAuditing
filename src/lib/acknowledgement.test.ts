import { describe, expect, it } from "vitest";
import { ackRow, latestSigningDate, uncoveredItems } from "./acknowledgement";

const held = [{ assetId: "a", tag: "BR-LT-0001" }, { assetId: "b", tag: "BR-MN-0002" }];
describe("uncoveredItems (Phase 16 §6)", () => {
  it("no record on file: everything held is uncovered", () => {
    expect(uncoveredItems(held, null).map((h) => h.tag)).toEqual(["BR-LT-0001", "BR-MN-0002"]);
  });
  it("a full match covers everything", () => {
    expect(uncoveredItems(held, [{ assetId: "a" }, { assetId: "b" }])).toEqual([]);
  });
  it("items issued since the last signature are named", () => {
    expect(uncoveredItems(held, [{ assetId: "a" }]).map((h) => h.tag)).toEqual(["BR-MN-0002"]);
  });
});

describe("latestSigningDate (ruling R10)", () => {
  it("returns the UTC calendar date one day after now", () => {
    expect(latestSigningDate(new Date("2026-09-07T19:00:00Z"))).toBe("2026-09-08");
  });
  it("rolls over year boundaries", () => {
    expect(latestSigningDate(new Date("2026-12-31T10:00:00Z"))).toBe("2027-01-01");
  });
});

describe("ackRow (the signed-form history loader; document preview Task 1)", () => {
  it("keeps the signed date and items, and adds when the form was uploaded (createdAt) and who recorded it", () => {
    const signedAt = new Date("2026-10-20T00:00:00Z");
    const items = [{ assetId: "a", tag: "BR-LT-0001", model: "Latitude", serial: null }];
    const row = {
      id: "k1", employeeId: "e1", signedAt, items, fileName: "signed.pdf", path: "acks/e1/1-signed.pdf", checksum: "abc",
      recordedById: "u1", createdAt: new Date("2026-10-22T01:41:00Z"), recordedBy: { name: "Ivan Tan" },
    };
    expect(ackRow(row)).toEqual({
      id: "k1", signedAt, items, fileName: "signed.pdf", uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: "Ivan Tan",
    });
  });

  it("a missing recorder reads as a null uploader", () => {
    const row = ackRow({ id: "k1", signedAt: new Date(), items: [], fileName: "f.pdf", createdAt: new Date("2026-10-22T01:41:00Z"), recordedBy: null });
    expect(row.uploadedBy).toBeNull();
  });
});
