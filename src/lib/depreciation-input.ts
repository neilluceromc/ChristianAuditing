import { z } from "zod";

/** Phase 35 (spec §5.4-5.5): the depreciation settings' input rules, shared by the forms and the actions. */
export const MAX_LIFE_MONTHS = 600;

export function lifeFromYearsMonths(years: string, months: string): number | null | "bad" {
  const y = years.trim(), m = months.trim();
  if (y === "" && m === "") return null;
  if ((y !== "" && !/^\d+$/.test(y)) || (m !== "" && !/^\d+$/.test(m))) return "bad";
  const total = Number(y || 0) * 12 + Number(m || 0);
  if (Number(m || 0) > 11 || total < 1 || total > MAX_LIFE_MONTHS) return "bad";
  return total;
}

export function lifeLabel(months: number | null): string {
  if (months === null) return "—";
  const y = Math.floor(months / 12), m = months % 12;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [y ? part(y, "year") : "", m ? part(m, "month") : ""].filter(Boolean).join(" ");
}

const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const life = z.number().int().min(1, "Life is at least 1 month").max(MAX_LIFE_MONTHS, "Life is at most 50 years");

export const policySchema = z.object({
  categoryId: z.string().min(1),
  lifeMonths: life.nullable(),
  salvagePercent: z.number().min(0, "Salvage can't be negative").lt(100, "Salvage must be under 100%")
    .refine(twoDecimals, "Two decimals at most").nullable(),
}).refine((v) => v.lifeMonths !== null || v.salvagePercent === null, { message: "Set a useful life first", path: ["lifeMonths"] });

export const overrideSchema = z.object({
  assetId: z.string().min(1),
  lifeMonths: life,
  salvage: z.number().min(0, "Salvage can't be negative").refine(twoDecimals, "Whole centavos only"),
  note: z.string().trim().min(3, "Say why this asset differs").max(300),
});

/** True when the typed row differs from the saved policy once both are normalised (blank salvage with a life is the same as 0). */
export function policyDirty(
  input: { years: string; months: string; salvage: string },
  saved: { lifeMonths: number | null; salvagePercent: number | null },
): boolean {
  const life = lifeFromYearsMonths(input.years, input.months);
  if (life === "bad") return true;
  if (life !== saved.lifeMonths) return true;
  const s = input.salvage.trim();
  const pct = s === "" ? (life === null ? null : 0) : Number(s);
  if (pct !== null && !Number.isFinite(pct)) return true;
  const savedPct = saved.salvagePercent ?? (saved.lifeMonths === null ? null : 0);
  return pct !== savedPct;
}
