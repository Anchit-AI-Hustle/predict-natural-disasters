# Predict Natural Disasters for iOS and iPadOS

A native SwiftUI app with the same features as
[predict-natural-disasters.anchit-tandon.com](https://predict-natural-disasters.anchit-tandon.com).
The specification it follows is in `docs/native-parity/` (features.md, api.md, logic.md, design.md and the test vectors).

| Folder | What it is |
| --- | --- |
| `PNDCore/` | Swift package with every rule that can be tested without a device: models (lenient JSON), the API client, the risk scale, place risk, alert rules, formatting, sorts, search, the trust note, the Track record screen logic, the stores and the offline cache. Builds and tests on Linux and macOS. |
| `App/Sources/` | The SwiftUI app (iOS 17, iPhone and iPad). |
| `AppUITests/` | XCUITests that run against bundled fixtures and attach screenshots. |
| `project.yml` | XcodeGen spec. The `.xcodeproj` is generated, never committed. |
| `scripts/` | `copy-web-assets.sh` (build phase), `track-record-expected.js` (CI parity check), `export-screenshots.sh`, `make-app-icon.py`. |

## Build, test and run

Requirements: Xcode 16 (iOS 17 SDK or later), [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`).

```sh
# Core logic (works on Linux too)
cd ios/PNDCore && swift test

# The app
cd ios && xcodegen generate && open PredictNaturalDisasters.xcodeproj
```

Run the `PredictNaturalDisasters` scheme on a simulator. Useful launch arguments:

| Argument | Effect |
| --- | --- |
| `-PNDFixtureMode` | Every request is answered from the bundled fixtures (`PNDCore/Tests/PNDCoreTests/Fixtures`), the clock is fixed to 20 Oct 2026 12:00 UTC and saved places start empty. UI tests use this, so CI needs no network. |
| `-PNDFixtureFail` | With fixture mode: every request fails, to show the offline wording. |
| `-PNDFixturePlaces` | With fixture mode: starts with one saved place (Kathmandu). |
| `-PNDOpenRoute /alerts/gdacs-FL-1104999` | Opens a site path after launch, as a universal link would. |

UI tests from the command line:

```sh
cd ios && xcodegen generate
xcodebuild test -project PredictNaturalDisasters.xcodeproj -scheme PredictNaturalDisasters \
  -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO
```

### Track record parity

The Track record grades forecasts with the website's own code: at build time `scripts/copy-web-assets.sh` copies
`hazard-model.js`, `observed-model.js`, `verification-model.js`, `verdicts.js`, `history-data.js` and
`world-countries.json` from the repository root into the app bundle, and the app runs `verify()` and
`assessCoverage()` in JavaScriptCore. Nothing is duplicated, so the app cannot drift from the site. The screen logic
around them (`accuracy.html load()`) is ported to Swift in `PNDCore/Sources/PNDCore/TrackRecord.swift`.

CI renders the site's own `/accuracy` page in jsdom over the committed ledgers (`scripts/track-record-expected.js`)
and `swift test` on macOS compares every figure with what the Swift port computes from the JavaScriptCore grading
(`TrackRecordTests.testFiguresMatchTheSite`). On Linux there is no JavaScriptCore, so that test is skipped unless a
JSON of the engine's output is supplied in `PND_TRACK_GRADED`. It was run that way while building: all 35 figures
matched the rendered page.

### CI

`.github/workflows/ios.yml` runs only for changes under `ios/` or to the workflow. Note that changes to the site's
grading scripts or `data/` do not trigger it; run it by hand (`workflow_dispatch`) after such a change.

- **PNDCore on Linux**: `swift test` in a `swift:6.0-jammy` container.
- **App on iPhone and iPad simulators** (`macos-15`): picks the newest Xcode 16 (or the newest installed), renders
  the site's Track record, runs `swift test` with the JavaScriptCore parity check, generates the project, builds for
  testing once, runs the UI tests on an iPhone 16 and an iPad (10th generation) or iPad Air simulator, and uploads
  the `.xcresult` bundles and the exported PNG screenshots as artifacts.

macOS minutes count ten times on a private repository's Actions allowance (the repository already ran out once,
see `test/actions-budget.test.js`). One full run is about 25 to 40 macOS minutes.

## What needs the owner

1. **Apple Developer Program** membership, and a signing team: set `DEVELOPMENT_TEAM` in `project.yml` (or in Xcode)
   to build to a device or for TestFlight. CI builds with `CODE_SIGNING_ALLOWED=NO`.
2. **Universal links**: the site must serve `https://predict-natural-disasters.anchit-tandon.com/.well-known/apple-app-site-association`
   (JSON, no redirect, `Content-Type: application/json`) listing `TEAMID.com.anchittandon.pnd` for the paths
   `/disasters/*`, `/alerts/*`, `/forecasts/*`, `/calamities/*`, `/regions/*`, `/locations/*`, `/hazards/*`,
   `/history/*` and `/sources/*`. The app already has the `applinks:` associated domain. Until the file is served,
   links open in Safari; inside the app, routes already work (`-PNDOpenRoute`, notifications).
   Example:
   ```json
   {"applinks":{"details":[{"appIDs":["TEAMID.com.anchittandon.pnd"],"components":[{"/":"/disasters/*"},{"/":"/alerts/*"},{"/":"/forecasts/*"},{"/":"/calamities/*"},{"/":"/regions/*"},{"/":"/locations/*"},{"/":"/hazards/*"},{"/":"/history/*"},{"/":"/sources/*"}]}]}}
   ```
   Note `vercel.json` must not rewrite `/.well-known/*`.
3. **Push notifications from a server (optional, later)**: `/api/alerts` accepts Web Push subscriptions only and is
   switched off in production, so the app checks alerts on the device (foreground on every feed load, and in a
   `BGAppRefreshTask` when iOS chooses to run it). True server push needs an APNs key (Apple Developer account), a
   native variant of `/api/alerts` that stores APNs tokens with the same privacy contract, and the Push Notifications
   capability. None of that is built.
4. **App Store**: privacy labels (location is used on device only; no data is collected), screenshots (the CI artifact
   has them), and a decision on the default time zone (the app keeps the site's IST default; Settings has "use this
   device's time zone").
5. **Map tiles**: the satellite layer uses Esri World Imagery and the Esri boundaries and places overlay, as the site
   does, with Esri's attribution shown. Check that Esri's terms allow this use in a published app.

## Notes and deliberate choices

- `SWIFT_VERSION` is `5.0` in `project.yml`: Xcode accepts only 4, 4.2, 5 or 6, so "5.10" is not a valid value.
  `5.0` selects Swift 5 language mode (no strict-concurrency errors) on the Xcode 16 Swift 6 compiler.
- iPhone shows the tabs Home, Alerts & events, Forecasts and My places, and iOS puts Map and Track record under its
  own "More" tab. Every screen has a "More pages and settings" button (the site's footer links, settings and the
  agencies). iPad uses a sidebar with all six plus "More pages".
- The dark theme is forced (the site has no light theme). Text uses Dynamic Type styles; hit targets are at least 44 pt.
- Default map layer is a muted dark Apple map (the "clear map" the site defaults to). The site's custom political
  layer and the optional NASA GIBS overlay and 3D globe are not built.

## Parity checklist (features.md)

Done means implemented in the app and, where it is logic, covered by PNDCore tests. "Unverified" means written but not
yet compiled or run: the SwiftUI app has only been compiled by CI, not here (this was written on Linux without Xcode).

| features.md | Screen / file | Status |
| --- | --- | --- |
| 0 Global rules 1 to 13 (trust note, never official, nothing found is not safe, Not rated, colour + shape + text, neutral provenance, earthquake limits, missing is not zero, empty is not safe, failure is not empty, data time, no percentages, acronyms) | `Trust.swift`, `RiskScale.swift`, `PlaceRisk.swift`, `Format.swift`, `Theme.swift` | Done (logic tested). First-use acronym expansion in prose is not applied (expandAlways is). |
| 0.1 Navigation, Home as launch, More, deep links, ID resolution, not-found copy | `RootView.swift`, `Routes.swift` | Done; universal links need the AASA file (owner) |
| 0.2 Refresh every 60 s, Refresh now with `?ts=`, live-only lists, quiet note, status line, error and loading text | `AppModel.swift`, `Components.swift` | Done (polls while the app is active, not per screen) |
| 0.3 Search, place filter, risk filter, hazard filters, remembered sort, empty results | `Search.swift`, `Sorts.swift`, `ListScreens.swift` | Done (`?q=` is kept in routes) |
| 0.4 Record card | `EventCard` | Done |
| 1.1 Hero, Nominatim search on submit, chooser, Use my location, saved chips, auto answer | `HomeView.swift` | Done; country found on device from `world-countries.json` |
| 1.2 Place result card, Save, Alert me, See details | `PlaceResultCard` | Done |
| 1.3 KPI tiles with shimmer | `HomeView` | Done |
| 1.4 Utility cards, 1.5 Explore chips | `HomeView` | Done |
| 1.6 Map, most serious 5, hazard strip (earthquake observed only), latest forecasts, events, warnings, track teaser | `HomeView` | Done (map selection opens the record instead of a nudge card) |
| 1.7 States, foreground notifications | `HomeView`, `NotificationService` | Done |
| 2 Map tab: search, sort, refresh, 220 markers, size and z-order, labels, layers (Map, Satellite), key with counts, latest 30 | `ListScreens.swift` `MapScreen`, `MapViews.swift` | Done; political layer, NASA overlay and 3D globe not built (optional) |
| 3.1 Alerts | `AlertsView` | Done |
| 3.2 Collection views (events, recent, official warnings, alerts-notifications, hazard types, historical, compare, forecast list, calendar, resources) | `CollectionScreen`, `CalendarScreen`, `SourcesView` | Done; compare-places is the list view as on the site |
| 3.3 Calamities (now and past) | `CalamitiesView` | Done |
| 4 Forecasts tab (stats, horizon, filters, map, tiles, table phone fold, high alert, changes, how we make, ND-001) | `ForecastsView`, `ForecastTable` | Done |
| 4.1 Full forecast table, 4.2 calendar, 4.3 verification list | `CollectionScreen`, `CalendarGrid`, `VerificationListView` | Done |
| 5.1 Alerts panel, rules sentence, keeps, current location | `MyPlacesView` | Done (alerts are on-device, see owner note 3) |
| 5.2 Saved places form, chooser, country cleared on edit, cards with summary chip | `MyPlacesView`, `PlacesStore` | Done |
| 5.3 Dangers near your places, five bands, sorts, scope note, load error | `MyPlacesView` | Done |
| 6 Track record (answer box, key figures, honesty, backtest, published models, came true, missed, disasters table, ledger with filters and paging, comparison, full details, failure state) | `TrackRecordView`, `TrackRecord.swift`, `GradingEngine.swift` | Done; figures match the site (checked locally, CI re-checks) |
| 7.1 Event detail, 7.2 alert detail, 7.3 calamity detail (rule 8 applied), 7.4 forecast detail (ledger fallback, mechanism, checks matrix, 250 km circle) | `DetailScreens.swift` | Done |
| 7.5 Enrichment block, ten panels, failure and loading, 5-minute refresh, donations held back for forecasts | `Enrichment.swift`, `EnrichmentSection` | Done |
| 8.1 Regions, 8.2 region detail, 8.3 location detail (radius per level, circle) | `PlaceScreens.swift` | Done |
| 9 Hazard types and hazard detail | `CollectionScreen(.hazardTypes)`, `HazardDetailView` | Done |
| 10.1 Our sources, 10.2 source detail | `SourcesView`, `SourceDetailView` | Done |
| 11 History list and detail | `CalamitiesView`, `HistoryDetailView`, `History.swift` | Done |
| 12 Insights | `InsightsView` | Done; topic detail catalogue (`entity-detail.html`) not built (low priority in the spec) |
| 13 Methodology and About (live figures from `?summary=1`) | `MethodologyView`, `AboutView` | Done |
| 14 ND-001 verification detail | `VerificationDetailView` | Done (comparison table reduced to area, lives lost and missing) |
| 15.1 Trust note on every forecast and risk screen, agency links, data sources with live status, when line | `TrustNote` | Done |
| 15.2 Footer agencies with WMO members link | `FooterAgencies` | Done |
| 16.1 Capability states | `MyPlacesView` | Partial: on, off and blocked; the web-only states (install, unsupported) do not apply |
| 16.2 Foreground notifications, place rule and major-event rule, 6-hour de-dup | `AlertRules.swift`, `NotificationService` | Done |
| 16.3 Background checks (BGAppRefreshTask), tap routing to app routes only | `NotificationService` | Done; server push not built (owner note 3) |
| 17 Time zone setting, labels, zone named | `SettingsView`, `Format.swift`, `Trust.when` | Done |
| Accessibility: Dynamic Type, VoiceOver labels on badges and markers, 44 pt targets, contrast | throughout | Done; contrast assertions in UI tests not added |
| Share sheet on details | `ShareButton` | Done |
| App icon from `icons/icon-512.png` | `Assets.xcassets/AppIcon.appiconset` | Done (upscaled to 1024, flattened on #02110D) |
