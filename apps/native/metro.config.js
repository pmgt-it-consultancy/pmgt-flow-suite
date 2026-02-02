const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push("mjs");

// Ensure @tamagui/core resolves to the same instance used by tamagui
const tamaguiCore = path.dirname(require.resolve("@tamagui/core/package.json"));
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@tamagui/core": tamaguiCore,
};

module.exports = config;
