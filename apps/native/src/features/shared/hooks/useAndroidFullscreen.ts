import { useCallback, useEffect } from "react";
import { AppState, Platform } from "react-native";
import { applyAndroidFullscreen } from "../utils/androidFullscreen";

export const useAndroidFullscreen = (enabled = true) => {
  const retriggerFullscreen = useCallback(() => {
    if (!enabled) {
      return;
    }

    void applyAndroidFullscreen();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || Platform.OS !== "android") {
      return;
    }

    retriggerFullscreen();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        retriggerFullscreen();
      }
    });

    return () => subscription.remove();
  }, [enabled, retriggerFullscreen]);

  return retriggerFullscreen;
};
