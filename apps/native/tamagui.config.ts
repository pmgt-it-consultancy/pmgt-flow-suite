import { createAnimations } from "@tamagui/animations-react-native";
import { createInterFont } from "@tamagui/font-inter";
import { createMedia } from "@tamagui/react-native-media-driver";
import { shorthands } from "@tamagui/shorthands";
import { tokens as defaultTokens, themes as tamaguiThemes } from "@tamagui/themes";
import { createTamagui, createTokens } from "tamagui";

const animations = createAnimations({
  fast: { type: "spring", damping: 20, mass: 1.2, stiffness: 250 },
  medium: { type: "spring", damping: 15, mass: 0.9, stiffness: 150 },
  slow: { type: "spring", damping: 20, stiffness: 60 },
});

const interFont = createInterFont();

const headingFont = createInterFont({
  family: "Montserrat",
  face: {
    300: { normal: "MLight" },
    400: { normal: "MRegular" },
    500: { normal: "MMedium" },
    600: { normal: "MSemiBold" },
    700: { normal: "MBold" },
  },
});

const bodyFont = createInterFont({
  face: {
    400: { normal: "Regular" },
    500: { normal: "Medium" },
    600: { normal: "SemiBold" },
    700: { normal: "Bold" },
  },
});

const tokens = createTokens({
  ...defaultTokens,
  color: {
    ...defaultTokens.color,
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
    transparent: "transparent",

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
  space: {
    ...defaultTokens.space,
    px: 1,
    0: 0,
    0.5: 2,
    1: 4,
    1.5: 6,
    2: 8,
    2.5: 10,
    3: 12,
    3.5: 14,
    4: 16,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    9: 36,
    10: 40,
    12: 48,
    16: 64,
    20: 80,
  },
  size: {
    ...defaultTokens.size,
    0: 0,
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
    12: 48,
    16: 64,
    20: 80,
  },
  radius: {
    ...defaultTokens.radius,
    0: 0,
    1: 4,
    1.5: 6,
    2: 8,
    3: 12,
    4: 16,
    full: 9999,
  },
});

const lightTheme = {
  background: "#FFFFFF",
  backgroundHover: "#F9FAFB",
  backgroundPress: "#F3F4F6",
  backgroundFocus: "#F3F4F6",
  color: "#111827",
  colorHover: "#111827",
  colorPress: "#374151",
  colorFocus: "#111827",
  borderColor: "#E5E7EB",
  borderColorHover: "#D1D5DB",
  borderColorFocus: "#0D87E1",
  borderColorPress: "#D1D5DB",
  placeholderColor: "#9CA3AF",
  primary: "#0D87E1",
  primaryDark: "#0B6FBA",
  destructive: "#EF4444",
  success: "#22C55E",
  muted: "#6B7280",
  mutedForeground: "#6B7280",
};

const config = createTamagui({
  defaultFont: "body",
  animations,
  shouldAddPrefersColorThemes: false,
  themeClassNameOnRoot: false,
  shorthands,
  fonts: {
    heading: headingFont,
    body: bodyFont,
  },
  themes: {
    light: lightTheme,
  },
  tokens,
  media: createMedia({
    sm: { maxWidth: 640 },
    md: { maxWidth: 768 },
    lg: { maxWidth: 1024 },
  }),
});

export type AppConfig = typeof config;

declare module "tamagui" {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
