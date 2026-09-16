import type { Doc } from "../_generated/dataModel";

/**
 * Device Retirement keeps the old row as evidence — historical orders cite its device code — so a
 * tablet that has moved stores legitimately has more than one row on by_deviceId. Every lookup that
 * means "which store is this tablet serving now" must go through here: `.unique()` throws on a moved
 * tablet, and `.first()` silently returns the retired binding.
 */
export async function activeDeviceBinding(
  ctx: { db: any },
  deviceId: string,
): Promise<Doc<"syncDevices"> | null> {
  const bindings = await ctx.db
    .query("syncDevices")
    .withIndex("by_deviceId", (q: any) => q.eq("deviceId", deviceId))
    .collect();
  return bindings.find((binding: Doc<"syncDevices">) => binding.retiredAt === undefined) ?? null;
}
