#!/usr/bin/env node
'use strict';
/**
 * Give the places whose ids lost their accents their transliterated ids.
 *
 *   node tools/rename-places.js [dataDir]
 *
 * "Bogotá" was slugged "bogot-co" and "São Paulo" "s-o-paulo-br". The rename
 * table is forecast-models.js PLACE_ID_RENAMES, and this applies it to the
 * files that are rebuilt rather than recorded: the climatology's place ids
 * and the measurement archive's keys. The ledger and the run log are records
 * and keep the ids they were written with; the grading reads those through
 * placeIdOf. Running it twice changes nothing.
 */
const fs = require('fs');
const path = require('path');
const M = require(path.join(__dirname, '..', 'forecast-models.js'));
const MG = require(path.join(__dirname, 'model-grades.js'));
const DATA = process.argv[2] || path.join(__dirname, '..', 'data');

const climFile = path.join(DATA, 'climatology.json');
const clim = JSON.parse(fs.readFileSync(climFile, 'utf8'));
let renamed = 0;
for (const p of clim.places) {
  const id = M.placeIdOf(p.id);
  if (id !== p.id) { p.id = id; renamed++; }
}
if (renamed) fs.writeFileSync(climFile, JSON.stringify(clim) + (fs.readFileSync(climFile, 'utf8').endsWith('\n') ? '\n' : ''));

const archFile = path.join(DATA, 'model-measured.json');
if (fs.existsSync(archFile)) {
  const a = JSON.parse(fs.readFileSync(archFile, 'utf8'));
  let moved = 0;
  for (const old of Object.keys(a.places)) {
    const id = M.placeIdOf(old);
    if (id === old) continue;
    a.places[id] = Object.assign({}, a.places[old], a.places[id] || {});
    delete a.places[old]; moved++;
  }
  if (moved) MG.writeArchive(archFile, a);
  console.log('archive: ' + moved + ' place(s) moved');
}
console.log('climatology: ' + renamed + ' place id(s) renamed');
