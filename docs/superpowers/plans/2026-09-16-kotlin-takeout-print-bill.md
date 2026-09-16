# Kotlin Takeout Print Bill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a View Bill action to Kotlin takeout order entry and print the current unpaid bill without settling the order.

**Architecture:** Model an unpaid bill as its own immutable printer document and format it through the configured receipt printer. The order screen owns only modal and in-flight UI state; `PosBrowseRoot` resolves the latest local checkout view, maps it to the bill snapshot, and calls the printer boundary.

**Tech Stack:** Kotlin, Jetpack Compose, coroutines/Flow, JUnit, Android Compose UI tests, existing ESC/POS printer abstractions.

## Global Constraints

- Kotlin Android only; do not modify the discontinued React Native/Expo app.
- The printed heading is exactly `BILL`.
- Printing is read-only: do not settle the order, create payments, release a table, open the cash drawer, change order status, or write a receipt-reprint audit event.
- The bill must not print payment method, tender, change, card details, or a receipt number.
- Use the configured receipt printer and surface printer failures in the existing order-screen error dialog.

---

### Task 1: Bill document, mapping, and formatter

**Files:**
- Modify: `apps/android/app/src/main/java/com/pmgt/pos/printer/PrinterModels.kt`
- Modify: `apps/android/app/src/main/java/com/pmgt/pos/printer/PrinterFormatters.kt`
- Create: `apps/android/app/src/main/java/com/pmgt/pos/orders/BillMapping.kt`
- Create: `apps/android/app/src/test/java/com/pmgt/pos/printer/BillFormatterTest.kt`
- Create: `apps/android/app/src/test/java/com/pmgt/pos/orders/BillMappingTest.kt`

**Interfaces:**
- Consumes: `CheckoutView`, `OrderCart`, `CheckoutDiscount`, and existing printer item/discount/service enums.
- Produces: `BillDocument`; `CheckoutView.toBill(cashierName: String, printedAt: LocalDateTime): BillDocument`; `BillFormatter.format(document: BillDocument, charsPerLine: Int): List<PrinterCall>`.

- [x] **Step 1: Write failing formatter and mapping tests**

Create representative tests that build an open order with a modifier, discount, tax totals, store metadata, table marker, and cashier. Assert that mapping preserves those values. Flatten `PrinterCall.Text.text` from the formatted output and assert it contains `BILL`, order/item/tax/total content, and does not contain `Receipt #:`, `Payment Method`, `Amount Tendered`, `Change`, `Card`, or `Ref #`.

```kotlin
val output = BillFormatter.format(document, charsPerLine = 48)
    .filterIsInstance<PrinterCall.Text>()
    .joinToString("") { it.text }
assertTrue(output.contains("BILL"))
assertTrue(output.contains("TOTAL"))
assertFalse(output.contains("Payment Method"))
assertFalse(output.contains("Amount Tendered"))
assertFalse(output.contains("Change"))
assertFalse(output.contains("Receipt #:"))
```

- [x] **Step 2: Run the focused tests and verify red**

Run:

```bash
cd apps/android
./gradlew testDebugUnitTest --tests 'com.pmgt.pos.printer.BillFormatterTest' --tests 'com.pmgt.pos.orders.BillMappingTest'
```

Expected: compilation fails because `BillDocument`, `BillFormatter`, and `toBill` do not exist.

- [x] **Step 3: Add the immutable bill model and mapper**

Add `BillDocument` with store identity/contact/footer, order identity/type/category/table/marker/pax, cashier, non-voided items, discounts, totals, default service type, and print time. Implement:

```kotlin
fun CheckoutView.toBill(
    cashierName: String,
    printedAt: LocalDateTime = LocalDateTime.now(),
): BillDocument
```

Map only the captured local `CheckoutView`; do not query or mutate data inside the mapper.

- [x] **Step 4: Add the dedicated pure formatter**

Implement:

```kotlin
object BillFormatter {
    fun format(document: BillDocument, charsPerLine: Int): List<PrinterCall>
}
```

Format store metadata, centered `BILL`, order metadata, non-voided items and modifiers, discounts, tax breakdown, total, non-official footer, feed, and cut. Do not add any payment or receipt-number branch.

- [x] **Step 5: Run focused tests and verify green**

Run the Step 2 command. Expected: both test classes pass.

- [x] **Step 6: Compile Kotlin production and test sources**

Run:

```bash
cd apps/android
./gradlew compileDebugKotlin compileDebugUnitTestKotlin
```

Expected: build succeeds.

### Task 2: Receipt-printer boundary and takeout UI

**Files:**
- Modify: `apps/android/app/src/main/java/com/pmgt/pos/printer/settings/PrinterSettingsController.kt`
- Modify: `apps/android/app/src/main/java/com/pmgt/pos/orders/OrderEditorScreen.kt`
- Modify: `apps/android/app/src/main/java/com/pmgt/pos/orders/OrderEntryUi.kt`
- Modify: `apps/android/app/src/main/java/com/pmgt/pos/browse/PosBrowseRoot.kt`
- Modify: `apps/android/app/src/androidTest/java/com/pmgt/pos/orders/OrderDialogUiTest.kt`

**Interfaces:**
- Consumes: `BillFormatter.format`, `CheckoutView.toBill`, `PrinterSettingsController` state/transport, `OrderEditorScreen`'s existing coroutine error wrapper.
- Produces: `PrinterSettingsController.printBill(document: BillDocument)` and `OrderEditorScreen(..., printBill: suspend (String) -> Unit = ...)`.

- [x] **Step 1: Write the failing Compose interaction test**

Extend the real-editor Compose test with injected counters:

```kotlin
var checkoutCalls = 0
var billPrints = 0
OrderEditorScreen(
    session = session,
    repository = repo,
    catalog = catalog,
    onBack = {},
    onStatus = {},
    onCheckout = { checkoutCalls++ },
    printBill = { billPrints++ },
)
```

Use a persisted takeout draft containing an item. Assert the vertical bounds place `View Bill` above `Proceed to Payment`; open the modal; tap `Print Bill`; wait for `billPrints == 1`; assert `checkoutCalls == 0` and the order remains open/draft.

- [x] **Step 2: Run the focused connected test and verify red**

Run:

```bash
cd apps/android
./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.pmgt.pos.orders.OrderDialogUiTest
```

Expected: compilation fails because the print boundary and button do not exist.

- [x] **Step 3: Add receipt-printer bill support**

Implement `PrinterSettingsController.printBill(document)` by selecting the receipt printer, connecting with the same surfaced failures as `printReceipt`, formatting with `BillFormatter` and the selected paper width, and writing exactly one document. Do not consult the minimal-receipt toggle because the bill format must retain its `BILL` heading and totals.

- [x] **Step 4: Add the takeout View Bill and modal Print Bill actions**

Add a full-width outlined `View Bill` action immediately before the takeout `Proceed to Payment` action. Preserve the existing dine-in placement. Extend `EntryBill` with `printing: Boolean` and `onPrint: () -> Unit`; add a full-width primary button labeled `Print Bill` or `Printing...`; disable it while printing.

In `OrderEditorScreen`, inject the suspending print function and call it through the existing `run("Unable to print bill")` wrapper. Set and clear screen-owned in-flight state in `try/finally`, leave the modal open, and block repeat taps.

- [x] **Step 5: Wire the latest local snapshot in PosBrowseRoot**

Pass a lambda that:

```kotlin
val view = checkoutRepository?.observe(checkoutOwner, orderId)?.first()
    ?: error("Bill is unavailable. Please try again.")
val printerModules = modules
    ?: error("Receipt printing is not available in this build.")
printerModules.printers.printBill(view.toBill(user.name, LocalDateTime.now()))
```

This read-only path must not call `settle`, drawer operations, audit logging, or any order mutation.

- [x] **Step 6: Run the focused UI test and verify green**

Run the Step 2 command. Expected: `OrderDialogUiTest` passes on the connected emulator/device.

- [x] **Step 7: Re-run Kotlin compilation and focused unit tests**

Run:

```bash
cd apps/android
./gradlew compileDebugKotlin compileDebugUnitTestKotlin testDebugUnitTest --tests 'com.pmgt.pos.printer.BillFormatterTest' --tests 'com.pmgt.pos.orders.BillMappingTest'
```

Expected: build and tests succeed.

### Task 3: Full verification, two-axis review, and commit

**Files:**
- Verify all files changed in Tasks 1 and 2.
- Update this plan's checkboxes as work completes.

**Interfaces:**
- Consumes: complete working tree diff against design commit `cecdf51`.
- Produces: verified and reviewed implementation commit on the current branch.

- [x] **Step 1: Run formatting and static checks**

Run:

```bash
pnpm check
cd apps/android && ./gradlew lintDebug
```

Expected: both commands succeed; if repository-wide unrelated failures exist, record exact evidence and run the narrowest relevant checks.

- [x] **Step 2: Run the full Android unit suite once**

Run:

```bash
cd apps/android
./gradlew testDebugUnitTest
```

Expected: all Android JVM unit tests pass.

- [x] **Step 3: Review the implementation on both required axes**

Use fixed point `d3f5589` and diff command `git diff d3f5589...HEAD` after creating a temporary implementation commit, or `git diff d3f5589` before it. Run the repository-standards review and approved-spec review separately, fix all material findings, and repeat relevant checks.

- [x] **Step 4: Inspect scope and whitespace**

Run:

```bash
git status --short
git diff --check cecdf51
git diff --stat cecdf51
```

Expected: only the plan and Kotlin bill feature/test files are changed; `.drift/` remains untracked and uncommitted; no whitespace errors.

- [x] **Step 5: Commit the implementation**

Run:

```bash
git add docs/superpowers/plans/2026-09-16-kotlin-takeout-print-bill.md apps/android/app/src/main/java apps/android/app/src/test apps/android/app/src/androidTest
git commit -m "feat(android): print unpaid order bills"
```

Expected: a commit is created on the current branch and does not include `.drift/`.
