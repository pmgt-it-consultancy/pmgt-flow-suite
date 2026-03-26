"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface EditingTab {
  orderId: Id<"orders">;
  tabName: string;
  tabNumber: number;
}

interface TabNameDialogProps {
  editingTab: EditingTab | null;
  onClose: () => void;
  onSave: (newName: string) => Promise<void>;
}

export function TabNameDialog({ editingTab, onClose, onSave }: TabNameDialogProps) {
  const [newTabName, setNewTabName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Sync local state when editingTab changes
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const handleResetTabName = () => {
    if (!editingTab) return;
    setNewTabName(`Tab ${editingTab.tabNumber}`);
  };

  const handleSubmit = async () => {
    if (!editingTab) return;
    setIsSaving(true);
    try {
      await onSave(newTabName.trim() || `Tab ${editingTab.tabNumber}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      open={!!editingTab}
      onOpenChange={(open) => {
        if (open && editingTab) {
          setNewTabName(editingTab.tabName);
        }
        handleOpenChange(open);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Tab Name</DialogTitle>
          <DialogDescription>Rename this tab for easier identification.</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSubmit();
          }}
        >
          <div className="py-4">
            <Field>
              <FieldLabel htmlFor="tabName">Tab Name</FieldLabel>
              <Input
                id="tabName"
                autoFocus
                value={newTabName}
                onChange={(e) => setNewTabName(e.target.value)}
                placeholder={`Tab ${editingTab?.tabNumber ?? 1}`}
              />
            </Field>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleResetTabName}
              className="mr-auto"
            >
              Reset to Default
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
