import { api } from "@packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";

export function useCartMutations() {
  const addItem = useMutation(api.orders.addItem);
  const updateItemQuantity = useMutation(api.orders.updateItemQuantity);
  const removeItem = useMutation(api.orders.removeItem);
  const updateItemServiceType = useMutation(api.orders.updateItemServiceType);

  return { addItem, updateItemQuantity, removeItem, updateItemServiceType };
}

export type CartMutations = ReturnType<typeof useCartMutations>;
