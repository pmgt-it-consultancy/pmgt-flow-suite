# Task Completion Checklist

When completing a task in this project, run through these checks:

## 1. Type Checking
```bash
npm run typecheck
```
Ensures TypeScript compiles without errors across all packages.

## 2. Linting (Web App)
```bash
cd apps/web && npm run lint
```
Checks for ESLint violations in the web app.

## 3. Code Formatting
```bash
npm run format
```
Formats all TypeScript, JavaScript, JSON, and Markdown files.

## 4. Build Verification
```bash
npm run build
```
Ensures production builds succeed for all packages.

## Convex-Specific Checks

### After Modifying Schema (`packages/backend/convex/schema.ts`)
- Ensure all existing data is compatible with schema changes
- Add appropriate indexes for query patterns
- Update any affected queries/mutations

### After Adding/Modifying Functions
- Verify `args` and `returns` validators are complete
- Public functions (`query`/`mutation`/`action`) are intentionally public
- Internal functions use `internal*` variants
- Actions using Node.js have `"use node";` directive

### After Modifying Authentication
- Test both web and native auth flows
- Verify `getUserId(ctx)` returns expected values

## Pre-Commit Summary
```bash
npm run typecheck && npm run format && cd apps/web && npm run lint
```
