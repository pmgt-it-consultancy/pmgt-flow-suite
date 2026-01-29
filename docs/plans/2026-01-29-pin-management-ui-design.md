# PIN Management UI — Web Admin

## Summary

Add a PIN management dialog to the web admin users page, allowing admins to set, overwrite, or remove a manager PIN for any user.

## UI

- New "Set PIN" action button (key/lock icon) in each user table row, alongside Edit and Reset Password.
- Clicking opens a PIN Management Dialog (shadcn `Dialog`) showing:
  - User name in header
  - Status badge: "PIN set" (green) or "No PIN set" (gray)
  - 4-digit numeric input for new PIN
  - "Save PIN" button
  - "Remove PIN" destructive button (visible only when PIN is already set)
- Calls existing `setPin` action on save, new `clearPin` action on remove.

## Backend

- Add `hasPin: boolean` to `list` query output in `usersHelpers.ts` (derived from `!!user.pin`).
- Add `clearUserPinInternal` internal mutation in `usersHelpers.ts` — patches `pin` to `undefined`.
- Add `clearPin` action in `users.ts` — authenticates caller, delegates to `clearUserPinInternal`. Same permission model as `setPin`.

## Files Changed

| File | Change |
|------|--------|
| `packages/backend/convex/helpers/usersHelpers.ts` | Add `hasPin` to `list` output; add `clearUserPinInternal` |
| `packages/backend/convex/users.ts` | Add `clearPin` action |
| `apps/web/src/app/(admin)/users/page.tsx` | Add PIN dialog, table button, state management |

## Decisions

- PIN button available for all users (backend controls who appears in approval flows).
- Dialog shows PIN status and allows removal, not just set/overwrite.
- Follows existing Reset Password pattern (separate action button + modal).
