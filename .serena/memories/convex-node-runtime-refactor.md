# Convex Node.js Runtime Refactor

## Problem
Convex deployment was failing because files with `"use node";` directive contained `query` and `mutation` functions. In Convex, only `action` functions can run in the Node.js runtime.

## Solution Applied
Split files into two parts:
1. Main file (with `"use node";`) - Contains only `action` functions that need Node.js (e.g., bcrypt)
2. Helper file (in `convex/helpers/`) - Contains `query`, `mutation`, `internalQuery`, `internalMutation` functions

## Files Changed

### 1. auth.ts → helpers/authHelpers.ts
**Moved to helpers:**
- `getUserByUsername` (internalQuery)
- `getUserById` (internalQuery)
- `createSession` (internalMutation)
- `deleteSession` (internalMutation)

**Kept in auth.ts (actions):**
- `login`, `logout`, `hashPassword`, `verifyManagerPin`

### 2. seed.ts → helpers/seedHelpers.ts
**Moved to helpers:**
- `insertSeedData` (internalMutation)

**Kept in seed.ts (actions):**
- `seed`

### 3. users.ts → helpers/usersHelpers.ts
**Moved to helpers:**
- `list` (query)
- `listManagers` (query)
- `get` (query)
- `insertUser` (internalMutation)
- `update` (mutation)
- `updatePasswordInternal` (internalMutation)

**Kept in users.ts (actions):**
- `create`, `resetPassword`

### 4. voids.ts → helpers/voidsHelpers.ts
**Moved to helpers:**
- `getManagerWithPin` (internalQuery)
- `validateSession` (internalQuery)
- `voidOrderItemInternal` (internalMutation)
- `voidOrderInternal` (internalMutation)
- `getOrderVoidsInternal` (internalQuery)

**Kept in voids.ts (actions):**
- `voidOrderItem`, `voidOrder`, `getOrderVoids`

### 5. roles.ts
Simply removed `"use node";` since it didn't need Node.js runtime.

## Client Code Updates Needed

### Public API path changes:
| Old Path | New Path |
|----------|----------|
| `api.users.list` | `api.helpers.usersHelpers.list` |
| `api.users.listManagers` | `api.helpers.usersHelpers.listManagers` |
| `api.users.get` | `api.helpers.usersHelpers.get` |
| `api.users.update` | `api.helpers.usersHelpers.update` |

### Search commands to find affected client code:
```bash
grep -r "api.users.list" apps/
grep -r "api.users.listManagers" apps/
grep -r "api.users.get" apps/
grep -r "api.users.update" apps/
```

### Unchanged API Paths (no client updates needed):
- `api.users.create`, `api.users.resetPassword`
- `api.auth.*` (login, logout, hashPassword, verifyManagerPin)
- `api.voids.*` (voidOrderItem, voidOrder, getOrderVoids)
- `api.seed.seed`
- `api.roles.*` (list, get)
