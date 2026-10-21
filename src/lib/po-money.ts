/**
 * The money an asset registered from a PO line starts with: the PO's four purchase facts, and the line's
 * unit price as the cost. Generic over the price type so a Prisma Decimal passes through untouched.
 */
export function moneyForAsset<P>(
  po: { vendorId: string | null; invoiceRef: string | null; receiptRef: string | null; purchasedAt: Date | null },
  line: { unitPrice: P | null },
): { cost: P | null; vendorId: string | null; invoiceRef: string | null; receiptRef: string | null; purchasedAt: Date | null } {
  return {
    cost: line.unitPrice,
    vendorId: po.vendorId,
    invoiceRef: po.invoiceRef,
    receiptRef: po.receiptRef,
    purchasedAt: po.purchasedAt,
  };
}
