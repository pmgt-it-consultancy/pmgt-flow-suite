import { z } from "zod";

export const tableSchema = z.object({
  name: z.string().min(1, "Table name is required"),
  capacity: z.number().int().min(1, "Capacity must be at least 1"),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
});

export type TableFormValues = z.infer<typeof tableSchema>;

export const tableDefaults: TableFormValues = {
  name: "",
  capacity: 4,
  sortOrder: 0,
  isActive: true,
};
