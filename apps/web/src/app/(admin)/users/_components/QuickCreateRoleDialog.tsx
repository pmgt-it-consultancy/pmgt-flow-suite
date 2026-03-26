"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "convex/react";
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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const quickRoleSchema = z.object({
  name: z.string().min(1, "Role name is required"),
  scopeLevel: z.enum(["branch", "parent"], {
    message: "Scope level is required",
  }),
});

interface QuickCreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (roleId: string) => void;
}

/** Map TanStack Form errors to the shape FieldError expects. */
function normalizeErrors(errors: unknown[]): Array<{ message?: string } | undefined> {
  return errors.map((e) => (typeof e === "string" ? { message: e } : (e as { message?: string })));
}

export function QuickCreateRoleDialog({
  open,
  onOpenChange,
  onCreated,
}: QuickCreateRoleDialogProps) {
  const createRole = useMutation(api.roles.create);

  const form = useForm({
    defaultValues: { name: "", scopeLevel: "branch" },
    validators: {
      onBlur: quickRoleSchema,
      onSubmit: quickRoleSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        const newRoleId = await createRole({
          name: value.name,
          permissions: [],
          scopeLevel: value.scopeLevel as "branch" | "parent",
        });
        toast.success("Role created successfully");
        onCreated(newRoleId);
        onOpenChange(false);
        form.reset();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to create role");
      }
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({ name: "", scopeLevel: "branch" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Create Role</DialogTitle>
          <DialogDescription>Quickly create a new role for this user.</DialogDescription>
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
                    <FieldLabel htmlFor="quick-role-name">Role Name</FieldLabel>
                    <Input
                      id="quick-role-name"
                      autoFocus
                      aria-invalid={hasErrors || undefined}
                      placeholder="e.g., Cashier, Manager"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                    <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                  </Field>
                );
              }}
            />

            <form.Field
              name="scopeLevel"
              children={(field) => {
                const hasErrors = field.state.meta.isTouched && field.state.meta.errors.length > 0;
                return (
                  <Field data-invalid={hasErrors || undefined}>
                    <FieldLabel htmlFor="quick-role-scope">Scope Level</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => field.handleChange(value as "branch" | "parent")}
                    >
                      <SelectTrigger id="quick-role-scope">
                        <SelectValue placeholder="Select scope" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="branch">Branch</SelectItem>
                        <SelectItem value="parent">Parent</SelectItem>
                      </SelectContent>
                    </Select>
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
