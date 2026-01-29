# Convex Auth React Native Window Shim

## Problem
`@convex-dev/auth/react` and the Convex WebSocket manager use `window.addEventListener` which is undefined in React Native, causing:
```
TypeError: window.addEventListener is not a function (it is undefined)
```

## Solution
A window shim is installed at app entry point (`apps/native/index.tsx`) before any other imports:

```typescript
import { installWindowShim } from "./src/shims/window";
installWindowShim();
```

The shim lives at `apps/native/src/shims/window.ts` and creates `window` on `globalThis` if missing, then adds no-op `addEventListener`/`removeEventListener`.

## Reference
- GitHub issue: https://github.com/get-convex/convex-auth/issues/276
- This is a known issue with `@convex-dev/auth` in non-browser environments.
- The shim must be imported **before** any Convex imports.
