const fs = require("fs");
const path = require("path");

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node set-version.js <major.minor.patch>");
  console.error("Example: node set-version.js 1.0.0");
  process.exit(1);
}

const [major, minor, patch] = version.split(".").map(Number);
const versionCode = major * 10000 + minor * 100 + patch;

// 1. Update package.json
const pkgPath = path.resolve(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// 2. Update app.config.ts
const appConfigPath = path.resolve(__dirname, "../app.config.ts");
let appConfig = fs.readFileSync(appConfigPath, "utf8");
appConfig = appConfig.replace(/version:\s*"[^"]+"/, `version: "${version}"`);
fs.writeFileSync(appConfigPath, appConfig);

// 3. Update build.gradle
const gradlePath = path.resolve(__dirname, "../android/app/build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");
gradle = gradle.replace(/versionCode \d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName "[^"]+"/, `versionName "${version}"`);
fs.writeFileSync(gradlePath, gradle);

console.log(`Set version to ${version} (versionCode: ${versionCode})`);
