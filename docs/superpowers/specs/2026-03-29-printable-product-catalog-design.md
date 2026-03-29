# Printable Product Catalog PDF

## Problem

Store operators need a printable reference sheet of all products for internal use — stock checks, training, price auditing. No print/export functionality exists for the product catalog.

## Solution

Add a "Download PDF" button to the web admin products page that generates a formatted PDF of all products grouped by category, including prices, VAT status, active/inactive status, and assigned modifier groups with options.

## Approach

Use `@react-pdf/renderer` — the same pattern already used for daily report PDFs. A `ProductCatalogPdfDocument` React-PDF component renders the catalog, and the existing `DownloadPdfButton` pattern handles generation and download.

## PDF Content

### Header
- Store name
- Title: "Product Catalog"
- Generation date
- Filter context (e.g., "Showing: All Categories, Active & Inactive" or "Showing: Beverages, Active only")

### Body — Products Grouped by Category
- Each category is a section header
- Subcategories shown under their parent
- Product table columns per category: Name, Price, VAT Status, Status
- Open price products show min–max range instead of fixed price
- Under each product with modifiers: group name, selection rules (required/optional, min/max), options with price adjustments
- Inactive products included and labeled

### Footer
- Total product and category counts
- Generation timestamp

## Behavior

- Button placed in the products page header, next to "Add Product"
- Respects current page filters (category, status, search) — PDF reflects what the user is currently viewing
- Filename: `{storeName}-product-catalog-{YYYY-MM-DD}.pdf`

## Components

1. **`ProductCatalogPdfDocument.tsx`** — React-PDF template in `apps/web/src/app/(admin)/products/_components/`
2. **Products page update** — Add download button to page header, wire up data passing

## Data Flow

- Reuse existing `products.list` query data already loaded on the page (filtered by current filters)
- Fetch modifier details using `modifierAssignments.getForStore` (bulk query, already used by POS)
- Pass filtered products, resolved modifiers, store info, and active filter labels to the PDF component

## Known Limitations

- `modifierAssignments.getForStore` only returns modifiers for active products. Inactive products in the PDF will not show their modifier groups. This is acceptable for v1 — the primary use case is auditing the active catalog.
