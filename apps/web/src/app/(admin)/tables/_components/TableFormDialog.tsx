"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useForm } from "@tanstack/react-form";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAdminStore } from "@/stores/useAdminStore";
import { normalizeErrors } from "../../_shared/normalizeErrors";
import { useTableMutations } from "../_hooks";
import { type TableFormValues, tableDefaults, tableSchema } from "../_schemas";

interface TableFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: Id<"tables"> | null;
  initialValues?: TableFormValues;
  onSaveAndCreateAnother?: () => TableFormValues;
}

export function TableFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
  onSaveAndCreateAnother,
}: TableFormDialogProps) {
  const { selectedStoreId } = useAdminStore();
  const { handleCreate, handleUpdate } = useTableMutations();
  const saveAndCreateAnotherRef = useRef(false);

  const isEditing = editingId !== null;
  const defaults = initialValues ?? tableDefaults;

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onBlur: tableSchema,
      onSubmit: tableSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        if (isEditing) {
          await handleUpdate(value, editingId);
        } else if (selectedStoreId) {
          await handleCreate(value, selectedStoreId);
        }

        if (saveAndCreateAnotherRef.current) {
          saveAndCreateAnotherRef.current = false;
          const freshDefaults = onSaveAndCreateAnother?.() ?? defaults;
          form.reset(freshDefaults);
        } else {
          onOpenChange(false);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save table");
      }
    },
  });

  // Reset form when dialog opens with new values
  useEffect(() => {
    if (open) {
      form.reset(defaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Table" : "Create Table"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the table details below."
              : "Fill in the details to create a new table."}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <FieldGroup className="py-4">
            {/* Table Name */}
            <form.Field
              name="name"
              children={(field) => {
                const hasErrors = field.state.meta.isTouched && field.state.meta.errors.length > 0;
                return (
                  <Field data-invalid={hasErrors || undefined}>
                    <FieldLabel htmlFor="table-name">Table Name</FieldLabel>
                    <Input
                      id="table-name"
                      autoFocus
                      aria-invalid={hasErrors || undefined}
                      placeholder="e.g., Table 1, Booth A"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                  </Field>
                );
              }}
            />

            {/* Capacity & Sort Order side by side */}
            <div className="grid grid-cols-2 gap-4">
              <form.Field
                name="capacity"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="table-capacity">Capacity (seats)</FieldLabel>
                      <Input
                        id="table-capacity"
                        type="number"
                        min={1}
                        aria-invalid={hasErrors || undefined}
                        value={field.state.value}
                        onChange={(e) =>
                          field.handleChange(Number.parseInt(e.target.value, 10) || 1)
                        }
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              <form.Field
                name="sortOrder"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="table-sortOrder">Sort Order</FieldLabel>
                      <Input
                        id="table-sortOrder"
                        type="number"
                        min={0}
                        aria-invalid={hasErrors || undefined}
                        value={field.state.value}
                        onChange={(e) =>
                          field.handleChange(Number.parseInt(e.target.value, 10) || 0)
                        }
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />
            </div>

            {/* Active toggle (edit mode only) */}
            {isEditing && (
              <form.Field
                name="isActive"
                children={(field) => (
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="table-isActive">Active</FieldLabel>
                    <Switch
                      id="table-isActive"
                      checked={field.state.value}
                      onCheckedChange={(checked: boolean) => field.handleChange(checked)}
                    />
                  </Field>
                )}
              />
            )}
          </FieldGroup>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={form.state.isSubmitting}
            >
              Cancel
            </Button>
            {!isEditing && (
              <Button
                type="submit"
                variant="outline"
                disabled={form.state.isSubmitting}
                onClick={() => {
                  saveAndCreateAnotherRef.current = true;
                }}
              >
                {form.state.isSubmitting ? "Saving..." : "Save & Create Another"}
              </Button>
            )}
            <Button
              type="submit"
              disabled={form.state.isSubmitting}
              onClick={() => {
                saveAndCreateAnotherRef.current = false;
              }}
            >
              {form.state.isSubmitting ? "Saving..." : isEditing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
