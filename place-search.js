'use strict';
/**
 * Finding a place at the level the reader means: a neighbourhood, a city, a
 * district, a state or a country.
 *
 * Both place searches asked OpenStreetMap's Nominatim for one result and took
 * it. "Koramangala" or "Andheri West" could land on a same-named place in
 * another country, and there was no way to say "the city, not the district".
 * This asks for several, says what level each one is, and lets the reader
 * pick. Nominatim's usage policy forbids search-as-you-type, so a search runs
 * only when the reader asks for one.
 *
 * Loaded as a plain script in the browser (window.PNDPlaceSearch) and required
 * by the tests.
 */
(function (root) {
  var ENDPOINT = 'https://nominatim.openstreetmap.org/search';

  /* Nominatim's own address type, read as what a reader would call it. */
  var LEVELS = [
    ['Area', /^(neighbourhood|suburb|quarter|city_district|borough|locality|village|hamlet|isolated_dwelling|croft|allotments|city_block|residential|farm)$/],
    ['City or town', /^(city|town|municipality)$/],
    ['District', /^(county|district|state_district|subdistrict|district_council)$/],
    ['State or region', /^(state|province|region|territory)$/],
    ['Country', /^(country|nation)$/],
    ['Address or landmark', /^(road|house|house_number|building|amenity|shop|tourism|leisure|office|highway|railway|aeroway|man_made|historic|natural|place_of_worship|school|university|hospital|postcode)$/]
  ];

  function levelOf(r) {
    var t = String((r && (r.addresstype || r.type)) || '').toLowerCase();
    for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i][1].test(t)) return LEVELS[i][0];
    var rank = Number(r && r.place_rank);
    if (isFinite(rank)) {
      if (rank <= 4) return 'Country';
      if (rank <= 8) return 'State or region';
      if (rank <= 12) return 'District';
      if (rank <= 16) return 'City or town';
      if (rank <= 25) return 'Area';
      return 'Address or landmark';
    }
    return 'Place';
  }

  /* "Koramangala, Bengaluru, Karnataka, India" rather than Nominatim's full
     chain of ward, taluk, district, postcode and country. */
  function labelOf(r) {
    var a = (r && r.address) || {};
    var name = (r && r.name) || String((r && r.display_name) || '').split(',')[0].trim();
    var town = a.city || a.town || a.village || a.municipality || a.county || '';
    var state = a.state || a.region || a.province || '';
    var parts = [name, town, state, a.country];
    var out = [];
    parts.forEach(function (p) {
      p = String(p || '').trim();
      if (p && out.map(function (x) { return x.toLowerCase(); }).indexOf(p.toLowerCase()) === -1) out.push(p);
    });
    return out.join(', ') || String((r && r.display_name) || '');
  }

  function candidate(r) {
    var lat = Number(r && r.lat), lon = Number(r && r.lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    var a = (r && r.address) || {};
    return {
      kind: 'Searched',
      name: labelOf(r),
      full: String((r && r.display_name) || ''),
      level: levelOf(r),
      lat: lat, lon: lon,
      country: a.country || '',
      countryCode: String(a.country_code || '').toUpperCase()
    };
  }

  /** Results as candidates, the same place never listed twice. */
  function candidates(results) {
    var seen = {}, out = [];
    (results || []).forEach(function (r) {
      var c = candidate(r);
      if (!c) return;
      var k = c.name.toLowerCase() + '|' + c.level;
      if (seen[k]) return;
      seen[k] = true;
      out.push(c);
    });
    return out;
  }

  function search(q, opts) {
    var f = (opts && opts.fetch) || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) return Promise.reject(new Error('Place search is not available in this browser.'));
    var url = ENDPOINT + '?format=jsonv2&addressdetails=1&accept-language=en&limit=' +
      ((opts && opts.limit) || 8) + '&q=' + encodeURIComponent(q);
    return f(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r || !r.ok) throw new Error('Place search is not available right now.');
      return r.json();
    }).then(candidates);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* A list the reader picks from. Each choice says what level it is, and the
     full address underneath tells two same-named places apart. */
  function renderChoices(box, list, onPick) {
    if (!box) return;
    if (!list || !list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<p class="pc-head">Which place do you mean?</p>' +
      list.map(function (c, i) {
        return '<button type="button" class="pc-item" data-pick="' + i + '">' +
          '<span class="pc-name">' + esc(c.name) + '</span>' +
          '<span class="pc-level">' + esc(c.level) + '</span>' +
          (c.full && c.full !== c.name ? '<span class="pc-full">' + esc(c.full) + '</span>' : '') +
          '</button>';
      }).join('');
    box.onclick = function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-pick]');
      if (!b) return;
      var c = list[Number(b.getAttribute('data-pick'))];
      box.hidden = true; box.innerHTML = '';
      if (c && onPick) onPick(c);
    };
  }

  var api = { search: search, candidates: candidates, levelOf: levelOf, labelOf: labelOf, renderChoices: renderChoices };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PNDPlaceSearch = api;
})(typeof window !== 'undefined' ? window : null);
