const { withAndroidManifest } = require("expo/config-plugins");
const { mkdirSync, writeFileSync, existsSync } = require("fs");
const { resolve, join } = require("path");

function withApkInstaller(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Add REQUEST_INSTALL_PACKAGES permission
    if (!manifest["uses-permission"]) {
      manifest["uses-permission"] = [];
    }
    const hasPermission = manifest["uses-permission"].some(
      (p) => p.$?.["android:name"] === "android.permission.REQUEST_INSTALL_PACKAGES",
    );
    if (!hasPermission) {
      manifest["uses-permission"].push({
        $: { "android:name": "android.permission.REQUEST_INSTALL_PACKAGES" },
      });
    }

    // Ensure file_system_provider_paths.xml exists for expo-file-system's FileProvider
    const resDir = resolve(config.modRequest.platformProjectRoot, "app/src/main/res/xml");
    const pathsFile = join(resDir, "file_system_provider_paths.xml");
    if (!existsSync(pathsFile)) {
      if (!existsSync(resDir)) {
        mkdirSync(resDir, { recursive: true });
      }
      writeFileSync(
        pathsFile,
        `<?xml version="1.0" encoding="utf-8"?>
<paths>
  <files-path name="internal_files" path="." />
  <cache-path name="internal_cache" path="." />
  <external-files-path name="external_files" path="." />
  <external-cache-path name="external_cache" path="." />
</paths>`,
      );
    }

    return config;
  });
}

module.exports = withApkInstaller;
