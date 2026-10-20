# Predict Natural Disasters: native feature parity spec

Target: native **iOS (SwiftUI)** and **Android (Jetpack Compose)** apps that do everything the website at
`https://predict-natural-disasters.anchit-tandon.com` does. This file covers *what* each screen shows and does.
The companion files cover the rest:

| File | Contents |
| --- | --- |
| `api.md` | HTTP contract, JSON shapes, caching, CORS, what native apps can and cannot call |
| `logic.md` | Client logic to port exactly (risk scale, place risk, alert rules, key facts, formatting, sorts, verdicts), with test vectors |
| `design.md` | Colour tokens, type, spacing, components (dark theme) |
| `sample-events.json` | Real `/api/events` response produced by running `api/events.js` against `test/mock-upstreams.js` |
| `sample-enrichment.json` | Real `/api/event-enrichment` request and response from the same harness |
| `test-vectors.json` | Input and output pairs captured by running the website's own JS (`node tools/make-parity-vectors.js`; `test/parity-vectors.test.js` fails when it is stale). Use them as unit-test fixtures |

Source of truth is the website code on branch `claude/website-audit-fixes` (PR #65) at commit `117201b`, 20 Oct 2026.
Every section below names the file that implements it. The first version of this spec (commit `ad275d8`) was taken
from `claude/disclaimer-sources-updated` at commit `224bde3`, before the audit fixes; the changelog below lists every
website behaviour that has changed since then.

## Changelog: website changes since the first spec (`ad275d8`)

The native apps were built to the first spec, so they repeat website bugs that the website has since fixed. Each
row below is a change the apps must port. "Supersedes" names the text of the first spec that is now wrong; the
sections below have been rewritten to match. "Vectors" names the `test-vectors.json` groups that pin the new
behaviour (all of them were produced by running the site code with `tools/make-parity-vectors.js`, and
`test/parity-vectors.test.js` fails when the file goes stale). Website commits: `5992bf0` (audit findings P1 to P16
and P18), `b9163f6`/`456996e` (one time zone per page, sources named without a count), `f9265cb` (trust note in the
page HTML), `4c11103` (accessibility, layout and performance), `a94cd45` (dead ReliefWeb address).

| # | Change (old → new) | Website file : function | Supersedes (first spec) | Vectors |
| --- | --- | --- | --- | --- |
| C1 | **Continents are the countries on them.** A continent region page (Asia, Africa, Europe, North America, South America, Oceania, Antarctica) used to match the continent's name as text inside each record and so listed nothing for most of the world. Now a record is on every continent that one of its countries (`countries[]` plus the comma-split `country`, with a trailing " region" removed) is on. A record that names no country is on no continent. Any other place name is matched by `matchesPlace` or a substring of `countries[]`. | `continents.js`: `continentNamed`, `continentsOf`, `onContinent`; `portal.js`: `PND.inPlace`; `region-detail.html`: `matches()` | §1.5 (continent chips opened empty pages), §8.2 match rule | `continents.NAMES`, `continents.continentNamed`, `continents.continentsOf`, `continents.onContinent`, `portal.inPlace`, `regionDetail.matches` |
| C2 | **Hazards are matched whole.** The first word of the type (with "wildfire" cut to "wild", "volcano" to "volcan") made "Extreme Cold" match every "Extreme Heat" record, and an unknown type fell back to Flood. Now a type's key is the `HAZARDS` key that `hazardOf(type)` resolves to ("Volcanic Eruption" is Volcano, "Heat wave" is Extreme Heat), or the trimmed type itself when `hazardOf` gives DEFAULT ("Ice", "Special Marine Warning"). Two types are the same hazard when their keys are equal ignoring case. | `portal.js`: `PND.hazardKey`, `PND.sameHazard`; `index.html`: `hazKey`; `hazard-detail.html`: `here`, `fillHazards` | §1.6 hazard filter, strip and their stem match; §9.2 select list and stem match | `portal.hazardKey`, `portal.sameHazard`, `hazardDetail.select`, `hazardDetail.fillHazards`, `home.render` |
| C3 | **An official warning is a warning in force.** Was: `sourceType==='official'` and alert Red or Orange (home tile and table), or that OR `source==='USGS'` (lists), which counted hundreds of earthquakes that had already happened. Now: not a forecast, and `evidenceState==='official-warning'`; a record with no `evidenceState` counts when `sourceType==='official'` and it has an `expiresAt`. Lists also drop `live===false`. Tile subline "Issued by agencies, in force now" with the tooltip `PND.WARNING_MEANING`; empty table text "No official warning is in force in our sources right now."; list subtitles rewritten. | `portal.js`: `isOfficialWarning`, `officialWarnings`, `WARNING_MEANING`; `collection.js`: `keep()`; `index.html`: `render()` | §1.3 Official warnings tile; §1.6 Official Warnings table; §3.2 rows official-warnings and alerts-notifications | `portal.isOfficialWarning`, `portal.officialWarnings`, `portal.WARNING_MEANING`, `collection.keep`, `home.render` |
| C4 | **A graded forecast shows its grade.** STATUS read "Ended, not yet checked" for a forecast already graded (ND-001 is Partly correct). Now the page looks the id up in `/data/verification-ledger.json` (`verifications[].status` through `PNDVerdicts.normalise`, ignoring PENDING and UNKNOWN) and, for ids starting `model-`, in `/data/model-verdicts.json` (`outlooks[].verdict` "correct" or "false alarm"). A grade sets STATUS to "Checked: {label}", the timing row to "Ended" and its text to "The forecast period ran to {end} and has been checked. Result: {label}. {summary}". | `forecast-detail.html`: `gradeOf`, `showGrade` | §7.4 STATUS and the "Inside the locked forecast period" row | `verdicts.LABELS`, `verdicts.label`, `forecastDetail.gradeOf` |
| C5 | **A record its provider stopped updating is not called live.** `live:false` records showed the eyebrow "LIVE EVENT" and DATA STATUS "Live" under the quiet note. Now: eyebrow "EVENT NO LONGER UPDATED"; DATA STATUS / STATUS from `PND.liveWord` ("Saved copy", "Our forecast", "Not updated recently", "Live"); the event "Status" row and the calamity status give the quiet note. | `portal.js`: `liveWord`; `event-detail.html`, `alert-detail.html`, `calamity-detail.html`: `load()` | §7.1 eyebrow, DATA STATUS and Status; §7.2 STATUS; §7.3 Status | `portal.liveWord`, `detail.statusWords` |
| C6 | **Alerts shows 40 at a time and says so.** The grid stopped at 40 with nothing to say more existed. Now: 40 cards, then a "Showing {n} of {N}." card with a "Show {min(40, rest)} more" button; when all are shown and there were more than 40, "Showing all {N}."; focus moves to the first new card. A new filter, search or sort goes back to 40; a feed refresh keeps the count. | `alerts.html`: `draw(more)` | §3.1 "grid of the first 40 cards" | `alerts.pager` |
| C7 | **Home "Live events" lists reports only, in its own sort.** Was "Most serious live events": the top 5 of all records, our forecasts included, always by severity. Now the card is titled "Live events" and shows the first 5 non-forecast records sorted by the card's own sort control (default "Newest first", stored under `pnd_sort_home_sortBy`). "Latest events" is the 5 newest reports (not the current sort); "Latest forecasts" is open forecasts newest first; "Official warnings" is in-force warnings by severity. | `index.html`: `render()` | §1.6 top-5 bullets and "Latest events" | `home.render` |
| C8 | **Hazard filters are built from the data.** Every non-forecast collection list (events, recent-events, official-warnings, alerts-notifications, hazard-types, historical-events, compare-locations) offered a fixed six (Flood, Earthquake, Wildfire, Volcano, Tropical Cyclone, Drought) and matched by a stem substring; the home map offered a fixed eleven. Now every collection list (forecast-list and forecast-calendar already did) fills its select with `PND.fillHazardSelect(sel, records in the list)` ("All hazards (N)", then "{type} ({n})" by count) and matches the type exactly. The home map filter is filled from the live records and matches with `hazardKey`. The Forecasts tab counts forecasts only (it counted high-alert reports too). | `collection.js`: `load()`, `render()`; `index.html`: `load()`, `render()`; `forecasts.html`: `load()`; `portal.js`: `hazardOptions`, `fillHazardSelect` | §0.3 hazard filter bullet; §1.6 hazard filter list; §3.2 "hazard filter (fixed list)"; §4 hazard filter | `portal.hazardOptions` (unchanged), `home.render` (`hazardFilterOptions`) |
| C9 | **The time zone defaults to the device's.** Was Asia/Kolkata for everyone. Now `localStorage.pnd_timezone`, else the browser zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), else Asia/Kolkata. The trust note formats its times with the page's own `PND.fmtDate`, so a page shows one zone. | `portal.js`: `PND.timezone`; `trust.js`: `when()` | §17 default and its last bullet; §15.1 `when()` format | `portal.timezoneDefault` |
| C10 | **Trust note copy and sources line.** "follow your national weather or disaster agency:" is now "follow your national agency:"; "Live data fetched from the agencies" is now "Live data from the agencies"; "weather models last run" is now "weather models run"; "Data sources (N): …" is now "Data sources: …" (names only). The note is in each page's HTML (no layout shift); the track record page hands its ledger time to the note (`PNDTrust.recorded`). | `trust.js`: `noteHtml`, `updatedLine`, `when`, `recorded`; `tools/trust-markup.js` | §0 rule 1 quote; §15.1 | none (copy) |
| C11 | **ND-001 check screen: all 8 metrics.** No website change; the first spec called it lower priority and the iOS app ported 3 rows. Section 14 now specifies every row, the stats and the trust group (`feed models`). | `verification-detail.html`: `load()` | §14 | `verificationDetail.render` |
| C12 | **Selected-event card and search on the home map.** Selecting a marker, or hovering or focusing a "Live events" row, shows the card with eyebrow "Selected event on map", the title, `type · place · source` and "See details →". The map search ignores an empty box, trims the query, and when nothing matches clears the selection and shows eyebrow "Search", "No live event matches "{q}"", "Try a country, a city or a type of hazard." with the details button hidden. | `index.html`: `selectEvent`, `mapSearch` keydown | §1.6 location search and nudge bullets | none (UI) |
| C13 | **Home hazard strip.** Built from reports only, grouped by `hazardKey`, ordered by count then name, every reported hazard shown (Extreme Heat ☀, Tsunami ≈, any other ◆), labelled "{n} reported" (was "{n} tracked", counting forecasts by first word). | `index.html`: `render()` | §1.6 strip | `home.render` (`hazardStrip`) |
| C14 | **One count per quantity.** `PND.observed` (live, not forecast), `PND.openForecasts` (live forecast, `!windowClosed`), `PND.isHighAlert` (not forecast, alert Red, Orange or High), `PND.sourcesReporting` (distinct `source`), `PND.countryCount`. Forecasts tab "OPEN FORECASTS" counts open forecasts; Regions "COUNTRIES AND AREAS" is `countryCount(reports)`; region and hazard pages list reports only and count sources with `sourcesReporting` (the region stat is now labelled "SOURCES REPORTING HERE"); forecast-list and calendar status read "{N} forecasts: {open} open, {ended} ended". | `portal.js`; `forecasts.html`, `regions.html`, `region-detail.html`, `hazard-detail.html`, `collection.js`: `countText` | §3.2 countText; §4 FORECASTS stat; §8.1 COUNTRIES AND AREAS; §8.2 SOURCES and record set; §9.2 stats and record set | `portal.observed`, `portal.openForecasts`, `portal.isHighAlert`, `portal.sourcesReporting`, `collection.keep` (`countText`) |
| C15 | **"Nothing matches" counts reports.** The "Right now we have {N} events from {C} countries" line counted every record, forecasts included, and raw country strings. Now it counts `live!==false && !forecast` records and `countryCount` of them. | `search.js`: `emptyHtml`, `countryCount` | §0.3 empty results | `search.emptyHtml.counts`, `search.countryCount` |
| C16 | **"Ending soonest first" puts ended windows last.** A window that has ended (`targetEnd <= now` or `windowClosed`) sorts after every open one, most recently ended first; open ones stay soonest first. | `portal.js`: `SORT_DEFS.windowEnd` | logic.md §8 windowEnd row | `sort.windowEndEnded` (`sort.results` unchanged) |
| C17 | **`/events?region=` is honoured.** Region detail's "See all events →" link opens `/events?region={name}`, which was ignored. Collection lists now keep only records `PND.inPlace(e, region)` (World means everything) and show "Showing only {region}. Show everywhere →". | `collection.js`: `scoped`, `scopeNote` | §8.2 "See all events" | `collection.keep` (`scoped`) |
| C18 | **The live map moves to a search.** A new search fits the map to the matching records (max zoom 6) and says "{n} event(s) match "{q}". The map shows it/them." or "No event matches "{q}"." A refresh does not move the map. | `live-map.html`: `draw()` | §2 toolbar | none (UI) |
| C19 | **A failed feed is not an empty world.** Alerts, Forecasts, Region, Hazard, Live map, Home and the dashboard now set their figures to "Unavailable" and lists to the "Live data unavailable." card (`PND.unavailableHtml`) when nothing has loaded, and keep earlier data otherwise. | `portal.js`: `unavailableHtml`, `feedDown`; those pages' `load()`; `index.html`: `down()` | §0.2 load error; §1.7 | none (UI) |
| C20 | **Not found and not loaded on detail screens.** Event, alert, calamity and forecast detail hide the body and say so ("Event not found" with a link to all events, "Alert not found" with a link to official warnings, "Disaster not found" with a link to current disasters, "Forecast not found" with a link to the forecast list, or "Live data unavailable" when the first load fails). | `event-detail.html`, `alert-detail.html`, `calamity-detail.html`, `forecast-detail.html`: `gone`, `notFound`, `unavailable` | §7.1 to §7.4 not-found lines | none (UI) |
| C21 | **Hazard detail.** The select holds every `HAZARDS` key, every hazard present and the requested type, A to Z (an unlisted type is offered as itself, not Flood). Current events are reports only; open forecasts of the hazard are counted in a note under the list. The empty text adds "Our sources have no current report of this hazard{ here}. This does not mean there is no danger." The region box uses `inPlace` (continents work). | `hazard-detail.html`: `fillHazards`, `load()` | §9.2 | `hazardDetail.fillHazards`, `hazardDetail.select` |
| C22 | **Unknown source and topic pages say so.** A source name with no profile and no current report shows "Source not found"; STATUS adds "Named in current reports". An unknown topic shows "Topic not found". | `source-detail.html`, `entity-detail.html` | §10.2; §12 | none |
| C23 | **My places keeps the country after an Enter search.** The field's change event after a search no longer clears the country the search found; only an edit by the reader does. | `personal-risk.html`: `chosenAs` | §5.2 | none |
| C24 | **Map markers.** The mark keeps its size (`markerIcon` `iconSize`, 9 to 27 px by level) inside a square tap area of `max(24, size)` px centred on it, and markers are out of the keyboard tab order (the list beside the map is the keyboard path). Phones and save-data readers open on the flat map, not the globe. | `map-setup.js`: `riskMarker`; `globe.js`: `prefers` | design.md §3.3 | none |
| C25 | **Static data reads revalidate.** `/data/*` is served `max-age=0, must-revalidate`; the track record reads its ledgers with `cache:'no-cache'` and no `?ts=`. The ReliefWeb candidate `/disasters/feed` was dropped (`endpoint` is now `https://reliefweb.int/disasters/rss.xml`). | `vercel.json`; `accuracy.html`: `readLedger`; `api/events.js` | api.md §5; §6 Track record "?ts= cache-busting" | none |

---

## 0. Global rules (apply to every screen)

These are the product's invariants. The website's test suite enforces them, and they also show up as long comments in
the code. A native build that breaks one of them is not at parity, even if every screen is present.

1. **Experimental, not official.** Every screen that shows a forecast or a risk level carries the trust note
   (section 15): *"Experimental model, not an official warning. For real alerts, follow your national agency: IMD
   and NDMA in India, NWS and USGS in the US, GDACS worldwide."*
2. **Forecasts are never presented as official.** Every forecast is labelled "Our forecast, not official",
   "OUR FORECAST", "Test case, not made in advance" or "TEST FORECAST" (see `PND.provenance`, logic.md §6).
   Forecasts never get donation links (the enrichment API returns `reliefGroups: []` for `forecast=true`). The
   forecast eyebrow reads `OUR FORECAST, NOT OFFICIAL`.
3. **Never show a risk level for "nothing found".** When place risk has `level == null`, show a neutral
   outlined chip that reads **"Nothing reported nearby"** (class `risk risk-unknown`). Never show a green LOW badge.
   The explanation must say *"This does not mean the place is safe."*
4. **Unknown is not a level.** An unrecognised or missing level renders as "Not rated" with a hollow-circle shape
   and no colour from the scale. Never fall back to Moderate or Low.
5. **A level is never shown by colour alone.** Every risk badge and map marker carries colour, the word and a
   shape (circle, ring, triangle, diamond, hexagon, star, plus hollow circle for unknown). See design.md §3.
6. **Provenance badges are neutral.** "OFFICIAL WARNING", "OUR FORECAST", "REPORTED EVENT", source pills and
   verdict pills are outlined and grey or green-grey. They are never filled with a risk colour, because an official
   warning is a statement about who said it, not a severity.
7. **Earthquake prediction limits.** Never imply that an earthquake (its time or place) was or can be predicted.
   Earthquakes are reported after they happen. The only seismic forecasts are 7-day *aftershock* outlooks after
   an M5.5+ mainshock, and these state *"It does not predict a new, separate earthquake"* and *"We do not claim to
   have predicted the main earthquake."* The home hazard strip marks Earthquake as "observed only"
   (`hazardOf(t).forecastable === false`).
8. **Missing is not zero.** A count that no source reports shows "Not reported" (or "Not reported by the source").
   A reported `0` shows `0`. Never use `+v > 0` to test whether a figure is present. Test for null, undefined and
   the empty string instead (logic.md §5).
9. **Empty is not safe.** Every empty list explains that the absence of reports does not mean the absence of risk,
   using the exact copy from the website (see each screen).
10. **Failure is not empty.** If a fetch fails, say "Live data unavailable. Trying again automatically." (or the
    screen-specific text). Never render an empty list or a 0 as though the data had loaded. When nothing has loaded
    yet, every figure reads **"Unavailable"** and every list shows the card from `PND.unavailableHtml()`:
    **"Live data unavailable."** / *"We could not load the latest reports, so nothing can be shown here. This does not
    mean nothing is happening. Trying again automatically."* (`PND.feedDown(kpiIds, listIds)`). When an earlier load
    succeeded, keep its data and only change the status line.
11. **The data's time, not the device's.** Every "updated" stamp comes from the response (`generatedAt`,
    `meta.modelRun.at`, a ledger's `updatedAt`). Format it in the user-selected timezone with the zone named
    (section 17). Never show "now" from the device clock as the data time.
12. **No made-up percentages.** Never invent a figure like "92% chance". Rates appear only on the Track record
    screen, and each one shows its denominator ("67% (2 of 3)").
13. **Acronyms.** On the web, `glossary.js` writes out the first use of each acronym in prose. Native apps should do
    the same in body text, and must always apply the `expandAlways` rules (bearings, "M 6.5" to "Magnitude 6.5",
    US state codes) to titles before display, search and sort (logic.md §9).

## 0.1 Navigation (information architecture)

Implemented in `portal.js` (`PND.NAV`, `PND.FOOT`, `PND.nav()`, `PND.footer()`), with the phone tab bar in `portal.css`.

On a phone the website shows **five bottom tabs**, in this order:

| Tab | Web route | Native screen |
| --- | --- | --- |
| Map | `/live-map` | Map (section 2) |
| Alerts & events | `/alerts` | Alerts & events (section 3) |
| Forecasts | `/forecasts` | Forecasts (section 4) |
| My places | `/personal-risk` | My places (section 5) |
| Track record | `/accuracy` | Track record (section 6) |

The logo ("Predict Natural Disasters / Check a place · live hazards · forecasts") opens **Home / Check a place**
(`/`), section 1. On native, make Home the launch screen and reach it from a logo button in every tab's top bar.
Alternatively make it a sixth tab, but the website deliberately has five. The PWA manifest's `start_url` is
`/personal-risk`; the website's own landing page is `/`. **Decision for the product owner: launch screen = Home is
recommended.**

The header also holds a **timezone picker** (section 17) and a "● Live" link to Events (section 3.2).

**Footer / "More" screen** (`PND.FOOT`): Check a place, Live events, Official warnings, Disasters now and in the
past (calamities), Regions, Forecast calendar, How it works (methodology), Our sources (resources), Insights,
About. Native: put these on a "More" sheet or screen reachable from every tab, followed by the trust footer
(section 15.2).

`PND.NAV_ALIAS` marks which tab is active for secondary screens: Live Map maps to Map; Alerts, Calamities and
Events map to Alerts & events; Personal Risk maps to My places; Verification and Accuracy map to Track record.
Forecast list and forecast calendar highlight Forecasts. Official warnings and alerts-notifications highlight Alerts & events.

**Deep links** (web routes from the `vercel.json` rewrites). Native apps should register these as universal links / app links:

| Path | Screen |
| --- | --- |
| `/disasters/{id}` | Event detail (section 7.1) |
| `/alerts/{id}` | Alert detail (section 7.2) |
| `/calamities/{id}` | Calamity detail (section 7.3) |
| `/forecasts/{id}` | Forecast detail (section 7.4) |
| `/regions/{name}` | Region detail (section 8.2) |
| `/locations/{name}?lat=&lon=&level=&country=&cc=` | Location detail (section 8.3) |
| `/hazards/{type}?region=` | Hazard detail (section 9.2) |
| `/history/{slug}` | Historical event detail (section 11.2) |
| `/sources/{name}` | Source detail (section 10.2) |
| query forms `/event-detail?id=` and so on | same screens (`PND.canonicalDetailUrl`) |

Which detail screen a record opens is decided by `PND.eventUrl(e)` (logic.md §6): forecasts open forecast detail,
official records with alert `Red` or `Orange` open alert detail, and everything else opens event detail.

**ID resolution:** a detail screen looks the id up with `PND.findEvent` (logic.md §6). That function does an exact
match, then a decoded match, then a match on alphanumerics only, then a match on the title, then a suffix match. A
not-found result shows the not-found copy for that screen. The website's `404.html` also forwards a record route to
its page if the id still resolves. Native: show "That event or forecast is no longer listed. We searched the latest
data by its ID and by its title, and found no match." with links to Events, Official warnings, Our forecasts,
Calamities and Regions.

## 0.2 Refresh behaviour (all list and detail screens)

Implemented in `PND.autoRefresh` and `PND.getEvents`.

- List and map screens poll `/api/events` **every 60 s** while visible. On the web `PND.autoRefresh` caps every timer at 60 s.
- Detail screens re-render from the feed every 60 s and re-request enrichment every **5 min** (`REFRESH_MS = 300000`).
- **"↻ Refresh now"** buttons request `/api/events?ts=<epoch ms>` with no-cache. That bypasses the 30 s edge copy.
  Automatic polls request plain `/api/events`, so they can be served the shared edge copy.
- Lists show **live records only**: drop records with `live === false` (`PND.getEvents()` default). Detail screens
  and some archive views ask for everything (`{all:true}`), so a quiet record still opens. That screen then shows the
  quiet note: *"Not updated by {source} for {n} day(s). It may have ended; check the source for its current status."*
  (`PND.quietNote`) in a `.stale` box under the subtitle.
- Status line text: `PND.statusText(meta)` gives *"Live · {ok} of {total} sources working"*, or *"Our data sources are
  not answering · showing saved copies only"* when `meta.live` is false, or *"Refreshing"* before any data arrives.
  It is followed by ` · {fmtDate(generatedAt)}` or ` · updated {age(generatedAt)}` depending on the screen.
- Load error text, everywhere unless noted: **"Live data unavailable. Trying again automatically."** If nothing
  had loaded before, the screen's figures and lists switch to the unavailable state (rule 10, `PND.feedDown`):
  Alerts (5 stats, the grid; the source list is emptied), Forecasts (6 stats, both lists; the hazard tiles and horizon
  note are emptied and "What changed" reads *"Live data unavailable, so we cannot say what changed. Trying again
  automatically."*), Region detail (5 stats, the list; the coverage line reads *"Live data unavailable, so we cannot
  say what is reported here right now."*), Hazard detail (4 stats, the list), Map (the list), Home (section 1.7).
- Loading text: "Loading…" or "Loading the latest data…". The home KPI tiles show an animated shimmer bar (`.kpi strong.pending`)
  that stops ("settles") whether or not the load succeeded.

## 0.3 Shared list controls

Implemented in `search.js`, `portal.js` and `collection.js`.

- **Search box** (`PNDSearch.matches`): every whitespace-separated term must appear, case-insensitively, in the
  record's search text. The search text is the fields `title name country affectedCountries region location type
  hazard source src details summary id eventId` joined, plus the glossary-expanded form of that text. So
  "california" finds "CA" and "magnitude" finds "M 6.5". The query is mirrored to `?q=` (the website also accepts
  `?search=`). Native: persist it in screen state and in deep links.
- **Place-only filter** (`matchesPlace`) uses only `country affectedCountries region location`. It is used by the
  Regions search, alert detail "same area" and hazard detail region box. It never matches titles, so "flood" does
  not match places.
- **Risk-level filter**: options "All risk levels", then Extreme, Severe, High, Moderate, Watch, Low, Not rated
  (`PND.riskLevelOptions`). It matches the record the same way the badge resolves it (logic.md §2.3).
- **Hazard filter** (changelog C8): on every list screen the options are built from the records the screen lists,
  as `"All hazards (N)"` (value `""`) then `"{type} ({count})"` (value = the raw `type`) sorted by count descending and
  then by name. A previously selected type that is now absent stays selectable with `(0)` (`PND.hazardOptions`,
  `PND.fillHazardSelect`). There is no fixed list any more: Extreme Heat, aftershock sequences, storm warnings or
  "Ice" are selectable whenever they are present. Matching:
  - Collection lists (section 3.2) and the Forecasts tab: the type exactly (`String(e.type).toLowerCase() ===
    value.toLowerCase()` in `collection.js`, `e.type === value` in `forecasts.html`).
  - Home map (section 1.6): the same hazard by `PND.hazardKey` (logic.md §6.10), so choosing "Volcano" also shows
    "Volcanic Eruption" records.
  - Calamities (section 3.3) still has its own fixed list and substring match (unchanged).
- **Sort control**: a select filled from `PND.SORT_DEFS` with a per-screen key list. The choice is remembered per
  screen (`localStorage['pnd_sort_'+path+'_'+id]`; native: per-screen key in UserDefaults/DataStore). Definitions and
  per-screen lists are in logic.md §8.
- **Empty results** (`PNDSearch.emptyHtml(query, pool, all, noun)`):
  - With no query: **"No {noun} to show right now."**
  - With a query that matches records elsewhere in the feed: **"No {noun} match "{q}"."**, then *"{n} other event(s)
    in our current data match(es) this search. This page shows only {noun}."*, then a button *"See it / See all {n} on
    the events page →"* that opens Events with `?q=`.
  - With a query that matches nothing: **"No {noun} match "{q}"."**, then *"Nothing in our current data matches it.
    Right now we have {N} event(s) from {C} countries and territories / country or territory. We only show what
    official sources are reporting. If a place has no current official report, it is not listed here. That does not
    mean nothing is happening there."* **N counts reports only** (records with `live !== false` and not `forecast`),
    and **C is `countryCount` of those reports** (a record naming "India, Nepal" names two countries) (changelog C15).

## 0.4 Shared record card ("event card")

Implemented in `collection.js` and `live-map.html`. This card is used on Events, Map list, Official warnings and
similar lists.

- Row of pills: **risk badge** (`PND.riskTag`), **source pill** (`PND.sourceBadge`, short name with the full name as
  an accessibility label, see `shortSource` in logic.md §6). Forecasts add a provenance pill "Our forecast, not
  official", or "Test case, not made in advance" for `forecastKind=frozen-benchmark`. A closed window adds "Forecast
  period ended".
- Title: `PND.titleOf(e)` (forecast names rewritten, logic.md §6).
- Line: `{type} · {placeOf(e,'Place not given')}`.
- Figures line: `PND.keyFactsLine(e,3)` in bold (reported facts only). If empty, fall back to
  `summary(impactText(e) || details)` (first sentence, at most 160 characters). The boilerplate sentences *"This is
  our own estimate, not an official warning."* and *"This is not a deterministic prediction…"* are stripped from card
  summaries. They stay in full on the forecast's own page, and the list states them once for the whole screen.
- Footer (muted): forecasts with `targetEnd` show `{windowText(e)} · ` first, then `Source updated {fmtDate(updated)} · {age(updated)}`.
- Tapping the card opens `eventUrl(e)`.

---

## 1. Home / "Check a place"

Implemented in `index.html` (self-contained; it uses `place-search.js`, `place-risk.js`, `alert-rules.js`,
`alerts-client.js` and `portal.js`). Trust note: groups `feed models place`, placed under the "Use my location" row.

### 1.1 Hero: "Is a place you care about at risk?"
- Subtitle: *"Search for any city, town or neighbourhood to see what official agencies are reporting near it right now, and why it matters."*
- **Input** "Search city, area or address" with a **Check risk** button (primary green). Submitting an empty box
  shows *"Type a city, area or address first."*
- Search goes to Nominatim through `PNDPlaceSearch.search(q)` (api.md §6). It runs **only on submit, never as you
  type** (this is Nominatim's usage policy). While it runs the button is disabled and the note reads *"Finding the place…"*.
  - 0 results: *"We could not find that place. Check the spelling, or add the city or country, for example "Andheri, Mumbai"."*
  - 1 result: answer that place immediately.
  - More than 1: *"We found {n} places with that name. Choose one."* followed by a **place chooser**. The chooser has
    the heading "Which place do you mean?" and one button per candidate showing its name, a level chip (Area / City
    or town / District / State or region / Country / Address or landmark / Place) and the full address underneath
    when it differs.
  - Error: *"Place search is not working right now, so we cannot check this place. Your saved places on the My places page still work."*
- **Use my location** (outlined pill). It asks the OS for a location (10 s timeout) and finds the country *on the
  device* with point-in-polygon against `/world-countries.json` (`PNDAlerts.countryAt`). The position is never sent
  anywhere to be named. Then it answers `{kind:'My location', name:'Your current location', lat, lon, country, countryCode:''}`.
  - With a country: *"Checked at your current position, in {country}. Save it to see it here each time you come back."*
  - Without one: *"Checked at your current position. We could not tell which country it is in, so forecasts that
    cover a whole country are not included. Search for the place by name to include them."*
  - Denied: *"Your browser did not share a location, so nothing was checked."* Native: "Location was not shared, so nothing was checked."
- **Saved quick chips**: up to 4 saved places, shown as `{kind} · {name}`. Tapping one answers that place.
- **Auto answer on arrival**: if the user has saved places, answer the first one with `id=='loc-current'`, otherwise
  the first saved place. Do this without scrolling, and show the note *"Showing your current location / your saved
  place "{name}". Search above to check anywhere else."*. Each feed refresh re-answers the place currently shown.

### 1.2 Place result card (`answer()`)
Uses `PNDPlaceRisk.assess(place, liveEvents, {generatedAt})` and `actionsFor()` (logic.md §3).

- Eyebrow "CURRENT RISK". If `A.level` is set, show a **badge** using the level label (for example "Severe"). If it
  is null, show the neutral chip **"Nothing reported nearby"**. Never show a LOW badge for nothing. Then the place
  name as the heading.
- **What's happening**: lead record title in bold, then `{type} · {placeOf} · reported {age(updated)}`. If there is
  no lead: *"None of our sources reports anything at this place right now."*
- **Why we're showing this**: `A.why`.
- **What should I do?**: bullet list of `actions.steps`, then `actions.authority` in amber text (`#ffd9a8`):
  *"Follow instructions from the issuing authority and local emergency services. Nothing on this page replaces official instructions."*
- **Source**: `{provenance(lead)} · {lead.source}` plus the link "Open the original report →" (`lead.sourceUrl`).
  With no lead: *"No report was used for this answer."*
- **Last checked**: `fmtDate(generatedAt) · age(generatedAt)`, or *"not yet: the data is still loading"*.
- Actions:
  - **Save place** (primary). Saves `{kind: place.kind||'Place', name, lat, lon, country, countryCode}` and shows the
    note *"Saved. You can find it on the My places page."*
  - **Alert me if this changes**. Saves the place first if needed (kind "My location" becomes "Current location").
    What happens next depends on notification capability (section 16):
    - Service on: *"Saved. Alerts are on for this device. You will get an alert when something is reported at or near this place, even when this site is closed."*
    - Service off and enabled now: *"Saved, and alerts are on. … You can manage alerts on the My places page."*, or show the failure reason.
    - Open-only fallback after permission is granted: *"Saved. You will get an alert about it only while this site is open in a tab. Nothing is sent once you close it."*
    - Denied: *"Notifications were not allowed, so nothing will be sent."*
  - **See details**. Opens `eventUrl(lead)`, or My places when there is no lead.

### 1.3 "Around the world now" KPI tiles
Counts come from **live, non-forecast** records unless noted. Every tile follows the map's hazard filter
(section 1.6). **[vectors: home.render]** pins every tile for 8 filter and sort combinations.
- **Live events** = number of non-forecast records (after the map's hazard filter). Subline: `"{Extreme+Severe}
  serious · {Informational} minor"` (counting the `severity` field) when there are reports and either count is
  non-zero, otherwise "From all our sources", or "Matching the hazard you chose" when a hazard filter is set. Tap opens Events.
- **Official warnings** = `PND.officialWarnings(list)`: warnings **in force**, not forecasts, `evidenceState ===
  'official-warning'` (or, with no `evidenceState`, `sourceType==='official'` with an `expiresAt`) (logic.md §6.11,
  changelog C3). Subline **"Issued by agencies, in force now"**, with the accessibility hint / tooltip
  `PND.WARNING_MEANING`: *"Warnings and watches issued by agencies and in force now. Reports of disasters that already
  happened are not counted."* Tap opens Official warnings, which lists the same records.
- **Open forecasts** = records with `forecast && !windowClosed` (the same as `PND.openForecasts`). Subline: the count per level, highest first, for
  example "3 High · 5 Moderate · 2 Watch" (`matchesRiskLevel`), or "Recorded for grading". Tap opens the forecast list.
- **Countries** = `PND.countryCount(reports)` (split comma-separated country strings, logic.md §6). Subline "Named in live reports". Tap opens Regions.
- Quote tile: *"Prepared communities save lives." / "Data for a safer, more resilient world."*

### 1.4 Utility cards ("Keep watch over the places that matter to you")
Four buttons: ⌖ My places, ! What should I do now? (opens Events), ◉ Forecasts, ✓ Track record. Each has the
one-line description from `index.html`.

### 1.5 Sidebar "Explore" (desktop) / native: a horizontal chip row
Whole world, Asia, Africa, North America, South America, Europe, Oceania (open Region detail). Tools: My places,
Risk map, Alerts and notifications, Forecast calendar, Past events, Compare places, Safety guides (Resources).
The continent chips open Region detail, which counts a continent from the countries each report names (section 8.2,
changelog C1). They must never open an empty "No current events here" page while the feed has reports there.

### 1.6 Map + "Live events"
Implemented in `index.html` (`render()`, `selectEvent()`, the `mapSearch` handler). **[vectors: home.render]**
- Map of all live records (forecasts included) that pass the hazard filter, as risk markers (design.md §3.3).
  Top toolbar:
  - **Location search** ("Search location"). Enter with an empty box does nothing. Otherwise the trimmed, lower-cased
    query is matched with `PND.matches`; the first live record that matches is selected with fly-to and its popup
    opened. **When nothing matches**: clear the selection (marker ring and list highlight), close any popup, and show
    the card with eyebrow **"Search"**, title **"No live event matches "{q}""**, meta *"Try a country, a city or a type
    of hazard."* and the "See details →" button hidden (changelog C12).
  - **Hazard filter**: "All hazards (N)" (value `""`) then one option per type present in the live records with its
    count, from `PND.fillHazardSelect(sel, events)` (section 0.3). It is refilled on each load, keeping the choice. A
    record passes when `PND.hazardKey(e.type)` equals `PND.hazardKey(choice)` ignoring case (so "Extreme Cold" never
    shows Extreme Heat, and "Volcano" includes "Volcanic Eruption") (changelog C2, C8). The filter applies to the map,
    the tiles (section 1.3), the "Live events" card, the three tables and the strip.
- **Selected event on map** card (changelog C12). Selecting an event shows a card over the map: eyebrow **"Selected
  event on map"**, the title, `[type, placeOf(e), source]` joined with " · " (blanks dropped), and a **"See details →"**
  button that opens `eventUrl(e)`. It is shown when a marker is tapped (no fly-to, no popup), and when a "Live events"
  row is hovered or focused (fly-to at zoom `max(current, 5)` over 0.55 s, popup opened). The selected marker gets a
  ring and the matching row is highlighted. Tapping a row opens its detail. Native: show the card on annotation
  selection, with the same text and button.
- **Live events** card (was "Most serious live events"; changelog C7): the **first 5 reports** (non-forecast live
  records; our forecasts are never listed here) sorted by **the card's own sort select**. The select offers
  `newest` (default), `severity`, `oldest`, `deaths`, `affected`, `country`, `type`, `source`, `title` with the labels
  of `PND.SORT_DEFS`, and stores the choice under `pnd_sort_home_sortBy`. index.html keeps its own comparators:
  `when(e) = parse(updated || targetStart)` (no `startedAt`), `rank(e) = severityRank if > 0, else RANK[alert]` with
  RANK red 5, critical 5, orange 4, high 4, moderate 3, watch 2, green 1; `country` compares `place || country ||
  region`, `title` compares `title` only (no glossary expansion), missing text sorts last. Each row: its number 1 to 5,
  the title, `type · placeOf(e,'Global')` and "Updated {fmtDate(updated)}". "View All →" opens Events.
- **Live events by type** strip (changelog C13): built from the **reports** (non-forecast) only, grouped by
  `PND.hazardKey(type)`, ordered by count descending then name A to Z, one chip per hazard present (none at 0). Icons:
  Earthquake ⌁, Wildfire 🔥, Flood ●, Drought ⌛, Tropical Cyclone ◉, Severe Storm ◈, Volcano ▲, Landslide △, Tornado ✦,
  Extreme Cold ❄, Extreme Heat ☀, Tsunami ≈, any other hazard ◆. Each chip shows `"{icon} {hazard}"` and
  **"{n} reported"**; a hazard whose `hazardOf(key).forecastable === false` (Earthquake) adds **" · observed only"** and
  the tooltip *"Observed only - no agency forecasts the onset of this hazard"*. Tap opens Hazard detail
  (`/hazards/{key}`).
- **Latest forecasts** table (Starts / Location / Hazard / Risk): open forecasts (`forecast && !windowClosed`),
  **newest first** (home `when`), first 6. Starts = `fmtWhen(targetStart||updated)`. Empty: *"No open forecasts right now."*
- **Latest events** table (Time / Location / Event / Source): the **5 newest reports** (not affected by the card's
  sort). Time = `fmtDate(updated)`, Location = `placeOf(e,'-')`, Event = `type || 'Event'`.
- **Official Warnings** table (Agency / Location / Warning / Ends): `PND.officialWarnings(list)` sorted **most serious
  first** (home `severity` comparator), first 5 (changelog C3). Agency = `source || 'Official'`, Ends =
  `fmtDate(expiresAt||expectedEnd)` or "Not stated". Empty: *"No official warning is in force in our sources right now."*
- **Track record teaser**: the ND-001 card ("Covered 13 to 16 Sep 2026. Written after that period began, so it is a
  test case, not an advance forecast.", verdict pill **PARTLY CORRECT**), "What we check" (Timing · Place · Cause ·
  Severity · Official reports) and "How we check forecasts".
- Footer line: *"Our forecasts help you stay aware and prepared. They do not replace official government warnings."*
- Header top search (desktop): Enter opens `/events?q=`.

### 1.7 Home states
- On load failure (`down()`, changelog C19) the tiles stop shimmering. If nothing had loaded: the tile values keep
  "-" (a failed load is not a zero), every tile subline except the quote reads **"Live data unavailable"**, the three
  tables show one row *"Live data unavailable. Trying again automatically."*, the "Live events" card shows the
  `PND.unavailableHtml()` card, the strip shows *"Live data unavailable. Trying again automatically."*, and the
  "last updated" text reads "Live data unavailable". If an earlier load succeeded, everything stays and the "last
  updated" text reads "Could not refresh: {fmtDate(last generatedAt)}". On native, also show the global error banner.
- Notifications: each load calls `PND.evaluateRiskNotifications(liveEvents)` (section 16.2).

---

## 2. Map (tab)

Implemented in `live-map.html` and `map-setup.js` (`PNDMap.basemap`, `riskMarker`). On the web `globe.js` adds an
optional Cesium 3D globe that mirrors the map. **The 3D globe is optional for native.** The flat map is the
parity requirement.

- Title "Live disaster map". Subtitle *"Events reported by official agencies, shown on a map. This page refreshes every minute."*
- Toolbar: search "Search place or hazard" (`matches`), sort (`EVENT_SORTS`), "↻ Refresh now", status line
  `{statusText} · updated {age(generatedAt)}`.
- **A search moves the map** (changelog C18): when the query is new (not the one the map was last fitted to) and
  some matching records have coordinates, fit the map to their markers (padding 25%, max zoom 6). A refresh with the
  same query does not move the map. Under the toolbar a polite live note says *"{n} event(s) match "{q}". The map shows
  it/them."* (the word is "match" for any n), or *"No event matches "{q}"."* with the list replaced by
  `emptyHtml(q, all, all, 'events')`. An empty query clears the note.
- If the first load fails, the list shows the `PND.unavailableHtml()` card.
- Map: the first **220** records of the filtered, sorted list as risk markers (design.md §3.3). Marker size
  `9 + rank*3` pt. Higher rank draws on top (`zIndex = rank*1000`). Accessible label: `"{title} - {Level} risk"`.
  The popup or callout shows title, `type · source` and "See details".
- Map layers (web `map-setup.js`): **Map** (default; dark political base drawn from `/world-countries.json` with
  ocean `#0e2631`, land `#22342d`, borders `#5f7d70`), **Satellite** (Esri World Imagery plus the Esri boundaries
  and places overlay), **Political** (pastel palette), and an optional overlay **"NASA today ({date})"** (NASA GIBS
  daily imagery, max zoom 9). The user's choice is remembered. Native: offer at least Map and Satellite. Keep the
  default on the clear map, for the reason the code gives: markers must stay readable.
- **Map key** (legend toggle): the six levels plus Not rated, with a count of each drawn on the map.
- Below the map, **Latest events**: the first 30 as event cards (section 0.4), with the "See all →" link to Recent events.
- Uses only live records. Runs notification evaluation on each load.

---

## 3. Alerts & events (tab)

### 3.1 Alerts screen (tab root)
Implemented in `alerts.html`.
- Eyebrow "OFFICIAL ALERTS AND REPORTED EVENTS", title "Alerts", subtitle *"Current reports from official agencies.
  Open any alert to see its details and its source."*
- Stat line: **OFFICIAL REPORTS** (number of filtered official records), **RED OR ORANGE ALERT**, **COUNTRIES AND
  AREAS** (`countryCount`), **SOURCES WORKING** (`sourcesRatio`, for example "7/8"), **UPDATED** (`age(generatedAt)`).
- Toolbar: search "Search by alert, place, hazard or agency", risk-level filter, sort (`EVENT_SORTS`), Refresh, status line.
- Records: `sourceType==='official'` only.
- Map of the first 250 as markers. **Current official alerts** grid, **40 cards at a time** (changelog C6): risk badge,
  source pill, title, `type · place`, impact line `impactText(e)` in bold when present, and `Source updated {fmtDate}
  · {age}`. When more than the shown number match, a full-width card follows: *"Showing {shown} of {N}."* and a button
  **"Show {min(40, N - shown)} more"**; pressing it adds 40 and moves focus to the first new card. When everything is
  shown and N > 40: *"Showing all {N}."* A change of search, level or sort goes back to 40; the 60 s refresh keeps
  the current number. Empty: `emptyHtml(q, all, all, 'official alerts')`. **[vectors: alerts.pager]**
- The stats follow the filtered list: OFFICIAL REPORTS = its length, RED OR ORANGE ALERT = alert Red or Orange in it,
  COUNTRIES AND AREAS = `countryCount` of it. Unchanged from the first spec, but note that RED OR ORANGE ALERT is not
  the "official warnings" count.
- Sidebar **Source status**: one row per `meta.sources` key, shown as `KEY` upper-cased with `_` replaced by a space,
  then `Working` or `Not answering`, then `checked {fmtDate(checkedAt)}`.
- **How to read these alerts**: *"Red and orange are the two highest alert levels. We treat them as the most
  serious." / "USGS earthquakes are earthquakes that have already happened. They may not have a colour alert level
  like GDACS alerts do." / "Open any alert to see where it is, its reported impact, when the source last updated it,
  and a link to the original report."*
- Links: "See all official warnings →" opens Official warnings.

### 3.2 Collection lists (shared engine `collection.js`, selected by `data-view`)
Each list is a card grid (section 0.4) with search, a hazard filter built from the list's own records (section 0.3,
changelog C8), a risk filter, sort, Refresh, and the status line `{statusText} · {countText} · updated {age}`.
`countText` gives "N events · M forecasts" when a list mixes the two, and uses singular forms for 1. On the forecast
list and calendar it gives **"{N} forecasts: {open} open, {N-open} ended"**, where open is `PND.openForecasts` of the
list (an ended forecast is still listed) (changelog C14). **[vectors: collection.keep]**

**Region scope** (changelog C17): with `?region={name}` (the link Region detail's "See all events →" opens), every
list except resources keeps only records with `PND.inPlace(e, name)` (a continent counts its countries; `World`
means no scope) and shows the note *"Showing only {name}. Show everywhere →"* (the link drops the parameter) above the
cards. Counts, the hazard options and the empty text use the scoped list.

| View | Web route | Title / subtitle | Records kept | Sort keys | Empty noun |
| --- | --- | --- | --- | --- | --- |
| events | `/events` | "Events happening now" / "Disasters reported by official agencies, and our own forecasts of what may happen next." | all live | EVENT_SORTS | events |
| recent-events | `/recent-events` | "Recent events" / "The latest disasters reported by official agencies." | `sourceType==='official'` | EVENT_SORTS | recent events |
| official-warnings | `/official-warnings` | "Official warnings" / "Warnings and watches that official agencies have issued and that are in force now. Reports of disasters that already happened are on Alerts & events." | `PND.isOfficialWarning(e)` (changelog C3) | EVENT_SORTS | official warnings |
| alerts-notifications | `/alerts-notifications` | "Current alerts" / "Warnings and watches that official agencies have issued and that are in force now, with a link to each source. Reports of disasters that already happened are on Alerts & events." | same as official-warnings | EVENT_SORTS | alerts |
| hazard-types | `/hazard-types` | "Events by type" / "Browse current events by type: flood, earthquake, wildfire, volcano, storm and drought." | all | EVENT_SORTS | events |
| historical-events | `/historical-events` | "Past and recent events" / "Recent past events from GDACS, plus the events happening now." | all **including not-live** (`getEvents({all:true})`) | newest, oldest, severity, country, type, title | events |
| compare-locations | `/compare-locations` | "Compare places" / "Search for a place to see its current events. Then search for another place to compare." | all | EVENT_SORTS | events |
| forecast-list | `/forecast-list` | "Our forecasts" / "All our current forecasts of what may happen next, including test cases that were not made in advance." | `forecast===true` | newest, severity, windowEnd, oldest, country, type, title | forecasts |
| forecast-calendar | `/forecast-calendar` | "Forecast calendar" / "Each current forecast, shown across the days it covers." | `forecast===true` | as forecast-list | forecasts |
| resources | `/resources` | "Our sources" (section 10.1) | n/a | curated, name, nameDesc | n/a |

The forecast list and calendar also show a page note above the list: `horizonText(meta) + " Each forecast is our
own estimate, based on a current official report. It may be wrong. It is not an official warning and does not
replace one."` The note keeps acronyms short (no first-use expansion of "UTC").

### 3.3 Calamities ("Disasters now and in the past")
Implemented in `calamities.html` and `history-data.js`.
- Two tabs: **Happening now** / **Past disasters**.
- Stats: HAPPENING NOW, HIGH ALERT (alert in Red, Orange or High), COUNTRIES AND TERRITORIES, SOURCES WORKING, PAST DISASTERS LISTED.
- Happening now: official, non-forecast, live records. Filters: free text (substring of title, country, region,
  type and source joined), a **country** select (every ISO region name from `Intl.DisplayNames`; native should use
  the platform locale list in English), a hazard select (Flood, Earthquake, Wildfire, Volcano, Storm, Drought), a
  risk select, sort (`EVENT_SORTS`) and Refresh. "Jump to a country" chips: Nepal, Indonesia, India, Vietnam, Japan,
  United States, Philippines, World. Cards also show "Saved copy" when `cached`. Empty: *"No matching disasters
  reported right now. Our sources have no current report that matches. This does not mean the place is safe."*
- Source status panel: per source `Working/Not answering · {window} · {error}` and `Checked {fmtDate}`. Note:
  *"You can choose any country or territory that your browser knows. We cover Earth only. If a source is down, we
  may show a saved copy of an event instead, and we label it as a saved copy."*
- Past disasters: the static `PND_HISTORY` timeline (bundle `history-data.js` in the app). Search and a hazard filter
  (Earthquake, Flood, Volcanic, Cyclone, Wildfire, Tsunami; substring match on type), sorted oldest or newest first
  by `sort`. Each row: year, name, `location · type`, summary and a severity badge ("Catastrophic" uses the severe
  style, anything else the high style). Notice: *"No complete list of every natural disaster in Earth's history
  exists. … Its first entry is not "the first natural disaster ever"."*
- Footer line: *"Times are shown in IST by default. To see them in another time zone, use the time zone menu at the top of the page."*
  This is still the website's copy, but since changelog C9 the default is the device's zone, so the sentence is now
  inaccurate on the web. Native: write *"Times are shown in your device's time zone. To see them in another time
  zone, use the time zone setting."* and flag the web copy to the website team.

---

## 4. Forecasts (tab)

Implemented in `forecasts.html` and `forecast-table.js` (`PNDForecastTable`).

- Eyebrow "OUR OWN ESTIMATES", title "Natural disaster forecasts", subtitle *"These are our forecasts of what may
  happen next, and where. We make them from reports by official agencies. They are not official warnings."*
- Stat line: **OPEN FORECASTS** (`PND.openForecasts` of the forecasts: the home page's number; ended forecasts are
  still listed below) (changelog C14), EVENTS ON HIGH ALERT (`PND.isHighAlert`: non-forecast records with alert in
  Red, Orange or High), KINDS OF HAZARD (distinct forecast types), SOURCES WORKING, UPDATED, FORECASTS REACH AS FAR AS
  (`fmtWhen(meta.forecastHorizon.furthestWindowEnds, null, 'end')` with the trailing `, time` removed, or "-").
  Then `horizonText(meta)` as a paragraph.
- Sticky toolbar: search "Search by forecast, country, city, sea or hazard", hazard filter (dynamic, built from
  **forecasts only**, so its counts add up to the forecasts and match the tiles; it still filters the high-alert
  list below by exact type) (changelog C8), risk filter, sort `['severity','windowEnd','newest','oldest','country','type','title']`,
  "↻ Refresh live data", status line.
- Map of forecasts plus high-alert observed records (first 300).
- **Forecasts by hazard** tiles: the count of forecasts per type that pass the search and risk filters, sorted by
  count descending. Tapping a tile toggles the hazard filter (`aria-pressed`). Hint: *"Select a hazard to see only
  its forecasts. Select it again to see them all."* Empty: *"No forecast matches these filters."*
- **Forecasts · N (of M)** table using `PNDForecastTable.render(fc,{columns:['Risk','Forecast','Geography','Hazard','Starts','Ends','Class']})`.
  Phone fold: the cards show Risk, Forecast (link), Place, Hazard, Kind of forecast, **Dates** (`windowText`) and
  **Status** (Active / Ended / Reported event). Full table → `/forecast-list`. Column semantics are in logic.md §7.
  Empty: `emptyHtml(q, fcAll, all, 'forecasts')`.
- **Events on high alert · N (of M)**: observed (not forecast) records with alert in Red, Orange or High, as rows
  showing the risk badge, title, `type · region · country` ("Location not stated by the source" when there is none)
  and `source · updated {age}`. Explanatory text: *"Official agencies have given these events a high alert level.
  These reports show what is happening now. They are not forecasts…"*. Empty: *"No event on high alert matches these filters."*
- **What changed since our last check**: `PND.changesHtml(meta)` (logic.md §6.9). Sections New, Raised, Lowered,
  Dates changed, Stopped, Ended on schedule and Could not be checked, each capped at 8 rows with "…and N more".
- **How we make forecasts**: 1. Spot, 2. Where and when, 3. Keep them apart (*"We never show an official report as
  our forecast, or our forecast as an official report."*), 4. Check.
- **Checking our forecasts**: the ND-001 blurb and a "See the ND-001 forecast →" link.
- The horizon paragraph keeps acronyms short. Load failure: see section 0.2.

### 4.1 Forecast list (full table)
Implemented in the `/forecast-list` view of `collection.js`. All 10 columns: Risk, Forecast, Place, Hazard, Starts,
Ends, Kind of forecast, What it is, Source, Updated (logic.md §7). Plus the horizon note.

### 4.2 Forecast calendar
Implemented in the `/forecast-calendar` view of `collection.js` (`timeline()`).
- The day axis runs from local midnight today to `min(today+15d, max(today+4d, lastEnd+1d))`. Each day header shows
  weekday, day number and month, and today is highlighted. A vertical "now" line is drawn at the current time.
- Rows are grouped by `type`, with groups sorted A to Z and rows sorted by start time. Each row has a label (risk
  badge and place) and a bar from start to end (minimum width 1.4%) coloured by `riskClass(alert)`, with a green
  outline when the window is live now. The bar text is the day range, for example "20 Oct - 23 Oct". Tapping opens the forecast.
- Empty: *"No forecasts to show for these dates. Try removing a filter, or refresh the page."*
- Note: *"Each bar runs from the start of a forecast to its expected end. The line marks now. Forecasts are our own estimates, not official warnings."*

### 4.3 Verification list ("How we check forecasts")
Implemented in `verification.html`. Lists every forecast, including those that are not live, as a card: risk badge,
provenance ("Test case" or "Based on a current report"), title, details, then Forecast period / Area / Hazard /
Based on, and "See forecast details →". Sort keys: newest, severity, windowEnd, oldest, country, type, title. Static
rules list: Timing, Place, Cause, Real harm, Result. Notice: *"These are our own estimates, not official warnings.
We do not predict exactly when an earthquake will strike…"*

---

## 5. My places (tab)

Implemented in `personal-risk.html`, `place-risk.js`, `alert-rules.js`, `alerts-client.js` and `hazard-model.js`
(`riskRow`, `RISK_BANDS`).

### 5.1 Alerts panel
- A status line describing what this device can do (section 16). Buttons: the alerts toggle ("Turn on alerts" /
  "Turn off alerts" / "Alert me while this page is open"; hidden when blocked) and **Use my current location**.
- "What we send and what we keep" disclosure, filled from the `/api/alerts` `keeps` field, and a rules sentence:
  *"You get an alert when a saved place is inside an official warning area or a reported affected area, or when a
  danger is reported within {nearKm} km of it ({severeNearKm} km if it is severe). We never send alerts for our own forecasts."*
- **Use my current location**: saves or replaces the place `id:'loc-current', kind:'Current location', name:'Current
  location'` with lat and lon **rounded to 2 decimals** and the country from the on-device lookup. Status:
  *"Saved as "Current location", to the nearest kilometre ({country}). It is updated each time you open this site."*
  It refreshes silently on later launches **only if** location permission is already granted. It never prompts at launch.

### 5.2 Saved places
- Form: Kind (Home, Office, Family, Travel), name search plus **Find place** (Nominatim, same chooser as Home), and
  Latitude and Longitude fields (lat −90…90, lon −180…180) with **Save**. Enter in the search field runs the search;
  it does not save.
- Choosing a candidate fills lat and lon to 6 decimals and records `country` and `countryCode`. Note: *"Chosen:
  {name} ({level lower-case}). Choose the kind of place and press Save."*
- **Any edit the reader makes to name, lat or lon after choosing clears the remembered country**, with the note
  *"You changed the place, so we no longer know its country. Search for it by name again to record the country."*
  The values the search itself filled are remembered (`chosenAs = name|lat|lon`); a change event whose values still
  equal them (for example the one fired on blur after pressing Enter) does **not** clear the country (changelog C23).
- Search failures: "Type a place first.", the not-found copy as on Home, and *"Place search is not working right now. You can type the latitude and longitude instead."*
- Storage: `pnd_saved_locations`, a JSON array of `{id:'loc-'+epochMs, kind, name, lat, lon, country, countryCode, updatedAt?}`
  (native: local persistent store; data model in logic.md §3.6).
- Each saved place card: `{kind} · {name}` (just `{kind}` when kind equals name), `{lat}, {lon} · {country}` or
  "· country unknown", "· updated {age}" for the current location, a **Remove** button, and a **summary chip** from
  `summarise()`:
  - no level: `NOTHING REPORTED NEARBY`
  - otherwise `HEADLINE` upper-cased, then ` · inside an official warning area` (lead band B), or ` · inside a
    reported affected area` (band A with containment), or ` · a forecast covers it` (band C), or ` · event {d} km away`.
- Empty: *"No saved places yet. Search for a place above and save it."*
- Any change to the places re-syncs background alerts (section 16).

### 5.3 "Dangers near your places"
- Header text: *"Grouped by how sure we can be that each one affects your place. We show a distance only when the
  report gives the exact spot."* Also shows "Updated {age}" and a sort select with keys `nearby` ("Distance: nearest
  first"), severity, newest, type and country.
- Rows are built from (saved place × every live record) through `riskRow` (logic.md §3.2). They are grouped into the
  **five bands, always shown in order A to E**, each with its title, blurb and empty text from `RISK_BANDS`. At most
  30 rows per band.
  - A "Confirmed events nearby", B "Official warnings for your places", C "Forecasts", D "Wider-area reports",
    E "Past disasters". **E is always empty** and reads *"We do not publish a history of past events for each place, so nothing can be shown here. Your national or regional disaster agency keeps the official record."*
- Row card: provenance pill (`PND.provenance`), title, `"{round(d)} km from {place}"` **only when `claimDistance`**
  (otherwise just the place name), ` · {type}`, and the `applicability` sentence when present. Tap opens `eventUrl`.
- Sort rule: for `nearby`, keep the band order and sort by distance with infinite distances last. For other keys,
  apply the event comparator and then the distance tie-break.
- **Scope note** (amber notice), shown only when there are country-wide forecasts (`forecastScope==='country'`) AND
  saved places without a country: *"{n} of your saved places has/have no country recorded, so we cannot tell whether
  {k} forecast(s) that cover a whole country apply/applies to it/them. Search for the place by name instead of typing coordinates, and we can check."*
- Load error: *"We could not load the latest data. Do not rely on this page in an emergency. Check with your local authorities."* in a `.stale` box.

---

## 6. Track record (tab)

Implemented in `accuracy.html`, `verdicts.js`, `verification-model.js`, `observed-model.js`, `hazard-model.js` and
`backtest-view.js`. Trust group `ledger`. It reads four static files with `fetch(path, {cache:'no-cache'})`
(revalidated with the server, no `?ts=`; changelog C25):
`/data/outlook-ledger.json` (about 3 MB), `/data/verification-ledger.json`, `/data/observed-disasters.json` (about
1.9 MB) and `/data/scan-ledger.json`, plus `/data/model-backtest.json` and `/data/model-verdicts.json`.

> Port strategy for grading: logic.md §10 explains why `verify()` and `assessCoverage()` (about 1,800 lines with
> `observed-model.js`) should run the website's own JS in an embedded engine. The alternative is a port verified
> against the same test vectors. Do not approximate it.

- Title "Track record". Intro: *"How the forecasts we have recorded turned out. This includes the ones we got wrong, the ones we could not check and the disasters we missed."*
- **Answer box**: the lead sentence plus 3 to 5 bullet points, computed (logic.md §10.4):
  - no headline-class forecasts: *"We do not have a track record of advance forecasts yet. Every forecast we have recorded was made after the danger was already known."*
  - headline forecasts but none gradeable: *"We have made some forecasts in advance, but none of them can be checked yet."*
  - otherwise *"Of the {n} advance forecasts we could check, {precision×100 rounded to 0.1}% came true. A partly correct forecast counts as half."*
- **Key figures** (10 metrics): Forecasts recorded (ledger rows), Still running, Ended not checked yet, Ended cannot
  be checked, Checked so far, Correct, Partly correct, Wrong (false alarm), Missed events, No proof made in time.
  These come from `PNDVerdicts.tally(records)`.
- "What these figures mean" disclosure (honesty paragraph).
- **Experimental forecast models** section: the backtest table (Hazard, Forecast made "3/5 days ahead", Days tested,
  Days it happened "(x%)", Caught by the model, Caught by chance, Right when the model warned, Right by chance), the
  status line, a list of limitations, and the **Published model forecasts** table (Hazard, Published, Came true,
  False alarms, Missed days, Waiting to be measured). Loading text: "Loading the test results…". If the backtest
  is missing or incomplete: *"Not yet available. The test results could not be read, or the last test scored nothing, so no figures are shown."*
  If no grades exist: *"Not yet graded. {n} published so far, each waiting for its days to be measured by NASA POWER, which runs about three days behind."*
- **Forecasts that came true** / **Significant events we missed** cards. Empty texts: *"No forecast has come true yet."* and *"No significant missed events have been recorded by hand yet."*
- **Significant disasters on record** table (Disaster, Type, Where, Started, Deaths, Displaced, Evidence, Forecast
  in advance?, Why not). Deaths and Displaced show "Not reported" when null. The verdict pill is "Yes" or one of
  "No: cannot be forecast / reason unknown / not checking there / missed by our forecasts / no advance source".
- **All recorded forecasts** ledger table: search, result filter, sort (`recorded` "Date recorded - newest first",
  `windowEnd`, `observed` "Actual severity - highest first", `hazard` "Hazard type - A to Z", `country`, `title`),
  and an actual-severity filter. Shown **25 at a time** with "Show 25 more" / "Show all" and the pager note "Showing
  {n} of {total}." Columns: Forecast, Did it happen?, Result pill, Type of forecast, Actual severity, Hazard and
  place, Locked on, Forecast period, What counted as a match, Matching event, Evidence. Empty: *"No forecasts match these filters."*
- "What we forecast compared with what happened" disclosure (side-by-side cards for graded forecasts).
- "Full details" disclosure: the advance (headline) metrics including precision, recall and F1, the other-forecasts
  metrics, the disasters-and-misses metrics, the methodology note, the counts by class, and the label legend.
- The trust note's "Track record last recorded {time}" uses the newest `updatedAt`/`generatedAt` among the ledgers
  this page loaded, handed to the note (`PNDTrust.recorded(iso)`), or *"The track record did not load, so no update
  time can be shown"* when none could be read.
- **Failure state**: if any of the four core ledgers fails to load, show the red alert *"Some track record data could
  not be loaded: {list}. So no figure on this page tells you what happened. This is not the same as nothing having
  been recorded."* above the answer, set **every graded figure to "Unavailable"**, and grade nothing.

---

## 7. Record detail screens

All four detail screens (7.1 to 7.4) load `getEvents({all:true})`, resolve the id with `findEvent`, re-render every
60 s, show the quiet note for `live:false` records, and mount the **enrichment block** (section 7.5).

### 7.1 Event detail
Implemented in `event-detail.html`.
- Breadcrumb Home › Events › {title}. Eyebrow `OUR FORECAST, NOT OFFICIAL` for a forecast, **`EVENT NO LONGER
  UPDATED` when `live === false`**, otherwise `LIVE EVENT` (changelog C5). Title, then `{type} · {placeOf}`. The screen
  title is the record's title.
- KPI row: RISK LEVEL (riskTag), TYPE, SOURCE, SOURCE LAST UPDATED (age), DATA STATUS = `PND.liveWord(e)`: "Saved
  copy" if `cached`, "Our forecast" if `forecast`, **"Not updated recently" if `live === false`**, otherwise "Live".
  **[vectors: portal.liveWord, detail.statusWords]**
- **"What should I do now?" action panel** (amber left border): provenance pill, "Updated {age}", then
  WHAT (type) / WHERE (`region · country` or "See the map") / HOW SERIOUS (`riskLabel`) / HOW RELIABLE ("OFFICIAL
  SOURCE" / "OUR OWN ESTIMATE" / "NOT YET CONFIRMED") / WHO SAYS THIS (`{source} · {voice}`, where voice is
  "reporting an event that has happened", "issuing an official warning", "a forecast made by this site" or "type of
  report not known").
  - The life-safety note *"Follow instructions from the issuing authority and local emergency services."* is shown
    **only** when `evidenceState==='official-warning'` or the level rank of `severity||alert` is at least HIGH.
  - "What matters most now": 3 bullets from the per-hazard `responseContext` table (earthquake, flood,
    cyclone/storm, wildfire, volcano, default; copy in `event-detail.html`).
  - **OPEN THE ORIGINAL SOURCE ↗** button (`sourceUrl`), or *"The source gave no link for this report. Check with your local emergency service before you act."*
  - *"This is up-to-date information from the report named above. It is not an instruction issued by any authority."*
- Overview: risk badge, source pill and forecast pill; the **key facts grid** (`keyFactsHtml`, logic.md §5); then
  When it started (`fmtDate (age)`, or "Forecast period starts {fmtWhen}", or "The source did not give a start time"),
  Last updated, Where it started (`placeOf`), Areas affected (`region · country`), Coordinates (4 decimals),
  Description (or "The source gave no further details."), **Also reported by** (`corroboratedBy` joined with ·, or
  *"No other agency we read has reported this event separately"*, plus *"The "{alert}" alert level shown is from
  {alertSource}."* and a link when `alertSource` differs from `source`), and Report ID.
- **Reported impact**: LIVES LOST, PEOPLE DISPLACED and PEOPLE AFFECTED, each showing a grouped number or **"Not
  reported"** (a reported 0 shows "0"). Note *"If the source gives no figure, we show "Not reported". We never assume it is zero."*
- How up to date and reliable: Last update, Type of source ("Official source" / "Our own forecast, not official" /
  "Collected from other sources"), Status ("Saved copy, not live" / "Forecast in progress" / **`quietNote(e)` when
  `live === false`** / "Live, as the source last reported it").
- Who may need help (3 context cards). Timeline (source report time, then "This page updated").
- Map centred on the record (zoom 7 for earthquakes, 6 otherwise) with a marker.
- **Other events nearby**: non-forecast records within 1,200 km, sort keys newest, distance, severity, oldest, type
  and title; at most 6; each shows "{km} km away · {type}". Empty: *"No other current events nearby."*
- Not found (changelog C20): eyebrow "EVENT", title and breadcrumb **"Event not found"**, subtitle *"The source may no
  longer list this event. [See all events] to find the latest ones."* (link to Events), and the KPI row, body and
  enrichment block hidden. Only on the first load: once a record has been shown, a later miss leaves it.
- Error: when a record is already shown, *"We could not update this event just now."* in the subtitle. On a first load
  that fails: title **"Live data unavailable"**, subtitle *"We could not load this event just now. Trying again
  automatically. [See all events]."*, body hidden.

### 7.2 Alert detail
Implemented in `alert-detail.html`. Used when the record is official and its alert is Red or Orange.
- Eyebrow "OFFICIAL ALERT". Stats: ALERT LEVEL (riskTag), AGENCY OR SOURCE, UPDATED, STATUS = `PND.liveWord(e)`
  (Live / Saved copy / Not updated recently; changelog C5).
- Alert summary: key facts grid, Hazard, Place, Areas affected, When it started, Issued or last updated, **Warning
  ends** (`expiresAt` or "The source did not give an end time"), What the alert says (details), Source report ID
  (`rawId||id`), and the "Open the original report ↗" button.
- Reported impact, the same three figures plus DATA STATUS (`PND.liveWord(e)`), with the note *"We show impact figures only when the source gives them. A missing figure does not mean there was no impact."*
- Source checks: Official source named? **Yes**. Source's update time shown? **Yes**. Is this a saved copy? ("Yes, and it is labelled" / "No"). Link to the original report? ("Yes" / "No, the source gave none").
- Safety: *"This page sums up a report from an official agency or source. It is not a new government warning."*
- **Other events in the same country or area**: `matchesPlace(x, country||region)`, non-forecast, at most 9, sorted with EVENT_SORTS.
- Not found (first load only; changelog C20): title **"Alert not found"**, subtitle *"The source may no longer list this
  alert. [See all official warnings]."*, stats, body and enrichment hidden. First load fails: **"Live data
  unavailable"** / *"We could not load this alert just now. Trying again automatically."*

### 7.3 Calamity detail
Implemented in `calamity-detail.html`. Reached from the Calamities context and `/calamities/{id}`.
- Eyebrow "CURRENT DISASTER". Stats: STATUS (Saved copy / Reported), HAZARD, LIVES LOST, PEOPLE DISPLACED and
  UPDATED. **Note: this screen uses truthy tests, so it shows "-" or "Not reported by the source" for a reported 0.
  This contradicts rule 8.** Native should apply rule 8 here (treat 0 as reported) and the web team should be told.
- Detail list: Event, Type, Country or area, Alert level, Official source, When it started, Last updated by the
  source, Coordinates, the three impact figures, and "Latest details from the source".
- How up to date: Source last updated, We last checked (`generatedAt`), Age of the data, Status ("A saved copy, shown
  because the source did not list it this time" if `cached`, **`quietNote(e)` if `live === false`** (changelog C5),
  otherwise "Live, as the source last reported it").
- Related events: same country OR same type, at most 6.
- Not found (first load only; changelog C20): **"Disaster not found"** / *"The source may no longer list this event. It
  may have ended. [See current disasters]."*, body hidden. First load fails: **"Live data unavailable"** / *"We could
  not load this disaster just now. Trying again automatically."*

### 7.4 Forecast detail
Implemented in `forecast-detail.html`. The id defaults to `ND-001`.
- If the id is not in the feed, request `/api/events?ledger=1` and use the **last ledger row with that id**
  (`forecast:true`), with the note *"This forecast is no longer being published. It is shown exactly as it was
  recorded on {fmtDate(recordedAt||freezeTimestamp)}."* **Never substitute a different forecast.** If it is not
  found there either: **"Forecast not found"** / *"We cannot find this forecast in our current data or in our record
  of past forecasts. Check the link, or [see all our forecasts]."*, with the factors, body and enrichment hidden. A
  first load that fails: **"Live data unavailable"** / *"We could not load our forecasts, so this one cannot be shown
  right now. Trying again automatically. [See all our forecasts]."* (changelog C20).
- Eyebrow "FORECAST DETAILS". Title `titleOf(e)`. Factors: RISK, LOCATION, LAST UPDATED, STATUS.
- **STATUS and the grade** (changelog C4; `gradeOf(id)`, `showGrade(e)`). STATUS is first "Ended, not yet checked" if
  `targetEnd < now`, otherwise "Active". Then the grade is looked up:
  1. `GET /data/verification-ledger.json`; take the row in `verifications[]` with `id === e.id`. If
     `k = PNDVerdicts.normalise(row.status)` is set and is not `PENDING` or `UNKNOWN`, the grade is
     `{label: PNDVerdicts.LABELS[k] || k, summary: row.summary || ''}`.
  2. Otherwise, if the id starts with `model-`: `GET /data/model-verdicts.json`, row in `outlooks[]` with that id;
     `verdict === 'correct'` gives `LABELS.VERIFIED` ("Correct"), `verdict === 'false alarm'` gives
     `LABELS.FALSE_ALARM` ("Wrong (false alarm)"), anything else no grade.
  3. A failed or non-200 read gives no grade.
  With a grade: STATUS **"Checked: {label}"**, the "Inside the locked forecast period" row reads **"Ended"** with the
  text *"The forecast period ran to {dayOf(targetEnd, targetStart, 'end') or 'its end'} and has been checked.
  Result: {label}."* followed by `" " + summary` when there is one. ND-001 reads "Checked: Partly correct".
  **[vectors: forecastDetail.gradeOf, verdicts.label, verdicts.LABELS]**
- The forecast: key facts; Hazard; Place; Description; Last updated; **Forecast period** (`windowText`); **Kind of
  forecast** (`frozen-benchmark` "Test case, locked but not made in advance", `signal-derived-outlook` "Short-term
  forecast based on an official report", `aftershock-sequence` "Aftershock forecast", otherwise "Our own estimate");
  **Severity** (`"{severity} (level {rank} of 5)"` or "Not assessed"); **Advance notice** (≤0 gives "None. The
  forecast period had already started when we made this."; under 48 h gives "N hours before the forecast period";
  otherwise "N days before the forecast period"); Confidence; Evidence; How it will be checked (`verificationRule`);
  Forecast ID.
- **Hazard definition box** (`PNDHazards.hazardOf(type)`): "What counts as {name}", the definition, How it starts
  (sudden: "Suddenly, with little or no warning"; slow: "Slowly, over weeks to months"; otherwise "Quickly, over
  hours to days"), How long it lasts, How much warning there is, How severity is judged, and Why this forecast
  period (`{horizonHours} hours` or `{days} days` when ≥168 h, plus *"We set this from how this hazard develops. Each hazard has its own forecast period."*).
- **How this forecast works** steps 1 to 4: trigger, transmission, exposure and verification text. These come from
  the per-hazard `HAZARD` table in the page (Flood, Flood / Landslide, Landslide, Earthquake, aftershock sequence,
  Tropical Cyclone, Severe Storm, Tornado, Wildfire, Volcano, Drought, Special Marine Warning, Extreme Heat, plus a
  default). The trigger sentence depends on the kind: the benchmark gets its own sentence, a forecast with a parent
  record in the feed reads "We did not make this forecast on our own. It follows {report}…", and one without reads
  "This forecast follows a report from {agency} that is no longer in our current data…". Bundle these strings.
- **What we will check** matrix (each line stays open until the period ends):
  - Inside the locked forecast period: Open / Ended, with the "Runs {span}" text (replaced by the grade text above
    once the forecast is graded).
  - Inside the forecast area: Open / Ended, *"Set to {place} when we made the forecast, and never widened. Damage just outside it does not count."*
  - Hazard reported: `{n} reported` / "None yet". This counts official non-forecast records within 1,000 km, of the
    same family (aftershock and earthquake are treated as earthquake; otherwise the first part of the type before
    `/`), starting on or after `targetStart`, and excluding the parent record.
  - Serious harm: always **"Not assumed"**, with *"We never predict deaths, injuries or damage, so we do not assume any. We fill this in only from what others report."*
  - Official reports nearby: the count of official records within 1,000 km.
- Map: centred, with a **250 km circle** (amber `#ffbf2f`, fill opacity 0.08) and the marker.
- What this forecast means: the claim text (one version for the benchmark, one for derived forecasts),
  `leadTimeText`, `verificationRule`, and *"In an emergency, follow your national and local authorities."*
- Official reports near the forecast area: official records within 1,000 km, sorted with NEARBY_KEYS, showing
  "{km} km · {type}". Empty: *"No official reports near this area right now."*
- **The enrichment block runs with `forecast=true`**, so no donation links are shown and the "Donation links held back" text appears instead.

### 7.5 Enrichment block (all record, region, location, hazard and history detail screens)
Implemented in `event-enrichment.js`, which calls `/api/event-enrichment` (api.md §3). It has ten panels, in order:

1. **When and where it happened** (key/value): When it was reported (`when.reportedAt||e.updated`, with its age);
   When it started; Forecast period (forecasts); Official warning ends; Where it started (`where.originArea`);
   Nearest place (locality · city · state · country, with *"Worked out from the map position the source gave ·
   {resolvedBy}"*); Continent; Areas affected; Coordinates with links to OpenStreetMap ↗, Google Maps ↗ and Weather
   map ↗; Type; Source (with "Open the original report ↗"); About these times (`when.note`). The meta line reads "Updated {fmtDate(generatedAt)}".
2. **Who may need help, and how to stay safe**: 4 cards: Who may need help first, Immediate needs, Other dangers to
   watch for, and How to stay safe. Meta: "{n} groups · {m} needs". An empty list shows "Not available for this event."
3. **News reports**: cards showing the outlet tag, an "Established newsroom" tag, title, summary (at most 200
   characters), `fmtDate(publishedAt)` or "Publication time not given", " · via {via}", and "Read more ↗". Empty:
   *"No news reports found yet"* plus a "Search news ↗" button. Meta: "{n} reports · only from established newsrooms and official agencies".
4. **Official situation reports** (ReliefWeb): same card. Empty: *"No matching ReliefWeb report yet"* plus "Search ReliefWeb ↗".
5. **Videos**: thumbnail (16:9), title and "Watch ↗". Empty: *"No videos found"* plus "Search for videos ↗".
6. **Emergency phone numbers**: one card per `helplines.emergency` entry with a large tappable `tel:` link
   (characters other than `+0-9` stripped). Then email cards for authorities and relief groups that publish an email,
   then a "Where these contacts come from" card. With no numbers: *"We have no verified national emergency number
   for this place. We never guess a number. Use the official agency links in the next section, or call your local emergency service."*
7. **Official agencies and contacts**: "Open the official website ↗" and "Contact ↗". Empty: *"We do not have a national agency listed for this country yet."*
8. **Local and national support groups**: Donate ↗ (if present) and Website ↗. Empty card: "Find your national Red Cross or Red Crescent ↗" (IFRC directory).
9. **Relief organisations and donations**: "Official donation page ↗" and "Emergency page ↗", then an "About
   donations" card (`donationPolicy`). With an empty list (always the case for forecasts): **"Donation links held back"** with `donationPolicy`.
10. **Directories, and where this information comes from**: directory cards and a provenance list (`sources[]`:
    name, role and item count) plus `disclaimer`. Meta: "How often this updates: {coverage.refreshTarget}".

Failure: every panel shows *"This information is not available right now. Our help-information service did not
respond. The rest of this page is still live. This section will try again by itself."* with the meta "Trying again".
Loading: each panel shows "Loading…".

---

## 8. Regions

### 8.1 Regions list
Implemented in `regions.html`.
- Eyebrow "BY PLACE". Title "Regions". *"Start with the whole world. Then choose a country, a city or a neighbourhood, and then an event."*
- Stats: CURRENT EVENTS (non-forecast), COUNTRIES AND AREAS (**`PND.countryCount(reports)`**, the same number as every
  other screen; the group count also counts seas) (changelog C14), HIGH ALERT (`PND.isHighAlert`), SOURCES WORKING, UPDATED.
- Toolbar: search (`matchesPlace`, filters the map), **Open this place** (opens Region detail for the typed name,
  or World), **Find a city or area** (Nominatim chooser). A Country result opens Region detail. Any other level
  opens Location detail with `lat`, `lon`, `level`, `country` and `cc`.
- Map of the first 250 filtered records (forecasts included).
- **Places with current events**: non-forecast records grouped by `countries[]` (or `sea`, or `country`). Each group
  card shows "{count} current event(s) · {high} high alert" and "{types} type(s) of hazard · latest {age}". At most 40.
  Sort keys: `newest` (latest desc), `priority` ("Most high alerts first": high desc, then count desc), `countDesc`, `countAsc`, `name`.
- Popular places: Nepal, Indonesia, India, Vietnam, Philippines, Japan, United States, World, each with a one-line hazard summary.
- "What we show": *"…We never make up an event to fill an empty place." / "If a place shows nothing, our sources have no current report for it. It does not mean the place has no risk."*

### 8.2 Region detail
Implemented in `region-detail.html`. The region name comes from the path or from `?region=`/`?country=` (default World).
- Match rule (`matches()`, changelog C1): `World` matches everything. If the name is a continent
  (`PNDContinents.continentNamed(name)`, case-insensitive: Africa, Asia, Europe, North America, South America, Oceania,
  Antarctica), the region becomes that canonical name and a record matches when `PNDContinents.onContinent(e, name)`:
  one of the record's countries is on that continent (logic.md §6.12). Otherwise `[country, region, title,
  details].join(' ')` lower-cased **contains** the region name lower-cased. **[vectors: regionDetail.matches]**
- The listed records are **reports only**: `PND.observed(events).filter(matches)` (no forecasts, no `live:false`)
  (changelog C14).
- Title "Disasters around the world" or "Disasters in {region}". Stats: CURRENT EVENTS, HIGH ALERT
  (`PND.isHighAlert`), TYPES OF HAZARD, **SOURCES REPORTING HERE** (`PND.sourcesReporting`), LAST CHECKED. The map
  fits the markers (max zoom 6).
- Current events list (EVENT_SORTS). Empty: *"No current events here. Our sources have no current report for this place. This does not mean there is no danger."*
- Types of hazard tiles (count per type, opening Hazard detail with the region), "What we cover" ("Sources working
  now: N. Current events here: M."), popular places, and "See all events →" (`/events?region={name}`, which now
  scopes the list; section 3.2). For a continent the coverage line adds *" {Continent} is counted from the countries
  each report names. {n} report(s) is/are at sea or name no country, so it is/they are on no continent's page."*,
  where n counts reports (`PND.observed`) with no continent.
- Enrichment block with a synthetic event: title "{region} natural disaster" (World: "global natural disaster
  response"), country and region set to the region, type of the first non-forecast record, and that record's lat and lon.

### 8.3 Location detail
Implemented in `location-detail.html`. Comes from Find a city or area.
- With lat and lon: a **radius select** (25, 50, 100, 150, 300 or 500 km). The default depends on the level: Area
  50, City or town 100, District 150, State or region 300, otherwise 100. The choice is remembered per level
  (`pnd_radius_{level}`).
- Records within the radius, sorted with `['distance', ...EVENT_SORTS]`, each showing "{km} km away".
- A **place answer line** above: the badge from `PNDPlaceRisk.assess` (or the "Nothing reported nearby" chip) and `A.why`.
- Map: the radius circle (green `#25e29c`, fill opacity 0.06) and a centre dot.
- Without coordinates: match with `matchesPlace(e, name)`.
- Title "Disasters near {name}" (with coordinates) or "Disasters in {name}". Enrichment block as in 8.2.

---

## 9. Hazards

### 9.1 Hazard types list
The `hazard-types` collection view (section 3.2).

### 9.2 Hazard detail
Implemented in `hazard-detail.html` (changelog C2, C21). **[vectors: hazardDetail.fillHazards, hazardDetail.select]**
- Hazard select (`fillHazards`): every key of `PNDHazards.HAZARDS` (Earthquake, Earthquake aftershock sequence,
  Tropical Cyclone, Flood, Flood / Landslide, Landslide, Wildfire, Drought, Volcano, Extreme Heat, Extreme Cold, Severe
  Storm, Tornado, Tsunami), plus `hazardKey` of every type in the feed, plus `hazardKey` of the requested type,
  de-duplicated and sorted A to Z. The requested type is selected as its key: `/hazards/Volcanic Eruption` opens
  "Volcano", `/hazards/Ice` opens "Ice". **An unknown type is offered as itself, never replaced by Flood.** The select
  is refilled on each load and keeps the reader's choice. An optional region box. **Show** applies them.
- Match (`here`): `PND.sameHazard(e.type, choice)` AND (if a region is given) `PND.inPlace(e, region)` (a continent
  counts its countries; other text matches the place fields or `countries[]`).
- Current events = `PND.observed(events).filter(here)`: **reports only**. Open forecasts of the hazard
  (`PND.openForecasts(events).filter(here)`) are not listed; when there are some, a note under the list says
  *"We also have {n} open forecast(s) of {hazard lower-case}{ here}. They are our own estimates, not events. See our
  forecasts →"* (link to the forecast list).
- Hazard definition box (`hazardOf`): definition, How it starts, How long it lasts, How much warning there is, How severity is measured.
- Stats: CURRENT EVENTS, HIGH ALERT (`PND.isHighAlert`), COUNTRIES AND AREAS (`countryCount`), SOURCES
  (`PND.sourcesReporting`). A "How to read this page" panel. The events list shows `place · details`. Empty:
  **"No current events of this type match."** plus *"Our sources have no current report of this hazard{ here}. This
  does not mean there is no danger."* Enrichment block. The screen title is "{hazard} events".
- Load failure: the four stats read "Unavailable", the list shows the unavailable card, the forecast note is cleared.

---

## 10. Sources

### 10.1 Our sources (resources view)
Implemented in the `resources` view of `collection.js`. It uses `meta.scan.providers`.
- Summary panel: *"{answered} of {n} sources answered in full this time{, and {partial} in part}."* Then the
  blind-spot sentence. Hazards are grouped into families with `PNDObserved.familiesOf`. A family is blind when no
  provider for it has `completeness==='exhaustive'` with `recordsObservations !== false`. Text: *"For {list}, none of
  our sources gives a complete list of disasters that have happened. So we cannot say that no such disaster
  happened, only that none was reported."*, or the all-covered sentence.
- One card per provider:
  - Status pill: SCANNED "Answered this time" (green), INCOMPLETE_SCAN "Answered in part" (amber), DATA_UNAVAILABLE
    "Did not answer" (red), NOT_ATTEMPTED "Not checked this time" (grey).
  - Label, then Hazards, Reach, What it lists, **If it reports nothing** (three variants keyed on
    `recordsObservations` and `completeness`), and **Can a forecast be made from it?** (keyed on `inputKind`).
  - "{recordsEvaluated} reports read · {recordsServed} shown on this site", failureReason, "latest data from {fmtDate(dataFreshness)}", and the endpoint link.
- Sort keys: curated ("Suggested order"), name ("Name (A to Z)"), nameDesc ("Name - Z to A").
- Empty: *"We could not get the list of sources read this time, so this page cannot show them. This does not mean no sources were read."*
- Status line: `{statusText} · sources checked {fmtDate(scan.scanTimestamp)} · updated {age}`.

### 10.2 Source detail
Implemented in `source-detail.html`. It has static profiles for GDACS, USGS, NASA EONET and WMO (WMO is
"Reference only … this site does not read" it). Each profile has Name, Type of source, What it covers, How we use
it, How often we check it, Limits and an external link. An unknown source gets a generic profile.
- Stats: STATUS (`meta.sources[key].ok`: "Working" / "Not answering"; with no status entry, **"Named in current
  reports"** when some current record names it, else "Not read live"), CURRENT REPORTS, LATEST UPDATE (age), TYPE.
- A name with no profile and no current report (changelog C22): title **"Source not found"**, subtitle *"None of our
  current reports names a source called "{name}". See every source we read."* (link to Our sources), body hidden. The
  generic profile's type reads "Source named in our current reports".
- Current reports from this source: the first 20 records whose `source` contains the name. "Other sources" links.
- "How we treat sources" copy.

---

## 11. History

### 11.1 Past disasters list
The Calamities "Past disasters" tab (section 3.3) and the `historical-events` collection (live feed including not-live records).

### 11.2 Historical event detail
Implemented in `historical-event-detail.html` and `history-data.js`. Resolution order: the slug of `name` equals the
key, then the exact name, then a numeric index, then a name containing the key.
- Stats: WHEN, HAZARD, SEVERITY and WHERE. Detail list: Name, When, Hazard type, Where, Severity, Summary.
- "How sure is this?": *"We keep this entry for background and comparison. It is not a current event…"* plus the caveat about ancient records.
- Similar past disasters (same first hazard word or same first location word), sort keys yearNew, yearOld, name and type, at most 8.
- Links to the hazard, the region and current calamities. Enrichment block (`title: name`, `country`: the last
  comma part of the location, `type`, `updated: ''`, `forecast: false`).
- Not found: "Past disaster not found".

---

## 12. Insights

Implemented in `insights.html`.
- Tiles: Events and forecasts (all records), Most reported hazard (the top type among non-forecast records, with "{n}
  event(s) in the current data"), Our forecasts (count). On failure, show "Unavailable" and "Our data could not be reached".
- **Hazards reported now**: the top 5 types as bars (width `max(4, round(count/max*100))%`), each with
  "{n} event(s) · {k} countries". Empty: *"Our sources are not reporting any hazards right now."* Error: *"Our data
  could not be reached, so we cannot show which hazards are being reported. We do not fill this panel with estimates."*
- Static prose cards (floods and landslides, where matters most, how we judge forecasts), "How to read this" and the Background notes table (copy in `insights.html`).
- Topic detail pages (`entity-detail.html`, `kind=insight|methodology|metric|resource|about`) are a static catalogue
  of short notes with links. Bundle the catalogue; it is low priority. An unknown id shows **"Topic not found"**
  (scope "Not found", status "Not found", body *"We have no page for this topic. For live information, open the
  events, regions, hazards, sources or forecasts pages."*, links Home, Current events, How it works); only the id
  `overview` falls back to the group's first topic (changelog C22).

## 13. Methodology ("How it works") and About

Implemented in `methodology.html` and `about.html`. Both are static prose; bundle the copy verbatim.
- Methodology: 1 We collect reports, 2 We tidy them, 3 We sort them, 4 We make forecasts (including *"After an
  earthquake of magnitude 5.5 or more, we forecast its aftershocks for 7 days."*), 5 We lock them, 6 We check them.
  Then the "How we mark a forecast" table (Correct / Partly correct / Wrong / Missed / Cannot be checked / Test case)
  and *"Each hazard has a fixed distance limit, for example 250 km for an earthquake and 300 km for a flood."*
  "What we do not claim": **No made-up percentages**, **Risk levels instead** (Low, Watch, Moderate, High, Severe,
  Extreme; "Not rated"), and **Earthquakes cannot be predicted** (*"No one can predict exactly when and where an
  earthquake will strike. We report earthquakes after they happen, and we forecast only the aftershocks that follow a
  strong one."*). Types of information: Event / Official warning / Forecast / Past disaster. Closing disclaimer.
- About: *"This site gathers reports of natural disasters from official agencies around the world…"*, What we are
  trying to do, the two live figures **Countries in the current data** (`meta.countryCount`) and **Types of hazard in
  the current data** (`meta.hazardTypeCount`) from `/api/events?summary=1` ("Unavailable" on failure), What we care
  about, a section list and the disclaimer.

## 14. Verification detail (ND-001)

Implemented in `verification-detail.html` (no website change since the first spec; changelog C11 makes it required
in full). **[vectors: verificationDetail.render]** Trust group **`feed models`** (not `ledger`).
- Hero: eyebrow "Forecast check", title **"ND-001 · Central Vietnam flood and landslide forecast"** (any other id:
  "Checking forecast {id}"). The id defaults to `ND-001`.
- Stats: **ID**; **Result** = `PNDVerdicts.LABELS[PNDVerdicts.VERDICTS[row.status]]` for the `verifications[]` row
  with that id in `/data/verification-ledger.json` (exact status key, not `normalise`); "Not checked yet" when there
  is no such row, its status has no label, or the file answers non-200; "Not available" when the request itself
  fails (ND-001 currently reads **"Partly correct"**); **Starts** = the
  date part of `fmtWhen(fcStart)` or "Not stated"; **Lasts** = `duration(fcStart, fc.targetEnd)` or "Not stated";
  **Matching reports** = the number of matching records.
- "The forecast, as recorded": a static list (Forecast ID, Issued 13 Sept 2026, Target date 14 Sept 2026, Period we
  check "Starts 13 Sept 2026 · expected duration 4 days", Area (locked), Expected chain of events (locked), Correct
  if, Partly correct if, Wrong if). Copy it verbatim from the page.
- Data: `getEvents({all:true})`. `fc = findEvent(events, id)`. Matching records `ev` = every record (the forecast
  itself included) whose `[title, country, region, details].join(' ')` matches
  `/[Vv]ietnam|[Đđ]à [Nn]ẵng|[Hh]uế|[Qq]uảng|[Qq]uang/`. `fcStart = fc.targetStart || fc.startedAt || fc.updated`.
  `times` = the parseable `startedAt` of `ev`, ascending (never `updated`); `firstSeen`/`lastSeen` = first/last.
  `places` = distinct `country || region` of `ev`.
- **"Forecast compared with what happened": all 8 rows, in this order** (Metric / Forecast / Actual). NR below is
  *"Not reported by any of our sources"* and NF is *"Not included. This forecast does not predict casualties."*
  1. **Area**: `fc.region || fc.country` or "Not stated in the recorded forecast" / `places` joined " · ", or NR.
  2. **Start date**: date part of `fmtWhen(fcStart)` or "Not stated" / date part of `fmtWhen(firstSeen)`, or NR.
  3. **Start time**: `fmtTime(fcStart)` or "Not stated" / `fmtTime(firstSeen)`, or NR.
  4. **Duration**: `duration(fcStart, fc.targetEnd)` or "Not stated" / `duration(firstSeen, lastSeen)`, else "Still
     developing" when there is at least one time, else NR.
  5. **How widespread**: `fc.details` or "Not measured in the recorded forecast" / "{ev.length} matching report(s)
     from {places.length} area(s)", or NR when `ev` is empty.
  6. **Strength or severity**: `fc.alert` or "Not stated" / "Highest magnitude reported: {max}" when any title has
     `\bM\s*(\d+(\.\d+)?)\b` or "magnitude N", else the distinct `alert` values joined " · ", else NR.
  7. **Lives lost**: NF / the sum of `deaths` over the records that carry the field (a reported 0 counts, so the
     answer can be "0"), en-US grouping, or NR when no record carries it.
  8. **Missing people**: NF / NR (no source reports it).
  Footnote: *"Each row shows what we forecast next to what our sources have reported since. "Not reported" means none
  of our sources has reported that figure yet. That is not the same as a reported zero. If the same hazard happens
  again later in the same place, we check it as a separate event."*
- "Matching reports" panel: `ev` sorted with `EVENT_SORTS` (default newest) as event cards linking to `eventUrl`, or
  *"None of our sources has a matching report."*; "Forecast details →" opens `/forecasts/ND-001`.
- "Rules we follow" panel (static copy). Load error: status line *"Could not load reports. Trying again…"*

---

## 15. Trust note and footer agencies

Implemented in `trust.js`, which is loaded on every page. Data groups per page come from the `data-trust` attribute.

### 15.1 Trust note (top of screen)
Shown on every screen that has a data group: Home, Map, Alerts, all collections, Forecasts, My places, Regions,
Region, Location and Hazard detail, Source detail, Event, Alert, Calamity and Forecast detail, Insights, Verification
and Track record. It is **not** shown on About, Methodology, Historical detail, Entity detail or 404 (these have no
prediction or risk level).
- Amber-bordered box with an italic "i" icon:
  **"Experimental model, not an official warning."** *For real alerts, follow your national agency:*
  [IMD] and [NDMA] in India, [NWS] and [USGS] in the US, [GDACS] worldwide. (changelog C10)
- "When" line. Groups `feed` and `models`: *"Live data from the agencies {when(generatedAt)}"*, plus *" (they
  were not answering, so saved copies are shown)"* when `meta.live===false`, then *" · weather models run
  {when(meta.modelRun.at)}"*, plus *" (over 36 hours ago, so their forecasts are not shown)"* when `modelRun.served`
  is false. On failure (the feed request fails before any feed arrived): *"The live data did not load, so no update
  time can be shown"*. Before data: *"Live data: loading…"* (or *"Track record: loading…"* on a `ledger`-only screen).
  Group `ledger`: *"Track record last recorded {when(time handed over by the Track record screen)}"*, or *"The track
  record did not load, so no update time can be shown"* (section 6).
  The `when()` text is **`PND.fmtDate(iso)`**, the same format and zone as every other time on the screen
  (`dd MMM yyyy, h:mm AM {tzLabel}`), with the UTC time `yyyy-MM-dd HH:mm UTC` as its tooltip / accessibility value
  (changelog C9). One screen shows one zone.
- **"Data sources: GDACS, USGS, …"** disclosure (names only, **no count**: one organisation can supply two
  datasets, so a count never matched the names; changelog C10). One row per source in the page's groups: name (link), status
  ("answered" in green or "not answering" in amber, plus " · newest record {when(scan.dataFreshness)}") for the eight
  feed providers, "used in the run of {when}" for model sources, and the "adds" sentence. Then *"What each source can
  and cannot see: Our sources · How it works"*. The source list and wording are in `trust.js` `SOURCES`:

| Group | Sources (key → status from `meta.sources[key]`) |
| --- | --- |
| feed | GDACS (`gdacs`), USGS Earthquake Hazards Program (`usgs`), EMSC (`emsc`), NASA EONET (`eonet`), NOAA National Hurricane Center (`nhc`), NOAA National Weather Service (`nws`), ReliefWeb (UN OCHA) (`reliefweb`), USGS Volcano Hazards Program (`usgs_volcano`), Open-Meteo Geocoding |
| models | Open-Meteo Forecast API, NASA POWER |
| place | OpenStreetMap Nominatim |
| ledger | The live feed, as recorded; NASA POWER; Open-Meteo Previous Runs API |

Page groups: most pages use `feed models` (verification detail included). Home, My places and Regions use `feed
models place`. Track record uses `ledger` and places the note after the hero paragraph. Home places it directly under
the "Use my location" row, above the place result. The note is part of each page's HTML from the first paint
(`tools/trust-markup.js` writes it from `trust.js noteHtml(groups)`), so it never pushes the page down; `trust.js`
only fills in the "when" line and the source rows. Native: lay the note out with the screen, never insert it after load.

### 15.2 Footer agencies (every screen, on native the More screen and the bottom of long screens)
**"This is an experimental model, not an official warning service."** *For real alerts and what to do in an emergency, follow your national meteorological or disaster agency:*
- **India:** India Meteorological Department (IMD) `mausam.imd.gov.in`, National Disaster Management Authority (NDMA) `ndma.gov.in`
- **United States:** NOAA National Weather Service (NWS) `www.weather.gov`, U.S. Geological Survey (earthquakes) (USGS) `earthquake.usgs.gov`
- **Worldwide:** Global Disaster Alert and Coordination System (GDACS) `www.gdacs.org`
- **Elsewhere:** "find your country's national weather service" → `https://wmo.int/about/governance/wmo-members` (the WMO is named only in the link's accessibility label; it is a directory, not a data source).

The footer navigation links (section 0.1) sit above this text.

---

## 16. Notifications

Implemented in `portal.js` (`evaluateRiskNotifications`), `alert-rules.js`, `alerts-client.js`, `sw.js`,
`api/alerts.js` and `api/alerts-run.js`.

### 16.1 Capability states (`PNDAlerts.state()` → `mode`)
`unavailable` (the server's `/api/alerts` says `available:false`, which is the **current production state**),
`unsupported`, `install` (iOS web needs Add to Home Screen), `blocked` (permission denied), `off` and `on`.
Status copy for each state is in section 5.1 and `personal-risk.html`. For example, when on: *"Alerts are on for {n}
place(s) on this device, even when this site is closed. Last checked {age}."*, with *"That is later than planned, so
an alert may be late."* when the last run is more than 4×5 minutes old.

### 16.2 Foreground notifications (must be ported)
On every feed load, if notification permission is granted and background alerts are not on:
1. **Place alerts**: `PNDAlertRules.alertsFor(liveEvents, savedPlaces, H, now)` (logic.md §4). Show a notification
   with `title`, `body` and `tag`. Opening it goes to `url`. De-duplicate with the map `pnd_notified[key] = timestamp`
   and re-notify only after **6 h** (21,600,000 ms).
2. **Major global events** (rule only in `portal.js`): non-forecast, not cached, `live !== false`, newest timestamp
   (`updated||startedAt||issuedAt`) within 72 h, AND any of the following:
   - `alert==='Red' && sourceType==='official'` → title "Red Alert: {type} ({country})"
   - `type==='Earthquake' && magnitude >= 6.5` → "Major Earthquake M{magnitude} ({country})"
   - `/tsunami/i` in the type or title → "Tsunami Alert ({country})"
   - `/cyclone|typhoon|hurricane/i` in the type AND (`/cat(egory)?\s*[345]|severe|super/i` in severity or title, OR alert Red) → "Severe Storm Alert: {title}"

   The precedence for the title is M6.5, then tsunami, then cyclone, then red. The body is `"{title} · {alert} alert · {source}"`
   (the alert part is dropped when there is none). The key is `major-{id}|{alert lowercase}`, the tag
   `pnd-major-{id}`, with the same 6 h de-duplication. Opening the notification goes to `eventUrl(e)`.

### 16.3 Background push (native)
The website's push backend is **Web Push (VAPID) only**. It accepts endpoints on FCM web, Mozilla, WNS and
web.push.apple.com, and it is currently switched off in production (`available:false`). **Native apps cannot use
`/api/alerts` as it is**: APNs and FCM device tokens are not Web Push subscriptions (api.md §4). For parity, native
apps should implement:
- **Local evaluation**: background refresh (iOS `BGAppRefreshTask`, Android `WorkManager` periodic work of at least
  15 min) fetches `/api/events` and runs `alertsFor` plus the major-event rule on device with the same 6 h
  de-duplication. This keeps the "never sends alerts for our own forecasts" rule and the privacy property (places
  never leave the device).
- **Optional server push** (new backend work): a native variant of `/api/alerts` that accepts an APNs or FCM token
  with the same `cleanPlaces` (kind plus lat and lon rounded to 2 decimals, at most 10 places), and the same
  `alerts-run` rules (at most 3 alerts per device per run plus a "{n} more hazards near your places" summary that
  opens My places, 14-day sent memory, 90-day expiry).
- Notification content and tap routing match `sw.js`: title, body, tag (replaces the previous notification with the
  same tag, renotify on), timestamp `at`, and a tap that opens `url` inside the app. Only app routes are allowed; anything else opens My places.

## 17. Timezone setting

Implemented in `PND.timezone`, `PND.timezoneOptions` and `PND.setTimezone` (`portal.js`).
- Default (changelog C9): the stored choice (`pnd_timezone`), else **the device's own zone**
  (`Intl.DateTimeFormat().resolvedOptions().timeZone`), else Asia/Kolkata when the platform gives none. Native:
  `TimeZone.current.identifier` / `ZoneId.systemDefault().id`, falling back to Asia/Kolkata. A zone without a short
  label shows its IANA id (for example "Asia/Kathmandu"). **[vectors: portal.timezoneDefault]**
- Picker: the current zone first, then Asia/Kolkata (labelled "IST · India"), UTC, America/New_York,
  America/Los_Angeles, Europe/London, Europe/Paris, Asia/Dubai, Asia/Singapore, Asia/Tokyo, Australia/Sydney, then
  every IANA zone. Stored in `pnd_timezone`. Changing it re-renders every screen (the web reloads the page).
- Zone labels shown after times (`tzLabel`): Asia/Kolkata IST, UTC UTC, America/New_York ET, America/Los_Angeles PT,
  Europe/London UK, Asia/Dubai GST, Asia/Singapore SGT, Asia/Tokyo JST, Australia/Sydney Sydney. Any other zone shows
  the raw IANA id (for example "Europe/Paris"). The formats are in logic.md §6.
- The trust note formats with the same `fmtDate` and `tzLabel` as the rest of the screen (one zone per screen). Do
  not use the platform's short zone name ("GMT+5:30").

## 18. Screens on the website not required for parity

- `dashboard.html`, `directory.html`, `home.html`, `home-v2.html` and `home-v3.html` are legacy. `/home*` redirect
  to `/`. dashboard and directory are not linked from navigation.
- `404.html` behaviour is covered by deep-link resolution (section 0.1).
- The 3D Cesium globe (`globe.js`) is optional.
- SEO markup, canonical links and `sitemap.xml` are not applicable.
