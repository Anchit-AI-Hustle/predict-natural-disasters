# Predict Natural Disasters for Android

This is the native Android app for https://predict-natural-disasters.anchit-tandon.com. It is written in Kotlin with Jetpack Compose and Material 3, and uses the site's dark theme.

The website is the source of truth. The spec this app follows is in `docs/native-parity/`.

- Package: `com.anchittandon.pnd`
- Version: `versionName 1.0.0`
- Android versions: minSdk 26, targetSdk 35

## Build, test and run

You need JDK 17 or newer (CI uses 21) and the Android SDK, with platform 35 and build-tools. Set its location with `ANDROID_HOME` or in `local.properties`. Run these commands from this folder (`android/`):

```sh
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest      # logic, decoding, flow and screenshot tests (Robolectric)
./gradlew verifyRoborazziDebug   # fails if a screen differs from app/src/test/snapshots
./gradlew recordRoborazziDebug   # re-record the screenshots after an intended UI change
./gradlew lintDebug
./gradlew installDebug           # install on a connected device or a running emulator
```

To run the app, start an emulator from Android Studio, or connect a phone with USB debugging on. Then run `installDebug` and open "Predict Natural Disasters".

To try a deep link:

```sh
adb shell am start -a android.intent.action.VIEW -d "https://predict-natural-disasters.anchit-tandon.com/forecasts/ND-001"
```

### What the tests cover

- `logic/VectorsTest`: checks every group in `docs/native-parity/test-vectors.json`, covering every rule in logic.md.
- `logic/GradingEngineTest`: runs the site's own `hazard-model.js`, `observed-model.js` and `verification-model.js` in Rhino. The output must match what Node produces for the same ledgers.
- `data/DataTest`: tolerant decoding of the sample feed and enrichment, the repositories (the saved copy on disk, `?ts=` refresh, failures), and deep-link resolution.
- `ui/FlowTest`: the key flows.
  - Search for a place, choose one and save it.
  - "Nothing found" is never shown as safe.
  - Location denied.
  - Open a detail from a list.
  - Share.
  - Sort and filter.
  - Failed feed.
  - Track record.
  - Not found.
  - Changing the time zone.
  - Turning alerts on.
- `ui/TrustNoteTest`: the trust note is on every forecast or risk screen, and only there.
- `ui/ScreenshotTest`: Roborazzi captures of every main screen and every detail kind at three sizes. Most screens also get a second, scrolled capture (`_more`).
  - Phone: 390x844 dp.
  - Tablet: 820x1180 dp.
  - Large phone at 200% font size (`large_font2x_`).

The tests use fixtures only. They never call the live site or Nominatim.

### CI

`.github/workflows/android.yml` runs on pull requests and on pushes to `main` that touch `android/`. It builds, runs the unit and screenshot tests, and runs lint. It uploads the debug APK, plus the Roborazzi diffs if a run fails. A run takes about 10 to 15 minutes of Actions time, and only starts when `android/` changes.

## How it works

- **Data**:
  - It uses OkHttp and kotlinx.serialization. Records stay as JSON objects and are read with JavaScript semantics, so unknown or odd fields never break decoding.
  - It polls every 60 s while a screen is visible. Pull to refresh adds `?ts=`.
  - The last good feed is kept in `last-feed.json`. When the network fails, the app shows that copy and labels it as a saved copy with its time.
- **Track record**: the grading runs the website's JavaScript unchanged, in Mozilla Rhino. `verdicts.js` was ported to Kotlin because Rhino cannot parse `for (const ...)`.
- **Alerts**:
  - WorkManager checks once an hour, when connected and the battery is not low. It applies the site's `alertsFor` and major-event rules with 6 h de-duplication.
  - Places never leave the device.
  - On Android 13 and later it asks for `POST_NOTIFICATIONS`. A switch in Settings turns alerts on or off.
- **Place search**: Nominatim, with the User-Agent `PredictNaturalDisasters-Android/1.0.0 (+https://predict-natural-disasters.anchit-tandon.com/about)` and at most 1 request per second.
- **Map**: osmdroid, with the Esri World Imagery and Topo tiles and their attribution.

## What needs the owner

1. **Google Play Console account** (one-off fee) to publish. You also need a privacy policy URL, and the Data safety form:
   - Location is used on device only and is not collected.
   - Saved places stay on the device.
2. **Release signing key**:
   - Create an upload keystore and keep it out of git.
   - Add a `signingConfigs { release { ... } }` block that reads the keystore from environment variables or `~/.gradle/gradle.properties`.
   - Enable Play App Signing.
   - Build the bundle with `./gradlew bundleRelease`.
   - Release minification is off on purpose: R8 would strip the Rhino classes that the JavaScript engine loads by reflection. Keep rules would be needed before turning it on.
3. **`assetlinks.json` on the website**, so the `autoVerify` deep links open the app without asking. The manifest claims these paths:
   - `/forecasts`
   - `/disasters`
   - `/alerts`
   - `/calamities`
   - `/regions`
   - `/locations`
   - `/hazards`
   - `/history`
   - `/sources`

   Serve this at `https://predict-natural-disasters.anchit-tandon.com/.well-known/assetlinks.json`:

   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.anchittandon.pnd",
       "sha256_cert_fingerprints": ["<SHA-256 of the Play app signing key>"]
     }
   }]
   ```

   Take the fingerprint from Play Console > App integrity. For local testing, use the debug key's fingerprint from `keytool -list -v -keystore ~/.android/debug.keystore -storepass android`. This is a change to the website, so it was not made here.
4. **Optional server push** (FCM). Without it, alerts depend on the hourly background check, which Android may delay. Push needs these steps:
   - Create a Firebase project and add `google-services.json`.
   - Build a native variant of `/api/alerts` that accepts FCM tokens (features.md §16.3).

   The website's push backend is Web Push only, and it is switched off.
5. **Product decision**: the time zone defaults to IST (Asia/Kolkata), matching the site. features.md §17 suggests asking whether the default should be the device's own zone.

## Parity checklist (features.md)

| § | Feature | Screen | Status |
|---|---|---|---|
| 0 | Global rules: plain wording, published-value checks, risk scale, a reported 0 shows as 0 | all | Done |
| 0.1 | 5 tabs (Map, Alerts & events, Forecasts, My places, Track record); Home is the launch screen, reached from the logo; other screens from More; web paths as routes; deep links | `App.kt`, `Routes.kt` | Done |
| 0.2 | 60 s polling while visible, pull to refresh with `?ts=`, error and offline states, saved copy labelled with its time | `FeedBanner`, `FeedRepository` | Done |
| 0.3 | Search, risk filter, sort remembered per screen, status line, empty and error copy | `ListScreens.kt` | Done |
| 0.4 | Record card (badges, facts, source, quiet note, opens the right detail) | `Components.kt` | Done |
| 1.1 to 1.4 | Home: check a place (search, choose, use my location, save), result card, KPI tiles, utility cards | `HomeScreen` | Done |
| 1.5 | Explore regions and tools | `HomeScreen` "Explore" panel | Done (a panel, not a sidebar) |
| 1.6 to 1.7 | Home map with the most serious live events; first-visit, loading and failed states | `HomeScreen` | Done |
| 2 | Map: Esri tiles and attribution, shaped risk markers, key, tap to open, list below | `MapScreen`, `RiskMap.kt` | Done, except the gaps below |
| 3.1 | Alerts tab | `AlertsScreen` | Done |
| 3.2 | All 8 collection views, with `q` and `region` | `CollectionScreen` | Done |
| 3.3 | Calamities, now and past | `CalamitiesScreen` | Done (see the difference below) |
| 4, 4.1 | Forecasts: hazard tiles, filters, table, test cases labelled | `ForecastsScreen`, `forecast-list` | Done |
| 4.2 | Forecast calendar | `ForecastCalendarScreen` | Done (see the difference below) |
| 4.3 | How we check forecasts | `VerificationListScreen` | Done |
| 5.1 to 5.3 | My places: alerts panel, saved places in DataStore (add, remove, summary chip), dangers near your places | `MyPlacesScreen` | Done |
| 6 | Track record from the site's own JS, last recorded time, key figures, ledgers | `TrackRecordUi` | Done |
| 7.1 to 7.4 | Event, alert, calamity and forecast detail (aftershock, ND-001, donations held back on forecasts), not found | `RecordDetail.kt`, `ForecastDetail.kt` | Done |
| 7.5 | Enrichment block on every record, region, location, hazard and history detail | `Enrichment.kt` | Done |
| 7.5 | Entity-detail topic catalogue (topic pages opened from enrichment links) | none | Not done: the links open the website |
| 8.1 to 8.3 | Regions list, region detail, location detail with place-risk rules | `PlaceScreens.kt` | Done |
| 9.1 to 9.2 | Hazard types and hazard detail | `hazard-types`, `HazardDetailScreen` | Done |
| 10.1 to 10.2 | Our sources with live provider status, source detail | `ResourcesScreen`, `SourceDetailScreen` | Done |
| 11.1 to 11.2 | Past disasters and historical event detail (same resolution order) | `CalamitiesScreen`, `HistoryDetailScreen` | Done |
| 12 | Insights | `InsightsScreen` | Done |
| 13 | How it works, About | `InfoScreens.kt` | Done |
| 14 | Verification detail (ND-001) | `VerificationDetailScreen` | Done |
| 15.1 | Trust note on every forecast or risk screen, with data times in the chosen zone | `Trust.kt` | Done |
| 15.2 | Footer agencies | More screen and the bottom of long screens | Done |
| 16.1 to 16.2 | Notification states and foreground notifications | `MainActivity`, Settings | Done |
| 16.3 | Local background evaluation (WorkManager, 6 h de-duplication, taps open app routes) | `AlertWorker` | Done |
| 16.3 | Optional server push | none | Not done: needs backend work and FCM (owner) |
| 17 | Time zone picker, labels, IST default | `SettingsScreen` | Done |
| 18 | Cesium globe | none | Not done (optional) |
| other | Share, 48 dp targets, 200% font size, TalkBack labels, adaptive icon | all | Done, except the gaps below |

### Known gaps and differences

- **Map layers**:
  - Only Map and Satellite exist.
  - There is no Political layer and no NASA GIBS overlay.
  - Markers are not separate TalkBack nodes. Each map has a spoken summary and an accessible list of the same events below it.
- **Glossary**: the first-use expansion of terms (`Glossary.expand`) exists as a helper, but it is not applied throughout the body text.
- **Tablet layout**: the tablet uses the phone's single column, widened, rather than a multi-column layout.
- **Calendar days**: the calendar groups days in the chosen time zone, not the device's local time.
- **Reported 0 on Calamities**: this screen applies logic.md rule 8, so a reported 0 shows as "0". The website's calamity page shows "-". The website should probably be fixed to match.
