# Client logic to port exactly (Swift and Kotlin)

Every rule here was read from the website source (branch `claude/website-audit-fixes`, commit `117201b`). Every
example was **produced by running that source**: the site scripts were loaded into jsdom with `Date.now()` fixed to
`2026-10-20T12:00:00Z`, page logic was cut out of the pages that hold it and run as it is, and the home, alerts and
ND-001 check pages were rendered whole with a fixed feed (`test/render.js`). The generator is committed as
**`tools/make-parity-vectors.js`** (`node tools/make-parity-vectors.js` rewrites the file; `--check` exits 1 when it
is stale), and `test/parity-vectors.test.js` fails the website's test suite when the file no longer matches the site.
Its output is **`docs/native-parity/test-vectors.json`**: `meta` plus 102 groups (the first spec's 66 groups, unchanged in
name, shape and content, plus 36 new ones for the audit fixes; features.md "Changelog"). Load that file in XCTest or
JUnit and assert equality. The JSON keys are given as **[vectors: key]** below; §11 indexes them.

Suggested module layout, shared by both platforms:

| Module | Ports | Section |
| --- | --- | --- |
| `RiskScale` | `risk.js`, plus `PND.riskTag`, `riskLabel`, `matchesRiskLevel` and `riskLevelOptions` from `portal.js` | §2 |
| `PlaceRisk` | `hazard-model.js riskRow` and geometry, plus `place-risk.js` | §3 |
| `PlaceSearch` | `place-search.js` | §3.5 |
| `AlertRules` | `alert-rules.js`, plus the major-event rule from `portal.js` | §4 |
| `HazardModel` | `hazard-model.js`: hazards, severity, key facts, lead time, classification | §5 |
| `Format` | `portal.js` text helpers | §6 |
| `Counts` | `portal.js` one-answer helpers: `observed`, `openForecasts`, `isHighAlert`, `isOfficialWarning`, `officialWarnings`, `sourcesReporting`, `countryCount`, `liveWord` | §6.11 |
| `Hazards` | `portal.js hazardKey`, `sameHazard` (on top of `HazardModel.hazardOf`) | §6.10 |
| `Places` | `continents.js` and `portal.js inPlace` | §6.12 |
| `ForecastTable` | `forecast-table.js` | §7 |
| `Sorts` | `PND.SORT_DEFS` and the per-screen extras | §8 |
| `Search` | `search.js`, plus `glossary.js expandAlways` | §9 |
| `TrackRecord` | `verdicts.js`, `verification-model.js` (`score` etc.) and `backtest-view.js` | §10 |

## 1. Conventions that every function relies on

- **Absent values.** JavaScript `Number(null)` and `Number('')` both give `0`. The site guards against this
  everywhere. The rule: a value is *published* only if it is not `undefined`, not `null`, not `""`, and (for numbers)
  finite. Model it as `Double?` and parse strings leniently: `"85.316"` parses to 85.316, `" "` parses to nil.
- **Dates.** `Date.parse` accepts ISO-8601 with `Z`, with offsets, and with or without milliseconds. An unparseable
  string gives NaN, and the site treats NaN as "absent". `timeOf` returns 0 for absent, which sorts as oldest.
- **Text comparison.** JavaScript `String.prototype.localeCompare` with the default locale (ICU root collation:
  case-insensitive at first, punctuation and spaces significant). Use `Collator.getInstance(Locale.ENGLISH)` on
  Kotlin, and `compare(_:options:[], range:nil, locale: Locale(identifier:"en"))` on Swift. The sort inputs are
  already lower-cased.
- **Sort stability.** `Array.prototype.sort` is stable. Use stable sorts (`sortedWith` in Kotlin and Swift
  `sorted(by:)` are both stable for these comparators; in Swift, wrap with an index tie-breaker if in doubt).
- **Number grouping.** `hazard-model.js group()` always groups with commas in threes (`120,000`). `impactText` and
  the detail pages use `Number.toLocaleString()`, which depends on the viewer's locale (en-IN would give
  `1,20,000`). **Native: always use en-US grouping (`1,234`)**, matching `group()` and the test vectors.
- **Now.** Functions that read "now" (`age`, `alertFor` liveness, `stateOf`, `windowClosed`, the `windowEnd` sort)
  must take an injectable clock.

---

## 2. Risk scale (`risk.js`, `risk.css`)

### 2.1 The six levels and Unknown

| key | label | colour (fill) | ink (text) | rank | shape | marker size (pt) |
| --- | --- | --- | --- | --- | --- | --- |
| LOW | Low | `#22C55E` | `#000000` | 1 | filled circle | 12 |
| WATCH | Watch | `#FACC15` | `#000000` | 2 | ring | 15 |
| MODERATE | Moderate | `#F97316` | `#000000` | 3 | triangle | 18 |
| HIGH | High | `#EF4444` | `#000000` | 4 | diamond | 21 |
| SEVERE | Severe | `#B91C1C` | `#FFFFFF` | 5 | hexagon | 24 |
| EXTREME | Extreme | `#7C3AED` | `#FFFFFF` | 6 | star (8-point, 4 long tips) | 27 |
| UNKNOWN | Not rated | none (transparent, 1px border `#2b624e`, text `--muted #91b4a6`) | none | 0 | hollow circle | 9 (marker fill `#8fa8a0`) |

Marker size is `9 + rank*3`. Map z-order is `rank*1000`, so higher levels draw on top. A marker's accessible name is
`"{label} - {LevelLabel} risk"`, or `"{LevelLabel} risk"` when it has no label. The shape polygons are in design.md §3.

### 2.2 `levelOf(value) -> key`

1. Convert to a string (`null` or `undefined` become `""`). If it is empty or whitespace, return **UNKNOWN**.
2. Test these case-insensitive, **whole-word** regexes **in order** and return the first that matches:

| order | key | regex |
| --- | --- | --- |
| 1 | EXTREME | `\b(?:extreme\|catastrophic\|very\s*high\|purple)\b` |
| 2 | SEVERE | `\b(?:severe\|critical)\b` |
| 3 | HIGH | `\b(?:high\|red\|significant)\b` |
| 4 | MODERATE | `\b(?:moderate\|orange)\b` |
| 5 | WATCH | `\b(?:watch\|advisory\|minor\|yellow\|amber\|elevated)\b` |
| 6 | LOW | `\b(?:low\|green\|informational\|routine\|normal)\b` |

3. Otherwise return **UNKNOWN**.

Word boundaries follow JavaScript `\b`, which is ASCII `[A-Za-z0-9_]`. In Kotlin, `Regex` with
`RegexOption.IGNORE_CASE` gives the same `\b`. In Swift, `NSRegularExpression` `\b` is Unicode-aware, which is
fine for these ASCII words. **[vectors: risk.levelOf]**, for example:

| in | out | in | out |
| --- | --- | --- | --- |
| `Red` | HIGH | `Orange` | MODERATE |
| `Green` | LOW | `Yellow` / `Amber` | WATCH |
| `Purple` | EXTREME | `very high`, `Very  High`, `VeryHigh` | EXTREME |
| `Critical` | SEVERE | `Significant` | HIGH |
| `Informational` | LOW | `Minor` | WATCH |
| `Severe Thunderstorm Warning` | SEVERE | `High surf advisory` | HIGH |
| `Moderate to severe` | SEVERE | `yellow-ish` | WATCH |
| `Greenish` | UNKNOWN | `Lowland` | UNKNOWN |
| `WARNING` (volcano level) | UNKNOWN | `""`, `null`, `Not rated`, `3` | UNKNOWN |

GDACS colours map to the swatch of the same name: Red to HIGH, Orange to MODERATE, Green to LOW. The top two
levels are reached only by impact words (Severe, Extreme, and so on).

### 2.3 Which level a record shows (`PND.riskTag`, `riskLabel`, `matchesRiskLevel`)

The badge for a record is resolved **once**, and the badge, the risk filter, `riskLabel` and the place-risk "own
level" all use the same rule:

```
sv = levelOf(e.severity); a = levelOf(e.alert)
level = sv != UNKNOWN ? sv : (a != UNKNOWN ? a : UNKNOWN)     // severity wins; alert only if no severity
```

- The badge text is the level label ("Severe"), **not** the provider's word.
- The accessibility label or tooltip names both inputs. Example:
  `"Severe on this site's six-level risk scale, from the alert level "Orange" published by GDACS and an assessed severity of "Severe". Where these differ the higher decides."`
  The "published by" agency is `shortSource(e.alertSource || e.source)`. The sentence "Where these differ…" is added
  only when both are known and differ.
- No level: text **"Not rated"**, title *"No alert level was published for this record and no severity has been assessed for it."*
- `riskLabel(e)` is the label or "Not rated". `matchesRiskLevel(e, "")` is always true. With key `UNKNOWN` it
  matches only records that resolve to UNKNOWN.

**[vectors: portal.riskLabel, portal.matchesRiskLevel, portal.riskTagHtml]**

| record | label |
| --- | --- |
| `{severity:"Severe", alert:"Orange"}` | Severe |
| `{alert:"Orange"}` | Moderate |
| `{severity:"Informational", alert:"Red"}` | **Low** (severity wins) |
| `{severity:"Moderate", alert:"High"}` | Moderate |
| `{}` | Not rated |

Filter options (`riskLevelOptions`), in order: Extreme, Severe, High, Moderate, Watch, Low, Not rated (value `UNKNOWN`).

Other places that use the raw scale:
- **Map markers**: `markerIcon(e.alert, e.title)`. Markers use **`alert` only**, not the severity resolution.
  **[vectors: risk.markerIcon]**
- **Forecast calendar bars** use `riskClass(e.alert)`, which is also alert only.
- **Severity chip** (`PND.severityBadge`) = `badge(e.severity, text: e.severity)`, with the SEVERITY meaning as its tooltip.
- **Event detail life-safety note** threshold: `rankOf(severity || alert) >= rank(HIGH)` (that is 4), or the record
  is an official warning.

### 2.4 Provenance badges (not on the scale)

`PND.provenance(e)`:
- `evidenceState=='forecast'`, or `!evidenceState && e.forecast` → `forecastKind=='frozen-benchmark' ? "TEST FORECAST" : "OUR FORECAST"`
- `evidenceState=='official-warning'` → `"OFFICIAL WARNING"`
- anything else → `"REPORTED EVENT"`

**[vectors: portal.provenance]**. Render these as neutral outlined pills (design.md §4.3).

---

## 3. Place risk (`hazard-model.js riskRow`, `place-risk.js`)

### 3.1 Geometry

- `distanceKm(aLat,aLon,bLat,bLon)` is the haversine formula with **R = 6371 km**:
  `x=(bLat-aLat)·π/180; y=(bLon-aLon)·π/180; z=sin²(x/2)+cos(aLat·π/180)·cos(bLat·π/180)·sin²(y/2); d=2R·asin(√z)`.
  **[vectors: hazards.distanceKm]**: Delhi to Mumbai = 1148.095, (0,0) to (0,1) = 111.195, across the antimeridian (10,179.5) to (10,−179.5) = 109.506.
  `portal.js PND.distanceKm` and `alerts-client` use the same formula.
- `geometryContains(g, lat, lon) -> Bool?`. Here `nil` means undecidable, and **nil is never read as outside**.
  - Returns nil if `g` is nil or lat or lon is not finite.
  - `Polygon`: rings are `[[lon,lat],…]`. The first ring is the outer ring and the rest are holes. A ring is valid
    when it has more than 2 points and its first element is an array. Any invalid ring makes the result nil. **Any
    ring with consecutive longitudes more than 180° apart (wraps the antimeridian) makes the result nil.** If the
    point is not in the outer ring, return false. If it is in any hole, return false. Otherwise return true.
  - Ray casting per ring (raw degrees): `inside` toggles for each edge (i,j) where `(yi>lat) != (yj>lat) && lon < (xj-xi)*(lat-yi)/(yj-yi)+xi`.
    A non-finite vertex makes the ring false.
  - `MultiPolygon`: return true if any part is true. Otherwise return nil if any part is nil, else false.
  - `GeometryCollection`: the same rule, applied recursively.
  - Any other type returns nil.
  **[vectors: hazards.geometryContains]**

### 3.2 `riskRow(e, place, radiusKm = 500) -> Row?`

`Row = {band: A|B|C|D, distanceKm: Double?, claimDistance: Bool, containment: Bool?, applicability: String, reason: e.proximityReason ?? ""}`

```
pLat,pLon = coord(place.lat), coord(place.lon); if either nil → return nil
eLat,eLon = coord(e.lat), coord(e.lon)
contains = geometryContains(e.geometry, pLat, pLon)
d        = (eLat,eLon both non-nil) ? distanceKm(pLat,pLon,eLat,eLon) : nil
near     = d != nil && d <= R
row(band, note, claim) = {band, d, claim, contains, note}

if e.isForecast || e.forecast:
    if contains == true  → C, FORECAST, false
    if contains == false → near ? D, OUTSIDE_FORECAST, false : nil
    if e.forecastScope == "country" && e.country non-empty:
        if countryMatches(place, e.country)            → C, COUNTRY_FORECAST, false
        if placeCountryKeys(place) not empty:
            if countryComparable(place)                → nil
            else near ? C, COUNTRY_UNRECOGNISED_PLACE, false : nil
        else near ? C, COUNTRY_UNKNOWN_PLACE, false : nil
    near ? C, FORECAST, (e.proximityEligible == true) : nil

if e.evidenceState == "official-warning":
    contains == true  → B, INSIDE_WARNING, false
    contains == false → near ? D, OUTSIDE_WARNING, false : nil
    else              → near ? B, UNDETERMINED, false : nil

contains == true                    → A, INSIDE_INCIDENT, false
e.proximityEligible && near         → A, "", true          // the only case where a distance may be shown
contains == false                   → near ? D, OUTSIDE_WARNING, false : nil
else                                → near ? D, AREA_LEVEL, false : nil
```

Applicability strings (`APPLICABILITY`, verbatim):

| key | text |
| --- | --- |
| INSIDE_INCIDENT | Your place is inside the reported affected area. |
| INSIDE_WARNING | Your place is inside the official warning area. |
| OUTSIDE_WARNING | Your place is outside the official warning area. |
| UNDETERMINED | This is a regional warning. We could not tell whether it covers your exact place. |
| FORECAST | This is a forecast of what may happen, not a report that something has happened. |
| OUTSIDE_FORECAST | Your place is outside the forecast area. |
| COUNTRY_FORECAST | This forecast covers the whole country your place is in, not one specific spot. |
| COUNTRY_UNKNOWN_PLACE | This forecast covers a whole country, but your saved place has no country recorded. Search for the place by name instead of entering coordinates, and we can check. |
| COUNTRY_UNRECOGNISED_PLACE | This forecast covers a whole country, but we could not recognise the country of your saved place. This can happen if you searched in another language. Search for the place by name again to fix it. |
| AREA_LEVEL | This report gives only the centre of an area, not an exact spot. We could not tell whether your place is inside the affected area. |

**Country matching**
- `countryKey(name)`: lower-case it, apply Unicode NFD, strip U+0300 to U+036F (combining marks), then keep only `[a-z]`.
  So "Viet Nam" and "Vietnam" both become `vietnam`.
- `countryFromCode(code)`: for a 2-letter code, take the English region display name (`Intl.DisplayNames(['en'],{type:'region'})`;
  `Locale(identifier:"en").localizedString(forRegionCode:)` on Swift, `Locale("", cc).getDisplayCountry(Locale.ENGLISH)`
  on Kotlin). Return nil when the name equals the code.
  **Platform name differences matter**. For example, ICU says "United States" and some platforms say "United States
  of America". Feed country names follow ICU English. Test the countries in the feed.
- `placeCountryKeys(place)` = `[countryKey(countryFromCode(place.countryCode))?, countryKey(place.country)?]` without duplicates.
- `countryMatches(place, name)` = `countryKey(name)` is non-empty and is in `placeCountryKeys`.
- `countryComparable(place)` is true if a code resolves. Otherwise, if `countryKey(place.country)` is empty, it is
  false. Otherwise it is true when the key is in the set of all English region names keyed (built from every AA..ZZ
  code). If that set is empty because the platform has no region data, it is true.

**[vectors: hazards.riskRow]** with fixtures `fixtures.places` and `fixtures.events`:

| event | place | result |
| --- | --- | --- |
| USGS quake 13.6 km away, `proximityEligible` | Kathmandu | A, 13.6 km, claimDistance true |
| GDACS flood (regional centroid) 2 km away | Kathmandu | **D**, AREA_LEVEL, claimDistance false |
| NWS warning with polygon containing the place | Phoenix | **B**, containment true, INSIDE_WARNING |
| NWS warning without geometry, 20.6 km | Phoenix | B, containment nil, UNDETERMINED |
| forecast, scope `event`, 6.3 km | Kathmandu | C, FORECAST |
| forecast, scope `country` Nepal | Kathmandu (NP) | C, COUNTRY_FORECAST |
| same | place without a country | C, COUNTRY_UNKNOWN_PLACE (near) |
| same | Phoenix (US) | nil |
| forecast, scope `country` United States, anchored in Florida, 2,884 km away | Phoenix (US) | **C** (distance ignored) |
| forecast, scope `country` Germany | `{country:"Deutschland", countryCode:""}` | C, COUNTRY_UNRECOGNISED_PLACE |
| same | `{country:"Deutschland", countryCode:"DE"}` | C, COUNTRY_FORECAST |
| any record more than 500 km away | | nil |

### 3.3 Bands (`RISK_BANDS`; My places shows all five, always in this order)

| key | title | blurb | empty text |
| --- | --- | --- | --- |
| A | Confirmed events nearby | Events an official agency has reported at an exact spot within 500 km of one of your places. | No reported event within 500 km of your places. |
| B | Official warnings for your places | Warnings in force now. Where the agency published the area a warning covers, we checked whether your place is inside it. | No official warning covers your places right now. |
| C | Forecasts | Our own estimates of what may happen next. They are not reports that something has happened, and they are not official warnings. | No forecast covers your places right now. |
| D | Wider-area reports | Reports that give only the centre of a large area, not an exact spot. They are listed because that centre is within range; your place may or may not be inside the affected area. | No wider-area report near your places right now. |
| E | Past disasters | What has happened at a place before. (`dataAvailable:false`) | We do not publish a history of past events for each place, so nothing can be shown here. Your national or regional disaster agency keeps the official record. |

### 3.4 `assess(place, events, meta) -> Assessment` and `actionsFor`

Constants: `NEAR_KM = 50`, `MODERATE_KM = 150`, `searchedKm = RISK_RADIUS_KM = 500`.

```
rows = events.compactMap { riskRow(e, place) → {e, r, d: r.distanceKm ?? ∞} }
       sorted by bandOrder(A<B<C<D<E) then d ascending                                   // rowsFor

ownLevel(e)  = levelOf(e.severity) != UNKNOWN ? that : (levelOf(e.alert) != UNKNOWN ? that : nil)
rank(k)      = k == nil ? 0 : LEVELS[k].rank
nearLevel(e, km):
    r = rank(ownLevel(e))
    km <= 50  → r >= rank(MODERATE) ? ownLevel : WATCH
    km <= 150 → r >= rank(HIGH) ? ownLevel : (r >= rank(MODERATE) ? WATCH : LOW)
    else      → r >= rank(HIGH) ? WATCH : LOW
atLeast(a, b) = the higher-ranked of the two non-nil keys (a wins ties)

insideWarning  = first row with band B and containment == true
insideIncident = first row with band A and containment == true
ranked = rows where band A and claimDistance and d finite,
         mapped to (x, nearLevel(x.e, x.d)), sorted by rank(level) desc then d asc
top = ranked.first; nearest = top?.x
outlook = first row with band C

if insideWarning:     lead=it; level=atLeast(HIGH, ownLevel(e));  why=WHY_INSIDE_WARNING
elif insideIncident:  lead=it; level=atLeast(MODERATE, ownLevel(e)); why=WHY_INSIDE_INCIDENT
elif top && top.x.d <= 150 && rank(top.level) > rank(LOW):
                      lead=nearest; level=top.level; why="An event was reported {round(d)} km from your place. That is the distance between two points. It does not mean the affected area reaches you."
elif outlook:         lead=outlook; level=WATCH; why=WHY_FORECAST
elif top:             lead=nearest; level=top.level
                      why = d <= 150 ? "A minor event was reported {round(d)} km from your place."
                                     : "The most serious event near your place is {round(d)} km away. We look up to 500 km away, so it is shown, but it is far from this place."
headline = level ? LEVELS[level].label : "Nothing reported nearby"
if level == nil:
    areaOnly = count of rows with band D
    why = "Nothing we track shows a danger at this place right now. " +
          (areaOnly>0 ? "{1 report|N reports} within 500 km give only the centre of a wider area, so we cannot tell whether this place is inside {it|them}. "
                      : "No event with an exact location has been reported within 500 km. ") +
          "This does not mean the place is safe. Your national and local disaster agencies have the official information."
```

- WHY_INSIDE_WARNING: *"Your place is inside the area covered by an official warning. We checked this against the warning area the agency published, not just the distance."*
- WHY_INSIDE_INCIDENT: *"Your place is inside the area reported as affected by this event."*
- WHY_FORECAST: *"One of our forecasts covers your place. It is our own estimate of what may happen. It is not a report that something has happened, and it is not an official warning."*
- `round` is JavaScript `Math.round`, which rounds half up (toward +∞). Swift's `.rounded()` rounds half away from
  zero, which is the same for positive distances.

`nearLevel` table, from **[vectors: placeRisk.nearLevel(table)]** (the record's own severity across rows, distance in km across columns):

| own severity | 10 | 50 | 100 | 150 | 151 | 300 | 500 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Informational (LOW) | WATCH | WATCH | LOW | LOW | LOW | LOW | LOW |
| Minor (WATCH) | WATCH | WATCH | LOW | LOW | LOW | LOW | LOW |
| Moderate | MODERATE | MODERATE | WATCH | WATCH | LOW | LOW | LOW |
| Severe | SEVERE | SEVERE | SEVERE | SEVERE | WATCH | WATCH | WATCH |
| Extreme | EXTREME | EXTREME | EXTREME | EXTREME | WATCH | WATCH | WATCH |

Note that a LOW nearLevel at ≤150 km does not pass the third branch (`> LOW`). It falls through to `outlook`, and
then to the final `top` branch, which reports LOW with "A minor event was reported…".

`actionsFor(A)`:
```
AUTHORITY = "Follow instructions from the issuing authority and local emergency services. Nothing on this page replaces official instructions."
if level == nil → steps = [
   "You do not need to do anything because of this page right now.",
   "For official information about this place, check your national or local disaster agency.",
   "Save the place so it is checked again each time you open this site."], official=false
official = lead.e.evidenceState == "official-warning"
step1 = official ? "An official warning covers this place. Read the warning (linked below) and follow it."
      : (level == WATCH && lead.r.band == C) ? "Nothing has happened yet. This is only our forecast, so check your official weather or disaster service before you act."
      : "Check whether your local authorities have given instructions for this place. This page shows what agencies publish. It does not receive local orders."
if level in {HIGH, SEVERE, EXTREME}: + "Do not travel into the affected area. Follow any evacuation or shelter instructions given locally."
                                     + "Keep following the official agency’s updates. Their instructions are the most current. This page is only as current as the last update shown."
else: + "Keep an eye on the source (linked below) and on your local agency, not only on this summary."
```

**[vectors: placeRisk.assess]** covers 11 scenarios, including these:
- no events: level nil, the "No event with an exact location…" text.
- only an area-level flood 2 km away: **level nil** (band D never produces a level), and "1 report within 500 km give only the centre…".
- a green M4.6 at 14 km: WATCH.
- adding an Extreme M7.1 at 35 km: EXTREME, lead usgs-2.
- a Severe quake at 115 km: SEVERE.
- an Extreme quake at 384 km: WATCH, with the "most serious event … far" text.
- a forecast at 6 km: WATCH via band C, with the forecast action step.
- inside an NWS polygon: SEVERE (at least HIGH), `official:true`.
- an NWS warning without geometry 20 km away: **level nil**. A band B row with undecidable containment does not
  produce a level, and the "why" text counts only band D rows. Port this as is.

**Before the feed loads** (changelog C26, `place-risk.js`):
```
feedState(loaded, failed) = loaded ? "loaded" : failed ? "failed" : "loading"
PENDING.loading = {headline: "Checking…", text: "Checking the latest reports for this place.",
                   lastChecked: "not yet: the data is still loading"}
PENDING.failed  = {headline: "Live data unavailable",
                   text: "We could not load the latest reports, so nothing can be shown here. This does not mean nothing is happening. Trying again automatically.",
                   lastChecked: "not yet: the latest data could not be loaded"}
PENDING_STEP    = "For official information about this place, check your national or local disaster agency."
```
`loaded` means a feed has loaded on this screen at least once; `failed` that the last attempt failed. Every place
answer (Home card, My places chip, place page line) calls `assess` only when the state is `loaded`, and shows
`PENDING[state]` otherwise. `"…"` is U+2026. **[vectors: home.placeAnswerStates]**

**My places summary chip** (`personal-risk.html summarise`): before the feed loads, `PENDING[state].headline`
upper-cased (`CHECKING…`, `LIVE DATA UNAVAILABLE`). When there is no level, `NOTHING REPORTED NEARBY`.
Otherwise `HEADLINE.uppercased()` followed by one of:
`" · inside an official warning area"` (lead band B), `" · inside a reported affected area"` (band A with
containment true), `" · a forecast covers it"` (band C), or `" · event {round(d)} km away"` when d is finite.

### 3.5 Place search (`place-search.js`)

- `levelOf(r)` reads `t = (r.addresstype || r.type).lowercased()` and checks these patterns in order:
  - Area: `^(neighbourhood|suburb|quarter|city_district|borough|locality|village|hamlet|isolated_dwelling|croft|allotments|city_block|residential|farm)$`
  - City or town: `^(city|town|municipality)$`
  - District: `^(county|district|state_district|subdistrict|district_council)$`
  - State or region: `^(state|province|region|territory)$`
  - Country: `^(country|nation)$`
  - Address or landmark: `^(road|house|house_number|building|amenity|shop|tourism|leisure|office|highway|railway|aeroway|man_made|historic|natural|place_of_worship|school|university|hospital|postcode)$`

  If none matches and `place_rank` is finite: ≤4 Country, ≤8 State or region, ≤12 District, ≤16 City or town,
  ≤25 Area, otherwise Address or landmark. If there is no rank: "Place".
- `labelOf(r)`: name = `r.name` or the first comma part of `display_name`; town = `city || town || village ||
  municipality || county`; state = `state || region || province`. The parts are `[name, town, state, country]`,
  trimmed, with case-insensitive duplicates removed, and joined with ", ". If the result is empty, use `display_name`.
- `candidates(results)`: drop results whose lat or lon is not finite. Map each to
  `{kind:"Searched", name: labelOf, full: display_name, level, lat, lon, country: address.country||"", countryCode: address.country_code.uppercased()}`.
  De-duplicate by `name.lowercased()+"|"+level`.
- **[vectors: placeSearch.levelOf, placeSearch.labelOf, placeSearch.candidates]**

### 3.6 Saved place model

`{id: "loc-{epochMs}" | "loc-current", kind: "Home"|"Office"|"Family"|"Travel"|"Current location"|"Place"|"My location", name, lat: Double, lon: Double, country: String, countryCode: String, updatedAt?: ISO}`

- Saved under the key `pnd_saved_locations` as a JSON array.
- `loc-current` is unique: it is replaced (and moved to the front) whenever the location changes. Its lat and lon
  are rounded to 2 decimals.
- The background-alert payload per place is `{kind, lat: roundCoord(lat), lon: roundCoord(lon)}`, taking the first
  10 places that have valid coordinates (§4).

---

## 4. Alert rules (`alert-rules.js`, used by the page and by `api/alerts-run.js`)

Constants: `NEAR_KM = 30`, `SEVERE_NEAR_KM = 100`, `RECENT_HOURS = 72`, `SEVERE = /red|orange|severe|extreme|catastrophic/i`
(a substring test, not whole-word).

`KIND_LABEL`: Home → "home", Office → "office", Family → "family place", Travel → "travel place", Current location →
"current location", anything else → "saved place". `placeLabel(place) = "your " + KIND_LABEL`.

```
live(e, now):
  false if e == nil || e.forecast || e.isForecast || e.cached || e.live == false
  if e.evidenceState == "official-warning": exp = parse(e.expiresAt); return exp == nil || exp > now
  latest = max(parse(updated)??0, parse(startedAt)??0, parse(issuedAt)??0)
  return latest > 0 && now - latest <= 72h

alertFor(e, place, now):
  if !live(e, now) → nil
  r = riskRow(e, place); if nil → nil
  level = String(e.alert || e.severity || "")       // the raw word, not levelOf
  what  = e.type || "Hazard"
  if r.band == B && r.containment == true → title = "{what} warning covers {placeLabel}",   rank = 3
  elif r.band == A && r.containment == true → title = "{what} reported where {placeLabel} is", rank = 3
  elif r.band == A && r.claimDistance && r.distanceKm != nil && r.distanceKm <= 100
       && (SEVERE.test(level) || r.distanceKm <= 30)
       → title = "{what} {max(1, round(d))} km from {placeLabel}", rank = 2 - d/1000
  else → nil
  return { key: "{id}|{band}|{level.lowercased()}", eventId: id, rank, title,
           body: "{e.title || what}" + (level ? " · {level}" : "") + (e.source ? " · {source}" : ""),
           url: urlFor(e), tag: "pnd-{id}" }

alertsFor(events, places, now): for each place and each event, keep the highest-ranked alert per eventId
  (a later alert replaces an earlier one only when its rank is strictly greater), then sort by rank descending.
roundCoord(v): nil for null, undefined or a blank string; otherwise Math.round(Number(v)*100)/100 if finite, else nil.
urlFor(e) is the same as PND.eventUrl (§6.6).
```

Forecasts never produce an alert. Areas or centroids (band D) never produce an alert. Band B without containment
never produces an alert.

**[vectors: alertRules.alertFor, alertRules.alertsFor, alertRules.roundCoord, alertRules.urlFor]**, for example:

| case | result |
| --- | --- |
| green M4.6 quake at 13.6 km | `"Earthquake 14 km from your home"`, key `usgs-1\|A\|green`, rank 1.98638 |
| Red M7.1 at 35.4 km | `"Earthquake 35 km from your home"`, url `/disasters/usgs-2` |
| Orange quake at 115 km | nil (more than 100 km) |
| NWS polygon containing Phoenix | `"Flood warning covers your home"`, rank 3, body `"Flash Flood Warning · Red · NOAA / National Weather Service"` |
| quake last updated 4 days ago | nil (not recent) |
| warning that has expired | nil |
| `cached` or `live:false` | nil |
| `alertsFor` with all of these | order: nws-1 (3), usgs-1 (1.986), usgs-2 (1.965) |

Notification de-duplication (foreground): `seen[key]` holds an epoch ms value, and the app notifies again only if
`now - seen[key] > 6h`. The **major-event rule** is in features.md §16.2 and must be ported with its exact title
precedence.

---

## 5. Hazard model (`hazard-model.js`)

### 5.1 `hazardOf(type)`

Exact key match first. Otherwise test the lower-cased type **in this order**:

1. `/aftershock/` → Earthquake aftershock sequence
2. `/earthquake|seismic/` → Earthquake
3. `/cyclone|hurricane|typhoon/` → Tropical Cyclone
4. `/tsunami/` → Tsunami
5. `/tornado/` → Tornado
6. `/flood/` and `/landslide|mudslide/` → Flood / Landslide
7. `/flood/` → Flood
8. `/landslide|mudslide/` → Landslide
9. `/wildfire|bushfire|forest fire/` → Wildfire
10. `/drought/` → Drought
11. `/volcan/` → Volcano
12. `/heat/` → Extreme Heat
13. `/cold|freeze|frost|winter/` → Extreme Cold
14. `/storm|thunder|hail|wind/` → Severe Storm
15. otherwise DEFAULT

Note that "Snow" and "Ice" map to DEFAULT. **[vectors: hazards.hazardOf.name]**

| key | display name | onset | forecastable | horizon h |
| --- | --- | --- | --- | --- |
| Earthquake | Earthquake | sudden | **false** | 0 → horizonHours falls back to 72 |
| Earthquake aftershock sequence | Aftershock sequence | rapid | true | 168 |
| Tropical Cyclone | Tropical cyclone | rapid | true | 120 |
| Flood | Flood | rapid | true | 72 |
| Flood / Landslide | Flood and landslide | rapid | true | 96 |
| Landslide | Landslide | rapid | true | 72 |
| Wildfire | Wildfire | rapid | true | 72 |
| Drought | Drought | slow | true | 720 |
| Volcano | Volcanic activity | rapid | true | 168 |
| Extreme Heat | Extreme heat | rapid | true | 120 |
| Extreme Cold | Extreme cold | rapid | true | 120 |
| Severe Storm | Severe storm | rapid | true | 48 |
| Tornado | Tornado | sudden | true | 24 |
| Tsunami | Tsunami | sudden | true | 24 |
| DEFAULT | Natural hazard | rapid | true | 72 |

Each entry also has the strings `definition`, `duration`, `severityBasis` and `leadTime`. Copy them verbatim from
`hazard-model.js` lines 31 to 183 (`HAZARDS` and `DEFAULT`). They are shown on hazard detail and forecast detail.
**[vectors: hazards.horizonHours]**

### 5.2 Severity (computed by the server; port it for the ledger and offline use)

`severityOf(e) = BY_RANK[max(impactRank(e), alertRank(e), 1)]`, where the ranks map 1 to 5 onto Informational,
Minor, Moderate, Severe and Extreme.

- `impactRank`: let d = deaths, a = affected, p = displaced, with missing values counted as 0.
  - `d>=100 || a>=1,000,000 || p>=100,000` → 5
  - `d>=10 || a>=100,000 || p>=10,000` → 4
  - `d>=1 || a>=10,000 || p>=1,000` → 3
  - `a>0 || p>0` → 2
  - otherwise 0
- `alertRank`:
  - `pagerAlert`: red 5, orange 4, yellow 3.
  - wind from `windKt` (when > 0): ≥113 → 5, ≥96 → 4, ≥64 → 3, else 2.
  - `alert`: Red 4, Orange 3, **High 3, Moderate 2, Watch 1** (the forecast vocabulary is one step down).
  - If any of these is non-zero, return the max of them. Else, if `magnitude > 0`, return 1. Else 0.

SEVERITY meanings (chip tooltips): Informational *"A detection or observation with no impact assessment attached. Most of the feed by volume."*,
Minor *"Impact expected to stay limited and local."*, Moderate *"Localised damage, disruption or displacement; casualties possible."*,
Severe *"Significant casualties, damage or displacement across a region."*, Extreme *"Mass casualties or national-scale impact expected or already observed."*

**[vectors: hazards.severityOf]** has 28 cases. For example: `{alert:"Green", deaths:42}` gives Severe;
`{windKt:50, alert:"Red"}` gives Severe; `{deaths:null, affected:"", displaced:"0"}` gives Informational.

### 5.3 Key facts (`keyFacts(e)` → `[{key, label, reported, value, note?}]`)

Metrics are listed in order for each hazard (resolved via `hazardOf`), and each list is followed by
`IMPACT = deaths, injuries, missing, displaced, evacuated, affected`:

| hazard | own metrics |
| --- | --- |
| Earthquake | magnitude, depthKm, pagerAlert, tsunamiFlag |
| Earthquake aftershock sequence | mainshockMagnitude |
| Tropical Cyclone | windKt, category, pressureMb, movement |
| Wildfire | areaHa |
| Volcano | alertLevel, aviationColour |
| Flood, Flood / Landslide, Landslide, Drought, Extreme Heat, Extreme Cold, Severe Storm, Tornado, Tsunami | none |
| DEFAULT (unmodelled type) | IMPACT only |

Labels: Magnitude, Mainshock magnitude, Depth, USGS impact alert, Tsunami flag, Maximum sustained wind, Category,
Minimum central pressure, Moving, Area burned, Observatory alert level, Aviation colour code, Lives lost, Injured,
Missing or unaccounted for, People displaced, People evacuated, People affected.

Formatting. `has` means not undefined, null or `""`.

| key | reported when | value | note when not reported |
| --- | --- | --- | --- |
| magnitude, mainshockMagnitude | has | `toFixed(1)` ("6.5", "5.0") | |
| depthKm | has | `round(v) + " km"` | |
| pagerAlert | has | lower-cased | USGS issued no impact assessment for this earthquake |
| tsunamiFlag | has | `v ? "Raised" : "Not raised"` | Only the United States Geological Survey publishes a tsunami flag |
| windKt | has | integer: `"105 kt"`; otherwise one decimal: `"64.4 kt"`, `"63.8 kt"` | |
| category | `cycloneCategory(windKt) != nil` | see below | |
| pressureMb | has, finite, and > 0 | `group(v) + " mb"` | This source publishes no central pressure for this system |
| movement | the compass point is published | `"{point}"`, or `"{point} at {round(kt)} kt"` when `movementKt` is published and ≥ 0 | This source publishes no track for this system |
| areaHa | finite and > 0 | below 100 ha: `group(ha)+" ha"`; below 100 km²: `round(km*10)/10 + " km²"`; otherwise `group(km)+" km²"` (km = ha/100) | |
| aviationColour | has | the string | This source publishes no aviation colour code for this volcano |
| alertLevel | truthy | the string | This source publishes no observatory alert level for this volcano |
| any impact count | has and finite | `group(v)` (a reported `0` gives `"0"`) | |

- `cycloneCategory(kt)`: ≤0 or invalid gives nil; ≥137 "Category 5"; ≥113 "Category 4"; ≥96 "Category 3"; ≥83
  "Category 2"; ≥64 "Category 1"; ≥34 "Tropical storm"; otherwise "Tropical depression". **[vectors: hazards.cycloneCategory]**
- Compass: `COMPASS[round(((deg % 360)+360)%360 / 22.5) % 16]`, with points north, north-north-east, north-east,
  east-north-east, east, east-south-east, south-east, south-south-east, south, south-south-west, south-west,
  west-south-west, west, west-north-west, north-west, north-north-west. For example, 315° is "north-west".
- `group(n)`: round to an integer, then insert commas every 3 digits.
- The detail screens show the grid: a reported fact shows its value, and an unreported one shows **"Not reported"**
  in the muted style, with the note as its accessibility hint.
- `keyFactsLine(e, max=3)`: take the reported facts only, first `max`, and join with " · ". Each item is
  `"{label} {value}"`, except that the value alone is printed for `category`, or when the value already starts with
  the label (case-insensitive).
  **[vectors: hazards.keyFacts, portal.keyFactsLine]**, for example `"Maximum sustained wind 105 kt · Category 3 · Minimum central pressure 948 mb"`.

### 5.4 Lead time

`leadTimeHours(e)` is nil unless `e.forecast`. It is `round1((parse(targetStart) - parse(issuedAt || updated)) / 3600000)`,
or nil if either date is invalid.

`leadTimeText`:
- h < 0: `"Made {n} hour(s) after the forecast period began, so it gave no advance warning."`
- h == 0: `"No advance warning. This forecast began when it was made, so it describes something already under way."`
- h < 48: `"Made {round(h)} hour(s) before the forecast period begins."`
- otherwise: `"Made {round(h/24)} day(s) before the forecast period begins."`

Here `n` is `round(|h|)`, and the unit takes no "s" when the rounded value is 1. **[vectors: hazards.leadTimeText]**

### 5.5 Forecast classification (`classifyForecast(f, parent)`)

```
if !(f.forecast || f.isForecast) → nil
frozen-benchmark    → retrospective-benchmark
aftershock-sequence → post-event-conditional
if f.forecastOf:
   parentState = parent?.evidenceState ?? (WARNING_PROVIDERS.test(f.source) ? "official-warning" : nil)
   → parentState == "official-warning" ? warning-derived : continuation-outlook
freeze = parse(f.freezeTimestamp); start = parse(f.targetStart)
freeze == nil || f.freezeEvidenced == false → invalid-post-event
start == nil → invalid-post-event
freeze > start → invalid-post-event
else → independent-prospective
WARNING_PROVIDERS = /(?:National Weather Service|Volcano Hazards Program)/i
```

The reasons are verbatim strings. **[vectors: hazards.classifyForecast]**

---

## 6. Formatting helpers (`portal.js`)

### 6.1 `placeOf(e, fallback = "")`
```
tidy(v) = String(v ?? "") with trailing [\s,;]+ removed, then trimmed
if tidy(e.place) non-empty → return it
t = tidy(e.title).lowercased(); c = tidy(e.country); r = tidy(e.region)
if r == t || r matches /^(flood|drought|wildfire|forest fires?|earthquake|volcano|tropical cyclone)\b.*\bin\b/i || r matches /^tropical cyclone\s/i → r = ""
if r && c && !r.lowercased().contains(c.lowercased()) → "{r}, {c}"
return r || c || fallback
```
**[vectors: portal.placeOf]**

### 6.2 `titleOf(e)`
- `^(\d+)-(day|hour) (.+?) risk outlook - (.+)$` becomes `"{3} risk in {4} - {1}-{2} forecast"`.
  For example, "3-day Flood risk outlook - Nepal" becomes "Flood risk in Nepal - 3-day forecast".
- `^Aftershock-sequence outlook - (.+)$` becomes `"Aftershock risk " + (startsWithDigit ? "" : "near ") + "{1} - 7-day forecast"`.
- Otherwise the title is returned unchanged; `""` when there is none. **[vectors: portal.titleOf]**

### 6.3 `shortSource(name)` (pill text; the full name is the accessibility label)
1. Empty → "Source not stated".
2. Exact table: `NOAA / National Weather Service` → NOAA/NWS, `NOAA National Weather Service` → NOAA/NWS,
   `NOAA National Hurricane Center` → NOAA/NHC, `National Weather Service` → NWS, `National Hurricane Center` → NHC,
   `USGS Volcano Hazards Program` → USGS Volcano, `USGS verified recent snapshot` → USGS (verified),
   `GDACS verified snapshot` → GDACS (verified), `ReliefWeb (UN OCHA)` → ReliefWeb, `Predict Natural Disasters` → This site.
3. `^(.*?)\s*[·|]\s*derived from\s+(.*)$` (case-insensitive) → `clip("Derived · " + shortSource($2))`.
4. A trailing `\(([A-Z][A-Za-z0-9/&. -]{1,24})\)\s*$` → the text inside the brackets.
5. Split on `\s*/\s*`. If there is more than one part and the first part has at most 12 characters → the first part.
6. Otherwise `clip(s)`, where `clip` keeps up to 28 characters; if longer, take the first 27, strip trailing
   `[\s,;:.·-]+`, and append "…".

**[vectors: portal.shortSource]**. "Predict Natural Disasters · forecast model" gives "Predict Natural Disasters…".

### 6.4 Dates in the chosen timezone
- `fmtDate(v)`: `"-"` when empty. Returns the input unchanged when it cannot be parsed. Otherwise
  **`dd MMM yyyy, h:mm AM|PM {tzLabel}`**. The day is 2-digit and zero-padded, the hour is not padded, and the
  minutes are 2-digit. Month abbreviations are fixed, following CLDR en-IN: **Jan Feb Mar Apr May Jun Jul Aug Sept
  Oct Nov Dec** (note "Sept"). Hard-code them; do not rely on platform locale data.
  Examples: `"20 Oct 2026, 4:54 PM IST"`, `"05 Jan 2026, 11:35 PM IST"`, `"20 Oct 2026, 12:00 AM UTC"`.
- `fmtTime(v)`: `"h:mm AM|PM {tzLabel}"`.
- `tzLabel(tz, at)` (changelog C27): Asia/Kolkata → IST, UTC → UTC, America/New_York → ET, America/Los_Angeles → PT,
  Europe/London → UK, Asia/Dubai → GST, Asia/Singapore → SGT, Asia/Tokyo → JST, Australia/Sydney → Sydney. Any other
  zone: the `timeZoneName` part of `Intl.DateTimeFormat('en-US', {timeZone: tz, timeZoneName: 'short'})` at the moment
  `at` (the time being formatted; now when omitted). That is the en-US short name where CLDR has one ("CDT", "CST",
  "MST", "EDT") and otherwise `GMT±H` or `GMT±H:MM` with no leading zero ("GMT-3", "GMT+5:45", "GMT+11"; "GMT" alone at
  offset 0). When the platform gives nothing: `local time`. Never the IANA id. `fmtDate` and `fmtTime` pass their own
  date as `at`, so a DST zone is labelled for that date (Europe/Paris "GMT+2" on 20 Oct, "GMT+1" on 5 Jan).
  Native: ICU via `TimeZone.abbreviation(for:)`/`DateFormatter` with `en_US_POSIX` "zzz" (Swift) or
  `DateTimeFormatter.ofPattern("zzz", Locale.US)` (Kotlin) give the same short names; check them against the vectors and
  turn any "GMT-03:00" form into "GMT-3".
- `tzMenuLabel(tz, at)`: the time zone menu's text for the chosen zone. `India (IST)` for Asia/Kolkata (features.md C36); otherwise
  `{tzLabel} · {city}` where city is the last `/` segment with `_` as space, or just `tzLabel` when there is no city,
  the city equals the label (UTC), or the zone starts `Etc/` or `SystemV/`. Other menu options stay IANA ids.
  **[vectors: portal.zoneLabel]** (`{in:{tz, at}, out:{label, fmtDate, fmtTime, menuLabel}}`)
- The chosen zone (`PND.timezone`) is the stored `pnd_timezone`, else the device zone, else Asia/Kolkata (§6.13).
  The trust note's times use this same `fmtDate`, so one screen shows one zone.
- **[vectors: portal.fmtDate, portal.fmtTime]** cover 5 timezones each.

### 6.5 `fmtWhen(v, other?, role?)` (forecast window edges)
```
edge(x) = x matches ^(\d{4})-(\d\d)-(\d\d)T(00:00:00|23:59:59)(\.0+|\.9+)?Z$ → {t: UTC midnight of that date, last: time=="23:59:59"}
m = edge(v); if m == nil OR (other != nil && edge(other) == nil) → fmtDate(v)
day = (m.last || role != "end") ? m.t : m.t - 1 day
return "dd MMM yyyy" of day in **UTC** (no time, no zone)
```
A whole-day edge is the same calendar day for everyone. A midnight `end` excludes its own day. If the other edge is
a real moment, the value is formatted as a moment. **[vectors: portal.fmtWhen]**, for example
`fmtWhen("2026-11-19T00:00:00Z", nil, "end")` gives `"18 Nov 2026"`, and `("2026-10-20T00:00:00Z","2026-10-23T11:24:19Z")`
gives `"20 Oct 2026, 5:30 AM IST"`.

### 6.6 URLs and lookup
- `eventUrl(e)`: forecast → `/forecasts/{id}`; otherwise `/disasters/{id}`, whatever the alert level (features.md
  C34; `/alerts/{id}` and `/calamities/{id}` still open and name it canonical). The id is encoded with `encodeURIComponent` (a space becomes `%20`,
  `/` becomes `%2F`). On native, map these to screen routes. **[vectors: portal.eventUrl]**
- `findEvent(events, id)`:
  1. exact id, then the percent-decoded id;
  2. `norm(id)` equality, where `norm` lower-cases and keeps only `[a-z0-9]`;
  3. `norm(title) == norm(id)`;
  4. suffix match, where `norm(e.id)` ends with `norm(id)` or the other way round;
  5. otherwise nil.
  **[vectors: portal.findEvent]**, for example "1104999" resolves to `gdacs-FL-1104999`.

### 6.7 Relative and duration text
- `age(v)`: `"unknown"` when empty. `m = max(0, round((now - t)/60000))`. Then: m < 1 → "just now"; m < 60 →
  "{m} min ago"; m < 1440 → "{round(m/60)} hr ago"; otherwise "{round(m/1440)} d ago". A future time gives "just now".
  **[vectors: portal.age]**
- `duration(from, to)`: `""` unless both are valid and `to > from`. Below 1 hour: "under an hour". With
  `h = round(hours)`: h < 48 → "{h} hour(s)"; otherwise "{round(h/24)} day(s)". **[vectors: portal.duration]**
- `windowText(e)`: `start = targetStart || startedAt || updated`. With no start: "The source gives no start time".
  Otherwise `"Starts " + fmtWhen(start, e.targetEnd) + (dur ? " · lasts {dur}" : " · length not stated")`.
  **[vectors: portal.windowText]**, for example "Starts 13 Sept 2026 · lasts 4 days".

### 6.8 Status, counts, summaries
- `statusText(meta)`: nil → "Refreshing". When `meta.live` → "Live · {ok} of {total} sources working". Otherwise →
  "Our data sources are not answering · showing saved copies only".
- `sourcesRatio(meta)` → "{ok}/{total}", for example "2/3" or "0/0".
- `countryCount(list)`: split each `country` on ",", trim each part, drop empties, lower-case, and count distinct
  values. Every screen that states a number of countries uses it (Home, Alerts, Regions, Hazard detail, and the
  `emptyHtml` "nothing matches" line through `PNDSearch.countryCount`, which is the same function).
  **[vectors: portal.countryCount, search.countryCount]**
- `impactText(e)`: the non-zero (truthy) deaths, displaced and affected, formatted as "{n} deaths · {n} displaced ·
  {n} affected" with en-US grouping. Note that this one uses truthiness, so a 0 is omitted. That is acceptable for
  a card line.
- `summary(text, max=160)`: remove the trailing boilerplate (`This is not a deterministic prediction and must not
  replace official warnings` or `This is our own estimate, not an official warning`, with an optional "."). Collapse
  whitespace. Take the first sentence, matching `^.{20,}?[.!?](?=\s+[A-Z(]|$)`. If it is longer than max, cut at the
  last space before max (but not before 60% of max), strip trailing `[\s,;:· em dash, hyphen]+`, and append "…".
- `quietNote(e)`: only when `live == false`: `"Not updated by {source||'its source'} for {d} day(s). It may have ended; check the source for its current status."`,
  or "for some time" when `quietDays` is not finite.
- `horizonText(meta)`: no horizon → "There are no open forecasts right now." Otherwise:
  `"Our forecasts reach as far as {fmtWhen(furthest,nil,'end')} ({ahead} from now). Each one covers {lens} days. We do not forecast further ahead than that. It does not mean nothing will happen after that date."`
  - `ahead` = `round(d)+" day(s)"` when d ≥ 1, else "less than a day".
  - `lens` = the list joined as "1, 2, 3 or 30", with "day" singular only when the list is `[1]`.
  - The ". Each one covers …" clause is omitted when the list is empty.
  **[vectors: portal.horizonText]**
- `hazardOptions`: see features.md §0.3. **[vectors: portal.hazardOptions]**
- `emptyHtml`: see features.md §0.3. In the "nothing matches" variant, N is the number of `all` records with
  `live !== false` and not `forecast`, and C is `countryCount` of those. **[vectors: search.emptyHtml,
  search.emptyHtml.counts]**

### 6.9 Forecast changes (`changesHtml(meta)`)
```
c = meta.forecastChanges
nil → "No changes have been recorded yet."
when = fmtDate(c.at) + " · " + age(c.at)
c.baseline → "First check, {when}. {activeOutlooks} forecasts are open. There is nothing earlier to compare them with yet."
gap = sinceHours > 0 ? " ({<1h: round(h*60)+' minutes' | h==1: '1 hour' | h+' hours'} after the check before)" : ""
un = c.unavailable
if total == 0 && un == 0 → "Checked {when}{gap}. None of the {activeOutlooks} open forecasts changed their risk level, dates or status."
headline = total ? "{total} change(s) across {activeOutlooks} open forecasts" : "no changes across {activeOutlooks} open forecasts"
caveat = un ? ", and {un} that could not be checked" : ""
"Checked {when}{gap} · {headline}{caveat}."
then sections (each at most 8 rows, then "…and N more"):
  New ({n})                 → "{titleOf(x)} - {x.alert}"
  Raised / Lowered          → "{titleOf(x)} - {x.from} → {x.to}"
  Dates changed             → "{titleOf(x)} - now ends {fmtWhen(x.toEnd,nil,'end')}"
  Stopped                   → "{titleOf(x)} - the event it followed is no longer reported"
  Ended on schedule         → "{titleOf(x)} - its forecast period ended"
  Could not be checked      → "{titleOf(x)} - we could not reach its source this time, so it is unchanged, not withdrawn"
```
Note that `sinceHours` is printed raw (for example "5.24 hours").

### 6.10 Hazard identity: `hazardKey(t)` and `sameHazard(a, b)`
```
hazardKey(t):
  s = String(t ?? "").trimmed()
  h = hazardOf(s)                            // §5.1
  if h is not DEFAULT → return the HAZARDS key whose entry is h     // "Volcanic Eruption" → "Volcano"
  return s                                   // unknown types are only themselves: "Ice", "Special Marine Warning"
sameHazard(a, b) = hazardKey(a).lowercased() == hazardKey(b).lowercased()
```
This replaces the first-word stem match (`type.toLowerCase().includes(stem)`, with "wildfire" → "wild" and "volcano"
→ "volcan") that the home strip, the home map filter and hazard detail used: under it "Extreme Cold" matched every
"Extreme Heat" record and an unknown type fell back to Flood. Used by: the home map filter, the home strip (grouping
reports by key), hazard detail (`fillHazards` and the match). Note the consequences of `hazardOf`'s order:
"Winter storm" is Extreme Cold (cold before storm), "Severe Thunderstorm Warning" is Severe Storm, "Earthquake
aftershock sequence" is its own key (not Earthquake), "Flood / Landslide" is its own key (not Flood).
**[vectors: portal.hazardKey, portal.sameHazard, hazardDetail.fillHazards, hazardDetail.select, home.render]**

### 6.11 One answer per quantity (`portal.js`)
Each quantity the site states on more than one screen comes from one helper. Use these everywhere; never re-derive.
```
observed(list)        = list.filter(e => e && e.live !== false && !e.forecast)            // "reports"
openForecasts(list)   = list.filter(e => e && e.live !== false && e.forecast && !e.windowClosed)
isHighAlert(e)        = e && !e.forecast && e.alert in ["Red","Orange","High"]           // exact case
isOfficialWarning(e):
  if !e || e.forecast → false
  s = e.evidenceState
  return s ? (s == "official-warning") : (e.sourceType == "official" && e.expiresAt is truthy)
officialWarnings(list) = list.filter(e => e && e.live !== false && isOfficialWarning(e))
sourcesReporting(list) = count of distinct truthy e.source
liveWord(e) = !e ? "-" : e.cached ? "Saved copy" : e.forecast ? "Our forecast"
            : e.live === false ? "Not updated recently" : "Live"
WARNING_MEANING = "Warnings and watches issued by agencies and in force now. Reports of disasters that already happened are not counted."
```
`isOfficialWarning` replaces two older rules: "official and alert Red or Orange" (home tile and table) and "official
and (Red or Orange, or `source == 'USGS'`)" (official-warnings and alerts-notifications lists). Note that an empty
`evidenceState` (`""`) falls through to the `expiresAt` rule, and that `observed`/`openForecasts`/`officialWarnings`
drop `live === false` but `isOfficialWarning`/`isHighAlert` do not look at it.
Where each is used: features.md §1.3, §1.6, §3.2, §4, §7, §8, §9.2. **[vectors: portal.observed,
portal.openForecasts, portal.isHighAlert, portal.isOfficialWarning, portal.officialWarnings, portal.WARNING_MEANING,
portal.sourcesReporting, portal.liveWord, detail.statusWords, collection.keep]**

`collection.js keep(e)` per view: official-warnings and alerts-notifications → `isOfficialWarning(e)`;
forecast-list and forecast-calendar → `e.forecast === true`; recent-events → `e.sourceType === 'official'`; every
other view → true. With `?region=X` (X not "world", any case) the kept list is further filtered by `inPlace(e, X)`
(`scoped()`). The status count for the forecast views is `"{N} forecasts: {openForecasts(scoped).length} open,
{rest} ended"`; other views give `"{N-fc} {noun} · {fc} forecasts"` when they mix the two, else `"{N} {noun}"`, with
the noun singular (trailing "s" dropped) for 1.

### 6.12 Place membership: `continents.js` and `inPlace(e, q)`
```
CONTINENTS = { Africa: [...], Asia: [...], Europe: [...], North America: [...], South America: [...],
               Oceania: [...], Antarctica: [...] }          // copy the name lists verbatim from continents.js
NAMES = ["Africa","Asia","Europe","North America","South America","Oceania","Antarctica"]
BY_COUNTRY[name.lowercased()] = every continent whose list holds that name   // Russia, Russian Federation,
                                                                             // Turkey, Türkiye, Turkiye, Georgia,
                                                                             // Armenia, Azerbaijan, Kazakhstan,
                                                                             // Cyprus, N. Cyprus and Northern
                                                                             // Cyprus are in Asia and Europe
continentNamed(name) = the NAMES entry equal to String(name).trimmed() ignoring case, else ""   // no URL decoding
countriesOf(e) = (e.countries if a non-empty array, else []) + e.country split on ",", trimmed, empties dropped,
                 then each with a trailing /\s+region$/i removed ("New Zealand region" → "New Zealand")
continentsOf(e) = distinct continents of BY_COUNTRY[c.lowercased()] for c in countriesOf(e), in that order
                  ([] for a record at sea or with no country; the title is never read)
onContinent(e, name) = continentNamed(name) != "" && continentsOf(e) contains it
inPlace(e, q):
  if continentNamed(q) != "" → onContinent(e, q)
  t = String(q).lowercased().trimmed()
  return matchesPlace(e, t) || (e.countries is an array && some country lower-cased contains t)
```
The lists include the Natural Earth outline names (`Dem. Rep. Congo`, `Bosnia and Herz.`, `Solomon Is.`), provider
spellings (`DR Congo`, `Viet Nam`, `México`, `MX`, `US`, `USA`, `UK`, `UAE`) and territories. Note that `inPlace(e, "")`
is true (an empty substring matches) and `inPlace(e, "World")` is a plain text match (false for most records); the
screens handle "World" before calling it. Region detail: `World` → everything; a continent → `onContinent`; anything
else → `[country, region, title, details].join(' ')` contains the name (features.md §8.2). Hazard detail's region box
and the `?region=` list scope use `inPlace`.
**[vectors: continents.NAMES, continents.continentNamed, continents.continentsOf, continents.onContinent,
portal.inPlace, regionDetail.matches, fixtures.places.continents]**

### 6.13 Default time zone (`PND.timezone`)
```
timezone = storage["pnd_timezone"]
        ?? (try Intl.DateTimeFormat().resolvedOptions().timeZone, if it is a non-empty string)
        ?? "Asia/Kolkata"          // also when reading the device zone throws
```
Native: `TimeZone.current.identifier` (Swift) / `ZoneId.systemDefault().id` (Kotlin) for the device zone.
**[vectors: portal.timezoneDefault]** (input `[stored, browserZone]`; `browserZone` `"throws"` means the lookup throws).

---

## 7. Forecast table columns (`forecast-table.js`)

| column key | header | cell |
| --- | --- | --- |
| Risk | Risk | `riskTag(e)` |
| Forecast | Forecast | **link** with bold `titleOf(e)` |
| Geography | Place | `[region, country].join(" · ")`, or "Global"; clamp to 3 lines |
| Hazard | Hazard | `type`, or "-" |
| Starts | Starts | `fmtWhen(targetStart, targetEnd)`, or "-" |
| Ends | Ends | `fmtWhen(targetEnd, targetStart, "end")`, or "-" |
| Class | Kind of forecast | `FORECAST_CLASSES[forecastClass].label`, or the raw class, or "Not recorded" (the tooltip is the definition, or "We did not record what kind of forecast this is.") |
| Provenance | What it is | pill: not a forecast → "Official report"; frozen-benchmark → "Test case"; has `forecastOf` → "Our estimate"; otherwise "Our own estimate" |
| Source | Source | `"Predict Natural Disasters · derived from X"` becomes `"From X"`; otherwise the full source |
| Updated | Updated | `age(updated)` (tooltip `fmtDate`) |
| *(phone only)* Window | Dates | `targetStart || targetEnd ? windowText(e) : "No dates recorded"` |
| *(phone only)* Status | Status | not a forecast → "Reported event"; `windowClosed` → "Ended"; otherwise "Active" |

On a phone (narrow screen) Starts, Ends, Provenance, Source and Updated are hidden, and Window and Status are shown.

Forecast class labels and definitions:

| class | label | definition | counts toward the headline |
| --- | --- | --- | --- |
| independent-prospective | Made in advance | Recorded before the event it forecasts had started. | **yes** |
| warning-derived | Based on an official warning | Made from an official warning that had already been issued. | no |
| continuation-outlook | Follows an ongoing event | Made after the event had started. It forecasts that the event will continue or get worse. | no |
| post-event-conditional | After an earthquake | Made after an event that has already happened, such as aftershocks following a large earthquake. | no |
| retrospective-benchmark | Test case, not made in advance | A test of the method, written after the period it covers had started. | no |
| invalid-post-event | Not valid: no proof it came first | Presented as made in advance, but nothing shows it existed before the period it covers. | no |

---

## 8. Sorting (`PND.SORT_DEFS`)

Helpers:
- `rankOf(e)` = `severityRank` if it is finite and > 0. Otherwise `RISK_RANK[alert.lowercased()]`, where RISK_RANK =
  red 5, critical 5, orange 4, high 4, veryhigh 4, moderate 3, watch 2, green 1, low 1. Otherwise 0. Note that
  "severe" is not in the table, so an alert of "Severe" with no severityRank gives 0.
- `timeOf(e)` = `parse(updated || targetStart || startedAt)`, or 0. The fields are tried with **JavaScript `||`
  semantics**: an empty string falls through to the next.
- `numOf(v)` = the finite number, or 0.
- `textOf(e, ...keys)` = the first key whose value is truthy, passed through **`glossary.expandAlways`** (§9.2) and
  lower-cased. When no key has a value, return `"￿"`, so missing values sort last.

| key | label | comparator (a before b when negative) |
| --- | --- | --- |
| severity | Most serious first | `rankOf(b)-rankOf(a)`, then `timeOf(b)-timeOf(a)` |
| newest | Newest first | `timeOf(b)-timeOf(a)` |
| oldest | Oldest first | `timeOf(a)-timeOf(b)` |
| deaths | Most deaths first | `deaths` desc, then newest |
| affected | Most people affected first | `affected` desc, then `displaced` desc, then newest |
| country | Place (A to Z) | `textOf('place','country','region')` A to Z, then newest |
| type | Type of hazard (A to Z) | `textOf('type')` A to Z, then `rankOf` desc |
| source | Source (A to Z) | `textOf('source')` A to Z, then newest |
| title | Name (A to Z) | `textOf('title','name')` A to Z |
| distance | Nearest first | `_d` asc (a non-finite distance is ∞) |
| windowEnd | Ending soonest first | `x = parse(targetEnd)` (missing is ∞); `ended(x) = x <= now \|\| windowClosed`. An open window sorts before an ended one. Two open windows: `x` asc (soonest first). Two ended windows: `x` desc (most recently ended first). |
| yearNew / yearOld | Most recent first / Earliest first | `sort` desc / asc (history) |
| name | Name (A to Z) | `textOf('name','title')` A to Z |
| countDesc / countAsc | Most events first / Fewest events first | `count` |

Comparators that subtract can produce `NaN` with Infinity − Infinity. JavaScript then treats the pair as equal and
keeps their order. Native comparators must return "equal" in that case.

Screen-specific definitions:
- `nearby` (My places): "Distance: nearest first", a no-op comparator with distance as the tie-break (features.md §5.3).
- `priority` (Regions): "Most high alerts first": `high` desc, then `count` desc. Regions groups also use
  `newest` (latest desc), `countDesc`, `countAsc` and `name` (`localeCompare` on the group name).
- `curated`: "Suggested order", identity. `nameDesc`: "Name - Z to A".
- Track record: `recorded` "Date recorded - newest first" (`recordedAt || observedAt` desc). `hazard` "Hazard type -
  A to Z" (`hazard || type`, lower-cased, missing is `￿`). `observed` "Actual severity - highest first"
  (CATASTROPHIC 6, EXTREME 5, SEVERE 4, SIGNIFICANT 3, MODERATE 2, MINOR 1, then recorded desc).

Per-screen key lists (the **first is the default**):

| screen | keys |
| --- | --- |
| Events, Alerts, Map, Calamities, Official warnings, Recent events, Hazard types, Region, Hazard and Source detail, alert and calamity related lists (`EVENT_SORTS`) | newest, severity, oldest, deaths, affected, country, type, source, title |
| Forecasts tab | severity, windowEnd, newest, oldest, country, type, title |
| Forecast list and calendar, Verification list | newest, severity, windowEnd, oldest, country, type, title |
| Historical-events list | newest, oldest, severity, country, type, title |
| Event and forecast detail "nearby" | newest, distance, severity, oldest, type, title |
| Location detail with coordinates | distance, then EVENT_SORTS |
| My places | nearby, severity, newest, type, country |
| Regions | newest, priority, countDesc, countAsc, name |
| Our sources | curated, name, nameDesc |
| Track record ledger | recorded, windowEnd, observed, hazard, country, title |
| Historical detail related | yearNew, yearOld, name, type |
| Home "Live events" card (index.html own copy, features.md §1.6) | newest, severity, oldest, deaths, affected, country, type, source, title |

**[vectors: sort.fixture, sort.results, sort.rankOf, sort.timeOf, portal.SORT_DEFS.labels]**. For the 5-record fixture:

| key | order |
| --- | --- |
| severity | a, d, c, e, b |
| newest | d, b, a, c, e |
| oldest | e, c, a, b, d |
| deaths | c, a, d, b, e |
| affected | d, a, c, b, e |
| country | b, a, c, d, e |
| type | c, b, a, d, e |
| source | c, a, e, d, b |
| title | b, d, e, **c**, a |
| windowEnd | b, a, c, d, e |

In the title sort, c ("M 6.5 - near Teluknaga") sorts as "magnitude 6.5…" because of expandAlways.

`sort.results.windowEnd` is unchanged because every fixture window ends after `now`. The ended-window rule is pinned
by **[vectors: sort.windowEndEnded]**: for its fixture the order is `open-22, open-25, no-end, closed-flag, ends-now,
ended-oct1, ended-sep` (`ends-now` ends exactly at `now`, so it has ended; `closed-flag` ends in the future but is
`windowClosed`; `no-end` is open with ∞ and sorts after the dated open ones).

The home page keeps its own comparators (they differ from `SORT_DEFS`): `when(e) = parse(updated || targetStart)`
or 0 (no `startedAt`); `rank(e) = severityRank` if finite and > 0, else `{red:5, critical:5, orange:4, high:4,
moderate:3, watch:2, green:1}[alert lower-cased]` or 0; `numOf` as above; `textOf(e, keys…)` = the first truthy key
lower-cased (**no** glossary expansion) or `"\uffff"`. Comparators: newest `when` desc; severity `rank` desc then
newest; oldest `when` asc; deaths and affected desc then newest; country `textOf(place,country,region)` A to Z;
type, source and title A to Z on that one field. **[vectors: home.render]**

---

## 9. Search and glossary

### 9.1 `matches(e, q)`
Split `q.lowercased()` on whitespace. Every term must be a substring of `searchText(e)`.

`searchText(e)` is built from these fields, in this order: `title name country affectedCountries region location
type hazard source src details summary id eventId`. Values that are absent, null or `""` are skipped, and the rest
are joined with " ". Then `" " + expandAlways(text)` is appended, and the whole string is lower-cased. Cache it per record.

`matchesPlace(e, q)` does the same over `country affectedCountries region location` only, with no glossary step.
**[vectors: search.matches, search.matchesPlace]**

### 9.2 `glossary.expandAlways(text)` (stateless; apply it to displayed titles and use it for search and sort)
Apply in this order:
1. Bearings: `\b(N|S|E|W|NE|NW|SE|SW|NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW)\s+of\b` becomes `"{word} of"`, using north,
   south, east, west, north-east, north-west, south-east, south-west, north-north-east, east-north-east,
   east-south-east, south-south-east, south-south-west, west-south-west, west-north-west, north-north-west.
2. `\bM\s+(\d(?:\.\d+)?)` becomes `"Magnitude $1"`.
3. `\bMagnitude\s+(\d(?:\.\d+)?)\s+(mw|mb|ml|ms)\b` becomes `"{Capitalised scale} $1"`, where the scales are moment
   magnitude, body-wave magnitude, local magnitude and surface-wave magnitude.
4. `,\s(AK|CT|DC|FL|HI|IA|KS|MI|NH|NJ|NM|NV|NY|OH|OK|OR|RI|TX|UT|VT|WA|WI|WV|WY)\b` becomes `", {State}"`. Codes that
   are also ISO country codes (CA, IN, DE, …) are deliberately **not** expanded.

**[vectors: glossary.expandAlways]**, for example:
- "M 6.5 - 126 km NNE of Tobelo, Indonesia" becomes "Magnitude 6.5 - 126 km north-north-east of Tobelo, Indonesia"
- "948 mb" is unchanged
- "Toronto, CA" is unchanged

The first-use acronym expansion (`ONCE` list, for example "United States Geological Survey (USGS)") is for prose
only. It is never applied to badges, pills, headings or cards. Native: optional, but recommended for body text.

---

## 10. Track record (`verdicts.js`, `verification-model.js`, `accuracy.html`, `backtest-view.js`)

### 10.1 Verdict vocabulary

`normalise(status)`: trim and upper-case. Empty gives `""`. Otherwise use this table, and return `UNKNOWN` for any
value not in it:

| raw | normalised |
| --- | --- |
| VERIFIED | VERIFIED |
| PARTIAL_VERIFICATION, PARTIAL | PARTIAL |
| FALSE_ALARM, MISS_FALSE_POSITIVE | FALSE_ALARM |
| MISSED_EVENT, FALSE_NEGATIVE_UNPREDICTED_EVENT | MISSED |
| COVERAGE_FAILURE | COVERAGE_FAILURE |
| PENDING | PENDING |

| state | LABELS (Result) | OCCURRED (Did it happen?) | pill css |
| --- | --- | --- | --- |
| VERIFIED | Correct | Yes | verified |
| PARTIAL | Partly correct | Partly | partial |
| FALSE_ALARM | Wrong (false alarm) | No | alarm |
| MISSED | Missed event | Yes, but we did not forecast it | missed |
| COVERAGE_FAILURE | Missed: not checking there | Yes, but we were not checking that place | coverage |
| OPEN | Still running | Too early to say | open |
| AWAITING | Not checked yet | Not checked yet | awaiting |
| UNGRADEABLE | Cannot be checked | We cannot tell | ungradeable |
| NOT_A_PREDICTION | No proof it was made in time | Not counted | notprediction |
| UNKNOWN | Unrecognised result | Unrecognised result | unknown |

- `stateOf(r, now)`: `g = normalise(r.status || r.outcome)`. If g is set and not PENDING, return g. If there is no
  valid `targetEnd`, return AWAITING. Otherwise return `end > now ? OPEN : AWAITING`. **[vectors: verdicts.stateOf]**
- `engineState(v)`: if there is no classification, nil. `PENDING` gives OPEN if `ungradeableReason=='WINDOW_STILL_OPEN'`,
  otherwise UNGRADEABLE. Then HIT → VERIFIED, PARTIAL_HIT → PARTIAL, MISS_FALSE_POSITIVE → FALSE_ALARM,
  INVALID_POST_EVENT → NOT_A_PREDICTION, and anything else → UNKNOWN. **[vectors: verdicts.engineState]**

### 10.2 `tally(records, now)` and `rate`
Count each record by `r._state ?? stateOf(r, now)`. `matured` counts records whose `targetEnd <= now`.
- `graded = verified + partial + falseAlarm`
- `precision = rate(verified + partial, graded)`
- `recall = rate(verified + partial, verified + partial + missed + coverageFailure)`
- `rate(hit, total)`: when total is 0 → `{text:"Not enough checked forecasts", pct:null}`; otherwise
  `{text: "{round(hit/total*100)}% ({hit} of {total})", pct}`.

**[vectors: verdicts.tally, verdicts.rate]**: a 10-record fixture gives graded 3, precision "67% (2 of 3)" and recall "50% (2 of 4)".

### 10.3 Joining hand verdicts to ledger windows (`joinVerdicts`)
- `windowKey(r) = "{id}@{ms(targetStart)|''}..{ms(targetEnd)|''}"`.
- Attach each verification to the row with the same windowKey. If there is none, and **the id has exactly one ledger
  row**, attach it to that row. Otherwise put it in `unattached`.
- When merging, `out = row + verdict`, but every field in `CLAIM_FIELDS` is restored from the row (and deleted when
  the row lacks it), so a verdict never rewrites the frozen claim. The fields are: id, type, title, country, admin1,
  region, lat, lon, alert, severity, severityRank, issuedAt, sourceIssuedAt, targetStart, targetEnd, forecastKind,
  forecastClass, classificationReason, effectiveForecastStart, freezeTimestamp, freezeBasis, forecastOf, source,
  sourceUrl, confidence, evidence, verificationRule.

**[vectors: verdicts.joinVerdicts]**

### 10.4 Building the Track record screen (from `accuracy.html load()`)
1. Fetch the four ledgers. **If any fails, stop**: show the unavailable state (features.md §6) and grade nothing.
2. `obsEvents = observed.events.filter(!supersededBy)` and `supporting = observed.supporting`.
3. `preds = ledgerRows.map{ r + forecastClass: r.forecastClass ?? classifyForecast({forecast:true,...r}).forecastClass }`.
4. `verdicts[i] = VER.verify(preds[i], obsEvents, {now, hazardFamilyOf: PNDObserved.familyOf, observedCoverage: claim -> VER.observedCoverageFor(scanLedger, claim.hazards||claim.hazard, claim.geography), supportingEvents})`.
   Key each verdict by `claimKey(pred)` (§10.6).
5. `records = joinVerdicts(rows, verifications).records + verificationLedger.observedEvents` (each with status
   defaulted to MISSED_EVENT), mapped as follows:
   ```
   led = stateOf(r, now); eng = engineState(verdictByClaimKey[r])
   decided   = eng in {VERIFIED, PARTIAL, FALSE_ALARM, NOT_A_PREDICTION}
   ledGraded = led in {VERIFIED, PARTIAL, FALSE_ALARM, MISSED, COVERAGE_FAILURE}
   _state = decided ? eng : (ledGraded ? led : (eng ?? led))
   _ledgerState = (decided && eng != led && ledGraded) ? led : nil           // shown as "Checked by hand as …"
   _engineUnreproduced = !decided && ledGraded && eng == UNGRADEABLE
   ```
   Then sort by `recordedAt || observedAt` descending.
6. `t = tally(records)` gives the 10 key figures.
7. `headlineIdx` = preds with class `independent-prospective`. `condIdx` = preds with a class that is neither that
   nor `invalid-post-event`.
8. `assessments = obsEvents.map{ VER.assessCoverage(e, preds, scanLedger, {hazardFamilyOf, hazardForecastable: e -> HAZARDS[e.hazardLabel || e.type]?.forecastable != false}) }`.
9. `sH = score(headline verdicts, assessments)`. `since = predictingSince(preds)`. `recallIdx` = obsEvents with
   `inRecallPeriod(e, since)`. `sR = score(headline verdicts, recall assessments)`. `sC = score(conditional verdicts, [])`.
10. Percent display: `pct(x, n, unit)` → `x == nil ? "Cannot be calculated" : "{round(x*1000)/10}% ({n} {unit})"`.
11. Answer box sentences, honesty paragraph, WHY_NOT reasons and the "Forecast in advance?" labels are verbatim
    strings in the inline `load()` script of `accuracy.html`. Bundle them.

### 10.4b A forecast's grade on its own screen (`forecast-detail.html gradeOf`)
```
gradeOf(id):
  L = GET /data/verification-ledger.json (nil on failure or non-200)
  v = L.verifications.first(x => x.id == id)
  if v: k = normalise(v.status); if k != "" && k != PENDING && k != UNKNOWN → {label: LABELS[k] ?? k, summary: v.summary ?? ""}
  if id starts with "model-":
    M = GET /data/model-verdicts.json; o = M.outlooks.first(x => x.id == id)
    o.verdict == "correct"     → {label: LABELS.VERIFIED,    summary: ""}     // "Correct"
    o.verdict == "false alarm" → {label: LABELS.FALSE_ALARM, summary: ""}     // "Wrong (false alarm)"
  return nil
STATUS = grade ? "Checked: " + grade.label : (targetEnd < now ? "Ended, not yet checked" : "Active")
```
The ledger wins when an id is in both files. **[vectors: forecastDetail.gradeOf, verdicts.label, verdicts.LABELS,
fixtures.verdictFiles]**

The ND-001 check screen (`verification-detail.html`) reads its Result differently: `LABELS[VERDICTS[row.status]]`
with the raw status as the key (no `normalise`), else "Not checked yet" (features.md §14).
**[vectors: verificationDetail.render]**

### 10.5 `score(verifications, assessments)` (`verification-model.js`)
```
for v in verifications:
  if v.gradeable == false && v.ungradeableReason && v.ungradeableReason != "WINDOW_STILL_OPEN": ungradeable++, ungradeableBy[reason]++
  symmetric = v.absenceEstablishable != false
  HIT → symmetric ? hit++ : hitsOutsideCoverage++
  PARTIAL_HIT → symmetric ? partial++ : hitsOutsideCoverage++
  MISS_FALSE_POSITIVE → miss++ ; PENDING → pending++ ; INVALID_POST_EVENT → invalid++
eligible = hit + partial + miss
for a in assessments: if !a.falseNegative { a.matched.any(result=="HIT") ? predicted++ : partlyPredicted++ }
                      else { falseNegatives++; coverage[a.status]++ }   // COVERAGE_FAILURE, FORECAST_FAILURE, DATA_UNAVAILABLE, NOT_FORECASTABLE, NO_PROSPECTIVE_INPUT
precision = eligible ? (hit + 0.5*partial)/eligible : nil
recall    = assessments.count ? (predicted + 0.5*partlyPredicted)/assessments.count : nil
f1        = precision,recall non-nil and their sum > 0 ? 2pr/(p+r) : nil
```
`predictingSince(preds)` is the minimum of `parse(freezeTimestamp || recordedAt)` over independent-prospective preds,
or nil. `inRecallPeriod(e, since)` is `since != nil && parse(e.onset) != nil && onset >= since`.
**[vectors: verification.score, verification.predictingSince]**: the 7-verdict and 4-assessment fixture gives
precision 0.5, recall 0.375 and F1 0.428571.

Geography tolerance per hazard family (km): earthquake 250, tropical-cyclone 500, flood 300, landslide 150,
wildfire 200, volcano 100, drought 600, extreme-heat 400, severe-weather 250, other 250. `VERIFICATION_VERSION` is `verify-1.3.1`.

### 10.6 `claimKey(f)` (used to key verdicts)
`[id, type, targetStart, targetEnd, country, region, coord(lat), coord(lon), forecastScope, title-if-type-names-no-hazard]`.
Each part becomes `"-"` when absent, null or `""`, and is trimmed otherwise. The parts are joined with `|`.
`coord(v)` is `Number(v).toFixed(3)` when finite, otherwise `"-"`. The title is included only when `type` matches
`^(?:|natural hazard|other|others|unknown|unspecified|unclassified|complex emergency)$/i`.

### 10.7 Port strategy for `verify()` and `assessCoverage()`
`verification-model.js` (1,274 lines) and `observed-model.js` (589 lines: hazard families, same-event merging,
significance) hold the grading engine. It changes with versioned rules (`verify-1.3.1`). There are two acceptable approaches.

1. **Recommended: run the website's JS on device.** On iOS use **JavaScriptCore** (`JSContext`). On Android use
   `androidx.javascriptengine.JavaScriptSandbox`, or QuickJS (for example `app.cash.quickjs`). Load
   `hazard-model.js`, `observed-model.js`, `verification-model.js` and `verdicts.js`. Each attaches to `globalThis`
   or `module.exports`. Pass JSON in and get JSON out. Fetch these scripts from the site at runtime, or ship them in
   the bundle and refresh them with the app, so the grading always matches the website exactly.
2. Port it to Swift and Kotlin, and assert parity by running both implementations over the real
   `/data/*.json` files and comparing each verdict's `classification`, `ungradeableReason` and
   `observedEventIds`, plus each `score()` output.

Either way, the screen logic in §10.1 to §10.6 and §10.8 is small and should be native.

### 10.8 Backtest rows (`backtest-view.js`)
Hazards are heat (Extreme heat), rain (Heavy rain) and fire (Wildfire weather); leads are 3 and 5 days.
For each `results["{h}@{lead}"]` with `h=hits, m=misses, f=falseAlarms, c=correctNegatives` (all must be finite and
≥ 0, and `days=h+m+f+c > 0`; otherwise there are no rows):
`happened=h+m`, `caught = h+m ? h/(h+m) : nil`, `caughtByChance=(h+f)/days`, `rightWhenWarned = h+f ? h/(h+f) : nil`,
`rightByChance=(h+m)/days`. Percentages are rounded to whole numbers, and nil shows as "Cannot be calculated".
`doc.places` must be > 0. The heat limitation text depends on `doc.heatLine === 'trend'` (see `accuracy.html heatLimit`).

---

## 11. Test-vector index (`test-vectors.json`)

Regenerate with `node tools/make-parity-vectors.js`; never edit the file by hand. `test/parity-vectors.test.js`
rebuilds it in memory on every website test run and fails when it differs, and also fails if any of the first
spec's group names disappears.

**Groups from the first spec (unchanged; keep your harness as it is):**
`meta`, `risk.levelOf`, `risk.markerIcon`, `portal.riskLabel`, `portal.matchesRiskLevel`, `portal.riskTagHtml`,
`portal.riskLevelOptions`, `hazards.hazardOf.name`, `hazards.horizonHours`, `hazards.severityOf`,
`hazards.cycloneCategory`, `hazards.keyFacts`, `portal.keyFactsLine`, `hazards.leadTimeText`,
`hazards.classifyForecast`, `hazards.distanceKm`, `hazards.geometryContains`, `hazards.riskRow`, `fixtures.places`,
`fixtures.events`, `placeRisk.assess`, `placeRisk.nearLevel(table)`, `alertRules.alertFor`, `alertRules.alertsFor`,
`alertRules.roundCoord`, `alertRules.urlFor`, `portal.titleOf`, `portal.placeOf`, `portal.shortSource`,
`portal.provenance`, `portal.eventUrl`, `portal.duration`, `portal.fmtDate` (5 timezones), `portal.fmtTime`,
`portal.fmtWhen`, `portal.windowText`, `portal.horizonText`, `portal.age`, `portal.countryCount`,
`portal.impactText`, `portal.summary`, `portal.quietNote`, `portal.statusText`, `portal.sourcesRatio`,
`portal.findEvent`, `portal.hazardOptions`, `portal.SORT_DEFS.labels`, `portal.EVENT_SORTS`, `sort.fixture`,
`sort.results`, `sort.rankOf`, `sort.timeOf`, `search.matches`, `search.matchesPlace`, `search.emptyHtml`,
`glossary.expandAlways`, `placeSearch.levelOf`, `placeSearch.labelOf`, `placeSearch.candidates`,
`verdicts.normalise`, `verdicts.stateOf`, `verdicts.engineState`, `verdicts.rate`, `verdicts.tally`,
`verdicts.joinVerdicts`, `verification.score`, `verification.predictingSince`.

**Groups added for the audit fixes** (shape in brackets; `{in,out}[]` unless noted):

| Group | Site code that produced it | What it pins |
| --- | --- | --- |
| `sort.windowEndEnded` | `PND.applySort(list,'windowEnd')` | `{fixture, now, out: ids}`: ended windows after open ones (§8) |
| `search.emptyHtml.counts` | `PNDSearch.emptyHtml` | the "N events from C countries" line counts reports only |
| `search.countryCount` | `PNDSearch.countryCount` | same rule as `portal.countryCount` |
| `continents.NAMES` | `PNDContinents.NAMES` | plain array, the order of the continents |
| `continents.continentNamed` | `PNDContinents.continentNamed` | case and space handling, no URL decoding |
| `fixtures.places.continents` | (fixture) | records referenced by id in the next four groups |
| `continents.continentsOf` | `PNDContinents.continentsOf` | in: record id |
| `continents.onContinent` | `PNDContinents.onContinent` | in: `[record id, name]` |
| `portal.inPlace` | `PND.inPlace` | in: `[record id, query]` |
| `regionDetail.matches` | `region-detail.html` continent lines and `matches()` | in: `[region, ids]`; out: `{region (canonical), ids kept}` |
| `portal.hazardKey` | `PND.hazardKey` | whole-name hazard keys (§6.10) |
| `portal.sameHazard` | `PND.sameHazard` | Extreme Cold is not Extreme Heat |
| `hazardDetail.fillHazards` | `hazard-detail.html fillHazards` | in: `[requested type, types in the feed]`; out: `{options, selectedAtStart, selected}` |
| `fixtures.events.hazards` | (fixture) | records for the next group |
| `hazardDetail.select` | `hazard-detail.html here` + `PND.observed`/`openForecasts` | in: `[hazard, region]`; out: `{events, openForecasts}` ids |
| `fixtures.events.warnings` | (fixture) | records referenced by id in the next two groups |
| `portal.isOfficialWarning` | `PND.isOfficialWarning` | in: record id (or null) |
| `portal.officialWarnings` | `PND.officialWarnings` | `{in: ids, out: ids}` |
| `portal.WARNING_MEANING` | `PND.WARNING_MEANING` | plain string |
| `fixtures.events.mixed` | (fixture) | records for the next four groups |
| `portal.observed`, `portal.openForecasts` | `PND.observed`, `PND.openForecasts` | `{in: ids, out: ids}` |
| `portal.isHighAlert` | `PND.isHighAlert` | in: record id (or null) |
| `portal.sourcesReporting` | `PND.sourcesReporting` | in: `[ids]` |
| `portal.liveWord` | `PND.liveWord` | DATA STATUS word |
| `detail.statusWords` | `event-detail.html` eyebrow and Status, `calamity-detail.html` Status, `PND.liveWord` | out: `{eventEyebrow, eventDataStatus, eventRecordState, calamityStatus}` |
| `fixtures.events.collection` | (fixture) | records for the next group |
| `collection.keep` | `collection.js keep`, `scoped`, `countText` | in: `[view, region?]`; out: `{kept, scoped, countText}` (noun "items") |
| `verdicts.LABELS` | `PNDVerdicts.LABELS` | plain object |
| `verdicts.label` | `LABELS[normalise(status)]` | raw status to label |
| `fixtures.verdictFiles` | (fixture) | the two data files served to the next group |
| `forecastDetail.gradeOf` | `forecast-detail.html gradeOf` | in: `[id, targetEnd, filesDown?]`; out: `{grade, status}` (§10.4b) |
| `portal.timezoneDefault` | `PND.timezone`, `tzLabel`, `fmtDate` | in: `[stored, browserZone]` (§6.13) |
| `portal.zoneLabel` | `PND.tzLabel(tz, at)`, `fmtDate`, `fmtTime`, `tzMenuLabel` with that zone selected | in: `{tz, at}`; out: `{label, fmtDate, fmtTime, menuLabel}` (§6.4, changelog C27) |
| `home.placeAnswerStates` | `index.html` rendered whole with a saved place and the feed held, refused or served | object: `{placeAnswerStates, cases[{in:{state, place, feed (per load: "hang", "fail" or record ids)}, out:{eyebrow, badge, heading, happening, unavailableCard, why, steps, lastChecked, busy}}]}`; states loading, failed, loaded-empty, loaded-with-hits, failed-then-loaded (changelog C26) |
| `home.render` | `index.html` rendered whole | object: `feed`, `hazardFilterOptions`, `sortOptions`, `warningsTileNote`, `warningsTileTitle`, `liveEventsHeading`, `cases[{in:{hazardFilter, sort}, out:{kEvents, kEventsNote, kWarnings, kForecasts, kForecastsNote, kCountries, liveEvents (ids), latestEvents, officialWarnings, latestForecasts (table cells), hazardStrip[{hazard, text, link}]}}]` |
| `alerts.pager` | `alerts.html` rendered whole | object: `{feedRecords, officialRecords, pageSize, steps[{action, out:{shown, note, button, kOfficial}}]}` |
| `verificationDetail.render` | `verification-detail.html` rendered whole | object: `{fixtures:{forecast, reports}, cases[{in:{name, events, ledger}, out:{kVerdict, kEvidence, kTarget, kWindow, rows (8 × [metric, forecast, actual]), evidence (hrefs)}}]}` |

Groups whose entries carry a `tz` field (`portal.fmtDate`, `fmtTime`, `fmtWhen`, `windowText`, `horizonText`) were
run with that timezone selected. Every other group was run with `meta.timezoneDefault` (`Asia/Kolkata`) selected
explicitly; the site's own default is now the device zone (§6.13), so set the zone in your harness rather than
relying on the device. Numbers formatted with `toLocaleString()` use en-US grouping (§1). The fixed "now" is
`meta.now`. `riskRow` distances in the vectors are rounded to 0.1 km. Compare with a tolerance of 0.05. Rendered
pages (`home.render`, `alerts.pager`, `verificationDetail.render`) give the visible text with runs of whitespace
collapsed to one space.
