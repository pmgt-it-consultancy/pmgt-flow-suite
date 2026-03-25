# Products Category & Status Filtering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add category and status filter dropdowns to the products admin page so staff can quickly narrow the product list.

**Architecture:** Client-side filtering on the already-loaded `products` array using two new `useState` variables (`categoryFilter`, `statusFilter`). The existing search card gets two `Select` dropdowns alongside the search input. No backend changes.

**Tech Stack:** React, Next.js, Radix UI Select, Convex `useQuery`

**Spec:** `docs/superpowers/specs/2026-03-25-products-category-filter-design.md`

---

### Task 1: Add filter state variables

**Files:**
- Modify: `apps/web/src/app/(admin)/products/page.tsx:74`

- [ ] **Step 1: Add `categoryFilter` and `statusFilter` state**

After line 74 (`const [searchQuery, setSearchQuery] = useState("");`), add:

```tsx
const [categoryFilter, setCategoryFilter] = useState<Id<"categories"> | "all">("all");
const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");
```

- [ ] **Step 2: Replace `filteredProducts` with the full filter chain**

Replace lines 108-111:
```tsx
// Filter products by search query
const filteredProducts = products?.filter((p) =>
  p.name.toLowerCase().includes(searchQuery.toLowerCase()),
);
```

With:
```tsx
// Filter products by status, category, and search query
const filteredProducts = products?.filter((p) => {
  if (statusFilter !== "all" && p.isActive !== (statusFilter === "active")) return false;
  if (categoryFilter !== "all" && p.categoryId !== categoryFilter) return false;
  if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
  return true;
});
```

- [ ] **Step 3: Verify the app compiles**

Run: `cd apps/web && pnpm build --no-lint 2>&1 | tail -5`
Expected: Build succeeds (new state variables are unused in JSX but valid)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(admin)/products/page.tsx
git commit -m "feat(products): add category and status filter state with filter chain"
```

---

### Task 2: Add filter dropdowns to the search card

**Files:**
- Modify: `apps/web/src/app/(admin)/products/page.tsx:199-212`

- [ ] **Step 1: Replace the search card content**

Replace lines 199-212 (the `{/* Search */}` card):
```tsx
{/* Search */}
<Card>
  <CardContent className="pt-6">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <Input
        placeholder="Search products by name or SKU..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="pl-10"
      />
    </div>
  </CardContent>
</Card>
```

With:
```tsx
{/* Filters */}
<Card>
  <CardContent className="pt-6">
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          placeholder="Search products by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>
      <Select
        value={categoryFilter}
        onValueChange={(value) => setCategoryFilter(value as Id<"categories"> | "all")}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="All Categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {categories?.map((category) => (
            <SelectItem key={category._id} value={category._id}>
              {category.parentId ? "└ " : ""}
              {category.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={statusFilter}
        onValueChange={(value) => setStatusFilter(value as "all" | "active" | "inactive")}
      >
        <SelectTrigger className="w-[140px]">
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
```

- [ ] **Step 2: Verify the app compiles**

Run: `cd apps/web && pnpm build --no-lint 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(admin)/products/page.tsx
git commit -m "feat(products): add category and status filter dropdowns to search bar"
```

---

### Task 3: Update count display and empty state

**Files:**
- Modify: `apps/web/src/app/(admin)/products/page.tsx:216-238`

- [ ] **Step 1: Update the CardDescription count**

Replace:
```tsx
<CardDescription>{filteredProducts?.length ?? 0} product(s) found</CardDescription>
```

With:
```tsx
<CardDescription>
  {categoryFilter === "all" && statusFilter === "all" && !searchQuery
    ? `${products?.length ?? 0} product(s)`
    : categoryFilter === "all" && statusFilter === "active" && !searchQuery
      ? `${filteredProducts?.length ?? 0} active product(s)`
      : `${filteredProducts?.length ?? 0} of ${products?.length ?? 0} product(s)`}
</CardDescription>
```

- [ ] **Step 2: Update the empty state message**

Replace the empty state block:
```tsx
<p>
  {searchQuery
    ? "No products match your search."
    : "No products found. Create your first product."}
</p>
```

With:
```tsx
<p>
  {searchQuery || categoryFilter !== "all" || statusFilter !== "all"
    ? "No products match your filters."
    : "No products found. Create your first product."}
</p>
```

- [ ] **Step 3: Verify the app compiles**

Run: `cd apps/web && pnpm build --no-lint 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/(admin)/products/page.tsx
git commit -m "feat(products): update count display and empty state for filters"
```

---

### Task 4: Lint, format, and verify

**Files:**
- Modify: `apps/web/src/app/(admin)/products/page.tsx`

- [ ] **Step 1: Run lint and format**

Run: `pnpm check`
Expected: No errors (fix any that appear)

- [ ] **Step 2: Run full build**

Run: `pnpm build 2>&1 | tail -10`
Expected: Build succeeds with no errors

- [ ] **Step 3: Manual verification checklist**

Open the app at the products admin page and verify:
1. Default state shows only active products with "Active" selected in status dropdown
2. Selecting a category filters products to that category only
3. Selecting "Inactive" in status shows only inactive products
4. Selecting "All" in status shows both active and inactive products
5. Search works in combination with category and status filters
6. Count display shows correct format for each filter state
7. Empty state shows "No products match your filters." when filters produce no results
8. Empty catalog still shows "No products found. Create your first product."

- [ ] **Step 4: Final commit**

```bash
git add apps/web/src/app/(admin)/products/page.tsx
git commit -m "chore(products): lint and format products page"
```
