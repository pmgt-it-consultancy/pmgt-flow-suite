# Android Tablet: Landscape & Fullscreen Setup

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
