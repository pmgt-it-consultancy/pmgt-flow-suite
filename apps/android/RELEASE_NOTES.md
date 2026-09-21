## What's New

- Printers now connect through the printer's own advertised service, and fall back across connection channels if that fails — a printer that previously had to be removed and re-added should now connect on its own.
- A receipt printer and a kitchen printer can stay connected at the same time instead of taking turns, so neither drops out while the other is in use.
- Several tills can work the same order. Adding to and settling an order another till opened no longer leaves that till's changes stuck.
- When the server will not accept a change, the till now names which changes and why, instead of only reporting that synchronization failed.

## Notes

- A change the server refuses stays on the till and is delivered automatically once the server accepts it. Nothing is discarded.
- Day closing still waits until every sale has reached the server, and now gives the reason when it cannot continue.
- Day closing remains limited to accounts with end-of-day report permission, so a cashier login will not show it.
