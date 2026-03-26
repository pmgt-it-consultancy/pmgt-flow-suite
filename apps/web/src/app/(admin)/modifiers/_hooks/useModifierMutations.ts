"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import type { ModifierGroupFormValues } from "../_schemas";

export function useModifierMutations() {
  const createGroup = useMutation(api.modifierGroups.create);
  const updateGroup = useMutation(api.modifierGroups.update);
  const createOption = useMutation(api.modifierOptions.create);
  const updateOption = useMutation(api.modifierOptions.update);
  const toggleAvailability = useMutation(api.modifierOptions.toggleAvailability);

  const handleCreate = useCallback(
    async (values: ModifierGroupFormValues, storeId: Id<"stores">) => {
      // Create group first — returns the new group ID
      const groupId = await createGroup({
        storeId,
        name: values.name,
        selectionType: values.selectionType,
        minSelections: values.minSelections,
        maxSelections: values.maxSelections,
      });
      // Then create all options
      for (const option of values.options) {
        await createOption({
          modifierGroupId: groupId,
          name: option.name,
          priceAdjustment: option.priceAdjustment,
          isDefault: option.isDefault,
        });
      }
      toast.success("Modifier group created");
    },
    [createGroup, createOption],
  );

  const handleUpdate = useCallback(
    async (
      values: ModifierGroupFormValues,
      groupId: Id<"modifierGroups">,
      originalOptionIds: string[], // IDs of options that existed before editing
    ) => {
      // Update group
      await updateGroup({
        modifierGroupId: groupId,
        name: values.name,
        selectionType: values.selectionType,
        minSelections: values.minSelections,
        maxSelections: values.maxSelections,
        isActive: values.isActive,
      });
      // Diff options
      const currentIds = values.options.filter((o) => o.id).map((o) => o.id!);
      // Update existing options or create new ones
      for (const option of values.options) {
        if (option.id) {
          await updateOption({
            modifierOptionId: option.id as Id<"modifierOptions">,
            name: option.name,
            priceAdjustment: option.priceAdjustment,
            isDefault: option.isDefault,
          });
        } else {
          await createOption({
            modifierGroupId: groupId,
            name: option.name,
            priceAdjustment: option.priceAdjustment,
            isDefault: option.isDefault,
          });
        }
      }
      // Toggle availability for removed options (mark unavailable instead of deleting)
      for (const originalId of originalOptionIds) {
        if (!currentIds.includes(originalId)) {
          await toggleAvailability({
            modifierOptionId: originalId as Id<"modifierOptions">,
          });
        }
      }
      toast.success("Modifier group updated");
    },
    [updateGroup, createOption, updateOption, toggleAvailability],
  );

  return { handleCreate, handleUpdate };
}
