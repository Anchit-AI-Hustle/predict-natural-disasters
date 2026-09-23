# Leaflet 1.9.4, served from this site

Every map page used to load the map library from `unpkg.com`. Measured in
Chromium with that origin unreachable, the cost was not the map:

```
                 unpkg reachable        unpkg blocked
/alerts          25 records shown       5, and stuck on "Loading…"
/forecasts       31 records shown       6, and stuck on "Loading…"
/live-map        18,141 chars of page   7,353
```

Each page's script begins `const map = L.map('map')`, so a library that never
arrives throws on the first statement and everything after it — the feed
request, the list, the filters — never runs. A site whose purpose is telling
people what hazard is near them went blank because a third party was
unreachable: a CDN outage, a network that blocks unpkg, or a slow connection
that timed out.

So the library is served from this origin. There is no third-party request in
the critical path of any page.

## What is here, and where it came from

`leaflet.js`, `leaflet.css` and `images/` are the unmodified `dist` of the
`leaflet@1.9.4` package from the npm registry — the same files unpkg serves,
since unpkg serves registry tarballs directly.

```
registry tarball  https://registry.npmjs.org/leaflet/-/leaflet-1.9.4.tgz
npm integrity     sha512-nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA==

sha256  db49d009c841f5ca34a888c96511ae936fd9f5533e90d8b2c4d57596f4e5641a  leaflet.js
sha256  a7837102824184820dfa198d1ebcd109ff6d0ff9a2672a074b9a1b4d147d04c6  leaflet.css
sha256  066daca850d8ffbef007af00b06eac0015728dee279c51f3cb6c716df7c42edf  images/layers-2x.png
sha256  1dbbe9d028e292f36fcba8f8b3a28d5e8932754fc2215b9ac69e4cdecf5107c6  images/layers.png
sha256  00179c4c1ee830d3a108412ae0d294f55776cfeb085c60129a39aa6fc4ae2528  images/marker-icon-2x.png
sha256  574c3a5cca85f4114085b6841596d62f00d7c892c7b03f28cbfa301deb1dc437  images/marker-icon.png
sha256  264f5c640339f042dd729062cfc04c17f8ea0f29882b538e3848ed8f10edb4da  images/marker-shadow.png
```

Nothing in these files has been edited. `LICENSE` is Leaflet's own BSD-2-Clause
licence, kept because the licence requires it.

## What this does not fix

Map *tiles* still come from a tile service over the network, so a map still
needs connectivity to show anything. What it no longer does is take the rest
of the page down with it: `map-setup.js` stands in for a library that failed
to arrive, says so in the map panel, and lets everything else on the page
render.

## Upgrading

Replace the files from the same `dist` directory of the new version, update
the version and the hashes above, and re-run:

```
node --test test/vendor.test.js
SITE_ROOT=$PWD node tools/a11y-nav-check.js
```
