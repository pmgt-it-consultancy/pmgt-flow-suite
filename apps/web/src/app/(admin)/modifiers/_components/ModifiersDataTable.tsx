"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Copy, MoreHorizontal, Pencil, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface GroupData {
  _id: Id<"modifierGroups">;
  storeId: Id<"stores">;
  name: string;
  selectionType: "single" | "multi";
  minSelections: number;
  maxSelections?: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: number;
  optionCount: number;
}

interface ModifiersDataTableProps {
  groups: GroupData[] | undefined;
  selectedStoreId: Id<"stores"> | null;
  onEdit: (group: GroupData) => void;
  onDuplicate: (group: GroupData) => void;
}

export function ModifiersDataTable({
  groups,
  selectedStoreId,
  onEdit,
  onDuplicate,
}: ModifiersDataTableProps) {
  return (
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
                    {group.minSelections}&ndash;{group.maxSelections ?? "\u221E"}
                  </TableCell>
                  <TableCell>{group.optionCount}</TableCell>
                  <TableCell>
                    <Badge variant={group.isActive ? "default" : "destructive"}>
                      {group.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(group)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDuplicate(group)}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
