import React from "react";
import { ScrollView } from "uniwind/components";
import { Chip } from "../../shared/components/ui";
import { Id } from "@packages/backend/convex/_generated/dataModel";

interface Category {
  _id: Id<"categories">;
  name: string;
}

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: Id<"categories"> | "all";
  onSelectCategory: (categoryId: Id<"categories"> | "all") => void;
}

export const CategoryFilter = ({
  categories,
  selectedCategory,
  onSelectCategory,
}: CategoryFilterProps) => {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="px-3 py-2 border-b border-gray-200"
      contentContainerStyle={{ gap: 8 }}
    >
      <Chip
        selected={selectedCategory === "all"}
        onPress={() => onSelectCategory("all")}
      >
        All
      </Chip>
      {categories.map((category) => (
        <Chip
          key={category._id}
          selected={selectedCategory === category._id}
          onPress={() => onSelectCategory(category._id)}
        >
          {category.name}
        </Chip>
      ))}
    </ScrollView>
  );
};
