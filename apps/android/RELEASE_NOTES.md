## What's New

- Fixed cancelled orders remaining stuck as pending changes on Kotlin POS tablets.
- Existing affected tablets can deliver preserved cancellation records without clearing local data.
- Improved shared draft synchronization when another store tablet discards an order.

## Notes

- Update the backend before retrying synchronization on an affected tablet.
