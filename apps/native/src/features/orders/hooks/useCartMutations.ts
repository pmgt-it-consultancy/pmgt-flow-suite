import { api } from "@packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";

export function useCartMutations() {
  const addItem = useMutation(api.orders.addItem);
  const updateItemQuantity = useMutation(api.orders.updateItemQuantity).withOptimisticUpdate(
    (localStore, args) => {
      // Walk every cached `api.orders.get` query and patch the matching item's quantity + lineTotal.
      // We don't know the orderId from args (only orderItemId), so we scan all cached order queries.
      const allQueries = localStore.getAllQueries(api.orders.get);
      for (const { args: queryArgs, value } of allQueries) {
        if (!value) continue;
        const matched = value.items.find((i) => i._id === args.orderItemId);
        if (!matched) continue;

        // Derive unit price from the existing line so any modifier/open-price adjustments
        // baked into the current lineTotal are preserved. Server response will correct drift.
        const unitPrice =
          matched.quantity > 0 ? matched.lineTotal / matched.quantity : matched.productPrice;
        const nextItems = value.items.map((i) =>
          i._id === args.orderItemId
            ? { ...i, quantity: args.quantity, lineTotal: unitPrice * args.quantity }
            : i,
        );
        localStore.setQuery(api.orders.get, queryArgs, { ...value, items: nextItems });
      }
    },
  );
  const removeItem = useMutation(api.orders.removeItem).withOptimisticUpdate((localStore, args) => {
    const allQueries = localStore.getAllQueries(api.orders.get);
    for (const { args: queryArgs, value } of allQueries) {
      if (!value) continue;
      if (!value.items.some((i) => i._id === args.orderItemId)) continue;
      localStore.setQuery(api.orders.get, queryArgs, {
        ...value,
        items: value.items.filter((i) => i._id !== args.orderItemId),
      });
    }
  });
  const updateItemServiceType = useMutation(api.orders.updateItemServiceType);

  return { addItem, updateItemQuantity, removeItem, updateItemServiceType };
}

export type CartMutations = ReturnType<typeof useCartMutations>;
