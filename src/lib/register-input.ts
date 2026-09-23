/** Phase 30 (spec §5.4): paste a column of serials; one value per row, blanks dropped. */
export function parseSerialPaste(text: string): string[] {
  return text.split(/[\r\n\t]+/).map((s) => s.trim()).filter(Boolean);
}

/** Phase 30 (spec §5.4): "₱12,500.50" → "12500.50"; "" stays ""; anything else is refused, never silently blanked. */
export function normaliseCost(text: string): { ok: true; value: string } | { ok: false } {
  const cleaned = text.replace(/₱|PHP|,|\s/gi, "");
  if (cleaned === "") return { ok: true, value: "" };
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? { ok: true, value: cleaned } : { ok: false };
}
