import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const createUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  name: z.string().min(1).max(100),
  roleId: z.string(),
  storeId: z.string().optional(),
  pin: z.string().length(4).optional(),
});

export const managerPinSchema = z.object({
  pin: z.string().length(4, "PIN must be 4 digits"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type ManagerPinInput = z.infer<typeof managerPinSchema>;
