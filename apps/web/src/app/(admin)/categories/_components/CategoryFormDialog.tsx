"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAdminStore } from "@/stores/useAdminStore";
import { normalizeErrors } from "../../_shared/normalizeErrors";
import { QuickCreateModifierGroupDialog } from "../../_shared/QuickCreateModifierGroupDialog";
import { useCategoryMutations } from "../_hooks";
import { type CategoryFormValues, categoryDefaults, categorySchema } from "../_schemas";

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: Id<"categories"> | null;
  initialValues?: CategoryFormValues;
  onSaveAndCreateAnother?: () => CategoryFormValues;
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
  onSaveAndCreateAnother,
}: CategoryFormDialogProps) {
  const { selectedStoreId } = useAdminStore();
  const { handleCreate, handleUpdate } = useCategoryMutations();
  const saveAndCreateAnotherRef = useRef(false);
  const [selectedModifierGroupId, setSelectedModifierGroupId] = useState<Id<"modifierGroups"> | "">(
    "",
  );
  const [showQuickCreateModifier, setShowQuickCreateModifier] = useState(false);

  const isEditing = editingId !== null;
  const defaults = initialValues ?? categoryDefaults;

  // Queries for modifier assignments (edit mode only)
  const categories = useQuery(
    api.categories.list,
    selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const modifierGroups = useQuery(
    api.modifierGroups.list,
    selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );
  const categoryAssignments = useQuery(
    api.modifierAssignments.listForCategory,
    editingId ? { categoryId: editingId } : "skip",
  );

  // Mutations for modifier assignments
  const assignModifier = useMutation(api.modifierAssignments.assign);
  const unassignModifier = useMutation(api.modifierAssignments.unassign);

  // Parent categories: top-level only, exclude self when editing
  const parentCategories =
    categories?.filter((c) => !c.parentId).filter((c) => c._id !== editingId) ?? [];

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onSubmit: categorySchema,
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
          setSelectedModifierGroupId("");
        } else {
          onOpenChange(false);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save category");
      }
    },
  });

  // Reset form when dialog opens with new values
  useEffect(() => {
    if (open) {
      form.reset(defaults);
      setSelectedModifierGroupId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Category" : "Create Category"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the category details below."
                : "Fill in the details to create a new category."}
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
              {/* Category Name */}
              <form.Field
                name="name"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="category-name">Category Name</FieldLabel>
                      <Input
                        id="category-name"
                        autoFocus
                        aria-invalid={hasErrors || undefined}
                        placeholder="Enter category name"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              {/* Parent Category */}
              <form.Field
                name="parentId"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="category-parent">Parent Category (Optional)</FieldLabel>
                    <Select
                      value={field.state.value ?? "none"}
                      onValueChange={(value) =>
                        field.handleChange(value === "none" ? undefined : value)
                      }
                    >
                      <SelectTrigger id="category-parent">
                        <SelectValue placeholder="Select parent category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Parent (Main Category)</SelectItem>
                        {parentCategories.map((category) => (
                          <SelectItem key={category._id} value={category._id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />

              {/* Sort Order */}
              <form.Field
                name="sortOrder"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="category-sortOrder">Sort Order</FieldLabel>
                      <Input
                        id="category-sortOrder"
                        type="number"
                        min={0}
                        aria-invalid={hasErrors || undefined}
                        value={field.state.value}
                        onChange={(e) =>
                          field.handleChange(Number.parseInt(e.target.value, 10) || 0)
                        }
                        onBlur={field.handleBlur}
                      />
                      <FieldDescription>Lower numbers appear first.</FieldDescription>
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              {/* Status (edit mode only) */}
              {isEditing && (
                <form.Field
                  name="isActive"
                  children={(field) => (
                    <Field>
                      <FieldLabel htmlFor="category-status">Status</FieldLabel>
                      <Select
                        value={field.state.value ? "active" : "inactive"}
                        onValueChange={(value) => field.handleChange(value === "active")}
                      >
                        <SelectTrigger id="category-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
              )}
            </FieldGroup>

            {/* Modifier Group Assignments (edit mode only, outside TanStack Form) */}
            {isEditing && (
              <div className="grid gap-2 pb-4">
                <Label className="flex items-center gap-1">
                  <SlidersHorizontal className="h-4 w-4" />
                  Modifier Groups
                </Label>
                {categoryAssignments && categoryAssignments.length > 0 ? (
                  <div className="space-y-1">
                    {categoryAssignments.map((a) => (
                      <div
                        key={a._id}
                        className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm"
                      >
                        <span>{a.groupName}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={async () => {
                            try {
                              await unassignModifier({ assignmentId: a._id });
                              toast.success("Modifier removed");
                            } catch {
                              toast.error("Failed to remove modifier");
                            }
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    No modifiers assigned. Products in this category will inherit these.
                  </p>
                )}
                <div className="flex gap-2">
                  <Select
                    value={selectedModifierGroupId as string}
                    onValueChange={(v) => {
                      if (v === "__quick_create_modifier__") {
                        setShowQuickCreateModifier(true);
                        return;
                      }
                      setSelectedModifierGroupId(v as Id<"modifierGroups">);
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Add modifier group..." />
                    </SelectTrigger>
                    <SelectContent>
                      {modifierGroups
                        ?.filter(
                          (g) => !categoryAssignments?.some((a) => a.modifierGroupId === g._id),
                        )
                        .map((g) => (
                          <SelectItem key={g._id} value={g._id}>
                            {g.name}
                          </SelectItem>
                        ))}
                      <Separator className="my-1" />
                      <SelectItem value="__quick_create_modifier__">
                        <span className="flex items-center gap-1">
                          <Plus className="h-3 w-3" />
                          Create New Modifier Group
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedModifierGroupId}
                    onClick={async () => {
                      if (!selectedModifierGroupId || !selectedStoreId || !editingId) return;
                      try {
                        await assignModifier({
                          storeId: selectedStoreId,
                          modifierGroupId: selectedModifierGroupId as Id<"modifierGroups">,
                          categoryId: editingId,
                        });
                        setSelectedModifierGroupId("");
                        toast.success("Modifier assigned");
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Failed to assign modifier",
                        );
                      }
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            )}

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

      {/* Quick Create Modifier Group (stacked dialog) */}
      <QuickCreateModifierGroupDialog
        open={showQuickCreateModifier}
        onOpenChange={setShowQuickCreateModifier}
        onCreated={async (groupId) => {
          if (!selectedStoreId || !editingId) return;
          try {
            await assignModifier({
              storeId: selectedStoreId,
              modifierGroupId: groupId as Id<"modifierGroups">,
              categoryId: editingId,
            });
            setSelectedModifierGroupId("");
            toast.success("Modifier group created and assigned");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to assign modifier");
          }
        }}
      />
    </>
  );
}
