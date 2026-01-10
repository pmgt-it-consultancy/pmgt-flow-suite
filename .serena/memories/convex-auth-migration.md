# Convex Auth Migration

## Overview
Migrated from custom token-based authentication to `@convex-dev/auth` library with Password provider.

## Authentication Flow
- **Provider**: Password (email + password)
- **Sign in**: `signIn("password", { email, password, flow: "signIn" | "signUp" })`
- **Default credentials**: `superadmin@pmgt.com / superadmin123`

## Backend Changes (packages/backend)

### auth.ts
```typescript
import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
```

### Key Functions
- `getAuthUserId(ctx)` - Get authenticated user ID from context
- `getAuthSessionId(ctx)` - Get session ID from context
- Query current user: `api.sessions.getCurrentUser`

### Files Updated
- `convex/auth.ts` - New Convex Auth setup
- `convex/sessions.ts` - Uses `getAuthUserId()`
- `convex/users.ts` - Updated auth helpers
- `convex/voids.ts` - Updated auth helpers
- `convex/helpers/usersHelpers.ts` - Uses new auth
- `convex/helpers/voidsHelpers.ts` - Uses new auth

### Deleted Files
- `convex/helpers/authHelpers.ts` - Old auth helpers no longer needed

## Web Frontend (apps/web)

### ConvexClientProvider.tsx
```typescript
import { ConvexAuthProvider } from "@convex-dev/auth/react";

export default function ConvexClientProvider({ children }) {
  return (
    <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
  );
}
```

### useAuth.tsx Hook
```typescript
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";

const { isLoading, isAuthenticated } = useConvexAuth();
const { signIn: convexSignIn, signOut: convexSignOut } = useAuthActions();

// Sign in
await convexSignIn("password", { email, password, flow: "signIn" });
```

### Login Page
- Uses `signIn(email, password)` instead of `login(username, password)`
- Input type changed to `type="email"`
- Added `autoComplete` attributes

## React Native (apps/native)

### ConvexClientProvider.tsx
```typescript
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import * as SecureStore from "expo-secure-store";

const secureStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

<ConvexAuthProvider
  client={convex}
  storage={Platform.OS === "android" || Platform.OS === "ios" ? secureStorage : undefined}
>
```

### AuthContext.tsx
Same pattern as web - uses `useConvexAuth()` and `useAuthActions()`

### LoginForm.tsx
- Uses `signIn(email, password)` 
- `keyboardType="email-address"`

## Seeding the Database

To seed the super admin user with Convex Auth:

```bash
npx convex run seed:seed '{"superAdminEmail": "superadmin@pmgt.com", "superAdminPassword": "superadmin123", "superAdminName": "Super Admin"}'
```

The seed creates:
1. Default roles (Super Admin, Admin, Manager, Staff)
2. User entry in `users` table with email and roleId
3. Auth account in `authAccounts` table linking the password to the user

## Important Notes
1. Convex Auth automatically handles:
   - Session management
   - Token storage (localStorage on web, SecureStore on mobile)
   - JWT validation
   
2. User queries skip when not authenticated:
   ```typescript
   const currentUser = useQuery(
     api.sessions.getCurrentUser,
     isConvexAuthenticated ? {} : "skip"
   );
   ```

3. Loading state combines auth loading + user data loading:
   ```typescript
   const isLoading = isAuthLoading || (isConvexAuthenticated && currentUser === undefined);
   ```
