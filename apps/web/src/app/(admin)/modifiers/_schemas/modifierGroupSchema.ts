import { z } from "zod";

export const modifierOptionSchema = z.object({
  id: z.string().optional(), // Existing option ID for edit diffing
  name: z.string().min(1, "Option name is required"),
  priceAdjustment: z.number(),
  isDefault: z.boolean(),
});

export const modifierGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  selectionType: z.enum(["single", "multi"]),
  minSelections: z.number().int().min(0),
  maxSelections: z.number().int().min(0).optional(),
  isActive: z.boolean(),
  options: z.array(modifierOptionSchema).min(1, "At least one option is required"),
});

export type ModifierOptionFormValues = z.infer<typeof modifierOptionSchema>;
export type ModifierGroupFormValues = z.infer<typeof modifierGroupSchema>;

export const modifierOptionDefaults: ModifierOptionFormValues = {
  name: "",
  priceAdjustment: 0,
  isDefault: false,
};

export const modifierGroupDefaults: ModifierGroupFormValues = {
  name: "",
  selectionType: "single",
  minSelections: 0,
  maxSelections: undefined,
  isActive: true,
  options: [{ name: "", priceAdjustment: 0, isDefault: false }],
};
