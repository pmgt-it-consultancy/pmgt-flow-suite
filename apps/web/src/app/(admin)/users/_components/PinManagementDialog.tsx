"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useForm } from "@tanstack/react-form";
import { useEffect } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { normalizeErrors } from "../../_shared/normalizeErrors";
import { useUserMutations } from "../_hooks";
import { pinSchema } from "../_schemas";

interface PinManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: Id<"users"> | null;
  userName: string;
  hasPin: boolean;
}

export function PinManagementDialog({
  open,
  onOpenChange,
  userId,
  userName,
  hasPin,
}: PinManagementDialogProps) {
  const { handleSetPin, handleClearPin } = useUserMutations();

  const form = useForm({
    defaultValues: { pin: "" },
    validators: {
      onSubmit: pinSchema,
    },
    onSubmit: async ({ value }) => {
      if (!userId) return;
      try {
        const result = await handleSetPin(userId, value.pin);
        if (result.success) {
          onOpenChange(false);
          form.reset();
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to set PIN");
      }
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({ pin: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onClearPin = async () => {
    if (!userId) return;
    try {
      const result = await handleClearPin(userId);
      if (result.success) {
        onOpenChange(false);
        form.reset();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove PIN");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manage PIN &mdash; {userName}</DialogTitle>
          <DialogDescription>Set or remove the manager PIN for approvals.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <FieldGroup className="py-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Status:</span>
              <Badge variant={hasPin ? "default" : "secondary"}>
                {hasPin ? "PIN set" : "No PIN set"}
              </Badge>
            </div>

            <form.Field
              name="pin"
              children={(field) => {
                const hasErrors = field.state.meta.isTouched && field.state.meta.errors.length > 0;
                return (
                  <Field data-invalid={hasErrors || undefined}>
                    <FieldLabel htmlFor="user-pin">New PIN (4-6 digits)</FieldLabel>
                    <Input
                      id="user-pin"
                      type="password"
                      autoFocus
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      aria-invalid={hasErrors || undefined}
                      placeholder="Enter PIN"
                      value={field.state.value}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "");
                        field.handleChange(val);
                      }}
                      onBlur={field.handleBlur}
                    />
                    <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                  </Field>
                );
              }}
            />
          </FieldGroup>

          <DialogFooter className="flex gap-2 sm:justify-between">
            {hasPin && (
              <Button
                type="button"
                variant="destructive"
                onClick={onClearPin}
                disabled={form.state.isSubmitting}
              >
                Remove PIN
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={form.state.isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.state.isSubmitting}>
                {form.state.isSubmitting ? "Saving..." : "Save PIN"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
