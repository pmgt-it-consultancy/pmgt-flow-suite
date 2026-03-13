import type { ConfigContext, ExpoConfig } from "expo/config";

const IS_STAGING = process.env.APP_VARIANT === "staging";

const getAppName = () => {
  if (IS_STAGING) return "PMGT Flow STG";
  return "PMGT Flow";
};

const getPackageName = () => {
  if (IS_STAGING) return "com.pmgtitconsultancy.pmgtflow.stg";
  return "com.pmgtitconsultancy.pmgtflow";
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  jsEngine: "hermes",
  newArchEnabled: true,
  name: getAppName(),
  slug: "pmgt-flow",
  version: "3.10.1",
  orientation: "landscape",
  icon: "./assets/app-icon.png",
  userInterfaceStyle: "light",
  extra: {
    appVariant: IS_STAGING ? "staging" : "production",
    eas: {
      projectId: "d590d355-68a1-4dcd-8ffa-4d40489c7b0f",
    },
  },
  splash: {
    image: "./assets/logo-full.png",
    resizeMode: "contain",
    backgroundColor: "#0A1628",
  },
  assetBundlePatterns: ["**/*"],
  android: {
    permissions: [
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.ACCESS_FINE_LOCATION",
    ],
    versionCode: 6,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#2284E8",
    },
    package: getPackageName(),
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-font",
    "expo-secure-store",
    "@kesha-antonov/react-native-background-downloader",
    [
      "expo-notifications",
      {
        icon: "./assets/app-icon.png",
        color: "#ffffff",
        defaultChannel: "default",
      },
    ],
    ["./plugins/withReactNativeArchitectures", "arm64-v8a,x86_64"],
    "./plugins/withApkInstaller",
  ],
});
