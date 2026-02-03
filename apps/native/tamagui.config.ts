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
});

export type AppConfig = typeof config;

declare module "tamagui" {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
