import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useMemo } from "react";
import { getDatabase, type Store } from "../../db";
import { useObservable } from "../../db/useObservable";
import { isFlagEnabled } from "../featureFlags";

// ─── Shared view interface ───────────────────────────────────
//
// Both `api.stores.get` and the WatermelonDB path produce values
// structurally satisfying this type. `Doc<"stores">` (Convex's
// return type) has every field listed here plus extras — TypeScript
// structural typing accepts the wider type as assignable.
//
// The only `as` casts below are on branded ID fields (Id<"stores">,
// Id<"_storage">). These are sound: /sync/pull translates Convex _ids
// to clientId UUIDs, and the tablet receives the exact same values.

export interface StoreData {
  readonly _id: Id<"stores">;
  readonly name: string;
  readonly address1: string;
  readonly address2?: string;
  readonly tin: string;
  readonly vatRate: number;
  readonly contactNumber?: string;
  readonly telephone?: string;
  readonly email?: string;
  readonly website?: string;
  readonly footer?: string;
  readonly isActive: boolean;
  readonly createdAt: number;
  readonly logo?: Id<"_storage">;
  readonly socials?: ReadonlyArray<{ platform: string; url: string }>;
  readonly schedule?: StoreScheduleData;
}

export interface DaySlotData {
  readonly open: string;
  readonly close: string;
}

export interface StoreScheduleData {
  readonly monday: DaySlotData;
  readonly tuesday: DaySlotData;
  readonly wednesday: DaySlotData;
  readonly thursday: DaySlotData;
  readonly friday: DaySlotData;
  readonly saturday: DaySlotData;
  readonly sunday: DaySlotData;
}

// ─── Hook ─────────────────────────────────────────────────────

export function useStore(storeId: Id<"stores"> | undefined): StoreData | null | undefined {
  const offline = isFlagEnabled("useWatermelon.stores");

  const convexResult = useQuery(api.stores.get, !offline && storeId ? { storeId } : "skip");

  const watermelonStores = useObservable<Store>(
    () => getDatabase().collections.get<Store>("stores").query(),
    [offline],
  );

  const watermelonResult = useMemo((): StoreData | null | undefined => {
    if (!offline) return undefined;
    if (!watermelonStores) return undefined;
    if (!storeId) return undefined;

    const store = watermelonStores.find((s) => s.id === storeId);
    if (!store) return null;

    const schedule = parseSchedule(store.scheduleJson);

    return {
      _id: store.id as Id<"stores">,
      name: store.name,
      address1: store.address1,
      address2: store.address2 || undefined,
      tin: store.tin,
      vatRate: store.vatRate,
      contactNumber: store.contactNumber || undefined,
      telephone: store.telephone || undefined,
      email: store.email || undefined,
      website: store.website || undefined,
      footer: store.footer || undefined,
      isActive: store.isActive,
      createdAt: store.createdAt,
      logo: (store.logo || undefined) as Id<"_storage"> | undefined,
      socials: undefined,
      schedule,
    };
  }, [offline, storeId, watermelonStores]);

  return offline ? watermelonResult : convexResult;
}

// ─── Helpers ──────────────────────────────────────────────────

function parseSchedule(json: string | undefined): StoreScheduleData | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    if (!isScheduleShape(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function isScheduleShape(value: unknown): value is StoreScheduleData {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  for (const day of DAY_KEYS) {
    const slot = obj[day];
    if (
      typeof slot !== "object" ||
      slot === null ||
      typeof (slot as Record<string, unknown>).open !== "string" ||
      typeof (slot as Record<string, unknown>).close !== "string"
    ) {
      return false;
    }
  }
  return true;
}
