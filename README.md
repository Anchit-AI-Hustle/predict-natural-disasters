# Predict Natural Disasters

Global natural-disaster intelligence and experimental forecast-verification dashboard.

## Production

Target domain: `https://predict-natural-disasters.anchit-tandon.com/`

## Current frozen forecast

`ND-001` — Central Vietnam — target 14 Sep 2026, verification window 13–16 Sep 2026 — flash flooding / river flooding / landslides.

## Scientific / safety note

Experimental forecasts are research signals, not official emergency guidance. Official alerts and emergency instructions from local authorities, meteorological agencies, geological surveys, and emergency-management agencies take precedence.

## Deployment

This repository is intended to be the source repository for the Vercel project `anchit-ai-hustle/predict-natural-disasters`.

The current `index.html` is the existing static dashboard baseline. The next production revision should implement the full global command-center experience with world → continent → country → state/province → city drilldown, unified event ranking, an interactive map, official-vs-experimental separation, and ND-001 preserved as one experimental forecast rather than a globally pinned card.
