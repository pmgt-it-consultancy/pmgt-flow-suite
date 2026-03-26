"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { useEffect } from "react";
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
import { Field, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAdminStore } from "@/stores/useAdminStore";
import { normalizeErrors } from "./normalizeErrors";

const quickOptionSchema = z.object({
  name: z.string().min(1, "Option name is required"),
  priceAdjustment: z.number(),
});

const quickModifierGroupSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  selectionType: z.enum(["single", "multi"]),
  options: z.array(quickOptionSchema).min(1, "At least one option is required"),
});

type QuickModifierGroupFormValues = z.infer<typeof quickModifierGroupSchema>;

const quickDefaults: QuickModifierGroupFormValues = {
  name: "",
  selectionType: "single",
  options: [{ name: "", priceAdjustment: 0 }],
};

interface QuickCreateModifierGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (groupId: string) => void;
}

export function QuickCreateModifierGroupDialog({
  open,
  onOpenChange,
  onCreated,
}: QuickCreateModifierGroupDialogProps) {
  const { selectedStoreId } = useAdminStore();
  const createGroup = useMutation(api.modifierGroups.create);
  const createOption = useMutation(api.modifierOptions.create);

  const form = useForm({
    defaultValues: quickDefaults,
    validators: {
      onSubmit: quickModifierGroupSchema,
    },
    onSubmit: async ({ value }) => {
      if (!selectedStoreId) return;
      try {
        const groupId = await createGroup({
          storeId: selectedStoreId,
          name: value.name,
          selectionType: value.selectionType,
          minSelections: 0,
        });
        for (const option of value.options) {
          await createOption({
            modifierGroupId: groupId,
            name: option.name,
            priceAdjustment: option.priceAdjustment,
          });
        }
        toast.success("Modifier group created");
        onCreated(groupId);
        onOpenChange(false);
        form.reset();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create modifier group");
      }
    },
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      form.reset(quickDefaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Modifier Group</DialogTitle>
          <DialogDescription>Quickly create a new modifier group with options.</DialogDescription>
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
                    <FieldLabel htmlFor="quick-group-name">Group Name</FieldLabel>
                    <Input
                      id="quick-group-name"
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
                  <FieldLabel htmlFor="quick-group-selectionType">Selection Type</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value: "single" | "multi") => field.handleChange(value)}
                  >
                    <SelectTrigger id="quick-group-selectionType">
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

            <FieldSeparator>Options</FieldSeparator>

            {/* Options array */}
            <form.Field
              name="options"
              mode="array"
              children={(field) => (
                <div className="flex flex-col gap-3">
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
                                <FieldLabel htmlFor={`quick-option-name-${index}`}>Name</FieldLabel>
                              )}
                              <Input
                                id={`quick-option-name-${index}`}
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
                                <FieldLabel htmlFor={`quick-option-price-${index}`}>
                                  Price Adj.
                                </FieldLabel>
                              )}
                              <Input
                                id={`quick-option-price-${index}`}
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
                    onClick={() => field.pushValue({ name: "", priceAdjustment: 0 })}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Option
                  </Button>
                </div>
              )}
            />
          </FieldGroup>

          <DialogFooter className="gap-2 sm:gap-0 mt-4">
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
