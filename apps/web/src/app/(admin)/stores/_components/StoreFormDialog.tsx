"use client";

import { useMaskito } from "@maskito/react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Plus, Trash2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStoreFormStore } from "../_stores/useStoreFormStore";

interface ParentStore {
  _id: Id<"stores">;
  name: string;
}

interface StoreFormDialogProps {
  parentStores: ParentStore[];
  onSubmit: () => Promise<void>;
}

export function StoreFormDialog({ parentStores, onSubmit }: StoreFormDialogProps) {
  const {
    isDialogOpen,
    editingStoreId,
    formData,
    isSubmitting,
    closeDialog,
    setFormData,
    addSocial,
    removeSocial,
    updateSocial,
  } = useStoreFormStore();

  // TIN input mask (format: 000-000-000-000)
  const tinMaskRef = useMaskito({
    options: {
      mask: [/\d/, /\d/, /\d/, "-", /\d/, /\d/, /\d/, "-", /\d/, /\d/, /\d/, "-", /\d/, /\d/, /\d/],
    },
  });

  // Philippine mobile number mask
  // Supports: 09260385084, +639260385084, 639260385084
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

  return (
    <Dialog open={isDialogOpen} onOpenChange={(open) => !open && closeDialog()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingStoreId ? "Edit Store" : "Create Store"}</DialogTitle>
          <DialogDescription>
            {editingStoreId
              ? "Update the store details below."
              : "Fill in the details to create a new store."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Basic Info */}
          <div className="grid gap-2">
            <Label htmlFor="name">Store Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ name: e.target.value })}
              placeholder="Enter store name"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="parent">Parent Store (Optional)</Label>
            <Select
              value={formData.parentId ?? "none"}
              onValueChange={(value) =>
                setFormData({ parentId: value === "none" ? undefined : (value as Id<"stores">) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select parent store" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Parent (Main Store)</SelectItem>
                {parentStores
                  .filter((s) => s._id !== editingStoreId)
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
          </div>

          {/* Address */}
          <div className="grid gap-2">
            <Label htmlFor="address1">Address Line 1</Label>
            <Input
              id="address1"
              value={formData.address1}
              onChange={(e) => setFormData({ address1: e.target.value })}
              placeholder="Street address"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="address2">Address Line 2 (Optional)</Label>
            <Input
              id="address2"
              value={formData.address2}
              onChange={(e) => setFormData({ address2: e.target.value })}
              placeholder="Building, floor, etc."
            />
          </div>

          {/* TIN & MIN */}
          <div className="grid grid-cols-2 gap-4 items-start">
            <div className="grid gap-2">
              <Label htmlFor="tin">TIN (Tax ID)</Label>
              <Input
                id="tin"
                ref={tinMaskRef}
                value={formData.tin}
                onInput={(e) => setFormData({ tin: e.currentTarget.value })}
                placeholder="000-000-000-000"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="min">MIN (Machine ID)</Label>
              <Input
                id="min"
                value={formData.min}
                onChange={(e) => setFormData({ min: e.target.value })}
                placeholder="Auto-generated if empty"
              />
              <p className="text-xs text-gray-500">
                Leave blank to auto-generate. Update when BIR-registered.
              </p>
            </div>
          </div>

          {/* VAT Rate & Status */}
          <div className="grid grid-cols-2 gap-4 justify-start">
            <div className="grid gap-2">
              <Label htmlFor="vatRate">VAT Rate (%)</Label>
              <Input
                id="vatRate"
                type="number"
                value={formData.vatRate}
                onChange={(e) => setFormData({ vatRate: parseFloat(e.target.value) || 0 })}
              />
            </div>
            {editingStoreId && (
              <div className="grid gap-2">
                <Label htmlFor="isActive">Status</Label>
                <Select
                  value={formData.isActive ? "active" : "inactive"}
                  onValueChange={(value) => setFormData({ isActive: value === "active" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Contact Information */}
          <div className="border-t pt-4 mt-2">
            <p className="text-sm font-medium text-gray-700 mb-3">
              Contact Information (for receipts)
            </p>

            <div className="grid grid-cols-2 gap-4 items-start">
              <div className="grid gap-2">
                <Label htmlFor="contactNumber">Contact Number</Label>
                <Input
                  id="contactNumber"
                  ref={contactNumberMaskRef}
                  value={formData.contactNumber}
                  onInput={(e) => setFormData({ contactNumber: e.currentTarget.value })}
                  placeholder="0917-123-4567"
                />
                <p className="text-xs text-gray-500">
                  Formats: 0917-123-4567, +63-917-123-4567, 63-917-123-4567
                </p>
              </div>
              <div className="grid gap-2 ">
                <Label htmlFor="telephone">Telephone</Label>
                <Input
                  id="telephone"
                  value={formData.telephone}
                  onChange={(e) => setFormData({ telephone: e.target.value })}
                  placeholder="e.g., (02) 8xxx-xxxx"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ email: e.target.value })}
                  placeholder="store@example.com"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={formData.website}
                  onChange={(e) => setFormData({ website: e.target.value })}
                  placeholder="www.example.com"
                />
              </div>
            </div>

            {/* Social Links */}
            <div className="grid gap-3 mt-4">
              <div className="flex items-center justify-between">
                <Label>Social Links</Label>
                <Button type="button" variant="outline" size="sm" onClick={addSocial}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Social
                </Button>
              </div>
              {formData.socials.length === 0 ? (
                <p className="text-xs text-gray-500">No social links added yet.</p>
              ) : (
                <div className="space-y-2">
                  {formData.socials.map((social, index) => (
                    <div key={index} className="flex gap-2 items-start">
                      <Select
                        value={social.platform}
                        onValueChange={(value) => updateSocial(index, "platform", value)}
                      >
                        <SelectTrigger className="w-[140px]">
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
                      <Input
                        className="flex-1"
                        value={social.url}
                        onChange={(e) => updateSocial(index, "url", e.target.value)}
                        placeholder="https://..."
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => removeSocial(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Receipt Footer */}
            <div className="grid gap-2 mt-4">
              <Label htmlFor="footer">Receipt Footer</Label>
              <textarea
                id="footer"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={formData.footer}
                onChange={(e) => setFormData({ footer: e.target.value })}
                placeholder="Custom message to display at the bottom of receipts"
              />
              <p className="text-xs text-gray-500">
                Leave blank to use default: "Thank you for your patronage!"
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeDialog} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || !formData.name || !formData.address1 || !formData.tin}
          >
            {isSubmitting ? "Saving..." : editingStoreId ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
