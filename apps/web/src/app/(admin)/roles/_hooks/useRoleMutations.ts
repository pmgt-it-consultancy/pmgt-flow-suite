"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import type { RoleFormValues } from "../_schemas";

export function useRoleMutations() {
  const createRole = useMutation(api.roles.create);
  const updateRole = useMutation(api.roles.update);

  const handleCreate = useCallback(
    async (values: RoleFormValues) => {
      await createRole({
        name: values.name.trim(),
        scopeLevel: values.scopeLevel,
        permissions: values.permissions,
      });
      toast.success("Role created successfully");
    },
    [createRole],
  );

  const handleUpdate = useCallback(
    async (values: RoleFormValues, roleId: Id<"roles">) => {
      await updateRole({
        roleId,
        name: values.name.trim(),
        scopeLevel: values.scopeLevel,
        permissions: values.permissions,
      });
      toast.success("Role updated successfully");
    },
    [updateRole],
  );

  return { handleCreate, handleUpdate };
}
