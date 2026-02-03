import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { create } from "zustand";

export interface Social {
  platform: string;
  url: string;
}

export interface StoreFormData {
  name: string;
  parentId: Id<"stores"> | undefined;
  address1: string;
  address2: string;
  tin: string;
  min: string;
  vatRate: number;
  contactNumber: string;
  telephone: string;
  email: string;
  website: string;
  socials: Social[];
  footer: string;
  isActive: boolean;
}

const initialFormData: StoreFormData = {
  name: "",
  parentId: undefined,
  address1: "",
  address2: "",
  tin: "",
  min: "",
  vatRate: 12,
  contactNumber: "",
  telephone: "",
  email: "",
  website: "",
  socials: [],
  footer: "",
  isActive: true,
};

interface StoreFormState {
  isDialogOpen: boolean;
  editingStoreId: Id<"stores"> | null;
  formData: StoreFormData;
  isSubmitting: boolean;

  // Actions
  openCreateDialog: () => void;
  openEditDialog: (storeId: Id<"stores">, data: StoreFormData) => void;
  closeDialog: () => void;
  setFormData: (data: Partial<StoreFormData>) => void;
  setIsSubmitting: (value: boolean) => void;
  resetForm: () => void;
  addSocial: () => void;
  removeSocial: (index: number) => void;
  updateSocial: (index: number, field: keyof Social, value: string) => void;
}

export const useStoreFormStore = create<StoreFormState>((set) => ({
  isDialogOpen: false,
  editingStoreId: null,
  formData: initialFormData,
  isSubmitting: false,

  openCreateDialog: () =>
    set({
      isDialogOpen: true,
      editingStoreId: null,
      formData: initialFormData,
    }),

  openEditDialog: (storeId, data) =>
    set({
      isDialogOpen: true,
      editingStoreId: storeId,
      formData: data,
    }),

  closeDialog: () =>
    set({
      isDialogOpen: false,
      editingStoreId: null,
      formData: initialFormData,
    }),

  setFormData: (data) =>
    set((state) => ({
      formData: { ...state.formData, ...data },
    })),

  setIsSubmitting: (value) => set({ isSubmitting: value }),

  resetForm: () => set({ formData: initialFormData }),

  addSocial: () =>
    set((state) => ({
      formData: {
        ...state.formData,
        socials: [...state.formData.socials, { platform: "", url: "" }],
      },
    })),

  removeSocial: (index) =>
    set((state) => ({
      formData: {
        ...state.formData,
        socials: state.formData.socials.filter((_, i) => i !== index),
      },
    })),

  updateSocial: (index, field, value) =>
    set((state) => ({
      formData: {
        ...state.formData,
        socials: state.formData.socials.map((social, i) =>
          i === index ? { ...social, [field]: value } : social,
        ),
      },
    })),
}));
