import { Platform } from "react-native";

type NavigationBarController = {
  setBehaviorAsync: (behavior: "overlay-swipe") => Promise<void>;
  setVisibilityAsync: (visibility: "hidden") => Promise<void>;
};

export async function applyAndroidFullscreen(
  platformOs: string = Platform.OS,
  navigationBar?: NavigationBarController,
) {
  if (platformOs !== "android") {
    return;
  }

  const navigationBarController = navigationBar ?? (await import("expo-navigation-bar"));

  await navigationBarController.setBehaviorAsync("overlay-swipe");
  await navigationBarController.setVisibilityAsync("hidden");
}
