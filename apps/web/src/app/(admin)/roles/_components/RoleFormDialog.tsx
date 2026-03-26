"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useForm } from "@tanstack/react-form";
import { ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { normalizeErrors } from "../../_shared/normalizeErrors";
import { useRoleMutations } from "../_hooks";
import { type RoleFormValues, roleDefaults, roleSchema } from "../_schemas";

type ScopeLevel = "system" | "parent" | "branch";

interface User {
  scopeLevel: ScopeLevel;
}

interface RoleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: Id<"roles"> | null;
  initialValues?: RoleFormValues;
  onSaveAndCreateAnother?: () => RoleFormValues;
  user: User | null;
  permissionCategories: Record<string, Array<[string, string]>>;
}

const categoryLabels: Record<string, string> = {
  orders: "Orders",
  checkout: "Checkout",
  discounts: "Discounts",
  tables: "Tables",
  products: "Products",
  categories: "Categories",
  modifiers: "Modifiers",
  reports: "Reports",
  users: "Users",
  stores: "Stores",
  system: "System",
};

export function RoleFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
  onSaveAndCreateAnother,
  user,
  permissionCategories,
}: RoleFormDialogProps) {
  const { handleCreate, handleUpdate } = useRoleMutations();
  const saveAndCreateAnotherRef = useRef(false);

  const isEditing = editingId !== null;
  const defaults = initialValues ?? roleDefaults;

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onBlur: roleSchema,
      onSubmit: roleSchema,
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
          const freshDefaults = onSaveAndCreateAnother?.() ?? defaults;
          form.reset(freshDefaults);
        } else {
          onOpenChange(false);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save role");
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
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Role" : "Create Role"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the role name, scope, and permissions."
              : "Create a new role with a custom permission set."}
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
            {/* Name & Scope side by side */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Role Name */}
              <form.Field
                name="name"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="role-name">Role Name</FieldLabel>
                      <Input
                        id="role-name"
                        autoFocus
                        aria-invalid={hasErrors || undefined}
                        placeholder="e.g. Cashier Lead"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              {/* Scope Level */}
              <form.Field
                name="scopeLevel"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="role-scope">Scope Level</FieldLabel>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => field.handleChange(value as ScopeLevel)}
                      >
                        <SelectTrigger id="role-scope">
                          <SelectValue placeholder="Select scope" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="branch">Branch</SelectItem>
                          <SelectItem value="parent">Parent</SelectItem>
                          {user?.scopeLevel === "system" && (
                            <SelectItem value="system">System</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />
            </div>

            {/* Permissions */}
            <form.Field
              name="permissions"
              children={(field) => {
                const hasErrors = field.state.meta.isTouched && field.state.meta.errors.length > 0;
                const currentPermissions = field.state.value;

                const togglePermission = (permission: string, checked: boolean) => {
                  const updated = checked
                    ? Array.from(new Set([...currentPermissions, permission]))
                    : currentPermissions.filter((v) => v !== permission);
                  field.handleChange(updated);
                };

                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      <div>
                        <h3 className="font-semibold">Permissions</h3>
                        <p className="text-sm text-gray-500">
                          Enable the capabilities this role should have in the POS system.
                        </p>
                      </div>
                    </div>

                    {hasErrors && <FieldError errors={normalizeErrors(field.state.meta.errors)} />}

                    <div className="grid gap-4 md:grid-cols-2">
                      {Object.entries(permissionCategories).map(([category, permissions]) => (
                        <Card key={category}>
                          <CardHeader className="pb-3">
                            <CardTitle className="text-base">
                              {categoryLabels[category] ?? category}
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-3">
                            {permissions.map(([permission, description]) => {
                              const checked = currentPermissions.includes(permission);
                              return (
                                <div
                                  key={permission}
                                  className="flex items-start justify-between gap-4 rounded-lg border p-3"
                                >
                                  <div className="flex flex-col gap-1">
                                    <p className="font-mono text-xs font-medium">{permission}</p>
                                    <p className="text-sm text-gray-500">{description}</p>
                                  </div>
                                  <Switch
                                    checked={checked}
                                    onCheckedChange={(value) => togglePermission(permission, value)}
                                  />
                                </div>
                              );
                            })}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
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
              {form.state.isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
