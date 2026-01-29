import { Ionicons } from "@expo/vector-icons";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useState } from "react";
import { FlatList, TouchableOpacity, View } from "uniwind/components";
import { Modal, Text } from "../../shared/components/ui";

interface Category {
  _id: Id<"categories">;
  name: string;
}

interface CategoryFilterProps {
  categories: Category[];
  selectedCategory: Id<"categories"> | "all";
  onSelectCategory: (categoryId: Id<"categories"> | "all") => void;
}

interface CategoryButtonProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

const CategoryButton = ({ label, selected, onPress }: CategoryButtonProps) => {
  return (
    <TouchableOpacity
      className={`flex-1 m-1 rounded-xl items-center justify-center min-h-[56px] ${
        selected ? "bg-blue-500" : "bg-gray-100 border border-gray-200"
      }`}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        className={`text-sm font-semibold ${selected ? "text-white" : "text-gray-700"}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const MAX_VISIBLE = 3;

export const CategoryFilter = ({
  categories,
  selectedCategory,
  onSelectCategory,
}: CategoryFilterProps) => {
  const [showModal, setShowModal] = useState(false);

  const allCategories: Array<{ _id: Id<"categories"> | "all"; name: string }> = [
    { _id: "all", name: "All" },
    ...categories,
  ];

  const hasMore = allCategories.length > MAX_VISIBLE + 1;
  const visibleCategories = hasMore ? allCategories.slice(0, MAX_VISIBLE) : allCategories;

  const selectedName =
    selectedCategory === "all"
      ? null
      : (categories.find((c) => c._id === selectedCategory)?.name ?? null);
  const isSelectedHidden =
    hasMore &&
    selectedCategory !== "all" &&
    !visibleCategories.some((c) => c._id === selectedCategory);

  const handleSelectFromModal = (id: Id<"categories"> | "all") => {
    onSelectCategory(id);
    setShowModal(false);
  };

  return (
    <View className="px-2 py-2">
      <View className="flex-row">
        {visibleCategories.map((item) => (
          <CategoryButton
            key={item._id}
            label={item.name}
            selected={selectedCategory === item._id}
            onPress={() => onSelectCategory(item._id)}
          />
        ))}
        {hasMore && (
          <TouchableOpacity
            className={`flex-1 m-1 rounded-xl items-center justify-center min-h-[56px] ${
              isSelectedHidden ? "bg-blue-500" : "bg-gray-100 border border-gray-200"
            }`}
            onPress={() => setShowModal(true)}
            activeOpacity={0.7}
          >
            {isSelectedHidden ? (
              <Text className="text-xs font-semibold text-white" numberOfLines={1}>
                {selectedName}
              </Text>
            ) : (
              <Ionicons name="grid-outline" size={20} color="#374151" />
            )}
            <Text
              className={`text-xs mt-0.5 ${isSelectedHidden ? "text-blue-100" : "text-gray-500"}`}
            >
              More
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal
        visible={showModal}
        title="Categories"
        onClose={() => setShowModal(false)}
        onRequestClose={() => setShowModal(false)}
        position="center"
      >
        <FlatList
          data={allCategories}
          numColumns={3}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <CategoryButton
              label={item.name}
              selected={selectedCategory === item._id}
              onPress={() => handleSelectFromModal(item._id)}
            />
          )}
          contentContainerStyle={{ paddingBottom: 8 }}
        />
      </Modal>
    </View>
  );
};
