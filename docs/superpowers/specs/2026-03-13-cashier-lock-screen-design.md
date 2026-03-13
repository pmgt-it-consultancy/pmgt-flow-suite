# Cashier Lock Screen Design

## Overview

A screen lock feature for the native POS app that secures the terminal when a cashier takes a break or steps away. Supports manual locking, automatic idle timeout with a warning notice, PIN-based unlock, and manager override.

**Scope:** Native app only (not web admin panel).

## Requirements

- Cashier can manually lock the screen via a "Lock" button
- Screen auto-locks after a configurable idle timeout (per-store setting)
- A warning banner appears 30 seconds before auto-lock, dismissible by tapping
- Unlock via the cashier's existing 4-6 digit PIN
- Manager/admin can override-unlock with their own PIN (session stays as original cashier)
- Lock state persists across app kills/restarts
- Lock button only available if user has a PIN set
- All lock/unlock events are audit logged

## Architecture

### Components

**`useLockStore` (Zustand + AsyncStorage)**
- `isLocked: boolean` — whether the screen is currently locked
- `lockedAt: number | null` — timestamp when locked
- `lockedUserId: string | null` — the user who is locked out
- `lockedUserName: string | null` — display name for lock screen
- `lockedUserRole: string | null` — role name for lock screen
- `showIdleWarning: boolean` — whether the idle warning banner is visible
- `lock()` — sets locked state with current user info
- `unlock()` — clears locked state
- `setShowIdleWarning(boolean)` — toggles warning visibility

Persisted to AsyncStorage so lock survives app restart.

**`useIdleTimer` (Custom Hook)**
- Wraps the root view in a touch responder that resets a `lastActivity` timestamp on any touch
- Monitors `AppState` transitions (background → foreground recalculates elapsed time)
- At `timeout - 30s`, sets `showIdleWarning = true`
- At `timeout`, calls `lock()`
- Any touch during the warning period resets the timer and hides the warning
- Disabled when `isLocked` is true or timeout is set to "disabled"
- Reads timeout value from Convex store settings

**`LockScreen` (React Navigation Screen)**
- Pushed onto the navigation stack when `isLocked` becomes true
- Back gesture and hardware back button disabled (`gestureEnabled: false`)
- Displays: current time (updating), date, lock icon, locked user name + role, "locked since" time
- Numeric PIN pad (0-9, backspace) with PIN dots (filled/empty)
- On PIN submit: calls `users.verifyPin` on backend
  - If valid for locked user → unlock, pop screen, audit log
  - If invalid → shake animation, clear PIN, show error
- "Manager Override" link at bottom → shows manager list (reuses pattern from `ManagerPinModal`)
  - Select manager → enter manager PIN → verify → unlock + audit log with override info
- Max 5 failed attempts → 30-second cooldown with countdown display

**Backend (Convex)**
- **Settings:** Add `autoLockTimeout` field to store settings. Values: `1`, `2`, `5`, `10`, `15`, `30` (minutes) or `0` (disabled). Default: `5`.
- **PIN Verification:** Reuses existing `users.verifyPin` action (bcrypt compare)
- **Manager Query:** Reuses existing `usersHelpers.listManagers` for override flow
- **Audit Logging:** New actions logged:
  - `screen_locked` — manual or auto, with trigger type
  - `screen_unlocked` — by own PIN
  - `screen_unlock_override` — by manager, includes manager ID

### Navigation Integration

The idle timer hook is mounted in `App.tsx` (or the main authenticated wrapper), wrapping the navigation container in a touch-detecting `View`. When `isLocked` flips to true, the app navigates to `LockScreen`. On unlock, it pops back to wherever the cashier was.

On app launch, if `useLockStore.isLocked` is true (from persisted state), navigate directly to `LockScreen` after splash.

### Lock Button Placement

A lock icon button in the `HomeScreen` header (next to the existing logout button). Only visible if the current user has a PIN set. Tapping it immediately locks and navigates to `LockScreen`.

## UI Design

### Lock Screen
- Light background (`#F9FAFB`)
- Large clock display (48px bold) with date below
- Blue circle with lock icon
- User name (18px semibold) + role and "Locked since [time]" (13px muted)
- 4-6 PIN dots showing progress
- 3-column numeric keypad (64x56px buttons, 12px border-radius, white with gray border)
- Red backspace button with delete icon
- "Manager Override" link in brand blue at bottom

### Idle Warning Banner
- Centered overlay over dimmed current screen
- Amber background (`#FEF3C7`) with amber border (`#F59E0B`)
- Warning icon, "Screen will lock in 30s" (18px bold), "Tap anywhere to stay active" (13px)
- "Stay Active" button in amber (`#F59E0B`)
- Any touch anywhere on screen dismisses and resets timer

## Settings UI

Add an "Auto-Lock Timeout" option to the native app's Settings screen:
- Label: "Auto-Lock After"
- Picker/dropdown with options: Disabled, 1 min, 2 min, 5 min, 10 min, 15 min, 30 min
- Requires manager/admin permission to change
- Stored in Convex settings table per-store

## Edge Cases

- **No PIN set:** Lock button hidden. If auto-lock is enabled but user has no PIN, prompt them to set one (navigate to settings) rather than locking them out.
- **App backgrounded:** When app goes to background, record timestamp. On foreground, calculate elapsed time — if it exceeds timeout, lock immediately (no warning).
- **App killed while locked:** Persisted Zustand state restores `isLocked = true` on next launch → shows lock screen.
- **Multiple failed PINs:** After 5 wrong attempts, show 30-second cooldown timer. Resets after cooldown.
- **Manager override with no managers available:** Show message "No managers with PINs available. Contact your administrator."
- **Timeout changed while idle:** Timer picks up new value on next activity reset.

## Audit Trail

| Action | Details |
|--------|---------|
| `screen_locked` | `{ trigger: "manual" \| "idle_timeout", userId }` |
| `screen_unlocked` | `{ userId, method: "pin" }` |
| `screen_unlock_override` | `{ lockedUserId, overrideManagerId, method: "manager_pin" }` |
