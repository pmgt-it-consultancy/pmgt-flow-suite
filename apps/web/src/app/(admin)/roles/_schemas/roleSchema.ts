import { z } from "zod";

export const roleSchema = z.object({
  name: z.string().min(1, "Role name is required"),
  scopeLevel: z.enum(["system", "parent", "branch"]),
  permissions: z.array(z.string()).min(1, "Select at least one permission"),
});

export type RoleFormValues = z.infer<typeof roleSchema>;

export const roleDefaults: RoleFormValues = {
  name: "",
  scopeLevel: "branch",
  permissions: [],
};
