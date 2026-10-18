import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { defaultClassFor } from "./asset-class";
import { currentNav, type NavCurrent } from "./nav-match";
import { filterSectionsForRole, WORKSPACE_NAV, type WorkspaceId } from "./workspaces";

/** Spec §4.2, as the Task 2 brief tabulates it: [workspace, role, url] → current link and view (labels). */
const CASES: Array<[WorkspaceId, Role, string, string | null, string | null]> = [
  ["it", "it_staff", "/inventory", "Inventory", "All"],
  ["it", "it_staff", "/inventory?page=2&q=dell&sort=tag&purchaseYear=2024", "Inventory", "All"],
  ["it", "it_staff", "/inventory?status=SPARE&sort=tag", "Inventory", "Spare"],
  ["it", "it_staff", "/inventory?status=DEFECTIVE&sort=tag,defectiveSince", "Inventory", "Repairs"],
  ["it", "it_staff", "/inventory?status=SPARE,MISSING", "Inventory", null],
  ["it", "it_staff", "/inventory?category=x", "Inventory", "All"],
  ["it", "it_staff", "/inventory/abc", "Inventory", null],
  ["it", "it_staff", "/inventory/register", "Inventory", "Register assets"],
  ["it", "it_staff", "/inventory/work", "Worklist", null],
  ["it", "it_staff", "/inventory/activity", "Activity", "Inventory activity"],
  ["it", "it_staff", "/admin/asset-types", "Setup", "Asset types"],
  ["it", "viewer", "/admin/equipment-policies", "Setup", null],
  ["it", "it_staff", "/approvals?tab=open", "Approvals", "Open"],
  ["it", "it_staff", "/approvals?tab=failed", "Approvals", null],
  ["it", "it_staff", "/purchases?state=SUBMITTED", "Approvals", "Purchase reviews"],
  ["it", "it_staff", "/reservations?state=ACTIVE", "Reservations", "Active"],
  ["it", "it_staff", "/equipment-by-client", "Reports", "By client"],
  ["it", "it_staff", "/equipment-by-client?tab=internal", "Reports", "Internal teams"],
  ["it", "it_staff", "/employees/abc", "Employees", null],
  ["it", "it_staff", "/", "Home", null],
  ["it", "it_staff", "/settings/cris", null, null],
  ["purchasing", "purchasing_staff", "/inventory?sort=tag", "Assets", "Purchasing assets"],
  ["purchasing", "admin", "/inventory", "Assets", "IT inventory"],
  ["purchasing", "purchasing_staff", "/inventory/xyz", "Assets", null],
  ["purchasing", "purchasing_staff", "/purchases?state=CANCELLED", "Requests", null],
  ["purchasing", "purchasing_staff", "/purchases?state=IT_REVIEWED", "Requests", "Awaiting finance"],
  ["purchasing", "purchasing_staff", "/stock/stocktakes/xyz", "Stock", "Stocktakes"],
  ["purchasing", "purchasing_staff", "/stock/categories", "Setup", "Stock categories"],
];

describe("currentNav (spec §4.2)", () => {
  it.each(CASES)("%s / %s on %s → %s, %s", (ws, role, url, item, view) => {
    const [pathname, query = ""] = url.split("?");
    const sections = filterSectionsForRole(WORKSPACE_NAV[ws], role);
    const got: NavCurrent = currentNav(sections, pathname, new URLSearchParams(query), defaultClassFor(role));
    expect(got).toEqual({ item, view });
  });
});
