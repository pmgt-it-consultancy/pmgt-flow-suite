# Rush-hour task 5: stable cart rows and quantity flush

Ticket: `docs/specs/rush-hour-tickets/02.md` (#5). Implemented against the approved rendered cart / checkout boundary.

## Findings and change

`CartItem` previously owned an unobservable debounce timer, cleared pending state before its asynchronous write finished, and flushed an initial-render callback on unmount. Both order screens could transition before that work completed; their quantity callbacks swallowed failures. Recreated modifier arrays also defeated the default row memo comparison.

A screen-owned quantity queue now accepts taps immediately, coalesces them for 300 ms, serializes writes, and retains failed/latest targets. Rapid taps use a synchronous quantity ref so two taps in one React batch both count. Virtualized rows retain their pending quantity and refresh the queued saver when they remount. Autosave errors are surfaced; checkout and native back remain blocked until retry succeeds.

Dine-in and takeout await the queue before checkout and sending to kitchen. The flush returns the quantities saved during the boundary so draft payloads and kitchen tickets do not depend on an old React render's quantity. Quantity callbacks propagate persistence errors. Existing removal confirmation remains immediate, with one shown while confirmation is open; completed removal and explicit order discard clear the relevant pending work.

The row comparator checks every non-modifier prop, including callbacks, and all modifier display fields. Void handlers use a current-items ref so unrelated quantity updates do not invalidate unchanged sent rows. Native back uses React Navigation's supported `usePreventRemove` hook; the installed native-stack source explicitly warns against implementing prevention solely with a `beforeRemove` listener. Only the pending/non-pending boolean subscribes the screen, rather than every quantity tap.

## Verification

TDD red failures reproduced same-frame taps collapsing, remount losing the pending displayed quantity, equal modifier arrays redrawing a row, and recycled rows retaining old callbacks. Each behavior was taken to green before the next slice.

`pnpm exec jest src/features/orders/components/CartItem.test.tsx --runInBand --silent`: 7 passing interaction tests covering rapid input, slow in-flight writes, checkout failure/retry, row recycling, changed callbacks, native-back retry, and screen-unmount flushing. Tests render the actual `CartItem`, queue hook and navigation adapter; native UI, navigation, time and persistence boundaries are controlled. The checkout test harness uses the same flush-before-transition contract as both screens; it does not mount the whole order screen and its catalog/auth/printing dependencies.

`pnpm typecheck` in `apps/native`: passed. `biome check --write` on the five changed TypeScript files: passed with 12 existing dependency-array warnings about imported functions. `git diff --check`: passed. Full native suite is reserved for the final combined verification by the coordinating agent.

No tax, discount, price, payment or receipt formatting rules changed. No device measurements, APK builds or deployments were performed. Forced process termination while a database write is failing cannot be made durable by this in-memory debounce queue; normal row unmount and supported navigation are covered.
