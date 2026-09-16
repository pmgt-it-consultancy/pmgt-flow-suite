# Kotlin Takeout Print Bill Design

## Goal

Allow staff to view and print an unpaid bill from the Kotlin Android takeout order-entry screen without settling the order.

## User Experience

- Show a full-width **View Bill** button above **Proceed to Payment** when a takeout order contains items.
- Keep the existing dine-in **View Bill** action.
- Open the existing **Current Bill** modal from either action.
- Add a large **Print Bill** action to the modal.
- While printing, disable the action and label it **Printing...**.
- Keep the modal open after success so staff can verify or reprint the bill.
- If printing fails, keep the order and modal unchanged and show an actionable printer error.

## Printed Bill

Introduce a dedicated bill document and formatter instead of passing placeholder payment data through the customer-receipt formatter. The printout will include:

- store identity and contact details available in the local checkout view;
- a prominent **BILL** heading;
- order number, date, order type, table or table marker, pax, and cashier;
- current non-voided items, modifiers, service types, discounts, tax breakdown, and total;
- the existing non-official-document footer.

It will not include a payment method, amount tendered, change, card details, or receipt number.

## Data Flow and Boundaries

1. `OrderEditorScreen` receives an injected suspending bill-print boundary.
2. Tapping **Print Bill** passes the current order identity to that boundary.
3. `PosBrowseRoot` reads the latest local `CheckoutView` for the signed-in cashier and maps it to an immutable bill document.
4. The configured receipt printer formats and prints the bill.

The workflow is read-only with respect to business data. It must not call checkout settlement, create payments, release a table, open the cash drawer, change order status, or write a receipt-reprint audit event.

## Error Handling

- A missing, disconnected, or failed receipt printer surfaces through the order screen's existing error dialog.
- Cancellation is rethrown and does not become an error dialog.
- Repeated taps are blocked while a print is in flight.
- If the local order view is unavailable, no printer output is attempted and the user is told to retry.

## Tests

The approved public seams are:

1. **Pure formatter seam:** a representative bill prints `BILL`, current item/tax/total content, and no payment, tender, change, card, or receipt-number fields.
2. **Compose interaction seam:** on a takeout order, **View Bill** appears above **Proceed to Payment**, and tapping **Print Bill** invokes the injected print boundary without invoking checkout.

Run the focused formatter and order UI tests during development, Kotlin type/compile checks regularly, and the full Android unit test suite at the end.

## Out of Scope

- React Native/Expo changes.
- Backend schema or API changes.
- Payment, settlement, cash-drawer, or audit behavior.
- A bill preview redesign beyond the new print action.
