/** Fail closed: these operator-only tools must never run against production. */
export function requireStagingLab() {
  if (process.env.CONVEX_SITE_URL !== "https://aromatic-dalmatian-30.convex.site") {
    throw new Error("This operation is restricted to the approved staging deployment");
  }
}
