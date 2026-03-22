import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { FlatList, TouchableOpacity } from "react-native";
import { XStack, YStack } from "tamagui";
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
  hasModifiers: boolean;
  isOpenPrice?: boolean;
  minPrice?: number;
  maxPrice?: number;
}

interface SelectedProduct {
  id: Id<"products">;
  name: string;
  price: number;
  hasModifiers: boolean;
  isOpenPrice: boolean;
  minPrice?: number;
  maxPrice?: number;
}

interface CategoryGridProps {
  storeId: Id<"stores">;
  products: Product[] | undefined;
  onSelectProduct: (product: SelectedProduct) => void;
}

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

  const categoryTree = useQuery(api.categories.getTree, { storeId });

  // Search mode: flat product results across all categories
  const searchResults = useMemo(() => {
    if (!searchQuery || !products) return null;
    return products.filter(
      (p) => p.isActive && p.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [searchQuery, products]);

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
      setNav((prev) => ({
        level: 1,
        categoryId: prev.categoryId,
        categoryName: prev.categoryName,
      }));
    } else {
      setNav({ level: 0 });
    }
  }, [nav.level]);

  const gridItems = useMemo(() => {
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

  const renderItem = useCallback(
    ({ item }: { item: (typeof gridItems)[0] }) => {
      if (item.type === "category" || item.type === "subcategory") {
        const handler = item.type === "category" ? handleSelectCategory : handleSelectSubcategory;
        return (
          <CategoryTile
            id={item.category._id}
            name={item.category.name}
            itemCount={item.category.itemCount}
            onPress={handler}
          />
        );
      }
      return (
        <ProductCard
          id={item.product._id}
          name={item.product.name}
          price={item.product.price}
          hasModifiers={item.product.hasModifiers}
          isOpenPrice={item.product.isOpenPrice ?? false}
          minPrice={item.product.minPrice}
          maxPrice={item.product.maxPrice}
          onPress={onSelectProduct}
        />
      );
    },
    [handleSelectCategory, handleSelectSubcategory, onSelectProduct],
  );

  return (
    <YStack flex={1}>
      <SearchBar value={searchQuery} onChangeText={setSearchQuery} />

      {nav.level > 0 && !searchQuery && (
        <TouchableOpacity
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
          onPress={handleBack}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={20} color="#0D87E1" />
          <Text style={{ color: "#0D87E1", fontWeight: "600", fontSize: 14, marginLeft: 6 }}>
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
          <YStack flex={1} alignItems="center" justifyContent="center" paddingVertical={64}>
            <Ionicons
              name={searchQuery ? "search-outline" : "grid-outline"}
              size={40}
              color="#D1D5DB"
            />
            <Text variant="muted" style={{ marginTop: 12 }}>
              {searchQuery ? "No products found" : "No categories available"}
            </Text>
          </YStack>
        }
      />
    </YStack>
  );
};
