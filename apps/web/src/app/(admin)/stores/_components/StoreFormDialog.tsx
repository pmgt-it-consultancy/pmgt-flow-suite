"use client";

import { useMaskito } from "@maskito/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "convex/react";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { normalizeErrors } from "../../_shared/normalizeErrors";
import { useStoreMutations } from "../_hooks";
import { type StoreFormValues, storeDefaults, storeSchema } from "../_schemas";

interface StoreFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: Id<"stores"> | null;
  initialValues?: StoreFormValues;
  onSaveAndCreateAnother?: () => StoreFormValues;
}

export function StoreFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
  onSaveAndCreateAnother,
}: StoreFormDialogProps) {
  const { isAuthenticated } = useAuth();
  const { handleCreate, handleUpdate } = useStoreMutations();
  const saveAndCreateAnotherRef = useRef(false);

  const isEditing = editingId !== null;
  const defaults = initialValues ?? storeDefaults;

  // Fetch parent stores for the dropdown
  const stores = useQuery(api.stores.list, isAuthenticated ? {} : "skip");
  const parentStores = stores?.filter((s) => !s.parentId) ?? [];

  // TIN input mask (format: 000-000-000-000)
  const tinMaskRef = useMaskito({
    options: {
      mask: [/\d/, /\d/, /\d/, "-", /\d/, /\d/, /\d/, "-", /\d/, /\d/, /\d/, "-", /\d/, /\d/, /\d/],
    },
  });

  // Philippine mobile number mask
  const contactNumberMaskRef = useMaskito({
    options: {
      mask: ({ value }) => {
        const digits = value.replace(/\D/g, "");
        if (value.startsWith("+")) {
          // +63-926-038-5084
          return [
            "+",
            "6",
            "3",
            "-",
            /\d/,
            /\d/,
            /\d/,
            "-",
            /\d/,
            /\d/,
            /\d/,
            "-",
            /\d/,
            /\d/,
            /\d/,
            /\d/,
          ];
        }
        if (digits.startsWith("63")) {
          // 63-926-038-5084
          return [
            "6",
            "3",
            "-",
            /\d/,
            /\d/,
            /\d/,
            "-",
            /\d/,
            /\d/,
            /\d/,
            "-",
            /\d/,
            /\d/,
            /\d/,
            /\d/,
          ];
        }
        // 0926-038-5084 (default local format)
        return ["0", /\d/, /\d/, /\d/, "-", /\d/, /\d/, /\d/, "-", /\d/, /\d/, /\d/, /\d/];
      },
    },
  });

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onSubmit: storeSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        if (isEditing) {
          await handleUpdate(value, editingId);
        } else {
          await handleCreate(value);
        }

        if (saveAndCreateAnotherRef.current) {
          saveAndCreateAnotherRef.current = false;
          const freshDefaults = onSaveAndCreateAnother?.() ?? storeDefaults;
          form.reset(freshDefaults);
        } else {
          onOpenChange(false);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save store");
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Store" : "Create Store"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the store details below."
              : "Fill in the details to create a new store."}
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
            {/* Store Name */}
            <form.Field
              name="name"
              children={(field) => {
                const hasErrors = field.state.meta.isTouched && field.state.meta.errors.length > 0;
                return (
                  <Field data-invalid={hasErrors || undefined}>
                    <FieldLabel htmlFor="store-name">Store Name</FieldLabel>
                    <Input
                      id="store-name"
                      autoFocus
                      aria-invalid={hasErrors || undefined}
                      placeholder="Enter store name"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                  </Field>
                );
              }}
            />

            {/* Parent Store */}
            <form.Field
              name="parentId"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor="store-parentId">Parent Store (Optional)</FieldLabel>
                  <Select
                    value={field.state.value ?? "none"}
                    onValueChange={(value) =>
                      field.handleChange(value === "none" ? undefined : value)
                    }
                  >
                    <SelectTrigger id="store-parentId">
                      <SelectValue placeholder="Select parent store" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Parent (Main Store)</SelectItem>
                      {parentStores
                        .filter((s) => s._id !== editingId)
                        .map((store) => (
                          <SelectItem key={store._id} value={store._id}>
                            {store.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500">
                    Select a parent store to create this as a branch.
                  </p>
                </Field>
              )}
            />

            {/* Address Line 1 */}
            <form.Field
              name="address1"
              children={(field) => {
                const hasErrors = field.state.meta.isTouched && field.state.meta.errors.length > 0;
                return (
                  <Field data-invalid={hasErrors || undefined}>
                    <FieldLabel htmlFor="store-address1">Address Line 1</FieldLabel>
                    <Input
                      id="store-address1"
                      aria-invalid={hasErrors || undefined}
                      placeholder="Street address"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                  </Field>
                );
              }}
            />

            {/* Address Line 2 */}
            <form.Field
              name="address2"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor="store-address2">Address Line 2 (Optional)</FieldLabel>
                  <Input
                    id="store-address2"
                    placeholder="Building, floor, etc."
                    value={field.state.value ?? ""}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                </Field>
              )}
            />

            {/* TIN & MIN side by side */}
            <div className="grid grid-cols-2 gap-4 items-start">
              <form.Field
                name="tin"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="store-tin">TIN (Tax ID)</FieldLabel>
                      <Input
                        id="store-tin"
                        ref={tinMaskRef}
                        aria-invalid={hasErrors || undefined}
                        placeholder="000-000-000-000"
                        value={field.state.value}
                        onInput={(e) => field.handleChange(e.currentTarget.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              <form.Field
                name="min"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="store-min">MIN (Machine ID)</FieldLabel>
                    <Input
                      id="store-min"
                      placeholder="Auto-generated if empty"
                      value={field.state.value ?? ""}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    <p className="text-xs text-gray-500">
                      Leave blank to auto-generate. Update when BIR-registered.
                    </p>
                  </Field>
                )}
              />
            </div>

            {/* VAT Rate & Status side by side */}
            <div className="grid grid-cols-2 gap-4 justify-start">
              <form.Field
                name="vatRate"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="store-vatRate">VAT Rate (%)</FieldLabel>
                      <Input
                        id="store-vatRate"
                        type="number"
                        min={0}
                        aria-invalid={hasErrors || undefined}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(Number.parseFloat(e.target.value) || 0)}
                        onBlur={field.handleBlur}
                      />
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
                      <FieldLabel htmlFor="store-isActive">Status</FieldLabel>
                      <Select
                        value={field.state.value ? "active" : "inactive"}
                        onValueChange={(value) => field.handleChange(value === "active")}
                      >
                        <SelectTrigger id="store-isActive">
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

            <FieldSeparator>Contact Information</FieldSeparator>

            {/* Contact Number & Telephone side by side */}
            <div className="grid grid-cols-2 gap-4 items-start">
              <form.Field
                name="contactNumber"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="store-contactNumber">Contact Number</FieldLabel>
                    <Input
                      id="store-contactNumber"
                      ref={contactNumberMaskRef}
                      placeholder="0917-123-4567"
                      value={field.state.value ?? ""}
                      onInput={(e) => field.handleChange(e.currentTarget.value)}
                      onBlur={field.handleBlur}
                    />
                    <p className="text-xs text-gray-500">
                      Formats: 0917-123-4567, +63-917-123-4567, 63-917-123-4567
                    </p>
                  </Field>
                )}
              />

              <form.Field
                name="telephone"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="store-telephone">Telephone</FieldLabel>
                    <Input
                      id="store-telephone"
                      placeholder="e.g., (02) 8xxx-xxxx"
                      value={field.state.value ?? ""}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </Field>
                )}
              />
            </div>

            {/* Email & Website side by side */}
            <div className="grid grid-cols-2 gap-4">
              <form.Field
                name="email"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="store-email">Email</FieldLabel>
                      <Input
                        id="store-email"
                        type="email"
                        aria-invalid={hasErrors || undefined}
                        placeholder="store@example.com"
                        value={field.state.value ?? ""}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              <form.Field
                name="website"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="store-website">Website</FieldLabel>
                    <Input
                      id="store-website"
                      placeholder="www.example.com"
                      value={field.state.value ?? ""}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </Field>
                )}
              />
            </div>

            <FieldSeparator>Social Links</FieldSeparator>

            {/* Social links array */}
            <form.Field
              name="socials"
              mode="array"
              children={(field) => (
                <div className="flex flex-col gap-4">
                  <FieldError errors={normalizeErrors(field.state.meta.errors)} />

                  {field.state.value.length === 0 ? (
                    <p className="text-xs text-gray-500">No social links added yet.</p>
                  ) : (
                    field.state.value.map((_, index) => (
                      <div key={index} className="flex items-start gap-2">
                        {/* Platform Select */}
                        <form.Field
                          name={`socials[${index}].platform`}
                          children={(subField) => {
                            const hasErrors =
                              subField.state.meta.isTouched &&
                              subField.state.meta.errors.length > 0;
                            return (
                              <Field data-invalid={hasErrors || undefined} className="w-[140px]">
                                {index === 0 && (
                                  <FieldLabel htmlFor={`social-platform-${index}`}>
                                    Platform
                                  </FieldLabel>
                                )}
                                <Select
                                  value={subField.state.value}
                                  onValueChange={(value) => subField.handleChange(value)}
                                >
                                  <SelectTrigger id={`social-platform-${index}`}>
                                    <SelectValue placeholder="Platform" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Facebook">Facebook</SelectItem>
                                    <SelectItem value="Instagram">Instagram</SelectItem>
                                    <SelectItem value="TikTok">TikTok</SelectItem>
                                    <SelectItem value="Twitter">Twitter/X</SelectItem>
                                    <SelectItem value="YouTube">YouTube</SelectItem>
                                    <SelectItem value="LinkedIn">LinkedIn</SelectItem>
                                    <SelectItem value="Other">Other</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FieldError errors={normalizeErrors(subField.state.meta.errors)} />
                              </Field>
                            );
                          }}
                        />

                        {/* URL Input */}
                        <form.Field
                          name={`socials[${index}].url`}
                          children={(subField) => {
                            const hasErrors =
                              subField.state.meta.isTouched &&
                              subField.state.meta.errors.length > 0;
                            return (
                              <Field data-invalid={hasErrors || undefined} className="flex-1">
                                {index === 0 && (
                                  <FieldLabel htmlFor={`social-url-${index}`}>URL</FieldLabel>
                                )}
                                <Input
                                  id={`social-url-${index}`}
                                  aria-invalid={hasErrors || undefined}
                                  placeholder="https://..."
                                  value={subField.state.value}
                                  onChange={(e) => subField.handleChange(e.target.value)}
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
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={() => field.removeValue(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => field.pushValue({ platform: "", url: "" })}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Social
                  </Button>
                </div>
              )}
            />

            <FieldSeparator>Receipt</FieldSeparator>

            {/* Receipt Footer */}
            <form.Field
              name="footer"
              children={(field) => (
                <Field>
                  <FieldLabel htmlFor="store-footer">Receipt Footer</FieldLabel>
                  <Textarea
                    id="store-footer"
                    placeholder="Custom message to display at the bottom of receipts"
                    value={field.state.value ?? ""}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <p className="text-xs text-gray-500">
                    Leave blank to use default: "Thank you for your patronage!"
                  </p>
                </Field>
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
