"use client";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Pencil, Plus, SlidersHorizontal, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { useAdminStore } from "@/stores/useAdminStore";

interface GroupFormData {
  name: string;
  selectionType: "single" | "multi";
  minSelections: number;
  maxSelections: number | undefined;
  isActive: boolean;
}

const initialGroupForm: GroupFormData = {
  name: "",
  selectionType: "single",
  minSelections: 0,
  maxSelections: undefined,
  isActive: true,
};

interface OptionFormData {
  name: string;
  priceAdjustment: number;
  isDefault: boolean;
}

const initialOptionForm: OptionFormData = {
  name: "",
  priceAdjustment: 0,
  isDefault: false,
};

export default function ModifiersPage() {
  const { isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  // Group dialog state
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<Id<"modifierGroups"> | null>(null);
  const [groupForm, setGroupForm] = useState<GroupFormData>(initialGroupForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Options management state
  const [managingGroupId, setManagingGroupId] = useState<Id<"modifierGroups"> | null>(null);
  const [isOptionDialogOpen, setIsOptionDialogOpen] = useState(false);
  const [editingOptionId, setEditingOptionId] = useState<Id<"modifierOptions"> | null>(null);
  const [optionForm, setOptionForm] = useState<OptionFormData>(initialOptionForm);

  // Queries
  const groups = useQuery(
    api.modifierGroups.list,
    isAuthenticated && selectedStoreId
      ? { storeId: selectedStoreId, includeInactive: true }
      : "skip",
  );
  const managingGroup = useQuery(
    api.modifierGroups.get,
    managingGroupId ? { modifierGroupId: managingGroupId } : "skip",
  );

  // Mutations
  const createGroup = useMutation(api.modifierGroups.create);
  const updateGroup = useMutation(api.modifierGroups.update);
  const createOption = useMutation(api.modifierOptions.create);
  const updateOption = useMutation(api.modifierOptions.update);
  const toggleAvailability = useMutation(api.modifierOptions.toggleAvailability);

  // Group handlers
  const handleOpenCreateGroup = () => {
    setEditingGroupId(null);
    setGroupForm(initialGroupForm);
    setIsGroupDialogOpen(true);
  };

  const handleOpenEditGroup = (group: NonNullable<typeof groups>[number]) => {
    setEditingGroupId(group._id);
    setGroupForm({
      name: group.name,
      selectionType: group.selectionType,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      isActive: group.isActive,
    });
    setIsGroupDialogOpen(true);
  };

  const handleSubmitGroup = async () => {
    if (!isAuthenticated || !selectedStoreId) return;
    setIsSubmitting(true);
    try {
      if (editingGroupId) {
        await updateGroup({
          modifierGroupId: editingGroupId,
          name: groupForm.name,
          selectionType: groupForm.selectionType,
          minSelections: groupForm.minSelections,
          maxSelections: groupForm.maxSelections,
          isActive: groupForm.isActive,
        });
        toast.success("Modifier group updated");
      } else {
        await createGroup({
          storeId: selectedStoreId,
          name: groupForm.name,
          selectionType: groupForm.selectionType,
          minSelections: groupForm.minSelections,
          maxSelections: groupForm.maxSelections,
        });
        toast.success("Modifier group created");
      }
      setIsGroupDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save modifier group");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Option handlers
  const handleOpenCreateOption = () => {
    setEditingOptionId(null);
    setOptionForm(initialOptionForm);
    setIsOptionDialogOpen(true);
  };

  const handleOpenEditOption = (option: NonNullable<typeof managingGroup>["options"][number]) => {
    setEditingOptionId(option._id);
    setOptionForm({
      name: option.name,
      priceAdjustment: option.priceAdjustment,
      isDefault: option.isDefault,
    });
    setIsOptionDialogOpen(true);
  };

  const handleSubmitOption = async () => {
    if (!managingGroupId) return;
    setIsSubmitting(true);
    try {
      if (editingOptionId) {
        await updateOption({
          modifierOptionId: editingOptionId,
          name: optionForm.name,
          priceAdjustment: optionForm.priceAdjustment,
          isDefault: optionForm.isDefault,
        });
        toast.success("Option updated");
      } else {
        await createOption({
          modifierGroupId: managingGroupId,
          name: optionForm.name,
          priceAdjustment: optionForm.priceAdjustment,
          isDefault: optionForm.isDefault,
        });
        toast.success("Option created");
      }
      setIsOptionDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save option");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleAvailability = async (optionId: Id<"modifierOptions">) => {
    try {
      await toggleAvailability({ modifierOptionId: optionId });
    } catch (error) {
      toast.error("Failed to toggle availability");
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Modifiers</h1>
          <p className="text-gray-500">Manage modifier groups and options</p>
        </div>
        <Button onClick={handleOpenCreateGroup} disabled={!selectedStoreId}>
          <Plus className="mr-2 h-4 w-4" />
          Add Modifier Group
        </Button>
      </div>

      {/* Groups Table */}
      <Card>
        <CardHeader>
          <CardTitle>Modifier Groups</CardTitle>
          <CardDescription>{groups?.length ?? 0} group(s) found</CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedStoreId ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <SlidersHorizontal className="h-8 w-8 mb-2" />
              <p>Please select a store to view modifiers.</p>
            </div>
          ) : !groups ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <SlidersHorizontal className="h-8 w-8 mb-2" />
              <p>No modifier groups found. Create your first group.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Selection</TableHead>
                  <TableHead>Min/Max</TableHead>
                  <TableHead>Options</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group._id}>
                    <TableCell className="font-medium">{group.name}</TableCell>
                    <TableCell>
                      <Badge variant={group.selectionType === "single" ? "secondary" : "default"}>
                        {group.selectionType === "single" ? "Single" : "Multi"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {group.minSelections}–{group.maxSelections ?? "∞"}
                    </TableCell>
                    <TableCell>{group.optionCount}</TableCell>
                    <TableCell>
                      <Badge variant={group.isActive ? "default" : "destructive"}>
                        {group.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setManagingGroupId(group._id)}
                        title="Manage options"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEditGroup(group)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Options Panel */}
      {managingGroupId && managingGroup && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Options for &quot;{managingGroup.name}&quot;</CardTitle>
                <CardDescription>{managingGroup.options.length} option(s)</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setManagingGroupId(null)}>
                  Close
                </Button>
                <Button size="sm" onClick={handleOpenCreateOption}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Option
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {managingGroup.options.length === 0 ? (
              <p className="text-center text-gray-500 py-4">
                No options yet. Add your first option.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Price Adj.</TableHead>
                    <TableHead>Default</TableHead>
                    <TableHead>Available</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managingGroup.options.map((option) => (
                    <TableRow key={option._id}>
                      <TableCell className="font-medium">{option.name}</TableCell>
                      <TableCell className="text-right">
                        {option.priceAdjustment > 0 ? "+" : ""}
                        {formatCurrency(option.priceAdjustment)}
                      </TableCell>
                      <TableCell>
                        {option.isDefault && <Badge variant="secondary">Default</Badge>}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleToggleAvailability(option._id)}
                        >
                          {option.isAvailable ? (
                            <ToggleRight className="h-5 w-5 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-gray-400" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEditOption(option)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Group Create/Edit Dialog */}
      <Dialog open={isGroupDialogOpen} onOpenChange={setIsGroupDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingGroupId ? "Edit Modifier Group" : "Create Modifier Group"}
            </DialogTitle>
            <DialogDescription>
              {editingGroupId
                ? "Update the modifier group details."
                : "Fill in the details to create a new modifier group."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="groupName">Group Name</Label>
              <Input
                id="groupName"
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                placeholder="e.g. Size, Toppings, Add-ons"
              />
            </div>

            <div className="grid gap-2">
              <Label>Selection Type</Label>
              <Select
                value={groupForm.selectionType}
                onValueChange={(value: "single" | "multi") =>
                  setGroupForm({ ...groupForm, selectionType: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single (pick one)</SelectItem>
                  <SelectItem value="multi">Multi (pick many)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="minSelections">Min Selections</Label>
                <Input
                  id="minSelections"
                  type="number"
                  min={0}
                  value={groupForm.minSelections}
                  onChange={(e) =>
                    setGroupForm({ ...groupForm, minSelections: parseInt(e.target.value, 10) || 0 })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="maxSelections">Max Selections</Label>
                <Input
                  id="maxSelections"
                  type="number"
                  min={0}
                  value={groupForm.maxSelections ?? ""}
                  onChange={(e) =>
                    setGroupForm({
                      ...groupForm,
                      maxSelections: e.target.value ? parseInt(e.target.value, 10) : undefined,
                    })
                  }
                  placeholder="No limit"
                />
              </div>
            </div>

            {editingGroupId && (
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={groupForm.isActive ? "active" : "inactive"}
                  onValueChange={(value) =>
                    setGroupForm({ ...groupForm, isActive: value === "active" })
                  }
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

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsGroupDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmitGroup} disabled={isSubmitting || !groupForm.name}>
              {isSubmitting ? "Saving..." : editingGroupId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Option Create/Edit Dialog */}
      <Dialog open={isOptionDialogOpen} onOpenChange={setIsOptionDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingOptionId ? "Edit Option" : "Add Option"}</DialogTitle>
            <DialogDescription>
              {editingOptionId ? "Update the option details." : "Add a new option to this group."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="optionName">Option Name</Label>
              <Input
                id="optionName"
                value={optionForm.name}
                onChange={(e) => setOptionForm({ ...optionForm, name: e.target.value })}
                placeholder="e.g. Large, Extra Cheese"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="priceAdjustment">Price Adjustment</Label>
              <Input
                id="priceAdjustment"
                type="number"
                step="0.01"
                value={optionForm.priceAdjustment}
                onChange={(e) =>
                  setOptionForm({ ...optionForm, priceAdjustment: parseFloat(e.target.value) || 0 })
                }
              />
              <p className="text-xs text-gray-500">
                Use 0 for no extra charge, positive for add-on cost.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Default Selection</Label>
              <Select
                value={optionForm.isDefault ? "yes" : "no"}
                onValueChange={(value) =>
                  setOptionForm({ ...optionForm, isDefault: value === "yes" })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value="yes">Yes (pre-selected)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsOptionDialogOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmitOption} disabled={isSubmitting || !optionForm.name}>
              {isSubmitting ? "Saving..." : editingOptionId ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
