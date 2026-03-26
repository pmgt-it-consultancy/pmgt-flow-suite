import { z } from "zod";

export const productSchema = z
  .object({
    categoryId: z.string().min(1, "Category is required"),
    name: z.string().min(1, "Product name is required"),
    isOpenPrice: z.boolean(),
    price: z.number(),
    minPrice: z.number(),
    maxPrice: z.number(),
    sortOrder: z.number().int().min(0),
    isVatable: z.boolean(),
    isActive: z.boolean(),
  })
  .refine(
    (data) => {
      if (!data.isOpenPrice) return data.price > 0;
      return true;
    },
    { message: "Price must be greater than 0", path: ["price"] },
  )
  .refine(
    (data) => {
      if (data.isOpenPrice) return data.minPrice > 0;
      return true;
    },
    { message: "Minimum price must be greater than 0", path: ["minPrice"] },
  )
  .refine(
    (data) => {
      if (data.isOpenPrice) return data.maxPrice > 0;
      return true;
    },
    { message: "Maximum price must be greater than 0", path: ["maxPrice"] },
  )
  .refine(
    (data) => {
      if (data.isOpenPrice) return data.minPrice < data.maxPrice;
      return true;
    },
    { message: "Min price must be less than max price", path: ["maxPrice"] },
  );

export type ProductFormValues = z.infer<typeof productSchema>;

export const productDefaults: ProductFormValues = {
  categoryId: "",
  name: "",
  isOpenPrice: false,
  price: 0,
  minPrice: 0,
  maxPrice: 0,
  sortOrder: 0,
  isVatable: true,
  isActive: true,
};
