"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Copy, Folder, MoreHorizontal, Pencil, Tag } from "lucide-react";
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

interface CategoryData {
  _id: Id<"categories">;
  name: string;
  parentId?: Id<"categories">;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
}

interface CategoriesDataTableProps {
  categories: CategoryData[] | undefined;
  selectedStoreId: Id<"stores"> | null;
  onEdit: (category: CategoryData) => void;
  onDuplicate: (category: CategoryData) => void;
}

export function CategoriesDataTable({
  categories,
  selectedStoreId,
  onEdit,
  onDuplicate,
}: CategoriesDataTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>All Categories</CardTitle>
        <CardDescription>{categories?.length ?? 0} category(ies) in total</CardDescription>
      </CardHeader>
      <CardContent>
        {!selectedStoreId ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <Tag className="h-8 w-8 mb-2" />
            <p>Please select a store to view categories.</p>
          </div>
        ) : !categories ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : categories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <Tag className="h-8 w-8 mb-2" />
            <p>No categories found. Create your first category.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Sort Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((category) => (
                <TableRow key={category._id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {category.parentId ? (
                        <Tag className="h-4 w-4 text-gray-400" />
                      ) : (
                        <Folder className="h-4 w-4 text-primary" />
                      )}
                      {category.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={category.parentId ? "secondary" : "default"}>
                      {category.parentId ? "Sub-category" : "Main"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {category.parentId
                      ? (categories.find((c) => c._id === category.parentId)?.name ?? "-")
                      : "-"}
                  </TableCell>
                  <TableCell>{category.productCount}</TableCell>
                  <TableCell>{category.sortOrder}</TableCell>
                  <TableCell>
                    <Badge variant={category.isActive ? "default" : "destructive"}>
                      {category.isActive ? "Active" : "Inactive"}
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
                        <DropdownMenuItem onClick={() => onEdit(category)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDuplicate(category)}>
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
