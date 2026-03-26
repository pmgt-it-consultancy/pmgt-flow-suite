"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Copy, MoreHorizontal, Package, Pencil, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { formatCurrency } from "@/lib/format";

interface CategoryData {
  _id: Id<"categories">;
  name: string;
  parentId?: Id<"categories">;
}

interface ProductData {
  _id: Id<"products">;
  storeId: Id<"stores">;
  name: string;
  categoryId: Id<"categories">;
  categoryName: string;
  price: number;
  isVatable: boolean;
  isActive: boolean;
  isOpenPrice?: boolean;
  minPrice?: number;
  maxPrice?: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  hasModifiers: boolean;
}

interface ProductsDataTableProps {
  products: ProductData[] | undefined;
  filteredProducts: ProductData[] | undefined;
  categories: CategoryData[] | undefined;
  selectedStoreId: Id<"stores"> | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  categoryFilter: Id<"categories"> | "all";
  onCategoryFilterChange: (value: Id<"categories"> | "all") => void;
  statusFilter: "all" | "active" | "inactive";
  onStatusFilterChange: (value: "all" | "active" | "inactive") => void;
  onEdit: (product: ProductData) => void;
  onDuplicate: (product: ProductData) => void;
}

export function ProductsDataTable({
  products,
  filteredProducts,
  categories,
  selectedStoreId,
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  statusFilter,
  onStatusFilterChange,
  onEdit,
  onDuplicate,
}: ProductsDataTableProps) {
  return (
    <>
      {/* Filter Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder="Search products by name..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={categoryFilter}
              onValueChange={(value) => onCategoryFilterChange(value as Id<"categories"> | "all")}
            >
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories?.map((category) => (
                  <SelectItem key={category._id} value={category._id}>
                    {category.parentId ? "\u2514 " : ""}
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                onStatusFilterChange(value as "all" | "active" | "inactive")
              }
            >
              <SelectTrigger className="w-full md:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Products</CardTitle>
          <CardDescription>
            {categoryFilter === "all" && statusFilter === "all" && !searchQuery
              ? `${products?.length ?? 0} product(s)`
              : categoryFilter === "all" && statusFilter === "active" && !searchQuery
                ? `${filteredProducts?.length ?? 0} active product(s)`
                : `${filteredProducts?.length ?? 0} of ${products?.length ?? 0} product(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!selectedStoreId ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Package className="h-8 w-8 mb-2" />
              <p>Please select a store to view products.</p>
            </div>
          ) : !products ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredProducts?.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500">
              <Package className="h-8 w-8 mb-2" />
              <p>
                {searchQuery || categoryFilter !== "all" || statusFilter !== "all"
                  ? "No products match your filters."
                  : "No products found. Create your first product."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>VAT</TableHead>
                  <TableHead>Sort</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts?.map((product) => (
                  <TableRow key={product._id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>{product.categoryName}</TableCell>
                    <TableCell className="text-right">
                      {product.isOpenPrice ? (
                        <Badge
                          variant="outline"
                          className="text-emerald-600 border-emerald-300 bg-emerald-50"
                        >
                          Open Price ({formatCurrency(product.minPrice ?? 0)} &ndash;{" "}
                          {formatCurrency(product.maxPrice ?? 0)})
                        </Badge>
                      ) : (
                        formatCurrency(product.price)
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={product.isVatable ? "default" : "secondary"}>
                        {product.isVatable ? "VAT" : "Non-VAT"}
                      </Badge>
                    </TableCell>
                    <TableCell>{product.sortOrder}</TableCell>
                    <TableCell>
                      <Badge variant={product.isActive ? "default" : "destructive"}>
                        {product.isActive ? "Active" : "Inactive"}
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
                          <DropdownMenuItem onClick={() => onEdit(product)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDuplicate(product)}>
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
    </>
  );
}
