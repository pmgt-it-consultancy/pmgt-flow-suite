"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";
import type { TableFormValues } from "../_schemas";

export function useTableMutations() {
  const createTable = useMutation(api.tables.create);
  const updateTable = useMutation(api.tables.update);

  const handleCreate = useCallback(
    async (values: TableFormValues, storeId: Id<"stores">) => {
      await createTable({
        storeId,
        name: values.name,
        capacity: values.capacity,
        sortOrder: values.sortOrder,
      });
      toast.success("Table created successfully");
    },
    [createTable],
  );

  const handleUpdate = useCallback(
    async (values: TableFormValues, tableId: Id<"tables">) => {
      await updateTable({
        tableId,
        name: values.name,
        capacity: values.capacity,
        sortOrder: values.sortOrder,
        isActive: values.isActive,
      });
      toast.success("Table updated successfully");
    },
    [updateTable],
  );

  return { handleCreate, handleUpdate };
}
