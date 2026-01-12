import { z } from "zod";

export const createStoreSchema = z.object({
  name: z
    .string()
    .min(1, "Store name is required")
    .max(100, "Store name must be at most 100 characters"),
  parentId: z.string().optional(),
  address1: z
    .string()
    .min(1, "Address is required")
    .max(200, "Address must be at most 200 characters"),
  address2: z.string().max(200, "Address line 2 must be at most 200 characters").optional(),
  tin: z.string().min(1, "TIN is required").max(20, "TIN must be at most 20 characters"),
  min: z.string().min(1, "MIN is required").max(20, "MIN must be at most 20 characters"),
  vatRate: z
    .number()
    .min(0, "VAT rate cannot be negative")
    .max(100, "VAT rate cannot exceed 100%")
    .default(12),
});

export const updateStoreSchema = createStoreSchema.partial();

export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
