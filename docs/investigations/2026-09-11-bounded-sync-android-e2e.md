# Bounded sync Android E2E — 2026-09-11

## Scope

- Staging deployment only: `aromatic-dalmatian-30`
- Native staging package: `com.pmgtitconsultancy.pmgtflow.stg`, version `3.28.0`
- Android 15 / API 35 Pixel Tablet emulator, 2560x1600, 4 GB RAM, 2 emulator cores
- Production tablet proxy: VistaTab 30S, Helio G88, 4 GB physical RAM
- `EXPO_PUBLIC_SYNC_V2=1`

The emulator matches the tablet's memory class and landscape resolution, but does not reproduce
its CPU, GPU, flash storage, thermal throttling, or Bluetooth printer behavior. Timing results are
debug-build evidence, not production performance acceptance thresholds.

## Isolated staging fixture

- Store: `Bounded Sync E2E Lab`
- Store ID: `kh74r72rmz69jtr783qyhftt2h8e77t0`
- 20 categories, 500 products, 20 modifier groups, 80 modifier options
- 20 modifier assignments and 80 tables
- 10,000 paid historical orders and 50 active orders
- 40,200 order items, 40,200 item modifiers, and 10,000 payments
- Re-running provisioning and seeding is idempotent; verification reported no duplicate rows
- Synthetic traffic is opt-in and was left disabled

Credentials are intentionally excluded from source control and supplied directly to the operator.

## Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Fresh cashier login | Pass with performance concern | Home shell painted in about 20 s; complete legacy import took about 6–7 min |
| UI during legacy import | Partial | Screen remained tappable, but showed 50 orders and zero active details until import completed |
| Completed active set | Pass | 50 active: 25 dine-in and 25 takeout |
| Warm process restart | Pass | Active data ready in 9 s with the local cache retained |
| Explicit 30-day history | Pass | Remote summaries appeared in 5 s; detail hydrated only after selecting an order |
| Offline cached read | Pass | Home, active orders, and an already-loaded historical detail remained visible in airplane mode |
| Offline cold relaunch | Fail / existing blocker | Root remained blank while Convex auth waited for `getCurrentUser`; recovered 13 s after connectivity returned |
| Staff force refresh | Pass | Staff account was denied with a manager/settings permission message |
| Manager force refresh safety gate | Pass | Confirmation states pending work is delivered and verified before replacement |
| Manager force refresh at scale | Pass after fix | Initial endpoint exceeded Convex's 4,096-read limit; paginated snapshot fix reduced repair to 20 s |
| Offline sale after clean production-shaped fixture sync | Pass | A takeout item was added and sent to the kitchen in airplane mode; after reconnect, both local rows were synced and assigned staging server IDs |

## Defects found and corrected

### V2 snapshot exceeded the Convex read limit

The snapshot collected the seven-day operational window and hydrated every aggregate in one query.
The 10,050-order fixture made that query exceed 4,096 reads. Snapshots are now paginated in bounded
25-root pages, with a frozen snapshot timestamp carried in the opaque page cursor. The client gathers
all pages before validation and atomic activation, retaining the first page's checkpoint so later
events are caught up normally.

### Lab store identity did not match production-created stores

The first lab provisioner assigned a `clientId` to the store, while normal admin store creation does
not. That made the synthetic fixture exercise a different local identity contract. The lab is now
identified by an indexed staging TIN and removes the old client alias on retry, preserving the
production store/server ID relationship.

The clean-device rerun then created a takeout order in airplane mode, added a required modifier,
and moved the order to in-progress before reconnecting. This verifies the production-shaped local
foreign-key path that the original fixture had masked.

## Remaining release risk

The v2 bounded replicator is still a shadow sidecar while v1 remains the live source for day-to-day
screens. Therefore the app still downloads all 10,000 historical orders and 80,400 historical child
rows on a fresh device. The E2E run demonstrates that the bounded snapshot and explicit history path
scale, but it does not eliminate the current first-login cost until screen reads and all sale commands
are cut over from v1.

Offline cold boot is also not production-safe yet: authentication requires a live Convex
`getCurrentUser` result before navigation is mounted. A locally persisted, revocable session/user
projection is needed before the POS can honestly be called offline-first across process restarts.
