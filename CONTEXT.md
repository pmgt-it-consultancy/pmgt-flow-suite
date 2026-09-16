# Restaurant POS Operations

This context defines the language used for restaurant operations on an offline-capable POS device and its synchronization with the server.

## Local data

**Pending Local Work**:
Orders, payments, discounts, voids, and other business changes created on a device that the server has not yet accepted and confirmed.
_Avoid_: Pending mutations, queued mutations, unsynced models

**Operation Journal**:
The durable sequence of business commands created on a device and retained until each command has been accepted and observed.
_Avoid_: Dirty rows, retry queue

**Accepted Operation**:
An Operation Journal entry whose business effect the server has committed idempotently but whose authoritative result may not yet have returned to the device.
_Avoid_: Synced operation, completed operation

**Observed Operation**:
An Accepted Operation whose authoritative result the device has received through replication.
_Avoid_: Uploaded operation, sent operation

**Attention-Required Operation**:
A Pending Local Work entry that cannot progress automatically and requires an explicit corrective workflow without losing its original business intent.
_Avoid_: Dropped mutation, permanent sync error

**Operational Replica**:
The server-backed data automatically retained on a device so the restaurant can operate through the current Business Day without an internet connection.
_Avoid_: Local cache, full database copy

**Historical Cache**:
Older server-backed order information loaded only by explicit request and safe to remove without changing server history or Pending Local Work.
_Avoid_: Operational Replica, offline archive

**Order Aggregate**:
An Order together with the items, modifier snapshots, discounts, voids, and payments required to interpret it completely.
_Avoid_: Order row, order details

**Replica Membership**:
The explicit classification that determines whether server-backed data belongs in a device's Operational Replica or may remain only in Historical Cache.
_Avoid_: Sync filter, deletion state

**Operational Order**:
An Order Aggregate that must remain in the Operational Replica because it is active, belongs to an unclosed Business Day, or has an unresolved financial or synchronization dependency.
_Avoid_: Recent order, today's order

**Pinned Historical Order**:
An older Order Aggregate explicitly retained in Historical Cache while staff inspect, reprint, or complete an authorized workflow involving it.
_Avoid_: Operational Order, downloaded order

**Origin Tablet**:
The POS device that created an Order and owns changes to it while it remains open, unless ownership is explicitly transferred.
_Avoid_: Current tablet, primary terminal

## Time and operations

**Business Day**:
The store-defined operating period identified by the PHT calendar date on which it opens; it may cross midnight according to the store schedule.
_Avoid_: Calendar day, shift

**Settled Business Day**:
A Business Day for which all known device operations have been observed and the authoritative server report snapshot is complete; printing a Z-Report does not determine settlement.
_Avoid_: Printed day, closed shift

**Preliminary Day Report**:
A server-generated Business Day report that identifies tablets still awaiting reconciliation and does not declare the Business Day settled.
_Avoid_: Z-Report, final report

**Report Revision**:
An immutable, numbered snapshot of a Business Day report; later reconciliation creates a new revision instead of rewriting earlier evidence.
_Avoid_: Refreshed report, overwritten report

**Canonical Business Day**:
The Business Day assigned by the server after validating the device occurrence time against the store schedule; an offline device's assignment remains provisional until then.
_Avoid_: Device day, calendar date

**Active Tablet**:
A commissioned store device that has not completed an audited retirement and must participate in store-level financial reconciliation.
_Avoid_: Recently online tablet, current tablet

**Device Retirement**:
The audited removal of a tablet from store-level reconciliation after its Pending Local Work is cleared or a manager explicitly acknowledges unrecoverable device loss.
_Avoid_: Delete device, forget tablet

**Device Commissioning**:
The audited admission of a tablet into a store as an Active Tablet, allocating it a device code and order-number counters belonging to that store; a tablet already commissioned elsewhere must complete Device Retirement first.
_Avoid_: Register device, provision tablet, pair tablet

**Settle Order**:
The single business operation that commits payment, freezes order totals, changes the order state, and releases its table; receipt printing is not part of settlement.
_Avoid_: Process payment, print receipt

**Sync Now**:
A routine request to send Pending Local Work and receive the latest eligible server changes without removing local data.
_Avoid_: Force Sync, Force Resync

**Refresh POS Data**:
A supervised maintenance workflow that verifies and replaces selected downloaded data without removing Pending Local Work.
_Avoid_: Clear Cache, Force Resync

**Sync-Clean**:
A verified state in which the server has accepted all Pending Local Work, no financial synchronization exceptions remain, and the device has observed the required server checkpoint.
_Avoid_: Sync finished, online

## Money

**Device-Computed Totals**:
The money figures an Origin Tablet calculates for an Order Aggregate and sends to the server, which the server records without independently verifying them.
_Avoid_: Client totals, local totals

**Totals Reconciliation**:
The server's independent recalculation of an Order Aggregate's money figures from its items, compared against the Device-Computed Totals it received.
_Avoid_: Validation, totals check

**Totals Divergence**:
A recorded disagreement between Device-Computed Totals and Totals Reconciliation; it is raised for correction and never prevents a sale from being accepted.
_Avoid_: Rounding error, sync mismatch

**Ledger-Compatible Arithmetic**:
The requirement that any reimplementation of the money calculations reproduce the existing results exactly, so that already-settled Business Days remain reproducible.
_Avoid_: Correct arithmetic, precise arithmetic
