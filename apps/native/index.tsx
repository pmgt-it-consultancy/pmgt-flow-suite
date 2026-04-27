import { installWindowShim } from "./src/shims/window";

installWindowShim();

import { registerRootComponent } from "expo";

import App from "./App";

// Phase 0 spike smoke test — runs only when EXPO_PUBLIC_WATERMELON_SPIKE is "1".
// Verifies JSI SQLite boots cleanly under RN 0.81 + new arch. Remove once Phase 0
// is verified.
if (process.env.EXPO_PUBLIC_WATERMELON_SPIKE === "1") {
  import("./src/db/spike/runSmokeTest").then(({ runWatermelonSpike }) => {
    void runWatermelonSpike();
  });
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in the Expo client or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
