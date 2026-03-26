"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { normalizeErrors } from "../../_shared/normalizeErrors";
import { useUserMutations } from "../_hooks";
import { type UserFormValues, userDefaults, userSchema } from "../_schemas";
import { QuickCreateRoleDialog } from "./QuickCreateRoleDialog";

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: Id<"users"> | null;
  initialValues?: UserFormValues;
  onSaveAndCreateAnother?: () => UserFormValues;
}

export function UserFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
  onSaveAndCreateAnother,
}: UserFormDialogProps) {
  const { isAuthenticated } = useAuth();
  const { handleCreate, handleUpdate } = useUserMutations();
  const saveAndCreateAnotherRef = useRef(false);
  const [isQuickCreateRoleOpen, setIsQuickCreateRoleOpen] = useState(false);

  const roles = useQuery(api.roles.list, isAuthenticated ? {} : "skip");
  const stores = useQuery(api.stores.list, isAuthenticated ? {} : "skip");

  const isEditing = editingId !== null;
  const defaults = initialValues ?? userDefaults;

  const form = useForm({
    defaultValues: defaults,
    validators: {
      onSubmit: userSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        if (isEditing) {
          await handleUpdate(value, editingId);
        } else {
          const result = await handleCreate(value);
          if (!result.success) {
            return;
          }
        }

        if (saveAndCreateAnotherRef.current) {
          saveAndCreateAnotherRef.current = false;
          const freshDefaults = onSaveAndCreateAnother?.() ?? defaults;
          form.reset(freshDefaults);
        } else {
          onOpenChange(false);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save user");
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

  const handleRoleCreated = (roleId: string) => {
    form.setFieldValue("roleId", roleId);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit User" : "Create User"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update the user details below."
                : "Fill in the details to create a new user."}
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
              {/* Full Name */}
              <form.Field
                name="name"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="user-name">Full Name</FieldLabel>
                      <Input
                        id="user-name"
                        autoFocus
                        aria-invalid={hasErrors || undefined}
                        placeholder="Enter full name"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              {/* Email */}
              <form.Field
                name="email"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="user-email">Email</FieldLabel>
                      <Input
                        id="user-email"
                        type="email"
                        aria-invalid={hasErrors || undefined}
                        placeholder="Enter email address"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        disabled={isEditing}
                      />
                      {isEditing && (
                        <FieldDescription>Email cannot be changed after creation.</FieldDescription>
                      )}
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              {/* Password (create mode only) */}
              {!isEditing && (
                <form.Field
                  name="password"
                  validators={{
                    onBlur: ({ value }) =>
                      !isEditing && (!value || value.length === 0)
                        ? "Password is required"
                        : undefined,
                    onSubmit: ({ value }) =>
                      !isEditing && (!value || value.length === 0)
                        ? "Password is required"
                        : undefined,
                  }}
                  children={(field) => {
                    const hasErrors =
                      field.state.meta.isTouched && field.state.meta.errors.length > 0;
                    return (
                      <Field data-invalid={hasErrors || undefined}>
                        <FieldLabel htmlFor="user-password">Password</FieldLabel>
                        <Input
                          id="user-password"
                          type="password"
                          aria-invalid={hasErrors || undefined}
                          placeholder="Enter password"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                        />
                        <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                      </Field>
                    );
                  }}
                />
              )}

              {/* Role */}
              <form.Field
                name="roleId"
                children={(field) => {
                  const hasErrors =
                    field.state.meta.isTouched && field.state.meta.errors.length > 0;
                  return (
                    <Field data-invalid={hasErrors || undefined}>
                      <FieldLabel htmlFor="user-role">Role</FieldLabel>
                      <Select
                        value={field.state.value}
                        onValueChange={(value) => {
                          if (value === "__create_new__") {
                            setIsQuickCreateRoleOpen(true);
                            return;
                          }
                          field.handleChange(value);
                        }}
                      >
                        <SelectTrigger id="user-role" aria-invalid={hasErrors || undefined}>
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles?.map((role) => (
                            <SelectItem key={role._id} value={role._id}>
                              {role.name}
                            </SelectItem>
                          ))}
                          <SelectItem value="__create_new__">
                            <span className="flex items-center gap-1">
                              <Plus className="h-3.5 w-3.5" />
                              Create New Role
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                    </Field>
                  );
                }}
              />

              {/* Store */}
              <form.Field
                name="storeId"
                children={(field) => (
                  <Field>
                    <FieldLabel htmlFor="user-store">Assigned Store</FieldLabel>
                    <Select
                      value={field.state.value ?? "none"}
                      onValueChange={(value) =>
                        field.handleChange(value === "none" ? undefined : value)
                      }
                    >
                      <SelectTrigger id="user-store">
                        <SelectValue placeholder="Select store" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Store (System-wide)</SelectItem>
                        {stores?.map((store) => (
                          <SelectItem key={store._id} value={store._id}>
                            {store.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldDescription>
                      Super Admins typically have no assigned store.
                    </FieldDescription>
                  </Field>
                )}
              />

              {/* Status (edit mode only) */}
              {isEditing && (
                <form.Field
                  name="isActive"
                  children={(field) => (
                    <Field>
                      <FieldLabel htmlFor="user-status">Status</FieldLabel>
                      <Select
                        value={field.state.value ? "active" : "inactive"}
                        onValueChange={(value) => field.handleChange(value === "active")}
                      >
                        <SelectTrigger id="user-status">
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

      <QuickCreateRoleDialog
        open={isQuickCreateRoleOpen}
        onOpenChange={setIsQuickCreateRoleOpen}
        onCreated={handleRoleCreated}
      />
    </>
  );
}
