"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAction, useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import type { UserFormValues } from "../_schemas";

export function useUserMutations() {
  const createUser = useAction(api.users.create);
  const updateUser = useMutation(api.helpers.usersHelpers.update);
  const resetPasswordAction = useAction(api.users.resetPassword);
  const setPinAction = useAction(api.users.setPin);
  const clearPinAction = useAction(api.users.clearPin);

  const handleCreate = useCallback(
    async (values: UserFormValues) => {
      const result = await createUser({
        email: values.email,
        password: values.password,
        name: values.name,
        roleId: values.roleId as Id<"roles">,
        storeId: values.storeId ? (values.storeId as Id<"stores">) : undefined,
      });
      if (result.success) {
        toast.success("User created successfully");
        return { success: true as const };
      }
      toast.error(result.error);
      return { success: false as const, error: result.error };
    },
    [createUser],
  );

  const handleUpdate = useCallback(
    async (values: UserFormValues, userId: Id<"users">) => {
      await updateUser({
        userId,
        name: values.name,
        roleId: values.roleId as Id<"roles">,
        storeId: values.storeId ? (values.storeId as Id<"stores">) : undefined,
        isActive: values.isActive,
      });
      toast.success("User updated successfully");
    },
    [updateUser],
  );

  const handleResetPassword = useCallback(
    async (userId: Id<"users">, newPassword: string) => {
      const result = await resetPasswordAction({ userId, newPassword });
      if (result.success) {
        toast.success("Password reset successfully");
      } else {
        toast.error(result.error);
      }
      return result;
    },
    [resetPasswordAction],
  );

  const handleSetPin = useCallback(
    async (userId: Id<"users">, pin: string) => {
      const result = await setPinAction({ userId, pin });
      if (result.success) {
        toast.success("PIN set successfully");
      } else {
        toast.error(result.error);
      }
      return result;
    },
    [setPinAction],
  );

  const handleClearPin = useCallback(
    async (userId: Id<"users">) => {
      const result = await clearPinAction({ userId });
      if (result.success) {
        toast.success("PIN removed successfully");
      } else {
        toast.error(result.error);
      }
      return result;
    },
    [clearPinAction],
  );

  return { handleCreate, handleUpdate, handleResetPassword, handleSetPin, handleClearPin };
}
