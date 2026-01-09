# Style and Conventions

## Code Formatting
- **Prettier** for all formatting
- Config: `.prettierrc` with `arrowParens: "always"`
- Run: `npm run format`

## TypeScript
- Strict mode enabled
- Always use explicit types for function parameters and return values
- Use `Id<'tableName'>` from Convex for document IDs (not `string`)
- Use `Doc<'tableName'>` for full document types

## Convex Function Conventions

### Always Use Object-Based Syntax with Validators
```typescript
import { query } from "./_generated/server";
import { v } from "convex/values";

export const myFunction = query({
  args: { id: v.id("notes") },
  returns: v.null(),  // REQUIRED - use v.null() if no return value
  handler: async (ctx, args) => { ... }
});
```

### Function Types
- `query`, `mutation`, `action` - Public API (exposed to clients)
- `internalQuery`, `internalMutation`, `internalAction` - Private functions

### Function References
- Public: `api.filename.functionName` (e.g., `api.notes.getNotes`)
- Internal: `internal.filename.functionName` (e.g., `internal.openai.summary`)

### Database Best Practices
- Use `withIndex()` instead of `filter()` for queries
- Index names: `by_field1_and_field2` format
- Query field order must match index definition order

### Actions with Node.js
- Add `"use node";` at top of files using Node.js built-ins
- Actions cannot access `ctx.db` directly
- Use `ctx.runQuery()` / `ctx.runMutation()` to access database

### Scheduling
- Use `ctx.scheduler.runAfter(delay, functionRef, args)` for async work
- Example: `ctx.scheduler.runAfter(0, internal.openai.summary, { id: noteId })`

## React/Next.js Conventions

### Component Organization (apps/web/src)
- `app/` - Next.js App Router pages
- `components/common/` - Reusable UI components
- `components/home/` - Marketing page components
- `components/notes/` - Note-related components
- `lib/` - Utility functions

### Authentication Pattern
```typescript
const userId = await getUserId(ctx);
if (!userId) return null;  // or throw error
```

## ESLint
- Web app uses `next/core-web-vitals` config
- Run: `cd apps/web && npm run lint`
