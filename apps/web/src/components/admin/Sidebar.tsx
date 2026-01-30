"use client";

import {
  BarChart3,
  FileText,
  Grid3X3,
  Home,
  LayoutDashboard,
  Package,
  Receipt,
  SlidersHorizontal,
  Store,
  Tag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

interface NavItem {
  title: string;
  href: string;
  icon: React.ReactNode;
  permission?: string;
}

const navItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: <LayoutDashboard className="h-5 w-5" />,
  },
  {
    title: "POS Home",
    href: "/pos",
    icon: <Home className="h-5 w-5" />,
    permission: "orders.view",
  },
  {
    title: "Stores",
    href: "/stores",
    icon: <Store className="h-5 w-5" />,
    permission: "stores.view",
  },
  {
    title: "Categories",
    href: "/categories",
    icon: <Tag className="h-5 w-5" />,
    permission: "categories.manage",
  },
  {
    title: "Products",
    href: "/products",
    icon: <Package className="h-5 w-5" />,
    permission: "products.view",
  },
  {
    title: "Modifiers",
    href: "/modifiers",
    icon: <SlidersHorizontal className="h-5 w-5" />,
    permission: "modifiers.manage",
  },
  {
    title: "Tables",
    href: "/tables",
    icon: <Grid3X3 className="h-5 w-5" />,
    permission: "tables.view",
  },
  {
    title: "Users",
    href: "/users",
    icon: <Users className="h-5 w-5" />,
    permission: "users.view",
  },
  {
    title: "Orders",
    href: "/orders",
    icon: <Receipt className="h-5 w-5" />,
    permission: "orders.view",
  },
  {
    title: "Reports",
    href: "/reports",
    icon: <BarChart3 className="h-5 w-5" />,
    permission: "reports.daily",
  },
  {
    title: "Audit Logs",
    href: "/audit-logs",
    icon: <FileText className="h-5 w-5" />,
    permission: "orders.view",
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { hasPermission, user } = useAuth();

  // Filter nav items based on permissions
  const filteredNavItems = navItems.filter((item) => {
    if (!item.permission) return true;
    return hasPermission(item.permission);
  });

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-white">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center border-b px-6">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">PMGT POS</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {filteredNavItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                )}
              >
                {item.icon}
                {item.title}
              </Link>
            );
          })}
        </nav>

        {/* User Info */}
        <div className="border-t p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              {user?.name?.charAt(0).toUpperCase() || "U"}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium">{user?.name || "User"}</p>
              <p className="truncate text-xs text-gray-500">{user?.roleName || "Unknown Role"}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
