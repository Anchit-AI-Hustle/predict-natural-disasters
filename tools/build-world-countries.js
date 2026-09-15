/* Regenerate world-countries.json:
 *   npm i world-atlas@2 topojson-client
 *   node tools/build-world-countries.js world-countries.json
 * The output is committed, so the app never fetches country outlines at runtime.
 */
/* Builds the political world layer the app ships.
   Natural Earth 1:110m country outlines, coordinates rounded to two decimals
   (about a kilometre, far finer than a world map can show), and a colour per
   country chosen so no two that share a border get the same one -- computed
   here rather than guessed, by treating shared boundary vertices as adjacency
   and greedy-colouring the resulting graph. */
const fs = require('fs');
const topo = require('world-atlas/countries-110m.json');
const { feature } = require('topojson-client');

const fc = feature(topo, topo.objects.countries);
const R = n => Math.round(n * 100) / 100;

const walk = (co, fn) => Array.isArray(co[0]) ? co.forEach(c => walk(c, fn)) : fn(co);
for (const f of fc.features) walk(f.geometry.coordinates, p => { p[0] = R(p[0]); p[1] = R(p[1]); });

/* Russia, Fiji and Antarctica each carry a ring that crosses the antimeridian.
   Drawn as-is on a flat projection those rings sweep the long way round the
   globe and paint a band straight across the map. Each ring is unwrapped to
   continuous longitudes, then clipped back into the -180..180 strip once per
   360 degrees it covers, so the parts either side of the date line become
   separate rings -- which is what they are on the ground. */
function unwrap(ring) {
  const out = [ring[0].slice()];
  for (let i = 1; i < ring.length; i++) {
    let x = ring[i][0];
    const prev = out[i - 1][0];
    while (x - prev > 180) x -= 360;
    while (x - prev < -180) x += 360;
    out.push([x, ring[i][1]]);
  }
  return out;
}
/* Sutherland-Hodgman against one vertical edge. */
function clipEdge(ring, x, keepLeft) {
  const inside = p => keepLeft ? p[0] <= x : p[0] >= x;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ain = inside(a), bin = inside(b);
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (x - a[0]) / (b[0] - a[0]);
      out.push([x, a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}
function splitAtDateLine(ring) {
  const xs = ring.map(p => p[0]);
  if (Math.max(...xs) - Math.min(...xs) <= 180) return [ring];
  const un = unwrap(ring);
  const lo = Math.floor((Math.min(...un.map(p => p[0])) + 180) / 360);
  const hi = Math.floor((Math.max(...un.map(p => p[0])) + 180) / 360);
  const pieces = [];
  for (let k = lo; k <= hi; k++) {
    const shifted = un.map(p => [p[0] - k * 360, p[1]]);
    const clipped = clipEdge(clipEdge(shifted, 180, true), -180, false);
    if (clipped.length >= 4) pieces.push(clipped.map(p => [R(p[0]), R(p[1])]));
  }
  return pieces.length ? pieces : [ring];
}
let splitCount = 0;
for (const f of fc.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rebuilt = [];
  for (const poly of polys) {
    const outer = splitAtDateLine(poly[0]);
    if (outer.length > 1) splitCount += outer.length - 1;
    // Holes follow their outer ring; none of the split ones carry any.
    if (outer.length === 1) rebuilt.push(poly);
    else outer.forEach(r => rebuilt.push([r]));
  }
  f.geometry = { type: 'MultiPolygon', coordinates: rebuilt };
}
console.log('rings split at the date line:', splitCount);

// Adjacency: two countries touch if they share a boundary vertex.
const owners = new Map();
fc.features.forEach((f, i) => walk(f.geometry.coordinates, p => {
  const k = p[0] + ',' + p[1];
  (owners.get(k) || owners.set(k, new Set()).get(k)).add(i);
}));
const adj = fc.features.map(() => new Set());
for (const set of owners.values()) {
  if (set.size < 2) continue;
  const ids = [...set];
  for (const a of ids) for (const b of ids) if (a !== b) adj[a].add(b);
}

// Greedy colouring, densest countries first so the hard cases get choices.
const PALETTE = ['#f2b880', '#9ad4a0', '#f4d06f', '#a8c8ec', '#e8a0a8', '#c9b3e6', '#8fd5c8'];
const colour = new Array(fc.features.length).fill(-1);
const order = fc.features.map((_, i) => i).sort((a, b) => adj[b].size - adj[a].size);
for (const i of order) {
  const taken = new Set([...adj[i]].map(n => colour[n]).filter(c => c >= 0));
  let c = 0; while (taken.has(c)) c++;
  colour[i] = c % PALETTE.length;
}
const clashes = fc.features.reduce((n, _, i) =>
  n + [...adj[i]].filter(j => colour[j] === colour[i]).length, 0) / 2;

const out = {
  type: 'FeatureCollection',
  features: fc.features.map((f, i) => ({
    type: 'Feature',
    properties: { n: f.properties.name, c: colour[i] },
    geometry: f.geometry
  }))
};
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log('countries:', out.features.length);
console.log('palette slots used:', new Set(colour).size, 'of', PALETTE.length);
console.log('neighbouring pairs sharing a colour:', clashes);
console.log('file size:', (fs.statSync(process.argv[2]).size / 1024).toFixed(0) + 'KB');
console.log('palette:', JSON.stringify(PALETTE));
