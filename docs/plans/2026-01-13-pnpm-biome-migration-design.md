# pnpm + Biome Migration Design

**Date:** 2026-01-13
**Status:** Approved
**Reference:** [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo)

## Overview

Migrate pmgt-flow-suite from Yarn workspaces to pnpm workspaces, then replace ESLint/Prettier with Biome for better monorepo handling.

## Migration Approach

**Phased migration:**
- **Phase 1:** Yarn → pnpm workspaces (this document)
- **Phase 2:** ESLint/Prettier → Biome (future)

## Current State

| Component | Current |
|-----------|---------|
| Package Manager | Yarn 1.22.22 |
| Workspaces | `workspaces` field in package.json |
| Formatting | Prettier 3.7.4 |
| Linting | ESLint (apps/web only, next/core-web-vitals) |
| Task Runner | Turbo 2.6.2 |
| React (native) | 19.1.0 |
| React (web) | 19.2.2 (version mismatch!) |
| Expo SDK | 54 |

## Phase 1: pnpm Migration

### Target State

| Component | Target |
|-----------|--------|
| Package Manager | pnpm 10.19.0 |
| Workspaces | pnpm-workspace.yaml |
| React (all apps) | 19.1.0 (unified via catalog) |

### File Changes

| Action | File | Purpose |
|--------|------|---------|
| Create | `pnpm-workspace.yaml` | Define workspaces + catalogs |
| Delete | `yarn.lock` | Replaced by pnpm-lock.yaml |
| Modify | `package.json` (root) | Update packageManager |
| Modify | `apps/native/package.json` | Use catalog: protocol |
| Modify | `apps/web/package.json` | Use catalog: protocol |
| Simplify | `apps/native/metro.config.js` | Remove manual monorepo config |

---

### pnpm-workspace.yaml

```yaml
packages:
  - "apps/*"
  - "packages/*"

catalog:
  # Shared dependencies - pinned versions across all packages
  convex: ^1.29.3
  zod: ^4.3.5
  "@tanstack/react-query": ^5.90.16
  "@tanstack/react-form": ^1.27.7
  typescript: 5.9.3
  tailwindcss: ^4.1.18
  prettier: 3.7.4

catalogs:
  react19:
    react: 19.1.0
    react-dom: 19.1.0
    "@types/react": ~19.1.10
    "@types/react-dom": ~19.1.0

linkWorkspacePackages: true

onlyBuiltDependencies:
  - esbuild
  - "@tailwindcss/oxide"

# Selective hoisting - only what's needed
publicHoistPattern:
  - prettier
  - prettier-*
```

---

### Root package.json

```json
{
  "name": "pmgt-flow-suite",
  "private": true,
  "packageManager": "pnpm@10.19.0",
  "engines": {
    "node": ">=20.19.4",
    "pnpm": ">=10.19.0"
  },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "clean": "turbo run clean && rm -rf node_modules",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md}\" --ignore-path .gitignore"
  },
  "devDependencies": {
    "prettier": "catalog:",
    "turbo": "2.6.2",
    "typescript": "catalog:"
  }
}
```

**Changes:**
- `packageManager`: yarn@1.22.22 → pnpm@10.19.0
- `engines`: Added pnpm requirement
- `devDependencies`: Use `catalog:` protocol
- **Removed**: `workspaces` array (pnpm uses pnpm-workspace.yaml)
- **Removed**: `pnpm.onlyBuiltDependencies` (moved to pnpm-workspace.yaml)

---

### Catalog Protocol Pattern

Following t3-turbo's approach:

| Dependency Type | Version Specifier | Example |
|-----------------|-------------------|---------|
| Internal packages | `workspace:*` | `"@packages/backend": "workspace:*"` |
| React ecosystem | `catalog:react19` | `"react": "catalog:react19"` |
| Shared across apps | `catalog:` | `"typescript": "catalog:"` |
| Framework-specific | Explicit with `~` or `^` | `"expo": "~54.0.31"` |

---

### apps/native/package.json (key changes)

```json
{
  "dependencies": {
    "@packages/backend": "workspace:*",
    "react": "catalog:react19",
    "react-dom": "catalog:react19",
    "convex": "catalog:",
    "zod": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@tanstack/react-form": "catalog:",
    "expo": "~54.0.31",
    "react-native": "~0.81.5"
  },
  "devDependencies": {
    "@types/react": "catalog:react19",
    "typescript": "catalog:",
    "tailwindcss": "catalog:"
  }
}
```

---

### apps/web/package.json (key changes)

```json
{
  "dependencies": {
    "@packages/backend": "workspace:*",
    "react": "catalog:react19",
    "react-dom": "catalog:react19",
    "convex": "catalog:",
    "zod": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@tanstack/react-form": "catalog:",
    "next": "^16.0.9"
  },
  "devDependencies": {
    "@types/react": "catalog:react19",
    "@types/react-dom": "catalog:react19",
    "typescript": "catalog:",
    "tailwindcss": "catalog:",
    "eslint": "catalog:"
  }
}
```

---

### apps/native/metro.config.js (simplified)

```javascript
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { FileStore } = require("metro-cache");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// Cache for turbo
config.cacheStores = [
  new FileStore({
    root: path.join(__dirname, "node_modules", ".cache", "metro"),
  }),
];

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
```

**Removed** (Expo SDK 52+ auto-configures these):
- `watchFolders`
- `resolver.disableHierarchicalLookup`
- `resolver.nodeModulesPaths`

---

## Migration Steps

```bash
# 1. Delete yarn artifacts
rm -rf yarn.lock node_modules apps/*/node_modules packages/*/node_modules

# 2. Create pnpm-workspace.yaml (see above)

# 3. Update package.json files (see above)

# 4. Simplify metro.config.js (see above)

# 5. Install dependencies
pnpm install

# 6. Verify
pnpm dev        # Test both web and native
pnpm build      # Ensure builds pass
pnpm typecheck  # Ensure types are correct
```

---

## Rollback Plan

If issues occur:
1. `git checkout -- .` to restore all files
2. Restore yarn.lock from git history
3. Run `yarn install`

---

## Phase 2: Biome Migration (Future)

After Phase 1 is stable:
- Replace ESLint + Prettier with Biome
- Create `biome.json` at root
- Remove `.prettierrc`, `.eslintrc.json`
- Update scripts to use `biome check` and `biome format`

---

## References

- [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo) - pnpm + Expo monorepo reference
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [pnpm Catalogs](https://pnpm.io/catalogs)
- [Expo Monorepos](https://docs.expo.dev/guides/monorepos/)
