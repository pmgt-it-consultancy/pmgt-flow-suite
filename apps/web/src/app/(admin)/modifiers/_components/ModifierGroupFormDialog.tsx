"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useForm } from "@tanstack/react-form";
import { Plus, Trash2 } from "lucide-react";
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
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAdminStore } from "@/stores/useAdminStore";
import { useModifierMutations } from "../_hooks";
import {
  type ModifierGroupFormValues,
  modifierGroupDefaults,
  modifierGroupSchema,
  modifierOptionDefaults,
} from "../_schemas";

interface ModifierGroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: Id<"modifierGroups"> | null;
  initialValues?: ModifierGroupFormValues;
  onSaveAndCreateAnother?: () => ModifierGroupFormValues;
  originalOptionIds?: string[];
}

/** Map TanStack Form errors to the shape FieldError expects. */
function normalizeErrors(errors: unknown[]): Array<{ message?: string } | undefined> {
  return errors.map((e) => (typeof e === "string" ? { message: e } : (e as { message?: string })));
}

export function ModifierGroupFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
  onSaveAndCreateAnother,
  originalOptionIds = [],
}: ModifierGroupFormDialogProps) {
  const { selectedStoreId } = useAdminStore();
  const { handleCreate, handleUpdate } = useModifierMutations();
  const saveAndCreateAnotherRef = useRef(false);

  const isEditing = editingId !== null;
  const defaults = initialValues ?? modifierGroupDefaults;

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onBlur: modifierGroupSchema,
      onSubmit: modifierGroupSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        if (isEditing) {
          await handleUpdate(value, editingId, originalOptionIds);
        } else if (selectedStoreId) {
          await handleCreate(value, selectedStoreId);
        }

        if (saveAndCreateAnotherRef.current) {
          saveAndCreateAnotherRef.current = false;
          const freshDefaults = onSaveAndCreateAnother?.() ?? modifierGroupDefaults;
          form.reset(freshDefaults);
        } else {
          onOpenChange(false);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save modifier group");
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Modifier Group" : "Create Modifier Group"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the modifier group and its options."
              : "Fill in the details to create a new modifier group with options."}
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
            {/* Group Name */}
            <form.Field
              name="name"
              children={(field) => {
                const hasErrors = field.state.meta.isTouched && field.state.meta.errors.length > 0;
                return (
                  <Field data-invalid={hasErrors || undefined}>
                    <FieldLabel htmlFor="group-name">Group Name</FieldLabel>
                    <Input
                      id="group-name"
                      autoFocus
                      aria-invalid={hasErrors || undefined}
                      placeholder="e.g. Size, Toppings, Add-ons"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                  </Field>
                );
              }}
            />

            {/* Selection Type */}
            <form.Field
              name="selectionType"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor="group-selectionType">Selection Type</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value: "single" | "multi") => field.handleChange(value)}
                  >
                    <SelectTrigger id="group-selectionType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Single (pick one)</SelectItem>
                      <SelectItem value="multi">Multi (pick many)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />

            {/* Min/Max Selections */}
            <div className="grid grid-cols-2 gap-4">
              <form.Field
                name="minSelections"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="group-minSelections">Min Selections</FieldLabel>
                      <Input
                        id="group-minSelections"
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

              <form.Field
                name="maxSelections"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="group-maxSelections">Max Selections</FieldLabel>
                      <Input
                        id="group-maxSelections"
                        type="number"
                        min={0}
                        aria-invalid={hasErrors || undefined}
                        placeholder="No limit"
                        value={field.state.value ?? ""}
                        onChange={(e) =>
                          field.handleChange(
                            e.target.value ? Number.parseInt(e.target.value, 10) : undefined,
                          )
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
                  <Field>
                    <FieldLabel htmlFor="group-isActive">Status</FieldLabel>
                    <Select
                      value={field.state.value ? "active" : "inactive"}
                      onValueChange={(value) => field.handleChange(value === "active")}
                    >
                      <SelectTrigger id="group-isActive">
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

            <FieldSeparator>Options</FieldSeparator>

            {/* Options array */}
            <form.Field
              name="options"
              mode="array"
              children={(field) => (
                <div className="flex flex-col gap-4">
                  <FieldError errors={normalizeErrors(field.state.meta.errors)} />

                  {field.state.value.map((_, index) => (
                    <div key={index} className="flex items-start gap-3">
                      {/* Option Name */}
                      <form.Field
                        name={`options[${index}].name`}
                        children={(subField) => {
                          const hasErrors =
                            subField.state.meta.isTouched && subField.state.meta.errors.length > 0;
                          return (
                            <Field data-invalid={hasErrors || undefined} className="flex-1">
                              {index === 0 && (
                                <FieldLabel htmlFor={`option-name-${index}`}>Name</FieldLabel>
                              )}
                              <Input
                                id={`option-name-${index}`}
                                aria-invalid={hasErrors || undefined}
                                placeholder="e.g. Large, Extra Cheese"
                                value={subField.state.value}
                                onChange={(e) => subField.handleChange(e.target.value)}
                                onBlur={subField.handleBlur}
                              />
                              <FieldError errors={normalizeErrors(subField.state.meta.errors)} />
                            </Field>
                          );
                        }}
                      />

                      {/* Price Adjustment */}
                      <form.Field
                        name={`options[${index}].priceAdjustment`}
                        children={(subField) => {
                          const hasErrors =
                            subField.state.meta.isTouched && subField.state.meta.errors.length > 0;
                          return (
                            <Field data-invalid={hasErrors || undefined} className="w-32">
                              {index === 0 && (
                                <FieldLabel htmlFor={`option-price-${index}`}>
                                  Price Adj.
                                </FieldLabel>
                              )}
                              <Input
                                id={`option-price-${index}`}
                                type="number"
                                step="0.01"
                                aria-invalid={hasErrors || undefined}
                                value={subField.state.value}
                                onChange={(e) =>
                                  subField.handleChange(Number.parseFloat(e.target.value) || 0)
                                }
                                onBlur={subField.handleBlur}
                              />
                              <FieldError errors={normalizeErrors(subField.state.meta.errors)} />
                            </Field>
                          );
                        }}
                      />

                      {/* Default Switch */}
                      <form.Field
                        name={`options[${index}].isDefault`}
                        children={(subField) => (
                          <div className="flex flex-col items-center gap-1">
                            {index === 0 && (
                              <span className="text-sm font-medium leading-snug">Default</span>
                            )}
                            <Switch
                              checked={subField.state.value}
                              onCheckedChange={(checked: boolean) => subField.handleChange(checked)}
                            />
                          </div>
                        )}
                      />

                      {/* Remove Button */}
                      <div className="flex flex-col items-center gap-1">
                        {index === 0 && (
                          <span className="text-sm font-medium leading-snug invisible">X</span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => field.removeValue(index)}
                          disabled={field.state.value.length <= 1}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => field.pushValue({ ...modifierOptionDefaults })}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Option
                  </Button>
                </div>
              )}
            />
          </FieldGroup>

          <DialogFooter className="gap-2 sm:gap-0 mt-6">
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
