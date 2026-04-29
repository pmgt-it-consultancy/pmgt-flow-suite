import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { getDatabase, type Store } from "../../db";
import { useObservable } from "../../db/useObservable";
import { isFlagEnabled } from "../featureFlags";

export function useStore(storeId: Id<"stores"> | undefined): Doc<"stores"> | null | undefined {
  const offline = isFlagEnabled("useWatermelon.stores");

  const convexResult = useQuery(api.stores.get, !offline && storeId ? { storeId } : "skip");

  const watermelonStores = useObservable<Store>(
    () => getDatabase().collections.get<Store>("stores").query(),
    [offline],
  );

  const watermelonResult = useMemo(() => {
    if (!offline) return undefined;
    if (!watermelonStores) return undefined;
    if (!storeId) return undefined;

    const store = watermelonStores.find((s) => s.id === storeId);
    if (!store) return null;

    let schedule: Doc<"stores">["schedule"] | undefined;
    if (store.scheduleJson) {
      try {
        schedule = JSON.parse(store.scheduleJson);
      } catch {
        schedule = undefined;
      }
    }

    return {
      _id: store.id as Id<"stores">,
      _creationTime: store.createdAt,
      name: store.name,
      parentId: store.parentId as Id<"stores"> | undefined,
      logo: store.logo as Id<"_storage"> | undefined,
      address1: store.address1,
      address2: store.address2,
      tin: store.tin,
      min: store.min,
      vatRate: store.vatRate,
      printerMac: store.printerMac,
      kitchenPrinterMac: store.kitchenPrinterMac,
      contactNumber: store.contactNumber,
      telephone: store.telephone,
      email: store.email,
      website: store.website,
      socials: [],
      footer: store.footer,
      schedule: schedule as Doc<"stores">["schedule"],
      isActive: store.isActive,
      createdAt: store.createdAt,
      updatedAt: store.updatedAt,
      deviceCodeCounter: store.deviceCodeCounter,
    } as Doc<"stores">;
  }, [offline, storeId, watermelonStores]);

  return offline ? watermelonResult : convexResult;
}
