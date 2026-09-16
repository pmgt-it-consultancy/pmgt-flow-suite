# Android Tablet: Landscape & Fullscreen Setup

> **Describes the React Native app (`apps/native`), which is being transitioned away from.**
> The active Android POS is native Kotlin at `apps/android` — see memory: kotlin-pos-migration.
> In the Kotlin app, `sensorLandscape` alone is NOT enough: Android 16 ignores `screenOrientation`
> on large screens unless the manifest also sets
> `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`. Both are set there.

The native app targets **Android tablets only** (no iOS).

## Configuration

### `app.json`
- `"orientation": "landscape"`

### `AndroidManifest.xml` (activity attributes)
- `android:screenOrientation="sensorLandscape"` — locks to landscape, allows 180° rotation
- `android:resizeableActivity="true"` — prevents Android from letterboxing the app on tablets (without this, the app renders in a phone-sized window centered on the tablet screen)

## Notes
- Changes to `app.json` and `AndroidManifest.xml` require a full rebuild (not hot reload).
- The status bar spacer in `App.tsx` uses `StatusBar.currentHeight` on Android, which is fine.
