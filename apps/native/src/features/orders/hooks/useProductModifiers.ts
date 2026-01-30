import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";

export function useProductModifiers(productId: Id<"products"> | undefined) {
  const modifierGroups = useQuery(
    api.modifierAssignments.getForProduct,
    productId ? { productId } : "skip",
  );

  return {
    modifierGroups: modifierGroups ?? [],
    isLoading: modifierGroups === undefined,
    hasModifiers: (modifierGroups?.length ?? 0) > 0,
  };
}
