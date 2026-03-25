import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// ── Types ──────────────────────────────────────────────────────

interface StoreInfo {
  name: string;
  address1: string;
  address2?: string;
  tin: string;
  contactNumber?: string;
  telephone?: string;
  email?: string;
  website?: string;
}

interface DailyReportData {
  grossSales: number;
  netSales: number;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  nonVatSales: number;
  seniorDiscounts: number;
  pwdDiscounts: number;
  promoDiscounts: number;
  manualDiscounts: number;
  totalDiscounts: number;
  voidCount: number;
  voidAmount: number;
  cashTotal: number;
  cardEwalletTotal: number;
  transactionCount: number;
  averageTicket: number;
  generatedByName: string;
  generatedAt: number;
}

interface ProductSaleRow {
  productId: string;
  productName: string;
  categoryName: string;
  quantitySold: number;
  grossAmount: number;
  voidedQuantity: number;
  voidedAmount: number;
}

interface CategorySaleRow {
  categoryId: string;
  categoryName: string;
  productCount: number;
  totalQuantitySold: number;
  totalGrossAmount: number;
}

interface HourlySaleRow {
  hour: number;
  transactionCount: number;
  netSales: number;
}

export interface ReportPdfDocumentProps {
  store: StoreInfo;
  reportDate: string;
  report: DailyReportData;
  productSales: ProductSaleRow[];
  categorySales: CategorySaleRow[];
  hourlySales: HourlySaleRow[];
}

// ── Helpers ────────────────────────────────────────────────────

const fmt = (amount: number): string =>
  `PHP ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const fmtDate = (dateStr: string): string => {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-PH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const fmtDateTime = (ts: number): string =>
  new Date(ts).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const fmtHour = (hour: number): string => {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 || 12;
  return `${h}:00 ${suffix}`;
};

// ── Styles ─────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#1F2937" },
  header: { marginBottom: 20, textAlign: "center" },
  storeName: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  storeDetail: { fontSize: 9, color: "#6B7280", marginBottom: 1 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 2 },
  subtitle: { fontSize: 9, color: "#6B7280", marginBottom: 16 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    marginBottom: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  rowLabel: { color: "#6B7280" },
  rowValue: { fontFamily: "Helvetica-Bold" },
  divider: { borderBottomWidth: 1, borderBottomColor: "#E5E7EB", marginVertical: 6 },
  twoCol: { flexDirection: "row", gap: 20 },
  col: { flex: 1 },
  // Table styles
  table: { marginTop: 4 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#F9FAFB",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: "#F3F4F6",
  },
  tableRowAlt: { backgroundColor: "#FAFAFA" },
  thText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: "#6B7280" },
  tdText: { fontSize: 8 },
  tdRight: { fontSize: 8, textAlign: "right" },
  tdRed: { fontSize: 8, textAlign: "right", color: "#DC2626" },
  footer: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    textAlign: "center",
  },
  footerText: { fontSize: 8, color: "#9CA3AF" },
  // Summary cards
  cardRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  card: { flex: 1, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 6, padding: 10 },
  cardLabel: { fontSize: 8, color: "#6B7280", marginBottom: 2 },
  cardValue: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  cardHighlight: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#0D87E1",
    borderRadius: 6,
    padding: 10,
    backgroundColor: "#EFF6FF",
  },
});

// ── Component ──────────────────────────────────────────────────

const DetailRow = ({
  label,
  value,
  bold: isBold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) => (
  <View style={s.row}>
    <Text style={isBold ? s.rowValue : s.rowLabel}>{label}</Text>
    <Text style={s.rowValue}>{value}</Text>
  </View>
);

export const ReportPdfDocument = ({
  store,
  reportDate,
  report,
  productSales,
  categorySales,
  hourlySales,
}: ReportPdfDocumentProps) => {
  const address = [store.address1, store.address2].filter(Boolean).join(", ");
  const activeHours = hourlySales.filter((h) => h.transactionCount > 0 || h.netSales > 0);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {/* Store Header */}
        <View style={s.header}>
          <Text style={s.storeName}>{store.name}</Text>
          {address && <Text style={s.storeDetail}>{address}</Text>}
          {store.tin && <Text style={s.storeDetail}>TIN: {store.tin}</Text>}
          {store.contactNumber && <Text style={s.storeDetail}>Tel: {store.contactNumber}</Text>}
          {store.telephone && store.telephone !== store.contactNumber && (
            <Text style={s.storeDetail}>Phone: {store.telephone}</Text>
          )}
          {store.email && <Text style={s.storeDetail}>{store.email}</Text>}
          {store.website && <Text style={s.storeDetail}>{store.website}</Text>}
        </View>

        {/* Report Title */}
        <View style={{ textAlign: "center", marginBottom: 20 }}>
          <Text style={s.title}>Daily Sales Report</Text>
          <Text style={s.subtitle}>
            {fmtDate(reportDate)} — Generated by {report.generatedByName} on{" "}
            {fmtDateTime(report.generatedAt)}
          </Text>
        </View>

        {/* Summary Cards */}
        <View style={s.cardRow}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Gross Sales</Text>
            <Text style={s.cardValue}>{fmt(report.grossSales)}</Text>
          </View>
          <View style={s.cardHighlight}>
            <Text style={s.cardLabel}>Net Sales</Text>
            <Text style={[s.cardValue, { color: "#0D87E1" }]}>{fmt(report.netSales)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Transactions</Text>
            <Text style={s.cardValue}>{report.transactionCount}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Avg Ticket</Text>
            <Text style={s.cardValue}>{fmt(report.averageTicket)}</Text>
          </View>
        </View>

        {/* Financial Summary — two columns */}
        <View style={s.twoCol}>
          <View style={[s.section, s.col]}>
            <Text style={s.sectionTitle}>Sales Breakdown</Text>
            <DetailRow label="Vatable Sales" value={fmt(report.vatableSales)} />
            <DetailRow label="VAT Amount (12%)" value={fmt(report.vatAmount)} />
            <DetailRow label="VAT-Exempt Sales" value={fmt(report.vatExemptSales)} />
            <DetailRow label="Non-VAT Sales" value={fmt(report.nonVatSales)} />
            <View style={s.divider} />
            <DetailRow label="Gross Sales" value={fmt(report.grossSales)} bold />
          </View>

          <View style={[s.section, s.col]}>
            <Text style={s.sectionTitle}>Discounts & Voids</Text>
            <DetailRow label="Senior Citizen" value={fmt(report.seniorDiscounts)} />
            <DetailRow label="PWD" value={fmt(report.pwdDiscounts)} />
            <DetailRow label="Promo" value={fmt(report.promoDiscounts)} />
            <DetailRow label="Manual" value={fmt(report.manualDiscounts)} />
            <View style={s.divider} />
            <DetailRow label="Total Discounts" value={fmt(report.totalDiscounts)} bold />
            <View style={s.divider} />
            <DetailRow label="Void Count" value={String(report.voidCount)} />
            <DetailRow label="Void Amount" value={fmt(report.voidAmount)} />
          </View>
        </View>

        {/* Payment Methods */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Payment Methods</Text>
          <DetailRow label="Cash" value={fmt(report.cashTotal)} />
          <DetailRow label="Card/E-Wallet" value={fmt(report.cardEwalletTotal)} />
        </View>

        {/* Product Sales Breakdown */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>
            Product Sales Breakdown ({productSales.length} products)
          </Text>
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.thText, { flex: 3 }]}>Product</Text>
              <Text style={[s.thText, { flex: 2 }]}>Category</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Qty</Text>
              <Text style={[s.thText, { flex: 1.5, textAlign: "right" }]}>Gross</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Void Qty</Text>
              <Text style={[s.thText, { flex: 1.5, textAlign: "right" }]}>Void Amt</Text>
            </View>
            {productSales.map((p, i) => (
              <View key={p.productId} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
                <Text style={[s.tdText, { flex: 3 }]}>{p.productName}</Text>
                <Text style={[s.tdText, { flex: 2 }]}>{p.categoryName}</Text>
                <Text style={[s.tdRight, { flex: 1 }]}>{p.quantitySold}</Text>
                <Text style={[s.tdRight, { flex: 1.5 }]}>{fmt(p.grossAmount)}</Text>
                <Text style={[p.voidedQuantity > 0 ? s.tdRed : s.tdRight, { flex: 1 }]}>
                  {p.voidedQuantity > 0 ? p.voidedQuantity : "-"}
                </Text>
                <Text style={[p.voidedAmount > 0 ? s.tdRed : s.tdRight, { flex: 1.5 }]}>
                  {p.voidedAmount > 0 ? fmt(p.voidedAmount) : "-"}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Sales by Category */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Sales by Category</Text>
          <View style={s.table}>
            <View style={s.tableHeader}>
              <Text style={[s.thText, { flex: 3 }]}>Category</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Products</Text>
              <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Total Qty</Text>
              <Text style={[s.thText, { flex: 2, textAlign: "right" }]}>Total Amount</Text>
            </View>
            {categorySales.map((c, i) => (
              <View key={c.categoryId} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
                <Text style={[s.tdText, { flex: 3 }]}>{c.categoryName}</Text>
                <Text style={[s.tdRight, { flex: 1 }]}>{c.productCount}</Text>
                <Text style={[s.tdRight, { flex: 1 }]}>{c.totalQuantitySold}</Text>
                <Text style={[s.tdRight, { flex: 2 }]}>{fmt(c.totalGrossAmount)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Hourly Breakdown */}
        {activeHours.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={s.sectionTitle}>Hourly Breakdown</Text>
            <View style={s.table}>
              <View style={s.tableHeader}>
                <Text style={[s.thText, { flex: 2 }]}>Hour</Text>
                <Text style={[s.thText, { flex: 1, textAlign: "right" }]}>Transactions</Text>
                <Text style={[s.thText, { flex: 2, textAlign: "right" }]}>Net Sales</Text>
              </View>
              {activeHours.map((h, i) => (
                <View key={h.hour} style={[s.tableRow, i % 2 === 1 && s.tableRowAlt]}>
                  <Text style={[s.tdText, { flex: 2 }]}>{fmtHour(h.hour)}</Text>
                  <Text style={[s.tdRight, { flex: 1 }]}>{h.transactionCount}</Text>
                  <Text style={[s.tdRight, { flex: 2 }]}>{fmt(h.netSales)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>This is a system-generated report.</Text>
          <Text style={s.footerText}>Downloaded on {new Date().toLocaleString("en-PH")}</Text>
          <Text style={[s.footerText, { marginTop: 4 }]}>Powered by PMGT Flow Suite</Text>
        </View>
      </Page>
    </Document>
  );
};
