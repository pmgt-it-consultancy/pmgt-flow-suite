# Task Completion Checklist

When completing a task in this project, run through these checks:

## 1. Type Checking
```bash
pnpm typecheck
```

## 2. Lint + Format (Biome)
```bash
pnpm check
```

## 3. Build Verification (if significant changes)
```bash
pnpm build
```

## 4. Backend Tests (if Convex changes)
```bash
cd packages/backend && pnpm vitest run
```

## Convex-Specific Checks

### After Modifying Schema
- Ensure existing data compatibility
- Add indexes for query patterns (`by_field1_and_field2`)
- Update affected queries/mutations
- Add `returns` validator to all functions

### After Adding/Modifying Functions
- Verify `args` and `returns` validators are complete
- Public vs internal function choice is intentional
- Actions using Node.js have `"use node";` directive
- Use `withIndex()` not `filter()`
- Money math rounds at centavo precision

### After Modifying Authentication
- Test both web and native auth flows
- Verify `getAuthenticatedUser(ctx)` returns expected values

## Pre-Commit Summary
```bash
pnpm typecheck && pnpm check
```
