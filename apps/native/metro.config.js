const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("mjs");

const sharedRoot = path.resolve(__dirname, "../../packages/shared");

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@tamagui/core": path.dirname(require.resolve("@tamagui/core/package.json")),
};

config.resolver.blockList = [
  ...config.resolver.blockList,
  new RegExp(sharedRoot + "/node_modules/.*"),
];

module.exports = config;
