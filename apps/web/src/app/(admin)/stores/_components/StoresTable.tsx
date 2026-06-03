"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Building, Copy, MoreHorizontal, Pencil, Store } from "lucide-react";
import { useMemo } from "react";
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
import { AdminDataControls } from "../../_shared/AdminDataControls";
import { defaultSchedule, type StoreFormValues } from "../_schemas";

interface StoreData {
  _id: Id<"stores">;
  name: string;
  parentId?: Id<"stores">;
  address1: string;
  address2?: string;
  tin: string;
  min: string;
  vatRate: number;
  contactNumber?: string;
  telephone?: string;
  email?: string;
  website?: string;
  socials?: { platform: string; url: string }[];
  footer?: string;
  schedule?: StoreFormValues["schedule"];
  isActive: boolean;
  createdAt: number;
  branchCount: number;
}

interface StoresTableProps {
  stores: StoreData[] | undefined;
  filteredStores: StoreData[] | undefined;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: "active" | "inactive" | "all";
  onStatusFilterChange: (value: "active" | "inactive" | "all") => void;
  typeFilter: "all" | "parent" | "branch";
  onTypeFilterChange: (value: "all" | "parent" | "branch") => void;
  vatFilter: "all" | "vat" | "non-vat";
  onVatFilterChange: (value: "all" | "vat" | "non-vat") => void;
  contactFilter: "all" | "with-contact" | "missing-contact";
  onContactFilterChange: (value: "all" | "with-contact" | "missing-contact") => void;
  sortBy: "name" | "type" | "vat" | "branches";
  onSortByChange: (value: "name" | "type" | "vat" | "branches") => void;
  onResetFilters: () => void;
  onEdit: (storeId: Id<"stores">, data: StoreFormValues) => void;
  onDuplicate: (data: StoreFormValues) => void;
}

export function StoresTable({
  stores,
  filteredStores,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  vatFilter,
  onVatFilterChange,
  contactFilter,
  onContactFilterChange,
  sortBy,
  onSortByChange,
  onResetFilters,
  onEdit,
  onDuplicate,
}: StoresTableProps) {
  const activeFilterCount = useMemo(() => {
    return [
      searchQuery,
      statusFilter !== "active",
      typeFilter !== "all",
      vatFilter !== "all",
      contactFilter !== "all",
      sortBy !== "name",
    ].filter(Boolean).length;
  }, [searchQuery, statusFilter, typeFilter, vatFilter, contactFilter, sortBy]);

  const toFormValues = (store: StoreData): StoreFormValues => ({
    name: store.name,
    parentId: store.parentId,
    address1: store.address1,
    address2: store.address2 ?? "",
    tin: store.tin,
    min: store.min,
    vatRate: store.vatRate,
    contactNumber: store.contactNumber ?? "",
    telephone: store.telephone ?? "",
    email: store.email ?? "",
    website: store.website ?? "",
    socials: store.socials ?? [],
    footer: store.footer ?? "",
    schedule: store.schedule ?? defaultSchedule,
    isActive: store.isActive,
  });

  const handleEdit = (store: StoreData) => {
    onEdit(store._id, toFormValues(store));
  };

  const handleDuplicate = (store: StoreData) => {
    onDuplicate({
      ...toFormValues(store),
      name: `${store.name} (Copy)`,
    });
  };

  return (
    <>
      <AdminDataControls
        searchValue={searchQuery}
        searchPlaceholder="Search store, address, TIN, MIN, or contact..."
        onSearchChange={onSearchChange}
        activeFilterCount={activeFilterCount}
        onReset={onResetFilters}
        resultLabel={`${filteredStores?.length ?? 0} of ${stores?.length ?? 0} stores`}
      >
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusFilterChange(value as "active" | "inactive" | "all")}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="all">All Statuses</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={typeFilter}
          onValueChange={(value) => onTypeFilterChange(value as "all" | "parent" | "branch")}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="parent">Parent</SelectItem>
            <SelectItem value="branch">Branch</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={vatFilter}
          onValueChange={(value) => onVatFilterChange(value as "all" | "vat" | "non-vat")}
        >
          <SelectTrigger className="h-11 w-full md:w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All VAT</SelectItem>
            <SelectItem value="vat">VAT</SelectItem>
            <SelectItem value="non-vat">Non-VAT</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={contactFilter}
          onValueChange={(value) =>
            onContactFilterChange(value as "all" | "with-contact" | "missing-contact")
          }
        >
          <SelectTrigger className="h-11 w-full md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Contacts</SelectItem>
            <SelectItem value="with-contact">Has Contact</SelectItem>
            <SelectItem value="missing-contact">Missing Contact</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sortBy}
          onValueChange={(value) => onSortByChange(value as "name" | "type" | "vat" | "branches")}
        >
          <SelectTrigger className="h-11 w-full md:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name</SelectItem>
            <SelectItem value="type">Type</SelectItem>
            <SelectItem value="vat">VAT Rate</SelectItem>
            <SelectItem value="branches">Branches</SelectItem>
          </SelectContent>
        </Select>
      </AdminDataControls>

      <Card>
        <CardHeader>
          <CardTitle>Store Directory</CardTitle>
          <CardDescription>
            Review branch structure, tax setup, and receipt identity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!stores ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : filteredStores?.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center text-gray-500">
              <Store className="mb-2 h-8 w-8" />
              <p>
                {activeFilterCount > 0
                  ? "No stores match your filters."
                  : "No stores found. Create your first store."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>TIN / MIN</TableHead>
                    <TableHead>VAT</TableHead>
                    <TableHead>Branches</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(filteredStores ?? []).map((store) => (
                    <TableRow key={store._id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {store.parentId ? (
                            <Building className="h-4 w-4 text-gray-400" />
                          ) : (
                            <Store className="h-4 w-4 text-primary" />
                          )}
                          {store.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={store.parentId ? "secondary" : "default"}>
                          {store.parentId ? "Branch" : "Parent"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-xs truncate" title={store.address1}>
                        {store.address1}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>{store.tin}</div>
                          <div className="text-muted-foreground">{store.min}</div>
                        </div>
                      </TableCell>
                      <TableCell>{store.vatRate}%</TableCell>
                      <TableCell>{store.branchCount}</TableCell>
                      <TableCell>
                        {store.contactNumber || store.telephone || store.email ? (
                          <Badge variant="outline">Configured</Badge>
                        ) : (
                          <Badge variant="secondary">Missing</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={store.isActive ? "default" : "destructive"}>
                          {store.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Actions for ${store.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(store)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(store)}>
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
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
