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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { useAdminStore } from "@/stores/useAdminStore";
import { normalizeErrors } from "../../_shared/normalizeErrors";
import { QuickCreateModifierGroupDialog } from "../../_shared/QuickCreateModifierGroupDialog";
import { useProductMutations } from "../_hooks";
import { type ProductFormValues, productDefaults, productSchema } from "../_schemas";
import { QuickCreateCategoryDialog } from "./QuickCreateCategoryDialog";

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: Id<"products"> | null;
  initialValues?: ProductFormValues;
  onSaveAndCreateAnother?: () => ProductFormValues;
}

const QUICK_CREATE_CATEGORY_VALUE = "__quick_create__";

export function ProductFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
  onSaveAndCreateAnother,
}: ProductFormDialogProps) {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();
  const { handleCreate, handleUpdate } = useProductMutations();
  const saveAndCreateAnotherRef = useRef(false);

  const [showQuickCreateCategory, setShowQuickCreateCategory] = useState(false);
  const [showQuickCreateModifier, setShowQuickCreateModifier] = useState(false);
  const [selectedModifierGroupId, setSelectedModifierGroupId] = useState<Id<"modifierGroups"> | "">(
    "",
  );

  const isEditing = editingId !== null;
  const defaults = initialValues ?? productDefaults;

  // Queries
  const categories = useQuery(
    api.categories.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  const modifierGroups = useQuery(
    api.modifierGroups.list,
    isAuthenticated && selectedStoreId ? { storeId: selectedStoreId } : "skip",
  );

  const productAssignments = useQuery(
    api.modifierAssignments.listForProduct,
    editingId ? { productId: editingId } : "skip",
  );

  // Modifier mutations
  const assignModifier = useMutation(api.modifierAssignments.assign);
  const unassignModifier = useMutation(api.modifierAssignments.unassign);

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onBlur: productSchema,
      onSubmit: productSchema,
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
        toast.error(error instanceof Error ? error.message : "Failed to save product");
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

  const handleQuickCategoryCreated = (categoryId: string) => {
    form.setFieldValue("categoryId", categoryId);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Product" : "Create Product"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the product details below."
                : "Fill in the details to create a new product."}
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
              {/* Category Select */}
              <form.Field
                name="categoryId"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="product-category">Category</FieldLabel>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => {
                          if (value === QUICK_CREATE_CATEGORY_VALUE) {
                            setShowQuickCreateCategory(true);
                            return;
                          }
                          field.handleChange(value);
                        }}
                        disabled={!categories || categories.length === 0}
                      >
                        <SelectTrigger id="product-category">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories?.map((category) => (
                            <SelectItem key={category._id} value={category._id}>
                              {category.parentId ? "\u2514 " : ""}
                              {category.name}
                            </SelectItem>
                          ))}
                          <Separator className="my-1" />
                          <SelectItem value={QUICK_CREATE_CATEGORY_VALUE}>
                            <span className="flex items-center gap-1">
                              <Plus className="h-3 w-3" />
                              Create New Category
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {(!categories || categories.length === 0) && (
                        <p className="text-xs text-red-500">
                          Please create a category first, or use the quick-create option above.
                        </p>
                      )}
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              {/* Product Name */}
              <form.Field
                name="name"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="product-name">Product Name</FieldLabel>
                      <Input
                        id="product-name"
                        autoFocus
                        aria-invalid={hasErrors || undefined}
                        placeholder="Enter product name"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              {/* Open Price Checkbox */}
              <form.Field
                name="isOpenPrice"
                children={(field) => (
                  <Field orientation="horizontal">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="product-isOpenPrice"
                        checked={field.state.value}
                        onChange={(e) => {
                          field.handleChange(e.target.checked);
                          if (e.target.checked) {
                            form.setFieldValue("price", 0);
                          }
                        }}
                      />
                      <FieldLabel htmlFor="product-isOpenPrice">
                        Open Price (cashier enters price)
                      </FieldLabel>
                    </div>
                  </Field>
                )}
              />

              {/* Price & Sort Order (non-open-price) */}
              <form.Subscribe
                selector={(state) => state.values.isOpenPrice}
                children={(isOpenPrice) =>
                  !isOpenPrice ? (
                    <div className="grid grid-cols-2 gap-4">
                      <form.Field
                        name="price"
                        children={(field) => {
                          const hasErrors =
                            field.state.meta.isTouched && field.state.meta.errors.length > 0;
                          return (
                            <Field data-invalid={hasErrors || undefined}>
                              <FieldLabel htmlFor="product-price">Price (VAT-inclusive)</FieldLabel>
                              <Input
                                id="product-price"
                                type="number"
                                step="0.01"
                                aria-invalid={hasErrors || undefined}
                                value={field.state.value}
                                onChange={(e) =>
                                  field.handleChange(Number.parseFloat(e.target.value) || 0)
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
                              <FieldLabel htmlFor="product-sortOrder">Sort Order</FieldLabel>
                              <Input
                                id="product-sortOrder"
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
                  ) : (
                    <>
                      {/* Min Price & Max Price */}
                      <div className="grid grid-cols-2 gap-4">
                        <form.Field
                          name="minPrice"
                          children={(field) => {
                            const hasErrors =
                              field.state.meta.isTouched && field.state.meta.errors.length > 0;
                            return (
                              <Field data-invalid={hasErrors || undefined}>
                                <FieldLabel htmlFor="product-minPrice">Minimum Price</FieldLabel>
                                <Input
                                  id="product-minPrice"
                                  type="number"
                                  step="0.01"
                                  aria-invalid={hasErrors || undefined}
                                  value={field.state.value}
                                  onChange={(e) =>
                                    field.handleChange(Number.parseFloat(e.target.value) || 0)
                                  }
                                  onBlur={field.handleBlur}
                                />
                                <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                              </Field>
                            );
                          }}
                        />
                        <form.Field
                          name="maxPrice"
                          children={(field) => {
                            const hasErrors =
                              field.state.meta.isTouched && field.state.meta.errors.length > 0;
                            return (
                              <Field data-invalid={hasErrors || undefined}>
                                <FieldLabel htmlFor="product-maxPrice">Maximum Price</FieldLabel>
                                <Input
                                  id="product-maxPrice"
                                  type="number"
                                  step="0.01"
                                  aria-invalid={hasErrors || undefined}
                                  value={field.state.value}
                                  onChange={(e) =>
                                    field.handleChange(Number.parseFloat(e.target.value) || 0)
                                  }
                                  onBlur={field.handleBlur}
                                />
                                <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                              </Field>
                            );
                          }}
                        />
                      </div>
                      {/* Sort Order (open price) */}
                      <form.Field
                        name="sortOrder"
                        children={(field) => {
                          const hasErrors =
                            field.state.meta.isTouched && field.state.meta.errors.length > 0;
                          return (
                            <Field data-invalid={hasErrors || undefined}>
                              <FieldLabel htmlFor="product-sortOrder-open">Sort Order</FieldLabel>
                              <Input
                                id="product-sortOrder-open"
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
                    </>
                  )
                }
              />

              {/* VAT Status & Active Status */}
              <div className="grid grid-cols-2 gap-4">
                <form.Field
                  name="isVatable"
                  children={(field) => (
                    <Field>
                      <FieldLabel htmlFor="product-isVatable">VAT Status</FieldLabel>
                      <Select
                        value={field.state.value ? "vat" : "non-vat"}
                        onValueChange={(value) => field.handleChange(value === "vat")}
                      >
                        <SelectTrigger id="product-isVatable">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="vat">VAT-able (12%)</SelectItem>
                          <SelectItem value="non-vat">Non-VAT</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
                {isEditing && (
                  <form.Field
                    name="isActive"
                    children={(field) => (
                      <Field>
                        <FieldLabel htmlFor="product-isActive">Status</FieldLabel>
                        <Select
                          value={field.state.value ? "active" : "inactive"}
                          onValueChange={(value) => field.handleChange(value === "active")}
                        >
                          <SelectTrigger id="product-isActive">
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
              </div>
            </FieldGroup>

            {/* Modifier Assignments (edit mode only, outside form validation) */}
            {isEditing && (
              <div className="flex flex-col gap-2 py-4 border-t">
                <FieldLabel className="flex items-center gap-1">
                  <SlidersHorizontal className="h-4 w-4" />
                  Modifier Groups
                </FieldLabel>
                {productAssignments && productAssignments.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {productAssignments.map((a) => (
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
                  <p className="text-xs text-gray-500">No modifiers assigned.</p>
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
                          (g) => !productAssignments?.some((a) => a.modifierGroupId === g._id),
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
                          productId: editingId,
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

            {/* VAT Breakdown */}
            <form.Subscribe
              selector={(state) => ({
                isOpenPrice: state.values.isOpenPrice,
                price: state.values.price,
                isVatable: state.values.isVatable,
              })}
              children={({ isOpenPrice, price, isVatable }) =>
                !isOpenPrice && price > 0 ? (
                  <div className="bg-gray-50 p-3 rounded-md text-sm">
                    <p className="text-gray-600">
                      <strong>Net Price (before VAT):</strong>{" "}
                      {formatCurrency(isVatable ? price / 1.12 : price)}
                    </p>
                    {isVatable && (
                      <p className="text-gray-600">
                        <strong>VAT (12%):</strong> {formatCurrency(price - price / 1.12)}
                      </p>
                    )}
                  </div>
                ) : null
              }
            />

            <DialogFooter className="mt-4 gap-2 sm:gap-0">
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

      {/* Quick Create Category (stacked dialog) */}
      <QuickCreateCategoryDialog
        open={showQuickCreateCategory}
        onOpenChange={setShowQuickCreateCategory}
        onCreated={handleQuickCategoryCreated}
      />

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
              productId: editingId,
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
