# Kotlin rewrite: what replaces the React Native ESC/POS printer

**Date:** 2026-09-15
**Issue:** [#17](https://github.com/pmgt-it-consultancy/pmgt-flow-suite/issues/17) (part of the map in #13)
**Code analysed:** `main` @ `ba59163` (native app `3.28.1`, `versionCode` 32801)
**Status:** Research — no code changed.

> **Scope note.** All file/line references are to `main` @ `ba59163`. The
> `feature/pos-system` branch is ~18 versions behind (native `3.10.2`) and its
> printing code predates split payments, `tableMarker`, minimal receipts and the
> Day Closing rework. Do not plan against that branch.

---

## Executive answer

**What replaces `@vardrz/react-native-bluetooth-escpos-printer`:** nothing off the
shelf is needed. The app only exercises **four** methods of that library
(`printText`, `printerAlign`, `cutPaper`, `openDrawer`) plus nine
`BluetoothManager` methods. Everything the printers actually receive reduces to
**seven ESC/POS byte sequences** over a **classic Bluetooth SPP RFCOMM socket**.
A ~300-line Kotlin `EscPosBuilder` + a ~250-line `SppPrinterConnection` replaces
the whole dependency, with no third-party ESC/POS library required. Adopting
DantSu/ESCPOS-ThermalPrinter-Android is possible but is a net _loss_ here (see
§3) — it is a text/HTML-markup formatter, not a byte emitter, and the app's
layout code is already byte-level.

**Reuse of `modules/bluetooth-connection`:** the Kotlin file is 83 lines and
**~55 of them survive** (the `BroadcastReceiver`, the Tiramisu-aware
`getParcelableExtra`, the ACL intent filter, the idempotent unregister; the
`RECEIVER_EXPORTED` branch should be dropped — see §4.3.5). What is thrown away is the `Module`/`ModuleDefinition`
wrapper and `sendEvent` — ~28 lines. Call it **~65 % line reuse of a file that is
2 % of the printing problem.** The honest estimate is: the existing Kotlin module
saves roughly **half a day**. It is not a foundation.

**But:** that module is currently **dead code in production** — see §1.3. The
Kotlin rewrite is the moment to fix it, and doing so is a genuine behavioural
improvement, not a port.

---

## 1. What `modules/bluetooth-connection` already does

### 1.1 The Kotlin source

`apps/native/modules/bluetooth-connection/android/src/main/java/expo/modules/bluetoothconnection/BluetoothConnectionModule.kt`
(83 lines, the entire module).

It is a single Expo `Module` named `BluetoothConnection` that declares two events
and registers a `BroadcastReceiver` for ACL connect/disconnect:

```kotlin
override fun definition() = ModuleDefinition {
    Name("BluetoothConnection")
    Events("onDeviceConnected", "onDeviceDisconnected")
    OnStartObserving { registerReceiver() }
    OnStopObserving { unregisterReceiver() }
}
```

— `BluetoothConnectionModule.kt:16-28`

The receiver body (`:35-58`) reads `BluetoothDevice.EXTRA_DEVICE` with the
API-33+ typed overload and a `@Suppress("DEPRECATION")` fallback, pulls
`device.address`, and maps `ACTION_ACL_CONNECTED` / `ACTION_ACL_DISCONNECTED`
onto `sendEvent(..., bundleOf("address" to address))`.

Registration (`:60-69`) builds an `IntentFilter` with the two ACL actions and
branches on `Build.VERSION_CODES.TIRAMISU` to pass `Context.RECEIVER_EXPORTED`.
Unregistration (`:72-82`) swallows `IllegalArgumentException` for the
already-unregistered case.

That is the whole module. It does **not** open sockets, does not scan, does not
print, does not touch permissions.

### 1.2 What survives the Expo strip

| Lines  | What                                                          | Survives?                                                             |
| ------ | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1-12   | imports                                                       | Mostly — drop the two `expo.modules.kotlin.*` imports                 |
| 13-14  | class decl + `receiver` field                                 | Rewrite as a plain class / `@Singleton`                               |
| 16-28  | `ModuleDefinition`, `Name`, `Events`, `OnStart/StopObserving` | **Deleted** (~13 lines)                                               |
| 30-34  | `registerReceiver()` guard + `appContext.reactContext`        | Body survives; context source changes to an injected `Context`        |
| 35-58  | the `BroadcastReceiver` incl. Tiramisu `getParcelableExtra`   | **Verbatim** (~24 lines)                                              |
| 51, 54 | `sendEvent(...)` calls                                        | Replaced by a `MutableSharedFlow<BtAclEvent>` emit (~2 lines changed) |
| 60-69  | `IntentFilter` + `RECEIVER_EXPORTED` branch                   | Filter verbatim (~6 lines); **drop the flag branch** (§4.3.5)         |
| 72-82  | idempotent `unregisterReceiver`                               | **Verbatim** (~11 lines)                                              |

Roughly **55 of 83 lines carry over unchanged**, 28 are Expo scaffolding that
disappears. In a Kotlin app this becomes a `BluetoothAclMonitor` exposing
`Flow<AclEvent>` instead of a JS event emitter — a smaller, better-typed object
than the Expo version, because `OnStartObserving`/`OnStopObserving` collapse into
`callbackFlow { ... awaitClose { ... } }`.

### 1.3 The module is currently inert in production

`apps/native/modules/bluetooth-connection/index.ts` on `main` is **not** wired to
the native module. It contains a hand-rolled `EventEmitterShim` and:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireNativeModule(name: string): any {
  return {};
}
```

— `index.ts:44-47`

`requireNativeModule` was replaced by a stub returning `{}`, and
`expo-modules-core`'s `EventEmitter` by a local class that only re-dispatches
events emitted from JS. Nothing ever calls `emitter.emit(...)`. Therefore:

- `addDeviceConnectedListener` / `addDeviceDisconnectedListener` register
  listeners that can never fire.
- Because no listener reaches the native `EventEmitter`, Expo never triggers
  `OnStartObserving`, so `registerReceiver()` is never called and the
  `BroadcastReceiver` is never registered at all.
- `useBluetoothConnectionEvents()` (mounted at `src/navigation/Navigation.tsx:107`)
  is a no-op.

The change landed in `2bc95f9` — _"fix(native): correct WatermelonDB write API
usage and import paths in service files"_ (2026-04-29), i.e. it looks like
collateral damage from an unrelated import cleanup, not a deliberate decision.
`expo-modules-core` is not a direct dependency in `apps/native/package.json`,
which is the likely trigger.

**Consequence for today's stores:** the only thing keeping printer connection
state fresh is `usePrinterConnectionPolling` — a 60 s `setInterval` plus an
`AppState → "active"` poll (`hooks/usePrinterConnectionPolling.ts:7,44-52`). A
printer that is switched off mid-service is not noticed for up to a minute, and
the exponential-backoff `autoReconnect` ladder (1/2/4/8/16 s,
`utils/autoReconnect.ts:4-5`) is only ever entered from that poll.

**This is a live, unflagged defect.** It should be listed in #17's follow-up
regardless of the Kotlin timeline — the ACL receiver is exactly the right
mechanism and it is already written.

---

## 2. Which Bluetooth stack — classic SPP, definitively

The current stack is **classic Bluetooth SPP over RFCOMM**. Not BLE. Evidence
from the vendored library source (installed at
`node_modules/.pnpm/@vardrz+react-native-bluetooth-escpos-printer@0.1.2_.../android/src/main/java/cn/jystudio/bluetooth/`):

- `BluetoothService.java:31` —
  `private static final UUID MY_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");`
  the well-known Serial Port Profile UUID.
- `BluetoothService.java:231` — `mmDevice.createRfcommSocketToServiceRecord(MY_UUID)`.
- `BluetoothService.java:219` — a reflection fallback,
  `mmDevice.getClass().getMethod("createRfcommSocket", int.class).invoke(mmDevice, i)`,
  looping over channel numbers. This is the classic workaround for printers
  whose SDP record is missing or wrong; **the Kotlin port must keep it**, because
  if any of the three stores' printers relies on it today, a "clean"
  `createRfcommSocketToServiceRecord`-only implementation will silently fail to
  connect on that unit.
- `BluetoothService.java:212` — `mAdapter.cancelDiscovery()` before connecting.
- `BluetoothService.java:269` — `mmSocket.getOutputStream()`; all printing is raw
  `OutputStream.write(byte[])`.
- No `BluetoothGatt`, `BluetoothLeScanner` or GATT characteristic write anywhere
  in the Android sources.

Device discovery is equally classic: `BluetoothAdapter.getBondedDevices()` +
`adapter.startDiscovery()` with an `ACTION_FOUND` receiver
(`RNBluetoothManagerModule.java:190-205, 436`).

The iOS half of the package _is_ BLE (`ios/PrintColumnBleWriteDelegate.m`,
`docs/ble_service_ids.png`), but the app is Android-only
(`app.config.ts` declares only `android`, and `bluetoothPrinter.ts` returns
early for `Platform.OS === "ios"`), so that path has never run in production.

**Recommendation:** target classic SPP in Kotlin —
`BluetoothDevice.createRfcommSocketToServiceRecord(SPP_UUID)`, keep the
`createRfcommSocket(channel)` reflection fallback, `cancelDiscovery()` before
`connect()`, write to `socket.outputStream`, one connection at a time.

> ⚠️ **Needs physical hardware.** Which profile each printer at each of the three
> stores actually advertises cannot be determined from this repository — no
> printer make, model, MAC or SDP record is recorded anywhere in the codebase or
> docs (grep for `xprinter|goojprt|rongta|epson|sunmi|bixolon|zjiang` across
> `docs/`, `apps/`, `packages/` returns nothing but an unrelated line in
> `docs/investigations/rush-hour-acceptance.md:37`). Some cheap "Bluetooth
> thermal printers" ship dual-mode (SPP **and** a BLE GATT service); some are
> BLE-only and only work with vendor SDKs. **Assume SPP, verify on-site.**

---

## 3. ESC/POS command generation — port, don't adopt

### 3.1 The real surface area is tiny

Counting every call site under `apps/native/src`:

| Call                       | Occurrences                               |
| -------------------------- | ----------------------------------------- |
| `printText(text, opts)`    | 149                                       |
| `printerAlign(n)`          | 26                                        |
| `cutPaper()`               | 1                                         |
| `openDrawer(pin, on, off)` | 1 (via `bluetoothPrinter.openCashDrawer`) |

No `printPic`, no `printQRCode`, no `printBarCode`, no `printColumn`, no
`setBlob`, no `printerInit`, no `rotate`. Column layout is done in **TypeScript**
by `formatRow()` padding with spaces against a `charsPerLine` of 32 (58 mm) or 48
(80 mm) — `escposFormatter.ts:25-29`, `usePrinterStore.ts:313`.

So the entire wire protocol the printers ever see is:

| Purpose         | Bytes                                   | Source of truth                                               |
| --------------- | --------------------------------------- | ------------------------------------------------------------- |
| Size / emphasis | `GS ! n` where `n = width<<4 \| height` | `PrinterCommand.POS_Print_Text`, `Command.GS_ExclamationMark` |
| Code page       | `ESC t n` (app always sends `n = 0`)    | `Command.ESC_t`, `codepage` defaults to `0`                   |
| Font A/B        | `ESC M n` (app always sends `n = 0`)    | `Command.ESC_M`, `fonttype: 0`                                |
| Alignment       | `ESC a n`, n ∈ {0,1,2}                  | `PrinterCommand.POS_S_Align`                                  |
| Feed n lines    | `ESC d n` (n = 30 before a cut)         | `POS_Set_PrtAndFeedPaper`                                     |
| Cut             | `GS V 66 n` (partial cut, n = 1)        | `Command.GS_V_m_n = {GS,'V','B',0}`, `POS_Set_Cut`            |
| Drawer kick     | `ESC p m t1 t2` (0, 25, 250)            | `Command.ESC_p`, `POS_Set_Cashbox`                            |

Seven sequences. A Kotlin `EscPos` builder emitting these is a couple of hundred
lines with no dependencies.

### 3.2 Two behaviours you must copy, not "improve"

**(a) "bold" is not bold.** `escposFormatter.ts:54-56` defines:

```ts
const normal = () => ({
  encoding: "UTF-8",
  widthtimes: 0,
  heigthtimes: 0,
  fonttype: 0,
});
const bold = () => ({
  encoding: "UTF-8",
  widthtimes: 0,
  heigthtimes: 1,
  fonttype: 0,
});
const large = () => ({
  encoding: "UTF-8",
  widthtimes: 1,
  heigthtimes: 1,
  fonttype: 0,
});
```

`heigthtimes` maps through `intToHeight = {0x00,0x01,0x02,0x03}` into `GS ! n`
(`PrinterCommand.java:234-236`). So the app's `bold()` emits `GS ! 0x01` —
**double-height, normal width**. `ESC E` (true emphasis) is never sent. Reproduce
this exactly or every kitchen ticket and every receipt heading changes shape on
day one at three live restaurants.

- `large()` → `GS ! 0x11` (double width **and** height) — used for the kitchen
  ticket order number and the `tableMarker`.

**(b) Every `printText` re-sends the style prefix.** `POS_Print_Text` concatenates
`GS ! n`, `ESC t n`, `ESC M n` **in front of every single string**
(`PrinterCommand.java:242`). Style is therefore stateless per call. A Kotlin
builder that sets style once and streams text will produce _different_ output
wherever the current code interleaves `normal()`/`bold()`; the safe port is to
keep the same "prefix every chunk" behaviour, then optimise later with printed
proofs in hand.

**(c) Encoding.** The app passes `encoding: "UTF-8"` while `ESC t` stays at code
page 0 (PC437). Bytes are `text.getBytes("UTF-8")` (`PrinterCommand.java:228`).
Pure ASCII is safe, which is why the formatters write `P ` rather than `₱`
(`escposFormatter.ts:31-34`) and why `formatReceiptDateTime` is hand-rolled to
emit an ASCII space before `AM`/`PM` instead of `Intl`'s U+202F narrow no-break
space — there is a regression test pinning exactly that
(`escposFormatter.test.ts:16-23`, asserting `/^[\x20-\x7E]+$/`). Keep the
ASCII-only discipline in Kotlin; `String.toByteArray(Charsets.US_ASCII)` with an
explicit transliteration step is safer than UTF-8.

### 3.3 Existing Kotlin/Java ESC/POS libraries

Five candidates were checked against primary sources (repo, LICENSE file, tags,
Maven Central Solr, and the library's own Android source), not write-ups.

| Library                                                                                         | License    | Stars | Last real commit       | Latest release    | Distribution                                                                                     | Transport                               |
| ----------------------------------------------------------------------------------------------- | ---------- | ----- | ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| [DantSu/ESCPOS-ThermalPrinter-Android](https://github.com/DantSu/ESCPOS-ThermalPrinter-Android) | MIT        | 1,544 | 2023-10-23 (`f61030e`) | 3.4.0, 2023-10-23 | **JitPack only** (`com.github.DantSu:ESCPOS-ThermalPrinter-Android:3.4.0`); not on Maven Central | Classic SPP + TCP + USB                 |
| [anastaciocintra/escpos-coffee](https://github.com/anastaciocintra/escpos-coffee)               | MIT        | 347   | 2022-04-20 (docs only) | 4.1.0, 2021-06-21 | Maven Central `com.github.anastaciocintra:escpos-coffee:4.1.0`                                   | **none** — you supply an `OutputStream` |
| [okarmazin/escpos4k](https://github.com/okarmazin/escpos4k)                                     | Apache-2.0 | 31    | push 2025-02-28        | 0.3.0, 2023-04-06 | Maven Central `cz.multiplatform.escpos4k:escpos4k`                                               | Bluetooth + USB on Android              |
| [Dilivva/Blueline](https://github.com/Dilivva/Blueline)                                         | MIT        | 30    | push 2025-06-10        | 2.0.1, 2025-06-10 | Maven Central `com.dilivva.blueline:*`                                                           | **BLE GATT only**                       |
| [KhairoHumsi/Printer-ktx](https://github.com/KhairoHumsi/Printer-ktx)                           | none found | 41    | 2021-01-26             | —                 | —                                                                                                | (Kotlin port of DantSu)                 |

(`mamon-aburawi/Printer-KMP` was also checked and is disqualified outright: its
README scopes connections to TCP/IP and USB, with no Bluetooth connector, and the
repo has no LICENSE file despite an MIT badge.)

**DantSu is the only credible adoption candidate.** Verified in its source
(`escposprinter/src/main/java/com/dantsu/escposprinter/EscPosPrinterCommands.java`,
`connection/DeviceConnection.java`), it covers everything this app needs and much
it does not: public `write(byte[])` raw passthrough; `TEXT_SIZE_DOUBLE_HEIGHT`
= `0x1D 0x21 0x01` / `TEXT_SIZE_DOUBLE_WIDTH` = `0x1D 0x21 0x10`; alignment
`0x1B 0x61 {0,1,2}`; `cutPaper()` = `0x1D 0x56 0x01`; `openCashBox()` =
`0x1B 0x70 0x00 0x3C 0xFF`; `EscPosCharsetEncoding`; image via
`convertGSv0ToEscAsterisk`; QR and six barcode symbologies. `compileSdk 33`,
`minSdk 16`, `targetSdk 33`.

**Recommendation: port, do not adopt.** Reasons, in order of weight:

1. **DantSu is a text-markup formatter; this app is a byte emitter.** Its idiom is
   `printFormattedText("[C]<b>title</b>\n[L]item[R]P 10.00\n")` — a parser over
   HTML-ish tags. All three of this app's renderers already compute exact column
   positions in code (`formatRow`, `charsPerLine`). Adopting DantSu means
   re-expressing 500+ lines of tested layout into a markup dialect, which is a
   _rewrite_ of the risky part, not a reuse of it. Using DantSu purely for
   `write(byte[])` means taking a dependency for one method.
2. **Its `cutPaper()` is `GS V 1`, the app's is `GS V 66 1`.** `GS V 0/1` is the
   older full/partial-cut form; the app currently sends the "function B"
   feed-and-cut variant. Different printers honour different ones. Adopting
   DantSu silently changes the cut command on three live sites.
3. **Its bold is `ESC E`; the app's "bold" is `GS ! 0x01` (double height).** Using
   DantSu's styling changes the look of every ticket (§3.2a).
4. **Two years without a code commit, JitPack-only.** Neither is disqualifying on
   its own — JitPack is one `maven { url }` line, and the library is feature-frozen
   rather than broken — but combined with points 1-3 the value is low.
5. **The thing that is actually hard is not command encoding.** It is the SPP
   socket lifecycle (bonded-device enumeration, `cancelDiscovery` ordering,
   connect timeouts, the `createRfcommSocket(channel)` fallback, reconnect after a
   printer power-cycle, one-connection-at-a-time serialisation). DantSu's
   `BluetoothConnection` does help there — so **read it, and keep it as the
   fallback plan** if the hand-rolled socket layer misbehaves on real hardware.

**If you do adopt DantSu**, vendor it. It is four small Java packages under MIT;
copying them into the repo removes the JitPack dependency and the staleness risk,
and lets you change `cutPaper()` and the bold mapping to match today's bytes.

**The incumbent, for the record.** `@vardrz/react-native-bluetooth-escpos-printer`
is MIT, last published **0.1.2 on 2026-01-23**, three releases total, 10 GitHub
stars — a fork of `ccdilan/…`, itself descended from
`januslo/react-native-bluetooth-escpos-printer` (396 stars, 191 open issues, last
push 2024-07-16). It is not abandoned, but it is one person's fork of a stale
upstream, and the `cn.jystudio` package namespace and Chinese-commented
`PrinterCommand.java` are inherited verbatim from 2018. Leaving it behind is a
clear win irrespective of the Kotlin migration.

**Do not use Blueline.** Its Android connector
(`core/src/androidMain/.../AndroidBluetoothConnection.kt`) is BLE GATT — it scans
with `bluetoothAdapter.bluetoothLeScanner` and writes characteristic
`00002AF1-…` on service `000018F0-…`. That is a different transport from the SPP
the current fleet uses (§2) and would almost certainly not talk to the existing
printers.

### 3.4 How the layouts carry across

Both formatters are pure functions of a data object followed by a sequence of
`printText`/`printerAlign` calls. Porting them is mechanical — they contain no
React, no async beyond the awaited native calls, and no platform APIs.

**Kitchen ticket** — `printKitchenTicketToThermal`, `escposFormatter.ts:255-402`.
Data contract (`escposFormatter.ts:12-21`):

```ts
export interface KitchenTicketData {
  orderNumber: string;
  orderType: "dine_in" | "take_out" | "delivery";
  orderCategory?: "dine_in" | "takeout";
  orderDefaultServiceType?: "dine_in" | "takeout";
  tableMarker?: string;
  customerName?: string;
  items: KitchenTicketItem[];
  timestamp: Date;
}
```

Layout order, which must be preserved:

1. `ALIGN.CENTER`, `#<orderNumber>` at `large()` (`GS ! 0x11`).
2. If `tableMarker`: a `==================` rule, the marker at `large()`, another
   rule. This is the "large/bold tent-card number" the counter staff read.
3. Category label — `DINE-IN` / `TAKEOUT` from `orderCategory`, falling back to
   `orderType`, at `bold()` (double-height). **Always printed.**
4. `Customer: <name>` at `normal()` if set.
5. `ALIGN.LEFT`, timestamp, horizontal rule.
6. Items. If the order mixes `serviceType` values, items are grouped under
   `---- DINE IN ----` / `---- TAKEOUT ----` headers at `bold()`; otherwise a flat
   list. Each item is `  {qty}x {name}` at `bold()`, modifiers as `     > {opt}`,
   notes as `     * {note}`, both at `normal()`.
7. Rule + 5 blank lines (80 mm) or 2 (58 mm), with `cut: true`.

Note the `CLAUDE.md` invariant holds in the code: `KitchenTicketData` has **no**
`tableName` field. (It did on `feature/pos-system`; it was removed on `main`.)

**Receipt** — `printReceiptToThermal`, `escposFormatter.ts:58-253`. Sections:
store header → order info → customer block → items → totals/VAT → discounts →
payments → footer, then feed + cut.

- **`tableMarker` on receipts** is appended to the receipt number, not printed
  separately: `` `${data.receiptNumber ?? data.orderNumber} | ${data.tableMarker}` ``
  (`escposFormatter.ts:96-99`).
- **VAT breakdown** is four unconditional rows — `Subtotal`, `Vatable Sales`,
  `VAT 12%`, `VAT-Exempt` — each via `formatRow(label, amount, w)`
  (`:159-168`). The `12%` in the label is a hard-coded string, _not_ derived from
  `store.vatRate`; `getReceipt` does return `vatRate`
  (`packages/backend/convex/checkout.ts:159`) but the formatter ignores it. Port
  the literal, and raise the mismatch separately.
- **SC/PWD** — a `DISCOUNTS` block printed only when `data.discounts.length > 0`,
  one stanza per discount: `SC:`/`PWD:`/`Discount:` + customer name, then
  `ID: <customerId>`, then `formatRow(itemName, -amount)`, then a blank line;
  finally a `Total Discount` row (`:170-188`). The BIR-relevant customer
  identification lines are therefore per-discount, and there is a _second_,
  separate customer block near the top driven by root-level
  `customerName/customerId/customerAddress/customerTin` (`:112-118`).
- **Split payments** (`:195-241`) — if `data.payments?.length`, iterate: cash rows
  print `formatRow("Cash", amount)` and accumulate `cashReceived` /
  `changeGiven`; card rows print `formatRow(cardPaymentType ?? "Card/E-Wallet", amount)`
  and a `Ref: <n>` line. After the loop, if `totalCashReceived > 0`, print
  `Amount Tendered` and `Change` as **aggregates across all cash legs**.
  Otherwise the legacy single-payment branch prints `Payment Method` +
  `Amount Tendered`/`Change` (cash) or `Ref #` (card). Both branches must be
  ported — old orders still have no `orderPayments` rows.
- **Minimal receipt mode** (`:66-75`) short-circuits everything: a
  `Product Name Quantity Price` header, one `name qty total` line per item, feed,
  cut. Toggled by `PrinterSettings.minimalReceiptEnabled`
  (`printerStorage.ts:20`), threaded through `printReceipt`
  (`usePrinterStore.ts:304-315`). There is a byte-exact test for it
  (`escposFormatter.test.ts:53-71`).

**Z-Report** — `printZReportToThermal`, `day-closing/utils/zReportFormatter.ts:80`.
A third formatter, same primitives only (20 `printerAlign` calls, one `cut: true`
at `:340`). Carries `ZReportData`, `ProductSaleItem[]` and
`PaymentTransactionGroup[]`. Port alongside the other two.

**`expo-print` is already dead.** `apps/native/src/features/shared/utils/receipt.ts`
imports `expo-print` and exports `generateReceiptHtml`, `printReceipt`,
`generateReceiptPdf`, `shareReceipt` — **none of which has a caller.** Every
importer of that module takes only the `ReceiptData` _type_
(`usePrinterStore.ts:2`, `escposFormatter.ts:2`, `ReceiptPreviewModal.tsx:9`,
`TakeoutOrderDetailModal.tsx:20`, plus two test files). In the Kotlin app,
`ReceiptData` becomes a data class and the HTML/PDF path is simply not rebuilt;
drop `expo-print` and `expo-sharing` from the printing story entirely.

---

## 4. Android 12+ runtime permissions

### 4.1 What is declared today

`apps/native/app.config.ts:40-44` lists three permissions, which `expo prebuild`
writes into the generated manifest
(`apps/native/android/app/src/main/AndroidManifest.xml:2-4`):

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"/>
```

There is **no** `android:usesPermissionFlags="neverForLocation"` on
`BLUETOOTH_SCAN`, and **no** legacy `BLUETOOTH` / `BLUETOOTH_ADMIN` with
`maxSdkVersion="30"` in the app manifest. The legacy pair arrives anyway via
manifest merge from the library's own manifest, **unbounded**:

```xml
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
```

— `@vardrz/.../android/src/main/AndroidManifest.xml`

SDK levels come from Expo defaults (`expo-modules-core@3.0.29`
`ExpoModulesCorePlugin.gradle:65-69`): **compileSdk 36, targetSdk 36, minSdk 24**.
The app is therefore fully inside the Android 12/13/14 permission regimes.

### 4.2 What is requested at runtime

`apps/native/src/features/settings/services/bluetoothPrinter.ts:22-42`:

```ts
if (apiLevel >= 31) {
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  return Object.values(results).every(
    (r) => r === PermissionsAndroid.RESULTS.GRANTED,
  );
}
```

This gate runs inside `getPairedDevices`, `scanDevices`, `connectToDevice` and
`unpairDevice`, and **returns `false` unless all three are granted**. Separately,
the library itself requests only `ACCESS_COARSE_LOCATION`, from a non-Activity
context path, with a literal `// TODO` beside it
(`RNBluetoothManagerModule.java:178-183`).

### 4.3 Defects this creates, and what changes in Kotlin

1. **Location is demanded for printing.** On API 31+, connecting to a bonded SPP
   printer needs `BLUETOOTH_CONNECT` only. Because `requestBluetoothPermissions`
   requires all three, a manager who declines the location prompt bricks receipt
   printing on that tablet. **Fix:** split the gate — `BLUETOOTH_CONNECT` for
   connect/print/bonded-list, `BLUETOOTH_SCAN` only for discovery, and drop
   `ACCESS_FINE_LOCATION` from the ≥31 path entirely once `neverForLocation` is
   declared.
2. **`neverForLocation` is missing.** Adding
   `android:usesPermissionFlags="neverForLocation"` to `BLUETOOTH_SCAN` is the
   supported way to scan without any location permission, and it is exactly
   right here — the app derives nothing locational from scan results.
3. **The legacy permissions are unbounded.** Once the vendored library is gone,
   declare `BLUETOOTH` and `BLUETOOTH_ADMIN` with `android:maxSdkVersion="30"`
   yourself, so API 31+ installs stop requesting them.
4. **Single request site.** In Kotlin, one `ActivityResultContracts.RequestMultiplePermissions`
   launcher in the printer-settings screen, with the connect path checking
   `checkSelfPermission(BLUETOOTH_CONNECT)` and surfacing a specific error rather
   than a silent `false`. Note that today _every_ failure in this file is
   swallowed into `return false` / `return []` (`:39-41, 148-150, 188-190`) —
   the Kotlin version should return a typed `PrinterError`.
5. **Receiver export flags — the existing module is arguably wrong, and the
   library is right.** `BluetoothConnectionModule.kt:65-69` passes
   `Context.RECEIVER_EXPORTED` on API 33+; the vendored library
   (`RNBluetoothManagerModule.java:88`) passes no flag at all. Android's own
   Android 14 behaviour-change page carves out exactly this case: _"If your app
   is registering a receiver only for system broadcasts through
   `Context#registerReceiver` methods … then it shouldn't specify a flag when
   registering the receiver."_ Both `ACTION_ACL_CONNECTED`/`ACTION_ACL_DISCONNECTED`
   and the discovery broadcasts are protected system broadcasts, so neither
   receiver needs a flag — and the app's `RECEIVER_EXPORTED` is the less correct
   of the two. In the Kotlin rewrite, register the ACL receiver with **no** flag.
6. **Reading ACL broadcasts requires `BLUETOOTH_CONNECT` on API 31+.** The
   `BluetoothDevice` reference states it on both constants (quoted below). Since
   §1.3 means the receiver has never actually run in production, this has never
   been exercised — expect it to matter the first time the ACL monitor works.

### 4.4 Primary-source citations

| Fact                                                                                                                                                                                                                                  | Source                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `BLUETOOTH_SCAN` / `BLUETOOTH_ADVERTISE` / `BLUETOOTH_CONNECT` split; `BLUETOOTH_CONNECT` is _"Required if your app communicates with already-paired Bluetooth devices"_                                                              | [Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)                           |
| `neverForLocation` applies to `BLUETOOTH_SCAN` only; _"If your app doesn't use Bluetooth scan results to derive physical location, you can make a strong assertion…"_; caveat _"some BLE beacons are filtered from the scan results"_ | same page                                                                                                                      |
| `ACCESS_FINE_LOCATION` can carry `android:maxSdkVersion="30"` once `neverForLocation` is asserted; legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` use `maxSdkVersion="30"`                                                                      | same page (manifest snippet)                                                                                                   |
| SPP UUID `00001101-0000-1000-8000-00805F9B34FB`; _"Hint: If you are connecting to a Bluetooth serial board then try using the well-known SPP UUID…"_                                                                                  | [`BluetoothDevice`](https://developer.android.com/reference/android/bluetooth/BluetoothDevice)                                 |
| _"You should always call `cancelDiscovery()` before `connect()`, especially because `cancelDiscovery()` succeeds regardless of whether device discovery is currently in progress."_                                                   | [Connect Bluetooth devices](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices)            |
| `getBondedDevices()` — _"For apps targeting `Build.VERSION_CODES.S` or higher, this requires the `Manifest.permission.BLUETOOTH_CONNECT` permission"_                                                                                 | [`BluetoothAdapter`](https://developer.android.com/reference/android/bluetooth/BluetoothAdapter)                               |
| `ACTION_ACL_CONNECTED` / `ACTION_ACL_DISCONNECTED` — _"For apps targeting `Build.VERSION_CODES.S` or higher, this requires the `Manifest.permission.BLUETOOTH_CONNECT` permission…"_                                                  | [`BluetoothDevice`](https://developer.android.com/reference/android/bluetooth/BluetoothDevice)                                 |
| API 33 opt-in exported/not-exported flag for runtime receivers                                                                                                                                                                        | [Android 13 features](https://developer.android.com/about/versions/13/features#runtime-receivers)                              |
| API 34 **requires** `RECEIVER_EXPORTED`/`RECEIVER_NOT_EXPORTED`, **except** for receivers registered only for system broadcasts                                                                                                       | [Android 14 behaviour changes](https://developer.android.com/about/versions/14/behavior-changes-14#runtime-receivers-exported) |
| Android 14 now _enforces_ `BLUETOOTH_CONNECT` on `BluetoothAdapter.getProfileConnectionState()`                                                                                                                                       | [Android 14 behaviour changes](https://developer.android.com/about/versions/14/behavior-changes-14)                            |
| Android 14 foreground services must declare a type; a Bluetooth-connection service uses `connectedDevice` + `FOREGROUND_SERVICE_CONNECTED_DEVICE`                                                                                     | [FGS types required](https://developer.android.com/about/versions/14/changes/fgs-types-required)                               |
| Android 15: no Bluetooth behaviour changes documented                                                                                                                                                                                 | [Android 15 behaviour changes](https://developer.android.com/about/versions/15/behavior-changes-15) (no "bluetooth" match)     |
| Android 16 adds `ACTION_KEY_MISSING` (remote bond loss) and `ACTION_ENCRYPTION_CHANGE`                                                                                                                                                | [Android 16 behaviour changes](https://developer.android.com/about/versions/16/behavior-changes-16#connectivity)               |

Two forward-looking items the Kotlin design should absorb now:

- **Foreground service.** If the Kotlin app keeps a printer socket alive across
  screens (recommended — it removes the reconnect-per-print cost), that service
  must declare `android:foregroundServiceType="connectedDevice"` and
  `FOREGROUND_SERVICE_CONNECTED_DEVICE`, holding `BLUETOOTH_CONNECT` at runtime.
  The current app has no service at all; this is new work, not a port.
- **Android 16 `ACTION_KEY_MISSING`.** Worth listening for: a printer that loses
  its bond currently manifests as an opaque connect failure and a manager
  re-pairing by hand.

---

## 5. Reprint and duplicate-protection semantics

### 5.1 The plan doc is partly historical

`docs/plans/2026-03-02-eod-closing-batch-reprint.md` specifies a Day Closing
screen with (a) a printable Z-Report and (b) **batch receipt reprint** —
select-all with deselect, sequential `getReceipt → printReceiptToThermal →
logReceiptReprint`, a `PrintProgressModal` showing "Printing 12 of 46…", voided
orders shown but deselected, and skip-and-report-at-end error handling.

**Half of that was removed.** Commit `a45a0de`, _"refactor(day-closing): remove
batch receipt reprint feature"_ (2026-03-25), deleted
`day-closing/hooks/useBatchPrint.ts`, `components/PrintProgressModal.tsx` and
`components/OrderSelectionItem.tsx`. On `main`, `DayClosingScreen.tsx` prints only
the Z-Report ("Sync & Print Z-Report", `:330`); there is no batch reprint. Do not
rebuild batch reprint in Kotlin on the strength of that plan document — confirm
with the owner first.

### 5.2 What reprint actually is today

Three distinct paths:

| Path                                | Where                                                | Guard                                                                                   |
| ----------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Customer receipt reprint            | `order-history/screens/OrderDetailScreen.tsx:66-140` | `isReprinting` state disables the button; `logReprint({ orderId })` **before** printing |
| Kitchen ticket reprint (takeout)    | `takeout/screens/TakeoutOrderScreen.tsx:466-505`     | `isSending` state guard; **no audit log**                                               |
| Post-checkout print / kitchen print | `ReceiptPreviewModal.tsx:102-130`                    | `isPrinting` / `isKitchenPrinting` state; states reset on modal open (`:84-92`)         |

### 5.3 There is no duplicate protection — and that is a deliberate-looking gap

`logReceiptReprint` (`packages/backend/convex/checkout.ts:532-560`) is
**append-only audit, not a lock**: it inserts one `auditLogs` row with
`action: "receipt_reprint"`, `entityType: "orders"`, and
`details: JSON.stringify({ orderNumber, reprintedBy })`. It never reads prior
reprints, never rate-limits, never marks the order. Permission
`checkout.reprint` gates _who_ may reprint (`lib/permissions.ts:15, 63, 89, 107`)
but not _how often_.

So the semantics to carry into Kotlin are:

1. **Reprinting is always allowed** for a permitted role; every attempt is
   audited; nothing is idempotent. Note it is logged _before_ the print, so an
   audit row exists even if the printer fails — the audit trail over-counts, not
   under-counts.
2. **The only real duplicate guard anywhere in the printing stack is the
   in-component boolean** (`isReprinting` / `isSending` / `isPrinting`). In
   Kotlin this must become a per-printer serialising queue, not per-screen
   state — see §6.
3. **Kitchen tickets have a genuine server-side guard, and it is not in the
   printing layer.** `orderItems.isSentToKitchen` (`schema.ts:308`) is flipped by
   `sendToKitchen` (`orders.ts:1579-1585, 1616-1621`), which only ever selects
   `!i.isVoided && !i.isSentToKitchen`. A second "send" prints nothing because
   there are no unsent items. The explicit **"Reprint Kitchen Receipt"** button
   deliberately bypasses this and reprints _all_ active items
   (`TakeoutOrderScreen.tsx:465-490`). Preserve both behaviours.
4. Reprint logging is explicitly **online-only** — the comment at
   `OrderDetailScreen.tsx:60` reads _"Reprint logging stays online — it's
   append-only audit, not blocking"_. It is a `useMutation`, not a sync-queued
   write. Under the offline-first sync architecture, a reprint performed offline
   is simply not audited. Decide deliberately whether the Kotlin app keeps that
   or queues it.

---

## 6. Proposed printing architecture for the Kotlin app

```
┌─ ui (Compose) ────────────────────────────────────────────┐
│  PrinterSettingsScreen · ReceiptPreviewSheet · DayClosing  │
└───────────────┬───────────────────────────────────────────┘
                │ PrintJob (sealed)
┌───────────────▼───────────────────────────────────────────┐
│  PrintQueue        single-threaded, per-printer            │
│   · Channel<PrintJob>, one consumer coroutine              │
│   · serialises: SPP allows one socket at a time            │
│   · retries connect (2 attempts, matches today)            │
│   · emits PrintResult(jobId, Success | Failure(reason))    │
└───────────────┬───────────────────────────────────────────┘
                │ ByteArray
┌───────────────▼───────────────────────────────────────────┐
│  SppPrinterConnection                                      │
│   · createRfcommSocketToServiceRecord(SPP_UUID)            │
│     + reflection createRfcommSocket(channel) fallback      │
│   · cancelDiscovery() before connect                       │
│   · connect timeout 3500ms  (= CONNECT_TIMEOUT_MS today)   │
│   · outputStream.write + flush                             │
└───────────────┬───────────────────────────────────────────┘
                │
┌───────────────▼───────────────┐  ┌────────────────────────┐
│ BluetoothAclMonitor            │  │ EscPos (builder)       │
│  · ported from the existing    │  │  align/size/text/feed/ │
│    Kotlin module, Flow-based   │  │  cut/drawer            │
│  · replaces the 60s poll       │  │  + ReceiptRenderer     │
└────────────────────────────────┘  │  + KitchenRenderer     │
                                    │  + ZReportRenderer     │
                                    └────────────────────────┘
```

**Components and their provenance**

| Component              | Origin                                                                                                                                                                                                                           | Effort |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `BluetoothAclMonitor`  | **~55 lines reused** from `BluetoothConnectionModule.kt`                                                                                                                                                                         | 0.5 d  |
| `SppPrinterConnection` | Re-implement from `BluetoothService.java` (358 lines, MIT — legally copyable, but it is Handler/thread-per-connection code from 2018; read it for the fallback logic, don't port it)                                                            | 1.5 d  |
| `EscPos` builder       | New, ~200 lines; the 7 sequences in §3.1                                                                                                                                                                                         | 1 d    |
| `ReceiptRenderer`      | 1:1 port of `escposFormatter.printReceiptToThermal` (196 lines TS)                                                                                                                                                               | 1.5 d  |
| `KitchenRenderer`      | 1:1 port of `printKitchenTicketToThermal` (148 lines TS)                                                                                                                                                                         | 1 d    |
| `ZReportRenderer`      | 1:1 port of `zReportFormatter` (~260 lines TS)                                                                                                                                                                                   | 1.5 d  |
| `PrintQueue`           | New — replaces per-screen booleans and the "always connect before printing" pattern (`usePrinterStore.ts:309-311, 327-329`)                                                                                                      | 1 d    |
| `PrinterRepository`    | Port of `printerStorage.ts` — the `PrinterConfig`/`PrinterSettings` shape maps straight onto a DataStore-backed data class. **Migrate the existing `expo-secure-store` key `"printer_settings"`** or staff re-pair every tablet. | 1 d    |
| Permission flow        | §4 — rewrite, do not port                                                                                                                                                                                                        | 0.5 d  |
| `PrinterForegroundService` | New — `connectedDevice` FGS type so the socket survives screen changes (§4.4) | 0.5 d |

**Design points that are decisions, not ports**

- **One socket at a time.** Today every print re-connects
  (`"Always connect before printing — Bluetooth Classic supports only one active
connection"`, `usePrinterStore.ts:269/288`). Keep that invariant, but hold it in
  the queue rather than at each call site, so a checkout receipt and a kitchen
  ticket fired in the same second cannot interleave.
- **Replace the 60 s poll with the ACL flow.** Fixing §1.3 makes disconnect
  detection immediate and lets you keep the poll only as a slow safety net.
- **Golden-bytes tests.** The renderers are pure; assert on the exact `ByteArray`.
  The existing Jest suite already does this in spirit
  (`escposFormatter.test.ts` asserts an exact printed string; `printerStorage.test.ts`
  and `usePrinterStore.test.ts` cover settings and add/remove/unpair). Port these
  as JVM unit tests — they need no device and catch the `bold()`-is-double-height
  class of regression.

**Reuse estimate, stated plainly:** of the ~900 lines of printing logic that
matter (three formatters + printer store + bluetooth service), **0 lines of
Kotlin exist today**. The existing Kotlin module contributes ~55 reusable lines,
about **6 %** of the Kotlin you will end up writing, and it covers connection
_events_ only. Budget the printing slice at **~9-10 engineer-days** plus on-site
verification.

---

## 7. What cannot be settled without the physical printers

Everything below is blocked on hardware at the three restaurants. None of it can
be answered from the repo.

1. **Make, model and firmware of each printer** (receipt and kitchen, per store).
   Nothing is recorded anywhere in the repo.
2. **Whether each unit speaks classic SPP** — and whether any of them only works
   via the `createRfcommSocket(channel)` reflection fallback rather than
   `createRfcommSocketToServiceRecord`. This decides whether the fallback is
   mandatory or merely defensive.
3. **`GS V 66 n` partial-cut support.** Cheap units silently ignore `GS V`; a few
   only honour `GS V 0`/`GS V 1` (full cut). Confirm the current partial cut
   actually cuts on each model before porting the constant.
4. **`ESC p 0 25 250` drawer kick.** Which pin (2 vs 5) the installed drawer is
   wired to, and whether the 25/250 (×2 ms) pulse is long enough for that
   solenoid. Only verifiable with the drawer attached.
5. **`GS ! 0x01` vs `GS ! 0x11` rendering** on each printer — the visual identity
   of every kitchen ticket depends on it. Print a side-by-side proof.
6. **Characters per line.** The 32/48 mapping (`usePrinterStore.ts:313`) assumes
   Font A at 58 mm/80 mm. Confirm against the real paper and real font; an
   off-by-one wraps every `formatRow` total column.
7. **Code page / non-ASCII.** Confirm nothing in live store names, footers,
   customer names or product names emits non-ASCII under `ESC t 0`. Store footer
   and product names are operator-entered, so this is a live risk today, not just
   after the port.
8. **Reconnect behaviour after power-cycling a printer mid-service** — validates
   both the ACL-monitor fix and the retry ladder.
9. **Bond survival across app reinstall.** `removePrinter` now calls
   `unpairDevice` (`usePrinterStore.ts:227-232`), which uses the library's
   reflection-based `unpaire`. A Kotlin equivalent needs `BluetoothDevice#removeBond`
   by reflection — verify it still works on the tablets' Android version.
10. **Print timing under load.** A full 80 mm receipt is ~150 `printText` calls
    today, each a separate JS→native round trip and a separate socket write. A
    Kotlin builder sends **one** buffer. That is a large behavioural change in
    timing; confirm no printer chokes on a single large write (some need chunking
    at 512 B with a short delay).

---

## 8. Recommendations

1. **Fix `modules/bluetooth-connection/index.ts` now**, independently of the
   Kotlin rewrite — restore `requireNativeModule`/`EventEmitter` from
   `expo-modules-core` (add it as a direct dependency). The Kotlin module is
   already correct; only the JS bridge is stubbed.
2. **Port, don't adopt.** Write the ESC/POS builder in Kotlin. See §3.3.
3. **Keep classic SPP**, keep the reflection fallback, keep one socket at a time.
4. **Split the permission gate**, add `neverForLocation`, bound the legacy
   permissions with `maxSdkVersion="30"`.
5. **Migrate the `printer_settings` blob** from `expo-secure-store` on first run.
6. **Write golden-byte tests** for all three renderers before touching hardware.
7. **Get the printer inventory** (make/model/MAC per store) before the port
   starts — item 1 of §7 blocks items 2-10.
8. **Confirm whether batch reprint should come back** (§5.1) before scoping.
