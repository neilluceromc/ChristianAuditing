import { revalidatePath } from "next/cache";

/**
 * The pages a direct lifecycle change makes stale: the asset, the inventory list, home, and each named
 * person's page. Phase 41: lives outside the "use server" actions file so Cris's confirm and undo
 * (src/server/cris) refresh the same pages the manual actions do.
 */
export function revalidateAsset(assetId: string, employeeIds: Array<string | null | undefined>): void {
  revalidatePath(`/inventory/${assetId}`);
  revalidatePath("/inventory");
  revalidatePath("/");
  for (const e of employeeIds) if (e) revalidatePath(`/employees/${e}`);
}
