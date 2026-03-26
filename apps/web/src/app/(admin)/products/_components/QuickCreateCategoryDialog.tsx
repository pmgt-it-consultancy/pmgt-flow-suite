"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { z } from "zod";
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
import { useAdminStore } from "@/stores/useAdminStore";

const quickCategorySchema = z.object({
  name: z.string().min(1, "Name is required"),
});

interface QuickCreateCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (categoryId: string) => void;
}

/** Map TanStack Form errors to the shape FieldError expects. */
function normalizeErrors(errors: unknown[]): Array<{ message?: string } | undefined> {
  return errors.map((e) => (typeof e === "string" ? { message: e } : (e as { message?: string })));
}

export function QuickCreateCategoryDialog({
  open,
  onOpenChange,
  onCreated,
}: QuickCreateCategoryDialogProps) {
  const { selectedStoreId } = useAdminStore();
  const createCategory = useMutation(api.categories.create);

  const form = useForm({
    defaultValues: { name: "" },
    validators: {
      onBlur: quickCategorySchema,
      onSubmit: quickCategorySchema,
    },
    onSubmit: async ({ value }) => {
      if (!selectedStoreId) return;
      try {
        const newCategoryId = await createCategory({
          storeId: selectedStoreId,
          name: value.name,
        });
        toast.success("Category created successfully");
        onCreated(newCategoryId);
        onOpenChange(false);
        form.reset();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create category");
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create Category</DialogTitle>
          <DialogDescription>Quickly create a new category for this product.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <FieldGroup className="py-4">
            <form.Field
              name="name"
              children={(field) => {
                const hasErrors = field.state.meta.isTouched && field.state.meta.errors.length > 0;
                return (
                  <Field data-invalid={hasErrors || undefined}>
                    <FieldLabel htmlFor="quick-category-name">Category Name</FieldLabel>
                    <Input
                      id="quick-category-name"
                      autoFocus
                      aria-invalid={hasErrors || undefined}
                      placeholder="e.g., Beverages, Mains"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                  </Field>
                );
              }}
            />
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
            <Button type="submit" disabled={form.state.isSubmitting}>
              {form.state.isSubmitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
