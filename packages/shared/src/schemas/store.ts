import { z } from "zod";

export const createStoreSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: z.string().optional(),
  address1: z.string().min(1).max(200),
  address2: z.string().max(200).optional(),
  tin: z.string().min(1).max(20),
  min: z.string().min(1).max(20),
  vatRate: z.number().min(0).max(100).default(12),
});

export const updateStoreSchema = createStoreSchema.partial();

export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
