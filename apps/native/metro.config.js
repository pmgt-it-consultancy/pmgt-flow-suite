// Learn more https://docs.expo.dev/guides/monorepos

const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const { FileStore } = require("metro-cache");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

let config = getDefaultConfig(projectRoot);

// #1 - Watch all files in the monorepo
config.watchFolders = [workspaceRoot];
// #3 - Force resolving nested modules to the folders below
config.resolver.disableHierarchicalLookup = true;
// #2 - Try resolving with project modules first, then workspace modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Use turborepo to restore the cache when possible
config.cacheStores = [
  new FileStore({
    root: path.join(projectRoot, "node_modules", ".cache", "metro"),
  }),
];

// Wrap with Uniwind config (must be outermost wrapper)
module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
