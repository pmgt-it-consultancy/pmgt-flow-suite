"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useForm } from "@tanstack/react-form";
import { useEffect } from "react";
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
import { useUserMutations } from "../_hooks";
import { resetPasswordSchema } from "../_schemas";

interface ResetPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: Id<"users"> | null;
}

/** Map TanStack Form errors to the shape FieldError expects. */
function normalizeErrors(errors: unknown[]): Array<{ message?: string } | undefined> {
  return errors.map((e) => (typeof e === "string" ? { message: e } : (e as { message?: string })));
}

export function ResetPasswordDialog({ open, onOpenChange, userId }: ResetPasswordDialogProps) {
  const { handleResetPassword } = useUserMutations();

  const form = useForm({
    defaultValues: { password: "" },
    validators: {
      onBlur: resetPasswordSchema,
      onSubmit: resetPasswordSchema,
    },
    onSubmit: async ({ value }) => {
      if (!userId) return;
      try {
        const result = await handleResetPassword(userId, value.password);
        if (result.success) {
          onOpenChange(false);
          form.reset();
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to reset password");
      }
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({ password: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>Enter a new password for this user.</DialogDescription>
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
              name="password"
              children={(field) => {
                const hasErrors = field.state.meta.isTouched && field.state.meta.errors.length > 0;
                return (
                  <Field data-invalid={hasErrors || undefined}>
                    <FieldLabel htmlFor="reset-password">New Password</FieldLabel>
                    <Input
                      id="reset-password"
                      type="password"
                      autoFocus
                      aria-invalid={hasErrors || undefined}
                      placeholder="Enter new password"
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
              {form.state.isSubmitting ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
