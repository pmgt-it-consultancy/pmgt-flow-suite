"use client";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { Bell, Building, LogOut, Menu, Store, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useStoreAccess } from "@/hooks/useStoreAccess";
import { useAdminStore } from "@/stores/useAdminStore";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { accessibleStores, canChangeStore, defaultStoreId, isLoading } = useStoreAccess();
  const { selectedStoreId, setSelectedStoreId } = useAdminStore();

  // Auto-select default store on mount if none selected
  useEffect(() => {
    if (!isLoading && !selectedStoreId && defaultStoreId) {
      setSelectedStoreId(defaultStoreId);
    }
  }, [isLoading, selectedStoreId, defaultStoreId, setSelectedStoreId]);

  // Also auto-select first store for Super Admins with no assigned store
  useEffect(() => {
    if (!isLoading && !selectedStoreId && !defaultStoreId && accessibleStores.length > 0) {
      setSelectedStoreId(accessibleStores[0]._id);
    }
  }, [isLoading, selectedStoreId, defaultStoreId, accessibleStores, setSelectedStoreId]);

  const handleLogout = async () => {
    try {
      await signOut();
      setSelectedStoreId(null); // Clear store selection on logout
      toast.success("Logged out successfully");
      router.push("/login");
    } catch (_error) {
      toast.error("Logout failed");
    }
  };

  const handleStoreChange = (storeId: string) => {
    setSelectedStoreId(storeId as Id<"stores">);
  };

  // Find the currently selected store
  const selectedStore = accessibleStores.find((s) => s._id === selectedStoreId);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-white px-6">
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick}>
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex items-center gap-4">
        {/* Store Selector */}
        {accessibleStores.length > 0 && (
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-gray-500" />
            <Select
              value={selectedStoreId ?? ""}
              onValueChange={handleStoreChange}
              disabled={!canChangeStore || isLoading}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select store">
                  {selectedStore ? (
                    <span className="flex items-center gap-2">
                      {selectedStore.parentId ? (
                        <Building className="h-3 w-3 text-gray-400" />
                      ) : (
                        <Store className="h-3 w-3 text-primary" />
                      )}
                      {selectedStore.name}
                    </span>
                  ) : (
                    "Select store"
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {accessibleStores.map((store) => (
                  <SelectItem key={store._id} value={store._id}>
                    <span className="flex items-center gap-2">
                      {store.parentId ? (
                        <Building className="h-3 w-3 text-gray-400" />
                      ) : (
                        <Store className="h-3 w-3 text-primary" />
                      )}
                      {store.name}
                      {!store.isActive && <span className="text-xs text-gray-400">(Inactive)</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                {user?.name?.charAt(0).toUpperCase() || "U"}
              </div>
              <span className="hidden text-sm font-medium md:inline-block">
                {user?.name || "User"}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{user?.name || "User"}</span>
                <span className="text-xs font-normal text-gray-500">
                  {user?.roleName || "Unknown Role"}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/profile")}>
              <User className="mr-2 h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-red-600">
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
