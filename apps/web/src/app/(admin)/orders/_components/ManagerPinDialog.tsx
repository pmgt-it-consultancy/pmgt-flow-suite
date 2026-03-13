"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ManagerPinDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: Id<"stores">;
  onSubmit: (managerId: Id<"users">, pin: string) => void;
  isSubmitting: boolean;
}

export function ManagerPinDialog({
  open,
  onOpenChange,
  storeId,
  onSubmit,
  isSubmitting,
}: ManagerPinDialogProps) {
  const managers = useQuery(api.helpers.usersHelpers.listManagers, { storeId });
  const [selectedManagerId, setSelectedManagerId] = useState<Id<"users"> | null>(null);
  const [pin, setPin] = useState("");

  const handleSubmit = () => {
    if (!selectedManagerId || pin.length < 4) return;
    onSubmit(selectedManagerId, pin);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setSelectedManagerId(null);
      setPin("");
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Manager Approval Required</DialogTitle>
          <DialogDescription>
            Select a manager and enter their PIN to approve this action.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Manager</Label>
            <div className="grid gap-2 max-h-40 overflow-y-auto">
              {managers?.map((manager) => (
                <button
                  key={manager._id}
                  type="button"
                  onClick={() => setSelectedManagerId(manager._id)}
                  className={`flex items-center justify-between px-3 py-2 rounded-md border text-sm transition-colors ${
                    selectedManagerId === manager._id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <span className="font-medium">{manager.name}</span>
                  <span className="text-gray-500 text-xs">{manager.roleName}</span>
                </button>
              ))}
            </div>
          </div>

          {selectedManagerId && (
            <div className="grid gap-2">
              <Label htmlFor="manager-pin">PIN</Label>
              <Input
                id="manager-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="Enter PIN"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmit();
                }}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSubmit}
            disabled={isSubmitting || !selectedManagerId || pin.length < 4}
          >
            {isSubmitting ? "Processing..." : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
