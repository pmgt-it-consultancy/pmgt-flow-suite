"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Building, Copy, MoreHorizontal, Pencil, Store } from "lucide-react";
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
  onEdit: (storeId: Id<"stores">, data: StoreFormValues) => void;
  onDuplicate: (data: StoreFormValues) => void;
}

export function StoresTable({ stores, onEdit, onDuplicate }: StoresTableProps) {
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
    <Card>
      <CardHeader>
        <CardTitle>All Stores</CardTitle>
        <CardDescription>{stores?.length ?? 0} store(s) in total</CardDescription>
      </CardHeader>
      <CardContent>
        {!stores ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : stores.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <Store className="h-8 w-8 mb-2" />
            <p>No stores found. Create your first store.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>TIN</TableHead>
                <TableHead>VAT Rate</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stores.map((store) => (
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
                  <TableCell className="max-w-xs truncate">{store.address1}</TableCell>
                  <TableCell>{store.tin}</TableCell>
                  <TableCell>{store.vatRate}%</TableCell>
                  <TableCell>
                    <Badge variant={store.isActive ? "default" : "destructive"}>
                      {store.isActive ? "Active" : "Inactive"}
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
        )}
      </CardContent>
    </Card>
  );
}
