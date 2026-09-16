## Update validation release

- Publishes version 1.2.1 so installed 1.2.0 tablets can exercise the complete in-app update flow.
- Fixes Kotlin release-tag parsing so the updater recognizes `kotlin-v1.2.1-production` and `kotlin-v1.2.1-staging` as version 1.2.1.
- Contains the same POS features and dialog-safety behavior delivered in 1.2.0.

## Verification

- 300 Android host tests passed.
- Android `lintDebug` passed.
- 273 backend tests and backend type checking passed.
