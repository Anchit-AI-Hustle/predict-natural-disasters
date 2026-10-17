# Predict Natural Disasters

Global natural-disaster intelligence and experimental forecast-verification dashboard.

## Production

Target domain: `https://predict-natural-disasters.anchit-tandon.com/`

## Live data sources

`/api/events` fetches every provider independently and isolates failures, so one
provider outage degrades coverage instead of emptying the feed:

| Source | Coverage |
| --- | --- |
| GDACS (JSON, app endpoint, RSS fallback) | Multi-hazard global alerts and impact figures |
| USGS Earthquake Hazards Program | Earthquakes, M2.5+ over 7 days |
| EMSC / seismicportal | Independent seismic cross-check, M4.5+ |
| NASA EONET | Satellite-observed open natural events |
| NOAA National Hurricane Center | Active tropical cyclones, Atlantic and eastern/central Pacific basins only |
| NOAA / National Weather Service | Active Extreme and Severe US warnings with mapped geometry |
| ReliefWeb (UN OCHA) | Listed humanitarian disasters, from the public RSS feed |
| USGS Volcano Hazards Program | Volcanoes at elevated alert level, US observatory network only |

These providers define the coverage. There is no global cell-by-cell scan: a
hazard below a provider's threshold, or outside the region it publishes for, is
not seen here, and an absence of records for a place is not evidence that the
place is quiet. What each run actually evaluated is recorded in
`data/scan-ledger.json`, with a status per provider, and the verification page
reports a disaster whose coverage cannot be established as exactly that rather
than as a forecasting failure.

Per-source status, record counts and failure reasons (including the upstream's
own error body) are returned in `meta.sources`.

### ReliefWeb

ReliefWeb's v2 API requires an appname that ReliefWeb approves by hand, so both
the disaster list and the per-event situation reports read its **public RSS
feeds** instead. Nothing to register, no environment variable, no key.

The disasters feed path is not documented, so the handler tries a short list of
candidate URLs and accepts one only if it parses into feed items - a Drupal miss
can answer 200 with an HTML page, which would otherwise look like "online, no
disasters". `meta.sources.reliefweb.endpoint` records which URL answered.

The disasters feed carries no coordinates, so each record is placed at its
country's location (resolved through Open-Meteo's key-less geocoder) and
flagged `precision: "country"`. These are country-level humanitarian records,
not incident positions, and the detail page says so. A record whose country
cannot be resolved is left off the map rather than placed somewhere plausible.

## Experimental outlooks

Outlooks are derived from **active official signals**, never from a single
provider, and each one carries its evidence, confidence and grading rule:

- **Hazard-continuation outlooks** - a 72-hour outlook for each active
  non-seismic official signal, deduplicated by country and hazard.
- **Aftershock-sequence outlooks** - a 7-day outlook following an observed
  M5.5+ earthquake. This describes the ongoing sequence; the mainshock is never
  presented as having been predicted.
- **ND-001** - the frozen benchmark forecast, retained for verification history.

Outlook IDs are derived from the source record, so a detail link stays valid
across refreshes.

## Per-event detail pages

`/api/event-enrichment` returns everything a detail page shows beyond the raw
feed record, refreshed on a 5-minute cycle:

- when it was reported and when it started, plus the monitored window for outlooks
- where it originated, reverse-geocoded to locality / city / state / country
- affected regions and map links
- distress groups, immediate needs, secondary risks and safety actions per hazard
- live news from Google News and Bing News, deduplicated and attributed, with
  established newsrooms badged
- official situation reports from ReliefWeb (UN OCHA)
- video and field reporting
- verified national emergency helplines, national authorities and contact pages
- national support groups and international relief organisations with real
  donation links on their own domains

Every incident, alert, calamity, outlook, region, location, hazard and historical
archive page renders this block.

### Contact-data policy

Emergency numbers are national numbers published by the relevant public-safety
authority. Where none could be verified, the page says so and links the national
authority instead - a number is never guessed. Email addresses appear only where
the organisation publishes them on its own contact page. Donation links always
point at the organisation's own domain, and are withheld entirely on forecast
records until impact is independently verified.

## Sorting

Every page that lists records carries a sort control. The vocabulary is shared
(`PND.SORT_DEFS` in `portal.js`) so the options, labels and behaviour match
everywhere, and the choice is remembered per page in `localStorage`.

- **Event lists** - severity, last updated (newest/oldest), reported deaths,
  people affected, country/region, hazard type, source, title.
- **Forecast lists** - the above plus window-ends-soonest.
- **Nearby lists** on detail pages - distance first, then the event options.
- **Region and source aggregates** - priority, record count, most recent, name.
- **Historical archive** - date, name, hazard type.

`index.html`, `dashboard.html` and `home-v3.html` are self-contained pages that
do not load `portal.js`, so they carry their own copy of the same vocabulary;
the test suite asserts they stay in step.

`about.html`, `insights.html` and `methodology.html` are static prose with no
record list, so they have no sort control - and `methodology.html` is a numbered
sequence that reordering would actively break.

## Refresh cycle

- Detail pages re-request enrichment every 5 minutes; list and map pages poll the
  live feed every 60 seconds.
- `.github/workflows/refresh-disaster-data.yml` runs every 5 minutes, validates
  the feed's shape, reports offline providers, and pre-warms the enrichment cache
  for every event using the exact query the browser sends. It fails loudly when
  the feed is empty, malformed, or when enrichment does not answer.

## Tests

Offline suite - no network required. Upstream providers are mocked, and the real
handlers and real pages run against them.

```bash
cd test
npm install
npm test
```

- `api.test.js` - both API handlers across success and total-outage paths,
  outlook generation, ID stability, and the verified support directory.
- `pages.test.js` - renders every page in the repository in jsdom and asserts the
  detail pages populate their fields and the full context block.

`test/` is excluded from the Vercel deployment via `.vercelignore`.

## Scientific / safety note

Experimental forecasts are research signals, not official emergency guidance.
Official alerts and emergency instructions from local authorities,
meteorological agencies, geological surveys and emergency-management agencies
take precedence.

## Deployment

Source repository for the Vercel project `anchit-ai-hustle/predict-natural-disasters`.
