# Implementation Plan: POS Drill-Down Category Grid Navigation

## Overview

Replace the current horizontal category pill bar + flat product grid with a full-screen drill-down grid navigation:
- **Level 0**: Category Grid (landing view, always shown first)
- **Level 1**: Tap category → subcategory tiles + direct product tiles in same grid
- **Level 2**: Tap subcategory → only products in that subcategory

Search bar present at every level. Max 2 levels deep. Back button navigation.

## Files to Modify

| File | Action |
|------|--------|
| `apps/native/src/features/orders/components/CategoryFilter.tsx` | **Delete** (replaced by new component) |
| `apps/native/src/features/orders/components/CategoryGrid.tsx` | **Create** — new drill-down grid component |
| `apps/native/src/features/orders/components/CategoryTile.tsx` | **Create** — tile for categories/subcategories |
| `apps/native/src/features/orders/components/ProductCard.tsx` | **Modify** — no functional change, just ensure visual distinction from CategoryTile |
| `apps/native/src/features/orders/components/index.ts` | **Modify** — swap exports |
| `apps/native/src/features/orders/screens/OrderScreen.tsx` | **Modify** — replace CategoryFilter + product FlatList with CategoryGrid |

## Architecture Decision

The backend already has everything we need:
- `categories.list` supports `parentId` filter → can fetch root categories and subcategories
- `categories.getTree` returns hierarchical data with children and product counts
- `products.list` returns all products with `categoryId`
- Schema has `parentId` on categories and `by_parent` / `by_store_parent` indexes

**We will use `categories.getTree`** for the category grid since it gives us the full hierarchy in one query. Products will continue using `products.list` filtered client-side.

---

## Tasks

### Task 1: Create `CategoryTile` component

**File**: `apps/native/src/features/orders/components/CategoryTile.tsx`

**Purpose**: A grid tile representing a category or subcategory. Visually distinct from ProductCard — uses a folder icon and different background to signal "this drills deeper."

```tsx
import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { TouchableOpacity, View } from "uniwind/components";
import { Text } from "../../shared/components/ui";

interface CategoryTileProps {
  id: Id<"categories">;
  name: string;
  itemCount: number; // product count + subcategory count
  onPress: (categoryId: Id<"categories">) => void;
}

export const CategoryTile = ({ id, name, itemCount, onPress }: CategoryTileProps) => {
  return (
    <TouchableOpacity
      className="flex-1 bg-blue-50 rounded-xl p-4 m-1.5 max-w-[31.5%] min-h-[100px] border border-blue-200 shadow-sm justify-between"
      onPress={() => onPress(id)}
      activeOpacity={0.7}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-blue-900 font-bold text-base flex-1 mr-2" numberOfLines={2}>
          {name}
        </Text>
        <Ionicons name="folder-open-outline" size={20} color="#1E40AF" />
      </View>
      <Text className="text-blue-500 text-xs mt-2">
        {itemCount} {itemCount === 1 ? "item" : "items"}
      </Text>
    </TouchableOpacity>
  );
};
```

**Visual distinction from ProductCard**:
- `bg-blue-50` + `border-blue-200` (vs ProductCard's `bg-white` + `border-gray-200`)
- Folder icon in top-right corner
- Item count instead of price badge
- Blue-toned text

**Verification**: Component renders, accepts props, no TypeScript errors.

---

### Task 2: Create `CategoryGrid` component

**File**: `apps/native/src/features/orders/components/CategoryGrid.tsx`

**Purpose**: The main drill-down navigation component. Manages navigation state internally and renders the appropriate level (categories, subcategories+items, or items only).

```tsx
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { FlatList, TouchableOpacity, View } from "uniwind/components";
import { Text } from "../../shared/components/ui";
import { CategoryTile } from "./CategoryTile";
import { ProductCard } from "./ProductCard";
import { SearchBar } from "./SearchBar";

interface Product {
  _id: Id<"products">;
  name: string;
  price: number;
  categoryId: Id<"categories">;
  isActive: boolean;
}

interface SelectedProduct {
  id: Id<"products">;
  name: string;
  price: number;
}

interface CategoryGridProps {
  storeId: Id<"stores">;
  products: Product[] | undefined;
  onSelectProduct: (product: SelectedProduct) => void;
}

// Navigation state: which category/subcategory we're viewing
interface NavState {
  level: 0 | 1 | 2;
  categoryId?: Id<"categories">;
  categoryName?: string;
  subcategoryId?: Id<"categories">;
  subcategoryName?: string;
}

export const CategoryGrid = ({ storeId, products, onSelectProduct }: CategoryGridProps) => {
  const [nav, setNav] = useState<NavState>({ level: 0 });
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch category tree (root categories with children)
  const categoryTree = useQuery(api.categories.getTree, { storeId });

  // --- Search mode: when searching, show flat product results across all categories ---
  const searchResults = useMemo(() => {
    if (!searchQuery || !products) return null;
    return products.filter(
      (p) => p.isActive && p.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [searchQuery, products]);

  // --- Navigation handlers ---
  const handleSelectCategory = useCallback(
    (categoryId: Id<"categories">) => {
      const cat = categoryTree?.find((c) => c._id === categoryId);
      if (!cat) return;
      setNav({
        level: 1,
        categoryId,
        categoryName: cat.name,
      });
    },
    [categoryTree],
  );

  const handleSelectSubcategory = useCallback(
    (subcategoryId: Id<"categories">) => {
      // Find subcategory name from current category's children
      const parentCat = categoryTree?.find((c) => c._id === nav.categoryId);
      const subcat = parentCat?.children.find((c) => c._id === subcategoryId);
      if (!subcat) return;
      setNav((prev) => ({
        ...prev,
        level: 2,
        subcategoryId,
        subcategoryName: subcat.name,
      }));
    },
    [categoryTree, nav.categoryId],
  );

  const handleBack = useCallback(() => {
    if (nav.level === 2) {
      // Go back to category level (level 1)
      setNav((prev) => ({
        level: 1,
        categoryId: prev.categoryId,
        categoryName: prev.categoryName,
      }));
    } else {
      // Go back to root (level 0)
      setNav({ level: 0 });
    }
  }, [nav.level]);

  // --- Build grid items for current level ---
  const gridItems = useMemo(() => {
    // Search mode overrides navigation
    if (searchResults) {
      return searchResults.map((p) => ({
        key: p._id,
        type: "product" as const,
        product: p,
      }));
    }

    if (!categoryTree || !products) return [];

    // Level 0: Root categories
    if (nav.level === 0) {
      return categoryTree.map((cat) => ({
        key: cat._id,
        type: "category" as const,
        category: {
          _id: cat._id,
          name: cat.name,
          itemCount: cat.productCount + cat.children.length,
        },
      }));
    }

    // Level 1: Subcategories + direct products of selected category
    if (nav.level === 1 && nav.categoryId) {
      const parentCat = categoryTree.find((c) => c._id === nav.categoryId);
      if (!parentCat) return [];

      const subcategoryItems = parentCat.children.map((child) => ({
        key: child._id,
        type: "subcategory" as const,
        category: {
          _id: child._id,
          name: child.name,
          itemCount: child.productCount,
        },
      }));

      const productItems = products
        .filter((p) => p.categoryId === nav.categoryId && p.isActive)
        .map((p) => ({
          key: p._id,
          type: "product" as const,
          product: p,
        }));

      // Subcategories first, then products
      return [...subcategoryItems, ...productItems];
    }

    // Level 2: Products in subcategory only
    if (nav.level === 2 && nav.subcategoryId) {
      return products
        .filter((p) => p.categoryId === nav.subcategoryId && p.isActive)
        .map((p) => ({
          key: p._id,
          type: "product" as const,
          product: p,
        }));
    }

    return [];
  }, [searchResults, categoryTree, products, nav]);

  // --- Breadcrumb text ---
  const breadcrumb = useMemo(() => {
    if (nav.level === 1) return nav.categoryName ?? "";
    if (nav.level === 2) return `${nav.categoryName} > ${nav.subcategoryName}`;
    return "";
  }, [nav]);

  // --- Render ---
  const renderItem = useCallback(
    ({ item }: { item: (typeof gridItems)[0] }) => {
      if (item.type === "category" || item.type === "subcategory") {
        const handler =
          item.type === "category" ? handleSelectCategory : handleSelectSubcategory;
        return (
          <CategoryTile
            id={item.category._id}
            name={item.category.name}
            itemCount={item.category.itemCount}
            onPress={handler}
          />
        );
      }
      // Product
      return (
        <ProductCard
          id={item.product._id}
          name={item.product.name}
          price={item.product.price}
          onPress={onSelectProduct}
        />
      );
    },
    [handleSelectCategory, handleSelectSubcategory, onSelectProduct],
  );

  return (
    <View className="flex-1">
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
      />

      {/* Back button + breadcrumb (only when drilled in) */}
      {nav.level > 0 && !searchQuery && (
        <TouchableOpacity
          className="flex-row items-center px-3 py-2"
          onPress={handleBack}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color="#3B82F6" />
          <Text className="text-blue-500 font-semibold text-sm ml-1.5">
            {nav.level === 1 ? "Categories" : nav.categoryName}
          </Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={gridItems}
        numColumns={3}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 6 }}
        columnWrapperStyle={{ justifyContent: "flex-start" }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center py-16">
            <Ionicons
              name={searchQuery ? "search-outline" : "grid-outline"}
              size={40}
              color="#D1D5DB"
            />
            <Text variant="muted" className="mt-3">
              {searchQuery ? "No products found" : "No categories available"}
            </Text>
          </View>
        }
      />
    </View>
  );
};
```

**Key design decisions**:
- Navigation state is local to this component (`nav` state with level 0/1/2)
- Uses `categories.getTree` (already exists!) for hierarchy — no new backend work needed
- Products are still passed in from parent (reuses existing `products.list` query)
- Search overrides navigation: when typing, shows flat product results globally
- Clearing search returns to current nav position

**Verification**: Component compiles, renders category grid at level 0, drill-down works.

---

### Task 3: Update `index.ts` exports

**File**: `apps/native/src/features/orders/components/index.ts`

**Change**: Replace `CategoryFilter` export with `CategoryGrid` and `CategoryTile`.

```diff
- export { CategoryFilter } from "./CategoryFilter";
+ export { CategoryGrid } from "./CategoryGrid";
+ export { CategoryTile } from "./CategoryTile";
```

Keep all other exports unchanged.

**Verification**: No TypeScript import errors in OrderScreen.

---

### Task 4: Update `OrderScreen.tsx` to use `CategoryGrid`

**File**: `apps/native/src/features/orders/screens/OrderScreen.tsx`

**Changes**:

1. **Remove** imports: `CategoryFilter`, `SearchBar` (SearchBar is now inside CategoryGrid)
2. **Add** import: `CategoryGrid`
3. **Remove** state: `selectedCategory`, `searchQuery`
4. **Remove** the `filteredProducts` memo (filtering now handled inside CategoryGrid)
5. **Replace** the menu section JSX

**Before** (lines 492-524):
```tsx
<View className="flex-2 border-r border-gray-200">
  <SearchBar value={searchQuery} onChangeText={setSearchQuery} />
  <CategoryFilter
    categories={categories ?? []}
    selectedCategory={selectedCategory}
    onSelectCategory={setSelectedCategory}
  />
  <FlatList
    data={filteredProducts}
    numColumns={3}
    keyExtractor={(item) => item._id}
    renderItem={({ item }) => (
      <ProductCard
        id={item._id}
        name={item.name}
        price={item.price}
        onPress={handleAddProduct}
      />
    )}
    contentContainerStyle={{ padding: 6 }}
    columnWrapperStyle={{ justifyContent: "flex-start" }}
    ListEmptyComponent={
      <View className="flex-1 items-center justify-center py-16">
        <Ionicons name="search-outline" size={40} color="#D1D5DB" />
        <Text variant="muted" className="mt-3">
          No products found
        </Text>
      </View>
    }
  />
</View>
```

**After**:
```tsx
<View className="flex-2 border-r border-gray-200">
  <CategoryGrid
    storeId={storeId}
    products={products}
    onSelectProduct={handleAddProduct}
  />
</View>
```

6. **Remove** the `categories` query since `CategoryGrid` uses `getTree` internally:
```diff
- const categories = useQuery(api.categories.list, { storeId });
```

7. **Remove** unused imports (`FlatList` from the menu section is no longer needed at this level — but keep it if CartSection still uses it; it does, so keep the import).

**Verification**: OrderScreen compiles. Menu section shows category grid. Tapping category drills down. Back button works. Search works across all levels. Adding products still works (modal flow unchanged).

---

### Task 5: Delete `CategoryFilter.tsx`

**File**: `apps/native/src/features/orders/components/CategoryFilter.tsx`

**Action**: Delete the file entirely. It's fully replaced by `CategoryGrid` + `CategoryTile`.

**Verification**: No remaining imports of `CategoryFilter` anywhere. Run `grep -r "CategoryFilter" apps/native/` to confirm.

---

## What Does NOT Change

- **Backend**: No schema changes, no new queries. `getTree` already exists.
- **ProductCard**: Same component, same styling. No changes needed.
- **AddItemModal / ModifierSelectionModal**: Untouched. Product selection flow after tapping a product is identical.
- **Cart section**: Completely untouched.
- **SearchBar**: Same component, just moved inside CategoryGrid.

## Execution Order

```
Task 1 (CategoryTile) → Task 2 (CategoryGrid) → Task 3 (index.ts) → Task 4 (OrderScreen) → Task 5 (delete CategoryFilter)
```

Tasks 1-2 are new files (safe to create independently), Tasks 3-5 depend on 1-2 being done.

## Risk Assessment

- **Low risk**: Backend already supports hierarchy via `getTree` — no migration needed.
- **Medium risk**: The `FlatList` with mixed item types (category tiles + product cards) needs `flex` handling so tiles fill the 3-column layout correctly. Both `CategoryTile` and `ProductCard` use `max-w-[31.5%]` and `flex-1` which should work, but should be visually tested on the iPad/tablet layout.
- **No data migration**: Categories already have `parentId` in the schema.
