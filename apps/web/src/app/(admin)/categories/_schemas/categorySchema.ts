import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().min(1, "Category name is required"),
  parentId: z.string().optional(),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;

export const categoryDefaults: CategoryFormValues = {
  name: "",
  parentId: undefined,
  sortOrder: 0,
  isActive: true,
};
