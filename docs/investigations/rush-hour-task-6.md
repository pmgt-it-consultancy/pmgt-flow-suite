# Ticket #6: batched order mutations

Adding a line now prepares the item, modifiers and parent count update as one batch, followed by the existing totals recalculation. Quantity and void updates likewise batch the line and count. Product and parent lookup happen before preparing writes.

Kitchen draft submission validates all products and the table before preparing the order, items, modifiers and table status in one batch. Its initial order includes item count, removing the redundant later count update. Existing totals/tax calculation functions remain unchanged.

RED: orderMutations.test.ts saw the first storage batch contain only order_items rather than the complete line/modifier/count update. A second red scenario proved a missing draft product left two orders instead of the one pre-existing order.

GREEN: real WatermelonDB model/writer tests with an in-memory adapter verify modifier-inclusive totals (50, then 75 after quantity change, then 0 after void), coherent line batching, no partial kitchen order on missing products, and successful sent-item/table state. Native typecheck passed after the implementation. Final integration reruns covering tests and full suite.

This change reduces calls and notifications; it does not claim a measured tablet speedup or combine totals recalculation with the initial item transaction. Adapter failure/recovery semantics remain WatermelonDB's responsibility.

Review follow-up: the public mutation tests also cover VAT-bearing modifier-inclusive items with both `senior_citizen` and `pwd` discounts. After increasing quantity to three, two regular units at 112 plus one exempt discounted unit at 80 produce net sales 304, VAT 24 and discount 20. Voiding the line clears the order totals and the item's discount amount. All six focused mutation tests pass. The first supplemental run used the invalid fixture type `senior`; correcting it to the app's `senior_citizen` contract required no production change.
