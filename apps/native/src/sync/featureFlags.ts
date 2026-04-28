/**
 * Feature flags controlling whether each data path reads from
 * WatermelonDB (offline-first) or Convex (`useQuery` over WS).
 *
 * Per spec §Migration & Rollout, every Phase-3 screen migration is
 * gated behind a flag so it can be flipped per-store and rolled back
 * without redeploying.
 *
 * Source of truth: an env var per flag, evaluated at app startup.
 * To enable a flag, set the corresponding EXPO_PUBLIC_OFFLINE_*
 * variable to "1" in `.env.local` (or via EAS env config).
 *
 * Flag names follow `useWatermelon.<table>` shape from the spec.
 */
export const featureFlags = {
  /** OrderScreen + CategoryGrid product list reads from WatermelonDB */
  "useWatermelon.products": process.env.EXPO_PUBLIC_OFFLINE_PRODUCTS === "1",
  "useWatermelon.categories": process.env.EXPO_PUBLIC_OFFLINE_CATEGORIES === "1",
  "useWatermelon.modifiers": process.env.EXPO_PUBLIC_OFFLINE_MODIFIERS === "1",
  "useWatermelon.tables": process.env.EXPO_PUBLIC_OFFLINE_TABLES === "1",
  "useWatermelon.orders": process.env.EXPO_PUBLIC_OFFLINE_ORDERS === "1",
} as const;

export type FeatureFlag = keyof typeof featureFlags;

export function isFlagEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
