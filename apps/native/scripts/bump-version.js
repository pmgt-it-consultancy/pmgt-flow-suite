const fs = require("fs");
const path = require("path");

const type = process.argv[2];
if (!["patch", "minor", "major"].includes(type)) {
  console.error("Usage: node bump-version.js <patch|minor|major>");
  process.exit(1);
}

const pkgPath = path.resolve(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);

let newVersion;
if (type === "patch") newVersion = [major, minor, patch + 1];
else if (type === "minor") newVersion = [major, minor + 1, 0];
else newVersion = [major + 1, 0, 0];

const versionStr = newVersion.join(".");
const versionCode = newVersion[0] * 10000 + newVersion[1] * 100 + newVersion[2];

// 1. Update package.json
pkg.version = versionStr;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// 2. Update app.config.ts
const appConfigPath = path.resolve(__dirname, "../app.config.ts");
let appConfig = fs.readFileSync(appConfigPath, "utf8");
appConfig = appConfig.replace(/version:\s*"[^"]+"/, `version: "${versionStr}"`);
fs.writeFileSync(appConfigPath, appConfig);

// 3. Update build.gradle
const gradlePath = path.resolve(__dirname, "../android/app/build.gradle");
let gradle = fs.readFileSync(gradlePath, "utf8");
gradle = gradle.replace(/versionCode \d+/, `versionCode ${versionCode}`);
gradle = gradle.replace(/versionName "[^"]+"/, `versionName "${versionStr}"`);
fs.writeFileSync(gradlePath, gradle);

console.log(`Bumped version to ${versionStr} (versionCode: ${versionCode})`);
