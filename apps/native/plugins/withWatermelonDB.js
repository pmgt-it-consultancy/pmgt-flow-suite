const { withAppBuildGradle, withDangerousMod, withSettingsGradle } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const PROGUARD_RULE = "-keep class com.nozbe.watermelondb.** { *; }";
const JSI_IMPORT = "import com.nozbe.watermelondb.jsi.WatermelonDBJSIPackage";
const JSI_REGISTER = "add(WatermelonDBJSIPackage())";

const SETTINGS_GRADLE_BLOCK = `
include ':watermelondb-jsi'
project(':watermelondb-jsi').projectDir = new File(
  ['node', '--print', "require.resolve('@nozbe/watermelondb/package.json')"]
    .execute(null, rootProject.projectDir).text.trim(),
  '../native/android-jsi',
)
`;

const APP_GRADLE_DEPENDENCY = "implementation project(':watermelondb-jsi')";

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
 * Adds the `:watermelondb-jsi` Gradle subproject pointing at the
 * @nozbe/watermelondb package's `native/android-jsi` directory. This is
 * required because WMDB's react-native.config.js only autolinks
 * `native/android` (the non-JSI surface). The path is resolved at Gradle
 * configuration time using `node --print require.resolve(...)` so it
 * works under pnpm's nested-symlink layout without hardcoding.
 */
function withSettings(config) {
  return withSettingsGradle(config, (innerConfig) => {
    if (!innerConfig.modResults.contents.includes(":watermelondb-jsi")) {
      innerConfig.modResults.contents += SETTINGS_GRADLE_BLOCK;
    }
    return innerConfig;
  });
}

/**
 * Adds `implementation project(':watermelondb-jsi')` to the app module so
 * the JSI subproject is on the classpath at compile time.
 */
function withAppBuild(config) {
  return withAppBuildGradle(config, (innerConfig) => {
    if (!innerConfig.modResults.contents.includes(APP_GRADLE_DEPENDENCY)) {
      innerConfig.modResults.contents = innerConfig.modResults.contents.replace(
        /dependencies\s*\{/,
        (match) => `${match}\n    ${APP_GRADLE_DEPENDENCY}`,
      );
    }
    return innerConfig;
  });
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

module.exports = (config) => withMainApplication(withAppBuild(withSettings(withProguard(config))));
