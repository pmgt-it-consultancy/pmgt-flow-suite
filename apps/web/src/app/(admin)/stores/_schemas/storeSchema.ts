import { z } from "zod";

const socialSchema = z.object({
  platform: z.string().min(1, "Platform is required"),
  url: z.string().min(1, "URL is required"),
});

export const storeSchema = z.object({
  name: z.string().min(1, "Store name is required"),
  parentId: z.string().optional(),
  address1: z.string().min(1, "Address is required"),
  address2: z.string().optional(),
  tin: z.string().min(1, "TIN is required"),
  min: z.string().optional(),
  vatRate: z.number().min(0),
  contactNumber: z.string().optional(),
  telephone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  website: z.string().optional(),
  socials: z.array(socialSchema),
  footer: z.string().optional(),
  isActive: z.boolean(),
});

export type StoreFormValues = z.infer<typeof storeSchema>;

export const storeDefaults: StoreFormValues = {
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
