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
| NOAA National Hurricane Center | Active tropical cyclones |
| NOAA / National Weather Service | Active Extreme and Severe US warnings with mapped geometry |
| ReliefWeb (UN OCHA) | Alert and ongoing humanitarian disaster records |
| USGS Volcano Hazards Program | Volcanoes at elevated alert level |

Per-source status, record counts and failure reasons are returned in `meta.sources`.

## Experimental outlooks

Outlooks are derived from **active official signals**, never from a single
provider, and each one carries its evidence, confidence and grading rule:

- **Hazard-continuation outlooks** — a 72-hour outlook for each active
  non-seismic official signal, deduplicated by country and hazard.
- **Aftershock-sequence outlooks** — a 7-day outlook following an observed
  M5.5+ earthquake. This describes the ongoing sequence; the mainshock is never
  presented as having been predicted.
- **ND-001** — the frozen benchmark forecast, retained for verification history.

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
authority instead — a number is never guessed. Email addresses appear only where
the organisation publishes them on its own contact page. Donation links always
point at the organisation's own domain, and are withheld entirely on forecast
records until impact is independently verified.

## Refresh cycle

- Detail pages re-request enrichment every 5 minutes; list and map pages poll the
  live feed every 60 seconds.
- `.github/workflows/refresh-disaster-data.yml` runs every 5 minutes, validates
  the feed's shape, reports offline providers, and pre-warms the enrichment cache
  for every event using the exact query the browser sends. It fails loudly when
  the feed is empty, malformed, or when enrichment does not answer.

## Tests

Offline suite — no network required. Upstream providers are mocked, and the real
handlers and real pages run against them.

```bash
cd test
npm install
npm test
```

- `api.test.js` — both API handlers across success and total-outage paths,
  outlook generation, ID stability, and the verified support directory.
- `pages.test.js` — renders every page in the repository in jsdom and asserts the
  detail pages populate their fields and the full context block.

`test/` is excluded from the Vercel deployment via `.vercelignore`.

## Scientific / safety note

Experimental forecasts are research signals, not official emergency guidance.
Official alerts and emergency instructions from local authorities,
meteorological agencies, geological surveys and emergency-management agencies
take precedence.

## Deployment

Source repository for the Vercel project `anchit-ai-hustle/predict-natural-disasters`.
