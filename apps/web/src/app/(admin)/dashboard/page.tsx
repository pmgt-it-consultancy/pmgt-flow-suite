"use client";

import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { DollarSign, Package, ShoppingCart, Store, TrendingUp, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { useAdminStore } from "@/stores/useAdminStore";

export default function DashboardPage() {
  const { user, isAuthenticated } = useAuth();
  const { selectedStoreId } = useAdminStore();

  // Get stores for the user (if Super Admin, all stores; otherwise, assigned store)
  const stores = useQuery(api.stores.list, isAuthenticated ? {} : "skip");

  // Get today's date
  const now = new Date();
  const todayDateStr = formatDateString(now);

  // Use the globally selected store for dashboard data
  const primaryStoreId = selectedStoreId;

  // Get live dashboard summary (computed directly from orders)
  const dashboardSummary = useQuery(
    api.reports.getDashboardSummary,
    primaryStoreId
      ? {
          storeId: primaryStoreId,
          reportDate: todayDateStr,
        }
      : "skip",
  );

  // Get live top selling products (computed directly from order items)
  const topProducts = useQuery(
    api.reports.getTopSellingProductsLive,
    primaryStoreId
      ? {
          storeId: primaryStoreId,
          reportDate: todayDateStr,
          limit: 5,
        }
      : "skip",
  );

  // Calculate summary values
  const todaySales = dashboardSummary?.netSales ?? 0;
  const todayOrders = dashboardSummary?.transactionCount ?? 0;
  const avgOrderValue = todayOrders > 0 ? todaySales / todayOrders : 0;
  const totalDiscounts = dashboardSummary?.totalDiscounts ?? 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-gray-500">
          Welcome back, {user?.name || "User"}! Here's an overview of your business.
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Today's Sales"
          value={formatCurrency(todaySales)}
          description="Total net sales for today"
          icon={<DollarSign className="h-5 w-5" />}
          trend={dashboardSummary ? "+12% from yesterday" : undefined}
        />
        <SummaryCard
          title="Orders"
          value={todayOrders.toString()}
          description="Total transactions today"
          icon={<ShoppingCart className="h-5 w-5" />}
        />
        <SummaryCard
          title="Avg Order Value"
          value={formatCurrency(avgOrderValue)}
          description="Average per transaction"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <SummaryCard
          title="Discounts Given"
          value={formatCurrency(totalDiscounts)}
          description="SC/PWD + other discounts"
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Sales Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Sales Breakdown</CardTitle>
            <CardDescription>Today's sales by payment method</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboardSummary ? (
              <div className="space-y-4">
                <SalesBreakdownItem
                  label="Cash"
                  value={dashboardSummary.cashTotal}
                  total={todaySales}
                />
                <SalesBreakdownItem
                  label="Card/E-Wallet"
                  value={dashboardSummary.cardEwalletTotal}
                  total={todaySales}
                />
                <div className="pt-4 border-t">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Gross Sales</span>
                    <span>{formatCurrency(dashboardSummary.grossSales)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">VAT Amount (12%)</span>
                    <span>{formatCurrency(dashboardSummary.vatAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Net Sales</span>
                    <span className="font-semibold">
                      {formatCurrency(dashboardSummary.netSales)}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-gray-500">
                No sales data for today
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Products */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Top Selling Products</CardTitle>
            <CardDescription>Best performers today</CardDescription>
          </CardHeader>
          <CardContent>
            {topProducts && topProducts.length > 0 ? (
              <div className="space-y-4">
                {topProducts.map((product, index) => (
                  <div key={product.productId} className="flex items-center gap-4">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium">
                      {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{product.productName}</p>
                      <p className="text-xs text-gray-500">{product.quantitySold} sold</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatCurrency(product.grossAmount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-gray-500">
                No product sales today
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stores Overview (for Super Admin/Admin) */}
        {stores && stores.length > 1 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Stores Overview</CardTitle>
              <CardDescription>All stores status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {stores.map((store) => (
                  <div key={store._id} className="flex items-center gap-4 p-4 border rounded-lg">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Store className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{store.name}</p>
                      <p className="text-xs text-gray-500">{store.address1}</p>
                    </div>
                    <Badge variant={store.isActive ? "default" : "secondary"}>
                      {store.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Quick Actions */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
            <CardDescription>Commonly used operations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <QuickActionCard
                title="Generate Report"
                description="Create daily sales report"
                icon={<TrendingUp className="h-5 w-5" />}
                href="/reports"
              />
              <QuickActionCard
                title="Manage Products"
                description="Add or update products"
                icon={<Package className="h-5 w-5" />}
                href="/products"
              />
              <QuickActionCard
                title="View Orders"
                description="Check today's orders"
                icon={<ShoppingCart className="h-5 w-5" />}
                href="/orders"
              />
              <QuickActionCard
                title="Manage Users"
                description="Staff and permissions"
                icon={<Users className="h-5 w-5" />}
                href="/users"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Helper Components
function SummaryCard({
  title,
  value,
  description,
  icon,
  trend,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  trend?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
        <div className="text-gray-400">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-gray-500">{description}</p>
        {trend && <p className="text-xs text-green-600 mt-1">{trend}</p>}
      </CardContent>
    </Card>
  );
}

function SalesBreakdownItem({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const percentage = total > 0 ? (value / total) * 100 : 0;

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="font-medium">{formatCurrency(value)}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function QuickActionCard({
  title,
  description,
  icon,
  href,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
    </a>
  );
}

// Helper function to format date as YYYY-MM-DD using local timezone
function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
