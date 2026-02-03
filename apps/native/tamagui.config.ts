import { defaultConfig } from "@tamagui/config/v5";
import { animations } from "@tamagui/config/v5-reanimated";
import { createTamagui } from "tamagui";

const config = createTamagui({
  ...defaultConfig,
  animations,
  settings: {
    ...defaultConfig.settings,
    // Allow full style prop names (backgroundColor, alignItems, etc.)
    onlyAllowShorthands: false,
    // Allow any style values (not just tokens)
    allowedStyleValues: false,
    // RN-friendly defaults
    defaultPosition: "relative",
  },
  tokens: {
    ...defaultConfig.tokens,
    color: {
      ...defaultConfig.tokens.color,
      // Brand
      primary: "#0D87E1",
      primaryDark: "#0B6FBA",
      primaryLight: "#DBEAFE",

      // Destructive
      destructive: "#EF4444",
      destructiveDark: "#DC2626",
      destructiveLight: "#FEE2E2",

      // Success
      success: "#22C55E",
      successDark: "#16A34A",
      successLight: "#DCFCE7",

      // Warning
      warning: "#F59E0B",
      warningLight: "#FEF3C7",

      // Grays (Tailwind)
      gray50: "#F9FAFB",
      gray100: "#F3F4F6",
      gray200: "#E5E7EB",
      gray300: "#D1D5DB",
      gray400: "#9CA3AF",
      gray500: "#6B7280",
      gray600: "#4B5563",
      gray700: "#374151",
      gray800: "#1F2937",
      gray900: "#111827",

      // Semantic
      white: "#FFFFFF",
      black: "#000000",

      // Badge colors
      blue100: "#DBEAFE",
      blue500: "#0D87E1",
      blue600: "#0B6FBA",
      blue700: "#1D4ED8",
      red100: "#FEE2E2",
      red500: "#EF4444",
      red700: "#B91C1C",
      green100: "#DCFCE7",
      green500: "#22C55E",
      green700: "#15803D",
      yellow100: "#FEF3C7",
      yellow700: "#A16207",
    },
  },
});

export type AppConfig = typeof config;

declare module "tamagui" {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
