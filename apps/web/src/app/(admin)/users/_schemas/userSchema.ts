import { z } from "zod";

export const userSchema = z.object({
  name: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string(),
  roleId: z.string().min(1, "Role is required"),
  storeId: z.string().optional(),
  isActive: z.boolean(),
});

export type UserFormValues = z.infer<typeof userSchema>;

export const userDefaults: UserFormValues = {
  name: "",
  email: "",
  password: "",
  roleId: "",
  storeId: undefined,
  isActive: true,
};

export const resetPasswordSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export const pinSchema = z.object({
  pin: z
    .string()
    .min(4, "PIN must be 4-6 digits")
    .max(6, "PIN must be 4-6 digits")
    .regex(/^\d+$/, "PIN must contain only digits"),
});

export type PinFormValues = z.infer<typeof pinSchema>;
