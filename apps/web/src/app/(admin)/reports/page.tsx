"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import { Id } from "@packages/backend/convex/_generated/dataModel";
import { useAuth, useSessionToken } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Calendar,
  FileText,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Clock,
  BarChart3,
  Printer,
  RefreshCw,
} from "lucide-react";
import { formatCurrency, formatDate, formatDateString } from "@/lib/format";

export default function ReportsPage() {
  const { user } = useAuth();
  const token = useSessionToken();
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<Id<"stores"> | undefined>(
    user?.storeId
  );
  const [reportDate, setReportDate] = useState(formatDateString(new Date()));
  const [dateRangeStart, setDateRangeStart] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return formatDateString(date);
  });
  const [dateRangeEnd, setDateRangeEnd] = useState(formatDateString(new Date()));

  // Queries
  const stores = useQuery(api.stores.list, token ? { token } : "skip");
  const dailyReport = useQuery(
    api.reports.getDailyReport,
    token && selectedStoreId
      ? { token, storeId: selectedStoreId, reportDate }
      : "skip"
  );
  const productSales = useQuery(
    api.reports.getDailyProductSales,
    token && selectedStoreId
      ? { token, storeId: selectedStoreId, reportDate }
      : "skip"
  );
  const categorySales = useQuery(
    api.reports.getCategorySales,
    token && selectedStoreId
      ? { token, storeId: selectedStoreId, reportDate }
      : "skip"
  );
  const hourlySales = useQuery(
    api.reports.getHourlySales,
    token && selectedStoreId
      ? { token, storeId: selectedStoreId, reportDate }
      : "skip"
  );
  const dateRangeReport = useQuery(
    api.reports.getDateRangeReport,
    token && selectedStoreId
      ? { token, storeId: selectedStoreId, startDate: dateRangeStart, endDate: dateRangeEnd }
      : "skip"
  );

  // Mutations
  const generateReport = useMutation(api.reports.generateDailyReport);
  const markPrinted = useMutation(api.reports.markReportPrinted);

  const handleGenerateReport = async () => {
    if (!token || !selectedStoreId) return;

    setIsGenerating(true);
    try {
      await generateReport({
        token,
        storeId: selectedStoreId,
        reportDate,
      });
      toast.success("Report generated successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to generate report"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleMarkPrinted = async () => {
    if (!token || !dailyReport?._id) return;

    try {
      await markPrinted({ token, reportId: dailyReport._id });
      toast.success("Report marked as printed");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to mark as printed"
      );
    }
  };

  // Find max hourly sales for bar chart scaling
  const maxHourlySales = hourlySales
    ? Math.max(...hourlySales.map((h) => h.netSales), 1)
    : 1;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-gray-500">View and generate sales reports</p>
        </div>
        <Button onClick={handleGenerateReport} disabled={!selectedStoreId || isGenerating}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isGenerating ? "animate-spin" : ""}`} />
          {isGenerating ? "Generating..." : "Generate Report"}
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            {stores && stores.length > 1 && (
              <>
                <Label htmlFor="storeFilter" className="whitespace-nowrap">
                  Store:
                </Label>
                <Select
                  value={selectedStoreId ?? ""}
                  onValueChange={(value) =>
                    setSelectedStoreId(value as Id<"stores">)
                  }
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Select store" />
                  </SelectTrigger>
                  <SelectContent>
                    {stores.map((store) => (
                      <SelectItem key={store._id} value={store._id}>
                        {store.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            <div className="flex items-center gap-2">
              <Label htmlFor="reportDate" className="whitespace-nowrap">
                Date:
              </Label>
              <Input
                id="reportDate"
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="daily" className="space-y-6">
        <TabsList>
          <TabsTrigger value="daily">
            <FileText className="mr-2 h-4 w-4" />
            Daily Report
          </TabsTrigger>
          <TabsTrigger value="products">
            <ShoppingCart className="mr-2 h-4 w-4" />
            Product Sales
          </TabsTrigger>
          <TabsTrigger value="hourly">
            <Clock className="mr-2 h-4 w-4" />
            Hourly Breakdown
          </TabsTrigger>
          <TabsTrigger value="range">
            <BarChart3 className="mr-2 h-4 w-4" />
            Date Range
          </TabsTrigger>
        </TabsList>

        {/* Daily Report Tab */}
        <TabsContent value="daily" className="space-y-6">
          {!selectedStoreId ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-32 text-gray-500">
                <FileText className="h-8 w-8 mb-2" />
                <p>Please select a store to view reports.</p>
              </CardContent>
            </Card>
          ) : !dailyReport ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-32 text-gray-500">
                <Calendar className="h-8 w-8 mb-2" />
                <p>No report found for this date. Click &quot;Generate Report&quot; to create one.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Report Header */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Daily Sales Report</CardTitle>
                      <CardDescription>
                        {formatDate(new Date(reportDate).getTime())} - Generated by {dailyReport.generatedByName}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={dailyReport.isPrinted ? "default" : "secondary"}>
                        {dailyReport.isPrinted ? "Printed" : "Not Printed"}
                      </Badge>
                      {!dailyReport.isPrinted && (
                        <Button variant="outline" size="sm" onClick={handleMarkPrinted}>
                          <Printer className="mr-2 h-4 w-4" />
                          Mark as Printed
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Summary Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <SummaryCard
                  title="Gross Sales"
                  value={formatCurrency(dailyReport.grossSales)}
                  icon={<DollarSign className="h-5 w-5" />}
                />
                <SummaryCard
                  title="Net Sales"
                  value={formatCurrency(dailyReport.netSales)}
                  icon={<TrendingUp className="h-5 w-5" />}
                  highlight
                />
                <SummaryCard
                  title="Transactions"
                  value={dailyReport.transactionCount.toString()}
                  icon={<ShoppingCart className="h-5 w-5" />}
                />
                <SummaryCard
                  title="Avg Ticket"
                  value={formatCurrency(dailyReport.averageTicket)}
                  icon={<BarChart3 className="h-5 w-5" />}
                />
              </div>

              {/* Details Grid */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* Sales Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Sales Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <DetailRow label="Vatable Sales" value={formatCurrency(dailyReport.vatableSales)} />
                    <DetailRow label="VAT Amount (12%)" value={formatCurrency(dailyReport.vatAmount)} />
                    <DetailRow label="VAT-Exempt Sales" value={formatCurrency(dailyReport.vatExemptSales)} />
                    <DetailRow label="Non-VAT Sales" value={formatCurrency(dailyReport.nonVatSales)} />
                    <div className="border-t pt-3">
                      <DetailRow label="Gross Sales" value={formatCurrency(dailyReport.grossSales)} bold />
                    </div>
                  </CardContent>
                </Card>

                {/* Discounts & Voids */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Discounts & Voids</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <DetailRow label="Senior Citizen" value={formatCurrency(dailyReport.seniorDiscounts)} />
                    <DetailRow label="PWD" value={formatCurrency(dailyReport.pwdDiscounts)} />
                    <DetailRow label="Promo" value={formatCurrency(dailyReport.promoDiscounts)} />
                    <DetailRow label="Manual" value={formatCurrency(dailyReport.manualDiscounts)} />
                    <div className="border-t pt-3">
                      <DetailRow label="Total Discounts" value={formatCurrency(dailyReport.totalDiscounts)} bold />
                    </div>
                    <div className="border-t pt-3">
                      <DetailRow label="Void Count" value={dailyReport.voidCount.toString()} />
                      <DetailRow label="Void Amount" value={formatCurrency(dailyReport.voidAmount)} />
                    </div>
                  </CardContent>
                </Card>

                {/* Payment Methods */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Payment Methods</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <DetailRow label="Cash" value={formatCurrency(dailyReport.cashTotal)} />
                    <DetailRow label="Card/E-Wallet" value={formatCurrency(dailyReport.cardEwalletTotal)} />
                    <div className="border-t pt-3">
                      <DetailRow label="Total" value={formatCurrency(dailyReport.netSales)} bold />
                    </div>
                  </CardContent>
                </Card>

                {/* Category Sales */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Sales by Category</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {categorySales && categorySales.length > 0 ? (
                      <div className="space-y-3">
                        {categorySales.slice(0, 5).map((cat) => (
                          <div key={cat.categoryId} className="flex justify-between text-sm">
                            <span className="truncate">{cat.categoryName}</span>
                            <span className="font-medium">{formatCurrency(cat.totalGrossAmount)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">No category sales data</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* Product Sales Tab */}
        <TabsContent value="products">
          <Card>
            <CardHeader>
              <CardTitle>Product Sales</CardTitle>
              <CardDescription>
                {productSales?.length ?? 0} product(s) sold on {reportDate}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedStoreId ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                  <ShoppingCart className="h-8 w-8 mb-2" />
                  <p>Please select a store to view product sales.</p>
                </div>
              ) : !productSales || productSales.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                  <ShoppingCart className="h-8 w-8 mb-2" />
                  <p>No product sales for this date.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Qty Sold</TableHead>
                      <TableHead className="text-right">Gross Amount</TableHead>
                      <TableHead className="text-right">Voided</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productSales.map((product) => (
                      <TableRow key={product.productId}>
                        <TableCell className="font-medium">{product.productName}</TableCell>
                        <TableCell>{product.categoryName}</TableCell>
                        <TableCell className="text-right">{product.quantitySold}</TableCell>
                        <TableCell className="text-right">{formatCurrency(product.grossAmount)}</TableCell>
                        <TableCell className="text-right">
                          {product.voidedQuantity > 0 ? (
                            <span className="text-red-600">
                              {product.voidedQuantity} ({formatCurrency(product.voidedAmount)})
                            </span>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Hourly Breakdown Tab */}
        <TabsContent value="hourly">
          <Card>
            <CardHeader>
              <CardTitle>Hourly Sales Breakdown</CardTitle>
              <CardDescription>Sales distribution by hour for {reportDate}</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedStoreId ? (
                <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                  <Clock className="h-8 w-8 mb-2" />
                  <p>Please select a store to view hourly breakdown.</p>
                </div>
              ) : !hourlySales ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                </div>
              ) : (
                <div className="space-y-2">
                  {hourlySales.map((hourData) => (
                    <div key={hourData.hour} className="flex items-center gap-4">
                      <div className="w-16 text-sm text-gray-500">
                        {hourData.hour.toString().padStart(2, "0")}:00
                      </div>
                      <div className="flex-1">
                        <div className="h-6 bg-gray-100 rounded overflow-hidden">
                          <div
                            className="h-full bg-primary rounded"
                            style={{
                              width: `${(hourData.netSales / maxHourlySales) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="w-24 text-right text-sm">
                        {formatCurrency(hourData.netSales)}
                      </div>
                      <div className="w-16 text-right text-sm text-gray-500">
                        {hourData.transactionCount} txns
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Date Range Tab */}
        <TabsContent value="range" className="space-y-6">
          {/* Date Range Selector */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label htmlFor="startDate" className="whitespace-nowrap">
                    Start:
                  </Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={dateRangeStart}
                    onChange={(e) => setDateRangeStart(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="endDate" className="whitespace-nowrap">
                    End:
                  </Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={dateRangeEnd}
                    onChange={(e) => setDateRangeEnd(e.target.value)}
                    className="w-40"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {!selectedStoreId ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center h-32 text-gray-500">
                <BarChart3 className="h-8 w-8 mb-2" />
                <p>Please select a store to view date range report.</p>
              </CardContent>
            </Card>
          ) : !dateRangeReport ? (
            <Card>
              <CardContent className="flex items-center justify-center h-32">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <SummaryCard
                  title="Total Gross Sales"
                  value={formatCurrency(dateRangeReport.totalGrossSales)}
                  icon={<DollarSign className="h-5 w-5" />}
                />
                <SummaryCard
                  title="Total Net Sales"
                  value={formatCurrency(dateRangeReport.totalNetSales)}
                  icon={<TrendingUp className="h-5 w-5" />}
                  highlight
                />
                <SummaryCard
                  title="Total Transactions"
                  value={dateRangeReport.totalTransactionCount.toString()}
                  icon={<ShoppingCart className="h-5 w-5" />}
                />
                <SummaryCard
                  title="Avg Ticket"
                  value={formatCurrency(dateRangeReport.averageTicket)}
                  icon={<BarChart3 className="h-5 w-5" />}
                />
              </div>

              {/* Details */}
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Period Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <DetailRow label="Vatable Sales" value={formatCurrency(dateRangeReport.totalVatableSales)} />
                    <DetailRow label="VAT Amount" value={formatCurrency(dateRangeReport.totalVatAmount)} />
                    <DetailRow label="VAT-Exempt Sales" value={formatCurrency(dateRangeReport.totalVatExemptSales)} />
                    <DetailRow label="Non-VAT Sales" value={formatCurrency(dateRangeReport.totalNonVatSales)} />
                    <div className="border-t pt-3">
                      <DetailRow label="Total Discounts" value={formatCurrency(dateRangeReport.totalDiscounts)} />
                      <DetailRow label="Void Amount" value={formatCurrency(dateRangeReport.totalVoidAmount)} />
                      <DetailRow label="Void Count" value={dateRangeReport.totalVoidCount.toString()} />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Payment Methods</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <DetailRow label="Cash" value={formatCurrency(dateRangeReport.totalCashSales)} />
                    <DetailRow label="Card/E-Wallet" value={formatCurrency(dateRangeReport.totalCardSales)} />
                  </CardContent>
                </Card>
              </div>

              {/* Daily Breakdown Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Daily Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Net Sales</TableHead>
                        <TableHead className="text-right">Transactions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dateRangeReport.dailyBreakdown.map((day) => (
                        <TableRow key={day.reportDate}>
                          <TableCell>{formatDate(new Date(day.reportDate).getTime())}</TableCell>
                          <TableCell className="text-right">{formatCurrency(day.netSales)}</TableCell>
                          <TableCell className="text-right">{day.transactionCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper Components
function SummaryCard({
  title,
  value,
  icon,
  highlight = false,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-primary bg-primary/5" : ""}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
        <div className={highlight ? "text-primary" : "text-gray-400"}>{icon}</div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${highlight ? "text-primary" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function DetailRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className={`flex justify-between text-sm ${bold ? "font-semibold" : ""}`}>
      <span className={bold ? "" : "text-gray-500"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
