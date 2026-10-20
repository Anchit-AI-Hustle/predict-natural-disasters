# API contract for the native apps

Base URL: `https://predict-natural-disasters.anchit-tandon.com`

The website is a static site plus three Node serverless functions on Vercel (`api/events.js`,
`api/event-enrichment.js`, `api/alerts.js`). A fourth function, `api/alerts-run.js`, is internal. Native apps call
the same endpoints the web pages call. **No authentication is needed to read.** All responses are JSON in UTF-8.
Timestamps are ISO-8601 strings in UTC, and most of them end in `Z`. Hand-written ledger rows can carry offsets such
as `+07:00`. Always parse with a full ISO-8601 parser.

The samples below come from running the real handlers. The script was
`/tmp/claude-0/-home-user-predict-natural-disasters/7adba1cf-f037-5286-b13d-6ec6fec1d7c2/scratchpad/work/samples.js`,
and it does the same thing as `test/render.js callApi`: it installs `test/mock-upstreams.js makeFetch({})` as
`global.fetch` and calls the handler with a mock `res`. Files:

- `parity/sample-events.json`: full `GET /api/events` body (63 events, all eight providers mocked).
- `parity/sample-enrichment.json`: `{request, response}` for `GET /api/event-enrichment` on the GDACS Nepal flood.

For scale, the **production** feed on 20 Oct 2026 had 1,558 events (780 of them `live:false`), was 1.7 MB
uncompressed, and took 3.3 s on a cache miss.

---

## 1. `GET /api/events`: the live feed

Implemented in `api/events.js` (`handler`).

### 1.1 Query parameters

| Param | Values | Effect |
| --- | --- | --- |
| *(none)* | | Full body `{generatedAt, meta, events}`. The response is served from the shared Vercel edge copy (see 1.2). |
| `summary` | `1` or `true` | Returns `{generatedAt, meta}` only, with no `events`. The About page uses this for `meta.countryCount` and `meta.hazardTypeCount`. It costs the same server time but transfers much less (about 27 KB in production). |
| `ledger` | `1` or `true` | Returns `{generatedAt, meta: {ledger}, ledger: [...]}`. `ledger` is the full append-only outlook ledger (`data/outlook-ledger.json` bundled into the function, 1,886 rows and about 3 MB). Forecast detail uses it to show a forecast that has left the feed (features.md §7.4). Prefer the static `/data/outlook-ledger.json` (§5). It is the same file and is served by the static CDN. `ledger` wins if both `ledger` and `summary` are given. |
| `ts` | any value, by convention `Date.now()` | **Cache-buster only.** The handler ignores it. A different query string misses the edge copy, so the feed is rebuilt from every provider. The web sends it from "↻ Refresh now" with `cache:'no-store'`. Native: send `ts` only on an explicit user refresh. Never send it on timers. |
| `cron` | any | Used by scheduled jobs. Same effect as `ts`. Native apps must not send it. |

There are no server-side filters. `region`, `q`, `type` and similar parameters seen in website URLs belong to the
pages, not to the API. **`all` and `fresh` are client-side options of `PND.getEvents`, not API parameters:**

- `fresh` (or a Refresh tap) means `GET /api/events?ts=<epoch ms>` with no-cache.
- The default (`all` absent) means the client **drops records with `live === false`** and keeps them separately as `notLive`. List, map and count screens use this.
- `all: true` means the client keeps every record. Detail screens use it so that a record which has gone quiet still opens, and so do the historical-events list and the verification list.

### 1.2 Response headers and caching

```
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Vercel-CDN-Cache-Control: max-age=30, stale-while-revalidate=60
Access-Control-Allow-Origin: *            (vercel.json, all /api/*)
Content-Type: application/json; charset=utf-8
```

- The response is never cached by the browser or the app (`no-store`). It is shared at the Vercel edge: a copy is
  rebuilt once it is 30 s old, and a stale copy may be served for up to 60 s more while the rebuild runs. **No copy
  is older than about 90 s.** Native: do not add an HTTP cache. Keep the last good body in memory, and optionally on
  disk for offline display, and label it with its own `generatedAt`.
- A rebuild takes 3 to 6 s, because the handler waits for every provider with a 6.5 s timeout each. Set a client
  timeout of at least 20 s.
- Status is always **200**, even when every provider fails. A total outage looks like `meta.live === false`, with
  every `meta.sources[*].ok === false` and only the fallback records (the two cached snapshots and ND-001). Treat a
  non-200 response or a network error as "Live data unavailable".
- Production also sends `ETag`. The handler does not use conditional requests.

### 1.3 Top-level shape

```jsonc
{
  "generatedAt": "2026-10-20T11:24:19.566Z",   // when this copy was built: show it as "updated"
  "meta": { ... },                             // see 1.5
  "events": [ Event, ... ]                     // see 1.4. Order is not meaningful; always sort client-side
}
```

### 1.4 `Event` object

Field inventory measured from `sample-events.json`, the handler code, and the production feed. "Opt" means the
field may be absent, `null`, or `""`. **Treat absent, null and empty string the same way: as "not published". Never
treat them as 0** (logic.md §5).

**Identity, provenance and kind**

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable id. Patterns: `gdacs-{TYPE}-{eventid}`, `usgs-{id}`, `emsc-{unid}`, `eonet-{id}`, `nhc-{id}`, `nws-{urn}`, `reliefweb-{slug}`, `usgs-volcano-{id}`, `OUT-{sourceId}` (derived outlooks), `OUT-aftershock-{sourceId}`, `model-{hazard}-{place}-{date}`, `ND-001`, plus the fallback snapshots `gdacs-FL-1104124` and `recent-IDN-20260911-M65`. URL-encode it in paths. |
| `source` | string | Display name, for example `GDACS`, `USGS`, `EMSC`, `NASA EONET`, `NOAA National Hurricane Center`, `NOAA / National Weather Service`, `ReliefWeb (UN OCHA)`, `USGS Volcano Hazards Program`, `Predict Natural Disasters`, `Predict Natural Disasters · derived from {X}`, `Predict Natural Disasters · forecast model`, `GDACS verified snapshot`, `USGS verified recent snapshot`. Shorten it for pills with `shortSource` (logic.md §6). |
| `sourceType` | `"official"` or `"forecast"` | |
| `evidenceState` | `"observed"`, `"official-warning"`, `"forecast"` or `"unknown"` | What kind of statement the record is. Drives provenance (`PND.provenance`) and place-risk banding. |
| `forecast` | bool (opt) | `true` on every forecast. |
| `isForecast` | bool | Always present. `!!forecast`. |
| `forecastKind` | opt: `signal-derived-outlook`, `aftershock-sequence`, `model-advance`, `frozen-benchmark` | |
| `forecastClass` | opt: `independent-prospective`, `warning-derived`, `continuation-outlook`, `post-event-conditional`, `retrospective-benchmark`, `invalid-post-event` | Labels in `hazard-model.js FORECAST_CLASSES` (logic.md §7). |
| `classificationReason` | string (opt) | |
| `forecastOf` | string (opt) | id of the parent record (derived and aftershock outlooks). |
| `forecastScope` | opt: `event`, `regional`, `country` | `country` means the forecast applies to the whole country (place-risk matches on country, logic.md §3.2). |
| `cached` | bool (opt) | A saved snapshot shown because the provider did not list it. Label it "Saved copy". |
| `live` | bool (opt) | `false` when the provider has gone quiet (per-hazard limits: cyclone 3 d, storm 3 d, tornado 2 d, quake 7 d, flood 10 d, landslide 14 d, wildfire 10 d, volcano 45 d, drought 60 d, heat 7 d, cold 7 d, humanitarian 60 d, default 14 d, unless `expectedEnd` or `expiresAt` is in the future). **Absent means live.** Forecasts never carry it. |
| `quietDays` | int (opt) | Only when `live === false`. Floor of the days since `updated`. |
| `windowClosed` | bool (opt) | `true` on a forecast whose `targetEnd <= now` (ND-001 stays in the feed with this set). |

**What and where**

| Field | Type | Notes |
| --- | --- | --- |
| `type` | string | Hazard type, normalised. Common values: `Earthquake`, `Earthquake aftershock sequence`, `Tropical Cyclone`, `Flood`, `Flood / Landslide`, `Landslide`, `Wildfire`, `Drought`, `Volcano`, `Extreme Heat`, `Extreme Cold`, `Severe Storm`, `Tornado`, `Tsunami`, and others. Defaults to `Natural Hazard`. Map it to a hazard with `hazardOf` (logic.md §5.1). |
| `title` | string | Plain title. The provider's original is in `sourceTitle` when it differed. Display it with `titleOf` (logic.md §6.2). |
| `sourceTitle` | string (opt) | |
| `details` | string | Free text. Can end with the boilerplate "This is our own estimate, not an official warning." |
| `place` | string | Server-computed place label, for example `"Bagmati Province, Nepal"` or `"Atlantic Ocean"`. Use `placeOf` (logic.md §6.1), which prefers this field. |
| `country` | string | Can be a comma-separated list (droughts, storms), or empty. |
| `countries` | string[] | Parsed list of countries, or `[]` at sea. Use it for grouping by country (Regions). |
| `sea` | string (opt) | Ocean name when there is no country. |
| `region`, `admin1`, `admin2` | string (opt) | `region` can be a storm name or corridor. |
| `affectedCountries`, `location` | string (opt) | Searchable. |
| `lat`, `lon` | number | Always present and valid. Records without coordinates are dropped server-side. |
| `geometry` | GeoJSON (opt) | `Polygon` or `MultiPolygon` warning area (NWS). Used for containment. |
| `locationPrecision` (`precision`) | `incident`, `polygon`, `admin2`, `admin1`, `regional`, `country` or `unknown` | `precision` is a back-compat duplicate of the same value. |
| `proximityEligible` | bool | `true` only for `incident` precision. Distances may be shown only when this is true. |
| `areaEligible` | bool | `!!geometry` |
| `proximityReason` | string | Sentence explaining the coordinate. |

**Level and severity**

| Field | Type | Notes |
| --- | --- | --- |
| `alert` | string | The provider's or this site's alert word: `Red`, `Orange`, `Green` (GDACS, USGS PAGER, EONET, ReliefWeb), `Red` or `Orange` for NWS and volcano records, or `High`, `Moderate`, `Watch` on forecasts. Map it to the six-level scale with `levelOf` (logic.md §2). |
| `alertBasis` | opt: `issued` or `derived-from-intensity` | |
| `alertSource`, `alertSourceUrl` | string (opt) | When a merged storm's alert came from another agency. |
| `severity` | `Informational`, `Minor`, `Moderate`, `Severe` or `Extreme` | Server-computed by `HAZARD_MODEL.severityOf` (logic.md §5.2). Always present when the hazard model loaded. |
| `severityRank` | 1 to 5 | |
| `severityText` | string (opt) | GDACS's own text. |
| `pagerAlert` | `green`, `yellow`, `orange`, `red` or null (opt) | USGS PAGER. |
| `alertLevel`, `aviationColour` | string (opt) | Volcano observatory, for example `WARNING` / `ORANGE`. |
| `confidence` | string (opt) | On forecasts. Prose. |

**Measurements and impact** (all optional numbers)

`magnitude`, `mainshockMagnitude`, `depthKm`, `tsunamiFlag` (bool, USGS only), `windKt`, `pressureMb`,
`movementDirDeg`, `movementKt`, `areaHa`, `deaths`, `displaced`, `affected`, `missing`. The fields `injuries` and
`evacuated` exist in the key-facts schema but no current provider sets them, so they always show "Not reported".

**Time**

| Field | Type | Notes |
| --- | --- | --- |
| `updated` | ISO | When the provider last updated the record. Used for sorting (`timeOf`). |
| `startedAt` | ISO or null (opt) | |
| `expiresAt` | ISO (opt) | Official warning expiry. |
| `expectedEnd` | ISO (opt) | GDACS future `todate`. |
| `issuedAt`, `sourceIssuedAt` | ISO (opt) | Forecasts. |
| `issuedAtBasis` | string (opt) | |
| `targetStart`, `targetEnd` | ISO (opt) | The forecast window. A whole-day window is stored as `...T00:00:00Z` to `...T23:59:59Z`, or as midnight to midnight with the end excluded. Format it with `fmtWhen` (logic.md §6.5). |
| `leadTimeHours` | number (opt) | Forecasts. Hours from issue to window start, one decimal, can be negative. |
| `generatedAt` | ISO (opt) | On forecasts, the build time. |
| `freezeTimestamp`, `freezeBasis`, `freezeEvidenced`, `effectiveForecastStart`, `creditedWindowHours`, `countsTowardHeadlineAccuracy` | (opt) | Forecast audit fields (Track record). |
| `evidence`, `verificationRule` | string (opt) | Forecast prose. Show it on forecast detail. |

**Links and other fields**

`sourceUrl` (string; the original report; can be relative such as `/verification` for ND-001 or `/accuracy` for model
forecasts, so resolve relative URLs against the base URL), `sourceApiUrl`, `rawId`, `rawType` (GDACS),
`issuingAgency`, `instruction` (NWS), `humanitarian` (ReliefWeb), `corroboratedBy` (string[]; other agencies that
reported the same quake), `mergedFrom` (`[{id, source, sourceUrl, updated}]`), and `model` (object; model-advance
forecasts: `{hazard, days:[{day, value, p95, p99, shift}], peak, severe, placeId, geonameId, bias, soil}`).

**Example records** (abridged from `sample-events.json`):

```json
{"id":"gdacs-FL-1104999","source":"GDACS","sourceType":"official","type":"Flood","title":"Flood in Bagmati Province, Nepal",
 "country":"Nepal","region":"Bagmati Province","alert":"Red","alertBasis":"issued","lat":27.7,"lon":85.3,
 "startedAt":"2026-09-10T00:00:00.000Z","updated":"2026-10-20T11:24:19.511Z",
 "details":"Widespread riverine flooding with continuing displacement.","deaths":42,"displaced":5100,"affected":120000,
 "sourceUrl":"https://www.gdacs.org/report.aspx?eventid=1104999&eventtype=FL","rawId":1104999,"rawType":"FL","live":true,
 "place":"Bagmati Province, Nepal","countries":["Nepal"],"evidenceState":"observed","isForecast":false,
 "locationPrecision":"regional","precision":"regional","proximityEligible":false,"areaEligible":false,
 "proximityReason":"Placed at the centre of a hazard area that can span a region.","severity":"Severe","severityRank":4}
```

```json
{"id":"nws-urn:oid:2.49.0.1.840.0.bbb","source":"NOAA / National Weather Service","sourceType":"official","type":"Extreme Heat",
 "title":"Excessive Heat Warning - Maricopa, Arizona","country":"United States","region":"Maricopa, Arizona","alert":"Red",
 "lat":33.4,"lon":-112.16,"geometry":{"type":"MultiPolygon","coordinates":[[[[-112.4,33.2],[-111.8,33.2],[-111.8,33.7],[-112.4,33.7],[-112.4,33.2]]]]},
 "expiresAt":"2026-09-16T00:00:00Z","issuingAgency":"NWS Phoenix AZ","evidenceState":"official-warning",
 "locationPrecision":"polygon","proximityEligible":false,"areaEligible":true,"severity":"Severe","severityRank":4}
```

```json
{"id":"OUT-gdacs-FL-1104999","source":"Predict Natural Disasters · derived from GDACS","sourceType":"forecast","type":"Flood",
 "title":"Flood risk in Bagmati Province, Nepal - 3-day forecast","alert":"High","forecast":true,
 "forecastKind":"signal-derived-outlook","forecastOf":"gdacs-FL-1104999","forecastScope":"event",
 "issuedAt":"2026-10-20T11:24:19.511Z","targetStart":"2026-10-20T11:24:19.511Z","targetEnd":"2026-10-23T11:24:19.511Z",
 "confidence":"Higher - the agency issued its highest (red) alert","forecastClass":"continuation-outlook",
 "evidenceState":"forecast","severity":"Moderate","severityRank":3,"leadTimeHours":0, "...": "see sample"}
```

Other kinds are in the sample file: the USGS and GDACS merged quake (`corroboratedBy`, `mergedFrom`), the NHC storm
(`windKt`, `pressureMb`, `movement*`, `sea`), the volcano (`alertLevel`, `aviationColour`), ReliefWeb (`precision:
"country"`, `humanitarian`), the aftershock outlook, the model-advance forecast, ND-001 (`windowClosed`) and a quiet
USGS quake (`live:false`, `quietDays:36`).

### 1.5 `meta` object

| Field | Type | Use in UI |
| --- | --- | --- |
| `live` | bool | true when at least one provider answered. Drives `statusText`. |
| `gdacs`, `usgs`, `eonet` | bool | Legacy flags. |
| `sources` | `{ [key]: {ok: bool, checkedAt: ISO, records?: int, error?: string, window?: string, endpoint?, via?, ...} }` | Keys: `gdacs`, `usgs`, `emsc`, `eonet`, `nhc`, `nws`, `reliefweb`, `usgs_volcano`. Used for the source status rows and `sourcesRatio` ("7/8"). Per-provider extras (`byHazard`, `incomplete`, `failed`, `apiError`, `hint`, `query`, and so on) are diagnostic. |
| `sourceCount`, `sourceTotal` | int | Providers that answered, and all providers. |
| `scan` | `{scanId, scanTimestamp, engineVersion, coverageLimitation, providers:[Provider], coverage:{SCANNED:n,...}}` | The Our sources screen and the trust note's "newest record". `Provider` = `{provider, label, hazards[], inputKind:'observation'|'forecast', inputBasis, geographicCoverage, coverageResolution, scope:{kind}, completeness:'exhaustive'|'selective', completenessBasis, recordsObservations, endpoint, status:'SCANNED'|'INCOMPLETE_SCAN'|'DATA_UNAVAILABLE'|'NOT_ATTEMPTED', success, failureReason, recordsEvaluated, recordsServed, dataFreshness, checkedAt}` |
| `modelRun` | `{at: ISO, served: bool, note}` or null | Trust note: "weather models last run …". `served:false` means older than 36 h, so model forecasts are withheld. |
| `forecastHorizon` | `{nextWindowEnds, furthestWindowEnds, daysAhead, windowLengthDays:number[], note}` or null | `horizonText` and the "Forecasts reach as far as" stat. |
| `forecastChanges` | `{at, sinceHours, activeOutlooks, baseline, added, raised, lowered, windowMoved, gone, expired, unavailable, sourcesDown[], total, records:{added[],raised[],lowered[],windowMoved[],gone[],expired[],unavailable[]}}` or null | "What changed since our last check" (`changesHtml`). Record = `{id,type,title,country,alert,rank,targetStart,targetEnd,provider, from?, to?, fromEnd?, toEnd?}`. |
| `refreshRecorded` | `{schedule, runsRecorded, runs, median, min, max, note}` | |
| `ledger` | `{status:'loaded'|'unavailable', recorded, windowClosed, graded, awaitingGrading}` | |
| `outlooks`, `outlooksWithheld`, `forecastNote` | | |
| `eventCount`, `officialCount`, `forecastCount`, `activeForecastCount`, `closedForecastCount`, `countryCount`, `hazardTypeCount`, `highRiskForecastCount`, `officialWarningCount`, `highSeverityCount`, `aheadOfWindowForecastCount`, `headlineEligibleForecasts`, `notLive`, `mergedSeismicReports`, `mergedCycloneReports`, `proximityEligible`, `areaEligible` | int | Server counts, computed over **all** events including not-live ones. The website computes its visible counts client-side over the filtered list. Use client counts for parity. About uses `countryCount` and `hazardTypeCount`. |
| `severityCounts`, `evidenceState`, `forecastClass`, `locationPrecision` | `{[value]: count}` | |
| `coverage`, `forecasting`, `refreshTarget`, `hazardModel` | string | |

`?summary=1` example: see the `meta` block of `sample-events.json`.

---

## 2. `GET /api/events?ledger=1`

```json
{ "generatedAt": "...", "meta": { "ledger": {"status":"loaded","recorded":1886,"windowClosed":1466,"graded":0,"awaitingGrading":1466} },
  "ledger": [ LedgerRow, ... ] }
```

`LedgerRow` (append-only; one id can appear many times, once per re-issued window): `recordedAt, id, type, title,
country, region, lat, lon, alert, severity, severityRank, issuedAt, sourceIssuedAt, targetStart, targetEnd,
forecastKind, forecastClass, forecastScope, classificationReason, effectiveForecastStart, forecastOf, source,
sourceUrl, confidence, evidence, verificationRule, freezeTimestamp, freezeBasis, sourceScanId, freezeEvidenced,
outcome`. Old rows may lack the newer fields. Forecast detail uses **the last row** with the id.

---

## 3. `GET /api/event-enrichment`: per-record help and context

Implemented in `api/event-enrichment.js`. The client is `event-enrichment.js` (`fetchAndRender`).

### 3.1 Request

```
GET /api/event-enrichment?title=…&country=…&region=…&type=…&updated=…&forecast=true|false[&lat=…&lon=…]
```

| Param | Max length | Notes |
| --- | --- | --- |
| `title`, `country`, `region`, `type`, `updated` | 180 / 80 / 160 / 80 / 80 chars (truncated server-side) | Send `""` for missing values, as the web does. At least one of title, country and type is required, otherwise the response is **400** `{"error":"Missing event context","hint":"Pass at least one of title, country or type."}` |
| `forecast` | `true` / `1` | When true, `reliefGroups` is `[]` and `donationPolicy` explains why. Always send `forecast=true` for forecasts. |
| `lat`, `lon` | numbers | Send them only when both are finite. They drive reverse geocoding (BigDataCloud) and map links. |

Region, location, hazard and history detail screens send a **synthetic** context (features.md §8.2, 8.3, 9.2, 11.2),
for example `title="Nepal natural disaster"&country=Nepal&region=Nepal&type=Flood`.

The web sends the parameters in this order: title, country, region, type, updated, forecast, lat, lon. The response
is **CDN-cached per exact URL**, so use the same parameter order and values to share cache hits with the website and
the pre-warm job.

### 3.2 Response headers

```
Cache-Control: s-maxage=300, stale-while-revalidate=900
Content-Type: application/json; charset=utf-8
Access-Control-Allow-Origin: *
```

The response is cached at the edge for 5 min, with up to 15 min of stale-while-revalidate. Clients re-request every
5 min (`refreshSeconds: 300`). A scheduled job pre-warms the cache for every live event using the exact query the
browser sends.

### 3.3 Response shape

Full example in `sample-enrichment.json`.

```jsonc
{
  "generatedAt": "ISO",
  "refreshSeconds": 300,
  "query": "Flood in Bagmati Province, Nepal Flood Nepal Bagmati Province",   // title type country region
  "event": { "title","type","country","region","updated": "ISO|null","lat": "number|null","lon": "number|null","forecast": "bool" },
  "when": { "reportedAt": "ISO|null", "label": "string", "note": "The time shown is when the source last updated its report. That can be later than when the event began." },
  "where": {
    "originArea": "Kathmandu, Bagmati Province, Nepal",              // or region / country / "Not supplied by the upstream source"
    "resolvedPlace": { "country","countryCode","state","city","locality","continent","administrativeChain":["…"],"resolvedBy":"BigDataCloud reverse geocoding" } | null,
    "coordinates": {"lat","lon"} | null,
    "affectedRegions": ["Bagmati Province","Kathmandu"],
    "affectedAreaText": "Bagmati Province · Kathmandu · Nepal",
    "mapLinks": {"openStreetMap","googleMaps","windy"} | null
  },
  "distressGroups": ["…"], "immediateNeeds": ["…"], "secondaryRisks": ["…"], "safetyActions": ["…"],   // per-hazard playbook
  "news":             [ { "title","link","outlet","publishedAt":"RFC-822 string or ISO or null","summary","via":"Google News|Bing News","established": true } ],  // max 24, newest first, only established outlets
  "situationReports": [ same shape, "via":"ReliefWeb (UN OCHA)" ],   // max 12
  "videos":           [ { "id","title","url","thumbnail" } ],
  "helplines": { "country": "Nepal", "matched": true, "emergency": [ {"label":"Police","phone":"100","note":""} ], "note": "…" },
  "authorities":   [ { "name","url","contactUrl?","email?" } ],
  "supportGroups": [ { "name","url","donate?" } ],
  "reliefGroups":  [ { "name","kind","url","donate","contactUrl?","email?","phone?" } ],   // [] when forecast=true
  "directories":   [ { "name","kind","url" } ],
  "donationPolicy": "string",
  "searches": { "googleNews","youtube","reliefweb","gdacs","ocha","ifrc" },               // fallback search URLs
  "sources":  [ { "name","role","url","items": "int","note?" } ],
  "coverage": { "refreshTarget","scope","newsProviders":[],"videoProviders":[],"humanitarian":[] },
  "disclaimer": "string"
}
```

Note that `publishedAt` in news items is the RSS date string (for example `"Sun, 14 Sep 2026 03:00:00 GMT"`), not
always ISO. Parse it with an RFC-822/1123 parser with an ISO fallback, and show "Publication time not given" if
neither works.

---

## 4. `/api/alerts`: background push registration (web)

Implemented in `api/alerts.js`. The client is `alerts-client.js`, and pushes are sent by `api/alerts-run.js`.

| Method | Body | Response |
| --- | --- | --- |
| `GET` | none | `200 {available, reason, schedule:{everyMinutes:5,cron}|null, keeps, rules:{nearKm:30, severeNearKm:100, recentHours:72}, publicKey: VAPID b64url|null, lastRun:{at, feedGeneratedAt, records, subscriptions, alerted, sent, failed, removed}|null}` |
| `POST` | `{subscription:{endpoint, keys:{p256dh, auth}}, places:[{kind, lat, lon}] (1 to 10)}` | `200 {ok:true, places, keptDays:90, scheduled, reason}` · `400 {ok:false, reason}` · `429` rate limit (30 requests per 10 min per IP hash) · `503` service not available · `502` store error |
| `DELETE` | `{endpoint}` | `200 {ok:true, removed}` |

All responses send `Cache-Control: no-store`. **Auth:** none for clients. The run endpoint (`/api/alerts-run`) needs
a QStash signature or `Authorization: Bearer $CRON_SECRET`, and clients must never call it.

**Production state (20 Oct 2026):** `GET /api/alerts` returns

```json
{"available":false,"reason":"Background alerts are not switched on for this site yet. It has nowhere to keep your alert settings and nothing that checks for dangers while the site is closed.","schedule":null,"keeps":"For each place: its kind (Home, Office, Family, Travel or Current location) and its position rounded to about 1 km. No name, address or account. Deleted when alerts are switched off, and 90 days after this device last opened the site.","rules":{"nearKm":30,"severeNearKm":100,"recentHours":72},"publicKey":null,"lastRun":null}
```

**Can native apps use it?** Not for delivery, for three reasons:
1. `cleanSubscription` accepts only Web Push subscriptions: an HTTPS endpoint on `fcm.googleapis.com`,
   `android.googleapis.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`, `web.push.apple.com` or
   `*.push.apple.com`, plus a 65-byte P-256 `p256dh` and a 16-byte `auth`. An APNs device token or an FCM
   registration token is not a Web Push subscription, and `alerts-run` sends RFC 8291 encrypted Web Push with a VAPID JWT.
2. The service is switched off in production.
3. No per-device auth exists, so POST and DELETE are only rate-limited.

Native apps **should** call `GET /api/alerts` to read `rules` (show them in the "What we send and what we keep"
disclosure) and `keeps`. They should implement on-device background evaluation (features.md §16.3). Server push for
native needs a new endpoint (APNs/FCM). Keep the same privacy contract: kind plus coordinates rounded to 2 decimals,
at most 10 places, 90-day expiry, deletion when switched off.

---

## 5. Static files

Served by the Vercel static CDN. Default headers are `Cache-Control: public, max-age=0, must-revalidate` (always
revalidate; ETag supported) and `Access-Control-Allow-Origin: *` (seen in production). Exceptions in `vercel.json`:
`/world-countries.json` sends `public, max-age=86400, stale-while-revalidate=604800`, and `/icons/*` and `/vendor/*`
are immutable for 1 year. **The web adds `?ts=<now>` and `cache:'no-store'` to ledger reads.** Native: use
conditional GET (ETag / If-None-Match), or always refetch on screen open.

| Path | Size | Used by | Top-level shape |
| --- | --- | --- | --- |
| `/data/outlook-ledger.json` | about 3.0 MB | Track record, forecast detail fallback | `LedgerRow[]` (§2) |
| `/data/verification-ledger.json` | 10 KB | Track record, ND-001 result | `{schemaVersion, updatedAt, rules, verifications:[{id, status, observedSeverity, evidenceConfidence, coverageStatus, country, region, hazard, targetStart, targetEnd, summary, criteria:{…bool}, final}], observedEvents:[{id, status, observedSeverity, evidenceConfidence, coverageStatus, country, region, hazard, observedAt, lastMaterialChangeAt, authoritativeSource, sourceUrl, impacts, …}]}` |
| `/data/observed-disasters.json` | about 1.9 MB | Track record (recall) | `{schemaVersion, note, events:[{eventId, canonicalEventId, hazard, hazardLabel, geography:{country, region, lat, lon,…}, geometry, onset, end, firstAuthoritativeReport, source, sourceUrl, severity, alert, alertBasis, deaths, injuries, missing, affected, displaced, evacuated, infrastructureImpact, impactLastUpdated, evidenceConfidence, significant, significanceReason, matchedPredictionIds, predictionCoverageStatus, evidence, mergeReasons, unattachedReason, firstRecordedAt, significanceAtEntry, geographyAtFirstRecord, lastSeenAt, sightings, revisions, derivedIdHistory, supersededBy?}], supporting:[…], updatedAt, method, lastRun}` |
| `/data/scan-ledger.json` | 240 KB | Track record (coverage) | `{schemaVersion, note, scans:[{scanId, scanTimestamp, engineVersion, providerVersion, providers}], engineVersion, coverageLimitation, providerVersions, providers, aggregate, retention, updatedAt}` |
| `/data/model-backtest.json` | 3 KB | Track record backtest | `{note, generatedAt, climatologyPeriod, places, skipped[], window:{from,to}, heatLine:'trend'|…, fireNote, results:{'heat@3':{hits, misses, falseAlarms, correctNegatives, days, …}, 'heat@5', 'rain@3', 'rain@5', 'fire@3', 'fire@5', 'heatUnshifted@3', 'heatUnshifted@5'}}` |
| `/data/model-verdicts.json` | 17 KB | Track record published model forecasts | `{note, generatedAt, counts:{issued, correct, falseAlarms, pending, missedDays}, outlooks:[{id, hazard:'heat'|'rain'|'fire', placeId, verdict:'correct'|'false alarm'|'pending', crossed}], misses:[{placeId, hazard, day}]}` |
| `/data/forecast-changes.json`, `model-ledger.json`, `model-outlooks.json`, `model-runs.json`, `climatology.json` | | not read by pages (the server and tools use them) | |
| `/world-countries.json` | 172 KB | Map base layer, and the on-device "which country am I in" lookup | GeoJSON `FeatureCollection` of 177 countries; `properties: {n: name, c: paletteIndex}`; Polygon/MultiPolygon. **Bundle it in the app.** |

Deploy note: `vercel.json` `ignoreCommand` skips deploys for commits tagged `[ledger]`, so the deployed `/data/*`
files and the function-bundled ledger can lag behind the repository. Always show the file's own `updatedAt` or `recordedAt`.

---

## 6. Third-party endpoints called directly by the client

| Service | Call | Rules |
| --- | --- | --- |
| OpenStreetMap Nominatim | `GET https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&accept-language=en&limit=8&q={q}` with header `Accept: application/json` | **Only on explicit submit, never as you type** (usage policy). Native must also send an identifying `User-Agent` (for example `PredictNaturalDisasters-iOS/1.0 (+https://predict-natural-disasters.anchit-tandon.com)`) and stay at or below 1 request per second. Response → `PNDPlaceSearch.candidates` (logic.md §3.5). |
| Map tiles | Esri World Imagery `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`; Esri boundaries and places `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`; NASA GIBS daily `https://gibs-{a,b,c}.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{YYYY-MM-DD}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, where the date is the UTC day of (now − 28 h), max zoom 9, and the label is "NASA today ({d Mon yyyy})" (see `map-setup.js dailyImagery()`) | Credits: "Esri, HERE, Garmin, © OpenStreetMap contributors", "Country outlines: Natural Earth (public domain)", plus the NASA GIBS credit. Native may use MapKit or Google Maps base maps instead, but must keep the dark default style and the risk markers. |

---

## 7. CORS and security headers summary (`vercel.json`)

- `/api/(.*)`: `Access-Control-Allow-Origin: *`. No `Allow-Methods` or `Allow-Headers` are declared, so browsers on other
  origins can only make simple requests. **Native apps are not subject to CORS.**
- All paths: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`, and HSTS for 2
  years with preload.
- HTML pages and detail routes are `no-store`. Not relevant to native apps.

## 8. Recommended client behaviour

1. One shared `FeedRepository`: `GET /api/events` every 60 s while any feed screen is in the foreground, a forced
   refresh (`?ts=`) on pull-to-refresh, and an in-memory last-good copy. Expose `live` (with `live !== false`
   records only) and `all` views, as `PND.getEvents` does.
2. Decode with lenient models. Every field except `id`, `lat`, `lon`, `type`, `title`, `source` and `sourceType` is
   optional. Keep unknown fields; the API adds fields often.
3. Never coerce a missing number to 0 (logic.md §5).
4. Send the same `User-Agent` for every request to this API, for example `PredictNaturalDisasters-{iOS|Android}/{version}`.
