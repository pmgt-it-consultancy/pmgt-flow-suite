import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";

let optimisticIdCounter = 0;

export function useCartMutations() {
  const addItem = useMutation(api.orders.addItem).withOptimisticUpdate((localStore, args) => {
    const orderQuery = localStore.getQuery(api.orders.get, { orderId: args.orderId });
    if (!orderQuery) return;

    // Find the product in the store's product list cache so we can synthesize the item
    // without waiting for the server response.
    // The OrderScreen subscribes to api.products.list with { storeId } — grab that entry.
    const allProducts = localStore.getAllQueries(api.products.list);
    let product: (typeof allProducts)[number]["value"] extends (infer T)[] | undefined
      ? T | undefined
      : undefined;
    for (const { value } of allProducts) {
      if (!value) continue;
      const found = value.find((p) => p._id === args.productId);
      if (found) {
        product = found;
        break;
      }
    }
    if (!product) return;

    const placeholderId = `optimistic-${++optimisticIdCounter}` as Id<"orderItems">;
    const basePrice = args.customPrice ?? product.price;
    const modifierTotal = (args.modifiers ?? []).reduce((s, m) => s + m.priceAdjustment, 0);
    const unitPrice = basePrice + modifierTotal;
    const lineTotal = unitPrice * args.quantity;

    // Build the optimistic item. Shape matches api.orders.get's items validator.
    const newItem = {
      _id: placeholderId,
      productId: args.productId,
      productName: product.name,
      productPrice: basePrice,
      isVatable: product.isVatable,
      quantity: args.quantity,
      notes: args.notes,
      isVoided: false,
      isSentToKitchen: undefined,
      serviceType: undefined,
      lineTotal,
      modifiers: (args.modifiers ?? []).map((m) => ({
        groupName: m.modifierGroupName,
        optionName: m.modifierOptionName,
        priceAdjustment: m.priceAdjustment,
      })),
    };

    localStore.setQuery(
      api.orders.get,
      { orderId: args.orderId },
      { ...orderQuery, items: [...orderQuery.items, newItem] },
    );
  });
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
  const updateItemServiceType = useMutation(api.orders.updateItemServiceType).withOptimisticUpdate(
    (localStore, args) => {
      const allQueries = localStore.getAllQueries(api.orders.get);
      for (const { args: queryArgs, value } of allQueries) {
        if (!value) continue;
        if (!value.items.some((i) => i._id === args.orderItemId)) continue;
        const nextItems = value.items.map((i) =>
          i._id === args.orderItemId ? { ...i, serviceType: args.serviceType } : i,
        );
        localStore.setQuery(api.orders.get, queryArgs, { ...value, items: nextItems });
      }
    },
  );

  return { addItem, updateItemQuantity, removeItem, updateItemServiceType };
}

export type CartMutations = ReturnType<typeof useCartMutations>;
