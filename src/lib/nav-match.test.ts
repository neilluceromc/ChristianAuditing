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
  // Repair mode (isRepairView): DEFECTIVE as the only status, or any repair stage — the stage chips clear status.
  ["it", "it_staff", "/inventory?stage=at-vendor&sort=defectiveSince", "Inventory", "Repairs"],
  ["it", "it_staff", "/inventory?stage=returned-ok", "Inventory", "Repairs"],
  ["it", "it_staff", "/inventory?stage=to-assess,beyond-repair", "Inventory", "Repairs"],
  ["it", "it_staff", "/inventory?status=DEFECTIVE&stage=to-assess", "Inventory", "Repairs"],
  ["it", "it_staff", "/inventory?status=DEFECTIVE,SPARE", "Inventory", null],
  ["it", "it_staff", "/inventory?stage=bogus", "Inventory", null],
  // A class other than the viewer's default, with no view matching on cls: no view (the counts are the default's).
  ["it", "admin", "/inventory?cls=PURCHASING", "Inventory", null],
  ["it", "admin", "/inventory?cls=PURCHASING&status=SPARE", "Inventory", null],
  ["it", "admin", "/inventory?cls=IT", "Inventory", "All"],
  ["it", "admin", "/inventory?cls=IT&status=SPARE", "Inventory", "Spare"],
  // Only the list itself is class-scoped: the Register page keeps its view whatever class it registers.
  ["it", "admin", "/inventory/register?cls=PURCHASING", "Inventory", "Register assets"],
  // An empty param is absent.
  ["it", "it_staff", "/inventory?status=", "Inventory", "All"],
  ["it", "it_staff", "/approvals?tab=", "Approvals", "Open"],
  ["purchasing", "purchasing_staff", "/inventory?cls=", "Assets", "Purchasing assets"],
  ["it", "it_staff", "/inventory?category=x", "Inventory", "All"],
  ["it", "it_staff", "/inventory/abc", "Inventory", null],
  ["it", "it_staff", "/inventory/register", "Inventory", "Register assets"],
  ["it", "it_staff", "/inventory/work", "Worklist", null],
  ["it", "it_staff", "/inventory/activity", "Activity", "Inventory activity"],
  ["it", "it_staff", "/admin/asset-types", "Setup", "Asset types"],
  ["it", "viewer", "/admin/equipment-policies", "Setup", null],
  ["it", "it_staff", "/approvals?tab=open", "Approvals", "Open"],
  ["it", "it_staff", "/approvals?tab=failed", "Approvals", null],
  // Migration 38: IT's purchase reviews moved off Approvals onto their own Purchase orders link.
  ["it", "it_staff", "/purchases?state=WITH_IT", "Purchase orders", null],
  ["it", "it_staff", "/reservations?state=ACTIVE", "Reservations", "Active"],
  ["it", "it_staff", "/equipment-by-client", "Reports", "By client"],
  ["it", "it_staff", "/equipment-by-client?tab=internal", "Reports", "Internal teams"],
  ["it", "it_staff", "/employees/abc", "Employees", null],
  ["it", "it_staff", "/", "Home", null],
  ["it", "it_staff", "/settings/cris", null, null],
  ["purchasing", "purchasing_staff", "/inventory?sort=tag", "Assets", "Purchasing assets"],
  ["purchasing", "admin", "/inventory", "Assets", "IT inventory"],
  ["purchasing", "purchasing_staff", "/inventory/xyz", "Assets", null],
  ["purchasing", "purchasing_staff", "/purchases?state=CANCELLED", "Purchase orders", "Cancelled"],
  // Task 7: Purchasing's view is To register (a mixed PO still with IT included); the READY tab is the page's own.
  ["purchasing", "purchasing_staff", "/purchases?state=READY", "Purchase orders", null],
  ["purchasing", "purchasing_staff", "/purchases?register=1", "Purchase orders", "To register"],
  ["purchasing", "purchasing_staff", "/inventory?reg=needs-correction&to=PURCHASING", "Assets", "Sent back"],
  ["it", "it_staff", "/inventory?reg=needs-correction&to=IT", "Inventory", "Sent back"],
  ["it", "it_staff", "/inventory?reg=needs-correction", "Inventory", null],
  ["purchasing", "purchasing_staff", "/purchases?state=DRAFT", "Purchase orders", null],
  ["purchasing", "purchasing_staff", "/stock/stocktakes/xyz", "Stock", "Stocktakes"],
  ["purchasing", "purchasing_staff", "/stock/categories", "Setup", "Stock categories"],
  // Phase 46 spec §4.3: the new views.
  ["purchasing", "purchasing_staff", "/stock", "Stock", "Items"],
  ["purchasing", "purchasing_staff", "/stock?low=1", "Stock", "Below reorder"],
  ["purchasing", "purchasing_staff", "/purchases/suppliers?renewing=30", "Suppliers", "Renewing soon"],
  ["purchasing", "purchasing_staff", "/employees?kind=INTERNAL", "Employees", "Internal staff"],
  ["purchasing", "purchasing_staff", "/approvals?tab=closed", "Approvals", "Closed"],
  ["finance", "finance_staff", "/finance/assets", "Assets", "All assets"],
  ["finance", "finance_staff", "/finance/assets?fin=with-finance", "Assets", "To confirm · IT"],
  ["finance", "finance_staff", "/finance/assets?cls=PURCHASING&fin=with-finance", "Assets", "To confirm · Purchasing"],
  ["finance", "finance_staff", "/finance/assets?fin=approved&page=2", "Assets", "Capitalized"],
  // Fix round 1 ruling: the whole Purchasing class (no fin) is All assets, so the nav keeps aria-current there.
  ["finance", "finance_staff", "/finance/assets?cls=PURCHASING", "Assets", "All assets"],
  ["finance", "finance_staff", "/finance/assets?cls=PURCHASING&q=dell&page=2", "Assets", "All assets"],
  // The IT views name their class (the page default): another class lights none of them.
  ["finance", "finance_staff", "/finance/assets?cls=PURCHASING&fin=approved", "Assets", null],
  ["finance", "finance_staff", "/finance/assets?fin=no-cost", "Assets", null],
  ["finance", "finance_staff", "/finance/depreciation?tab=schedule&year=2026&cls=IT", "Depreciation", "Schedule"],
  ["finance", "finance_staff", "/finance/depreciation?tab=policies", "Depreciation", "Policies"],
  ["finance", "finance_staff", "/purchases/suppliers?contract=EXPIRED", "Suppliers", "Expired contracts"],
  ["finance", "finance_staff", "/purchases/suppliers?contract=SUSPENDED", "Suppliers", null],
  ["finance", "finance_staff", "/stock/reports/expiry", "Stock", "Reports"],
  ["admin", "admin", "/admin/users", "Users & roles", "All users"],
  ["admin", "admin", "/admin/users?disabled=1&page=2", "Users & roles", "Disabled"],
  ["admin", "admin", "/admin/users?disabled=0", "Users & roles", null],
  ["admin", "admin", "/admin/webhooks", "Webhooks", "Endpoints"],
  ["admin", "admin", "/admin/webhooks/deliveries", "Webhooks", "All deliveries"],
  ["admin", "admin", "/admin/webhooks/deliveries?state=ALL", "Webhooks", "All deliveries"],
  ["admin", "admin", "/admin/webhooks/deliveries?state=DEAD", "Webhooks", "Failed deliveries"],
  ["admin", "admin", "/admin/webhooks/deliveries?state=PENDING", "Webhooks", null],
  ["admin", "admin", "/admin/flags?state=unavailable", "Feature flags", "Unavailable"],
  ["admin", "admin", "/audit", "Audit log", null],
];

describe("currentNav (spec §4.2)", () => {
  it.each(CASES)("%s / %s on %s → %s, %s", (ws, role, url, item, view) => {
    const [pathname, query = ""] = url.split("?");
    const sections = filterSectionsForRole(WORKSPACE_NAV[ws], role);
    const got: NavCurrent = currentNav(sections, pathname, new URLSearchParams(query), defaultClassFor(role));
    expect(got).toEqual({ item, view });
  });
});
