import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AdminState {
  selectedStoreId: Id<"stores"> | null;
  setSelectedStoreId: (storeId: Id<"stores"> | null) => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      selectedStoreId: null,
      setSelectedStoreId: (storeId) => set({ selectedStoreId: storeId }),
    }),
    {
      name: "admin-store",
    },
  ),
);
