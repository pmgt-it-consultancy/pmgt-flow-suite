const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const PROGUARD_RULE = "-keep class com.nozbe.watermelondb.** { *; }";
const JSI_IMPORT = "import com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage";
const JSI_REGISTER = "add(WatermelonDBJSIPackage())";

/**
 * Adds the ProGuard rule that keeps WatermelonDB native classes from being
 * stripped in release builds.
 */
function withProguard(config) {
  return withDangerousMod(config, [
    "android",
    (innerConfig) => {
      const proguardPath = path.join(
        innerConfig.modRequest.platformProjectRoot,
        "app",
        "proguard-rules.pro",
      );
      let contents = fs.existsSync(proguardPath) ? fs.readFileSync(proguardPath, "utf8") : "";
      if (!contents.includes(PROGUARD_RULE)) {
        contents = `${contents.trimEnd()}\n\n# WatermelonDB\n${PROGUARD_RULE}\n`;
        fs.writeFileSync(proguardPath, contents);
      }
      return innerConfig;
    },
  ]);
}

/**
 * Locates MainApplication.kt under the Android project root regardless of
 * package nesting (handles APP_VARIANT-based package suffixes like .stg).
 */
function findMainApplication(platformRoot) {
  const javaRoot = path.join(platformRoot, "app", "src", "main", "java");
  if (!fs.existsSync(javaRoot)) return null;
  const stack = [javaRoot];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === "MainApplication.kt") return full;
    }
  }
  return null;
}

/**
 * Registers WatermelonDBJSIPackage in MainApplication.kt's getPackages() block.
 * Required because new architecture autolinking does not auto-register the JSI
 * package — see https://github.com/Nozbe/WatermelonDB/issues/1769
 */
function withMainApplication(config) {
  return withDangerousMod(config, [
    "android",
    (innerConfig) => {
      const mainAppPath = findMainApplication(innerConfig.modRequest.platformProjectRoot);
      if (!mainAppPath) {
        throw new Error(
          "withWatermelonDB: MainApplication.kt not found under android/app/src/main/java",
        );
      }
      let src = fs.readFileSync(mainAppPath, "utf8");

      if (!src.includes(JSI_IMPORT)) {
        // Inject after the last existing 'import com.facebook.react.' line
        const importBlockMatch = src.match(/((?:import com\.facebook\.react\.[^\n]+\n)+)/);
        if (!importBlockMatch) {
          throw new Error(
            "withWatermelonDB: could not locate React Native imports in MainApplication.kt",
          );
        }
        src = src.replace(importBlockMatch[1], `${importBlockMatch[1]}${JSI_IMPORT}\n`);
      }

      if (!src.includes(JSI_REGISTER)) {
        const registerRegex = /(PackageList\(this\)\.packages\.apply\s*\{)/;
        if (!registerRegex.test(src)) {
          throw new Error(
            "withWatermelonDB: could not locate PackageList(this).packages.apply { ... } block",
          );
        }
        src = src.replace(registerRegex, (match) => `${match}\n              ${JSI_REGISTER}`);
      }

      fs.writeFileSync(mainAppPath, src);
      return innerConfig;
    },
  ]);
}

module.exports = (config) => withMainApplication(withProguard(config));
