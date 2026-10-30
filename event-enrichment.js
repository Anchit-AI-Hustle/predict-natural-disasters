/**
 * Detail-page enrichment renderer.
 *
 * Draws the full humanitarian context block that every incident, alert,
 * calamity and outlook detail page shares: when and where the event started,
 * who is in distress, live news, situation reports, video reporting, verified
 * helplines, national authorities, local support groups and real donation
 * links - refreshed on the platform's 5-minute cycle.
 */
(() => {
  const REFRESH_MS = 300000; // 5 minutes
  const TICK_MS = 60000;     // portal.js caps timers at 60s; we gate on elapsed time

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  const fmt = d => {
    if (!d) return '-';
    try { return window.PND ? PND.fmtDate(d) : new Date(d).toUTCString(); } catch (e) { return String(d); }
  };
  const age = d => {
    if (!d) return '';
    try { return window.PND ? PND.age(d) : ''; } catch (e) { return ''; }
  };
  const telHref = p => 'tel:' + String(p || '').replace(/[^+0-9]/g, '');

  const card = (title, body, links) =>
    '<div class="card"><h3>' + esc(title) + '</h3>' + (body || '') + (links || '') + '</div>';

  const list = items => (items && items.length)
    ? '<ul class="intellist">' + items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>'
    : '<p class="muted">Not available for this event.</p>';

  const STYLE = `<style>
    .intelgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;padding:10px}
    .intelgrid2{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;padding:10px}
    .intelgrid .card,.intelgrid2 .card{min-height:110px}
    .intelthumb{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#062018}
    .intelmeta{font-size:10px;color:#91b4a6}
    .intellist{margin:6px 0 0;padding-left:17px}
    .intellist li{margin-bottom:4px;color:#cfe7dd;font-size:12px}
    .intelphone{font-size:24px;font-weight:850;letter-spacing:.02em;display:block;margin:4px 0;color:#8ff0ca;text-decoration:none}
    .intelphone:hover{text-decoration:underline}
    .inteltag{font-size:9px;border:1px solid #2b624e;border-radius:999px;padding:2px 6px;color:#9fd0bb;margin-right:4px}
    .inteltag.verified{border-color:#25e29c;color:#8ff0ca}
    .intelkv{padding:14px}.intelkvdl{display:grid;grid-template-columns:190px 1fr;gap:7px 14px;margin:0}
    .intelkv dt{color:#89ab9d;font-size:12px}
    .intelkv dd{margin:0;font-size:13px}
    a.intelcard{color:inherit;text-decoration:none;display:block}
    a.intelcard:hover{border-color:#35d79a}
    @media(max-width:900px){.intelgrid,.intelgrid2{grid-template-columns:1fr}.intelkvdl{grid-template-columns:1fr}}
  </style>`;

  const PANELS = [
    ['whenWhere', 'When and where it happened', 'Where it started, the nearest place and the areas affected', 'kv'],
    ['distress', 'Who may need help, and how to stay safe', 'General guidance for this type of disaster, not confirmed reports about people', 'grid2'],
    ['news', 'News reports', '', 'grid'],
    ['reports', 'Official situation reports', 'From ReliefWeb (UN OCHA)', 'grid'],
    ['videos', 'Videos', '', 'grid'],
    ['helplines', 'Emergency phone numbers', 'Only numbers published by national authorities', 'grid'],
    ['authorities', 'Official agencies and contacts', '', 'grid'],
    ['support', 'Local and national support groups', '', 'grid'],
    ['relief', 'Relief organisations and donations', 'Links to official organisation websites only', 'grid'],
    ['directories', 'Directories, and where this information comes from', '', 'grid']
  ];

  function shell(only) {
    return STYLE + PANELS.filter(([id]) => !only || only.indexOf(id) >= 0).map(([id, heading, note, kind]) =>
      '<section class="panel"><div class="ph"><h2>' + esc(heading) + '</h2>' +
      '<span class="intelmeta" id="' + id + 'Meta">' + esc(note || 'Loading…') + '</span></div>' +
      '<div id="' + id + 'Body" class="' + (kind === 'kv' ? 'intelkv' : kind === 'grid2' ? 'intelgrid2' : 'intelgrid') + '">' +
      '<div class="card loading"><p class="muted">Loading…</p></div></div></section>'
    ).join('');
  }

  /* A page can be left while a request is out; nothing is drawn into it then. */
  const el = id => (typeof document !== 'undefined' && document && document.getElementById) ? document.getElementById(id) : null;
  const setBody = (id, html) => { const n = el(id + 'Body'); if (n) n.innerHTML = html; };
  const setMeta = (id, text) => { const n = el(id + 'Meta'); if (n) n.textContent = text; };

  function renderWhenWhere(d, e) {
    const w = d.where || {}, when = d.when || {}, place = w.resolvedPlace;
    const rows = [];
    const row = (k, v) => rows.push('<dt>' + esc(k) + '</dt><dd>' + v + '</dd>');

    row('When it was reported', esc(fmt(when.reportedAt || e.updated)) +
      (age(when.reportedAt || e.updated) ? ' <span class="muted">· ' + esc(age(when.reportedAt || e.updated)) + '</span>' : ''));
    if (e.startedAt) row('When it started', esc(fmt(e.startedAt)));
    if (e.forecast && e.targetStart) row('Forecast period', esc(window.PND && PND.windowText ? PND.windowText(e) : fmt(e.targetStart)));
    if (e.expiresAt) row('Official warning ends', esc(fmt(e.expiresAt)));
    row('Where it started', esc(w.originArea || e.region || e.country || 'Not given by the source'));
    if (place) {
      row('Nearest place', esc([place.locality, place.city, place.state, place.country].filter(Boolean).join(' · ') || '-') +
        '<br><span class="muted">Worked out from the map position the source gave · ' + esc(place.resolvedBy || 'map lookup') + '</span>');
      if (place.continent) row('Continent', esc(place.continent));
    }
    row('Areas affected', esc(w.affectedAreaText || '-'));
    if (w.coordinates) {
      const c = w.coordinates, m = w.mapLinks || {};
      row('Coordinates', esc(c.lat.toFixed(4) + ', ' + c.lon.toFixed(4)) +
        (m.openStreetMap ? '<br><a href="' + esc(m.openStreetMap) + '" target="_blank" rel="noopener">OpenStreetMap ↗</a>' : '') +
        (m.googleMaps ? ' · <a href="' + esc(m.googleMaps) + '" target="_blank" rel="noopener">Google Maps ↗</a>' : '') +
        (m.windy ? ' · <a href="' + esc(m.windy) + '" target="_blank" rel="noopener">Weather map ↗</a>' : ''));
    }
    row('Type', esc(e.type || '-'));
    row('Source', esc(e.source || '-') +
      (e.sourceUrl ? ' · <a href="' + esc(e.sourceUrl) + '" target="_blank" rel="noopener">Open the original report ↗</a>' : ''));
    row('About these times', '<span class="muted">' + esc(when.note || '') + '</span>');

    /* In a <dl>: a dt and dd straight inside a div is not a description list (axe dlitem, on every detail page). */
    setBody('whenWhere', '<dl class="intelkvdl">' + rows.join('') + '</dl>');
    setMeta('whenWhere', 'Updated ' + fmt(d.generatedAt));
  }

  function renderDistress(d) {
    setBody('distress', [
      card('Who may need help first', list(d.distressGroups)),
      card('Immediate needs', list(d.immediateNeeds)),
      card('Other dangers to watch for', list(d.secondaryRisks)),
      card('How to stay safe', list(d.safetyActions))
    ].join(''));
    setMeta('distress', (d.distressGroups || []).length + ' groups · ' + (d.immediateNeeds || []).length + ' needs');
  }

  /*
   * A headline without its outlet stuck on the end.
   *
   * Google News titles end " - Outlet", and its description repeats the
   * headline with the outlet after it ("... Across The World News18"), so the
   * card printed each headline twice with the source name glued on.
   */
  function stripSource(text, outlet) {
    let s = String(text == null ? '' : text).replace(/(&nbsp;)+/gi, ' ').replace(/\s+/g, ' ').trim();
    const o = String(outlet || '').trim();
    if (!o) return s;
    const low = s.toLowerCase(), ol = o.toLowerCase();
    if (low.endsWith(ol)) s = s.slice(0, s.length - o.length).replace(/[\s|:,\u00b7-]+$/, '').trim();
    return s;
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /* A source that gives only a day is shown as that day. Its midnight UTC,
     turned into a time in the reader's zone, read as "12:30 PM", a time
     nobody published. */
  function newsDate(v) {
    const raw = String(v || '').trim();
    if (!raw) return '';
    const dayOnly = /^\d{4}-\d\d-\d\d$/.test(raw) ||
      /\b00:00(:00)?\s*(GMT|UTC|Z|\+0000)\b/i.test(raw) || /T00:00(:00)?(\.0+)?(Z|\+00:?00)$/.test(raw);
    const t = Date.parse(dayOnly && /^\d{4}-\d\d-\d\d$/.test(raw) ? raw + 'T00:00:00Z' : raw);
    if (!Number.isFinite(t)) return raw;
    if (!dayOnly) return fmt(raw);
    const d = new Date(t);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  /* Within the last `days`, by the date the outlet gave. An undated item is
     not known to be recent, so it is not shown where recency is the rule. */
  function recentNews(items, days, now) {
    const since = (now || Date.now()) - (days || 30) * 864e5;
    return (items || []).filter(x => { const t = Date.parse((x && x.publishedAt) || ''); return Number.isFinite(t) && t >= since; });
  }

  function newsCard(x) {
    const title = stripSource(x.title, x.outlet);
    let summary = stripSource(x.summary, x.outlet);
    const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!norm(summary) || norm(summary).startsWith(norm(title))) summary = '';
    return '<a class="card intelcard" target="_blank" rel="noopener" href="' + esc(x.link) + '">' +
      '<span class="inteltag' + (x.established ? ' verified' : '') + '">' + esc(x.outlet || 'Source') + '</span> ' +
      (x.established ? '<span class="inteltag verified">Established newsroom</span>' : '') +
      '<h3>' + esc(title) + '</h3>' +
      (summary ? '<p class="muted">' + esc(summary.slice(0, 200)) + '</p>' : '') +
      '<small class="muted">' + esc(x.publishedAt ? newsDate(x.publishedAt) : 'Publication time not given') +
      (x.via ? ' · via ' + esc(x.via) : '') + '</small><br><b>Read more ↗</b></a>';
  }

  function renderNews(d) {
    const items = d.news || [];
    setBody('news', items.length
      ? items.map(newsCard).join('')
      : card('No news reports found yet',
        '<p class="muted">News searches can be slow to pick up a new event. Try the directories below. This section refreshes by itself.</p>',
        d.searches && d.searches.googleNews
          ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(d.searches.googleNews) + '">Search news ↗</a>' : ''));
    setMeta('news', items.length + ' report' + (items.length === 1 ? '' : 's') + ' · only from established newsrooms and official agencies');
  }

  function renderReports(d) {
    const items = d.situationReports || [];
    setBody('reports', items.length
      ? items.map(newsCard).join('')
      : card('No matching ReliefWeb report yet',
        '<p class="muted">Situation reports come out once aid groups organise a response, so there may be none in the first hours of an event.</p>',
        d.searches && d.searches.reliefweb
          ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(d.searches.reliefweb) + '">Search ReliefWeb ↗</a>' : ''));
    setMeta('reports', items.length + ' official report' + (items.length === 1 ? '' : 's'));
  }

  function renderVideos(d) {
    const items = d.videos || [];
    setBody('videos', items.length
      ? items.map(x => '<a class="card intelcard" target="_blank" rel="noopener" href="' + esc(x.url) + '">' +
        '<img class="intelthumb" loading="lazy" src="' + esc(x.thumbnail) + '" alt="">' +
        '<h3>' + esc(x.title) + '</h3><b>Watch ↗</b></a>').join('')
      : card('No videos found',
        '<p class="muted">Video search may be down, or it has not picked up this event yet.</p>',
        d.searches && d.searches.youtube
          ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(d.searches.youtube) + '">Search for videos ↗</a>' : ''));
    setMeta('videos', items.length + ' video' + (items.length === 1 ? '' : 's'));
  }

  function renderHelplines(d) {
    const h = d.helplines || {};
    const nums = h.emergency || [];
    const cards = nums.map(x => card(x.label || 'Emergency contact',
      '<a class="intelphone" href="' + esc(telHref(x.phone)) + '">' + esc(x.phone) + '</a>' +
      (x.note ? '<p class="muted">' + esc(x.note) + '</p>' : '') +
      '<p class="muted">' + esc(h.country || '') + '</p>'));

    const emails = [];
    (d.authorities || []).forEach(a => {
      if (a.email) emails.push(card(a.name + ' (email)',
        '<p><a href="mailto:' + esc(a.email) + '">' + esc(a.email) + '</a></p>',
        a.contactUrl ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(a.contactUrl) + '">Official contact page ↗</a>' : ''));
    });
    (d.reliefGroups || []).forEach(r => {
      if (r.email) emails.push(card(r.name + ' (email and phone)',
        '<p><a href="mailto:' + esc(r.email) + '">' + esc(r.email) + '</a></p>' +
        (r.phone ? '<p><a class="intelphone" style="font-size:17px" href="' + esc(telHref(r.phone)) + '">' + esc(r.phone) + '</a></p>' : ''),
        r.contactUrl ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(r.contactUrl) + '">Official contact page ↗</a>' : ''));
    });

    const note = card('Where these contacts come from', '<p class="muted">' + esc(h.note || '') + '</p>');
    setBody('helplines', (cards.length ? cards.join('') : card('We have no verified national emergency number for this place',
      '<p class="muted">We never guess a number. Use the official agency links in the next section, or call your local emergency service.</p>'))
      + emails.join('') + note);
    setMeta('helplines', (h.country ? h.country + ' · ' : '') + nums.length + ' verified number' + (nums.length === 1 ? '' : 's') + ' · ' + emails.length + ' published email contact' + (emails.length === 1 ? '' : 's'));
  }

  function renderAuthorities(d) {
    const items = d.authorities || [];
    const cards = items.map(x => card(x.name,
      '<p class="muted">Official national agency for warnings, advice and emergency response.</p>',
      '<a class="btn" target="_blank" rel="noopener" href="' + esc(x.url) + '">Open the official website ↗</a>' +
      (x.contactUrl ? ' <a target="_blank" rel="noopener" href="' + esc(x.contactUrl) + '">Contact ↗</a>' : '')));
    setBody('authorities', cards.length ? cards.join('')
      : card('We do not have a national agency listed for this country yet',
        '<p class="muted">Use the directories below to find the right national agency.</p>'));
    setMeta('authorities', items.length + ' agenc' + (items.length === 1 ? 'y' : 'ies'));
  }

  function renderSupport(d) {
    const items = d.supportGroups || [];
    setBody('support', items.length
      ? items.map(x => card(x.name, '<p class="muted">National relief and support organisation.</p>',
        (x.donate ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(x.donate) + '">Donate ↗</a> ' : '') +
        '<a target="_blank" rel="noopener" href="' + esc(x.url) + '">Website ↗</a>')).join('')
      : card('We do not have a national support group listed yet',
        '<p class="muted">The IFRC directory below lists the Red Cross or Red Crescent society for every country.</p>',
        '<a class="btn" target="_blank" rel="noopener" href="https://www.ifrc.org/national-societies-directory">Find your national Red Cross or Red Crescent ↗</a>'));
    setMeta('support', items.length + ' support group' + (items.length === 1 ? '' : 's'));
  }

  function renderRelief(d) {
    const items = d.reliefGroups || [];
    setBody('relief', items.length
      ? items.map(x => card(x.name, '<p class="muted">' + esc(x.kind || 'Humanitarian support') + '</p>',
        '<a class="btn" target="_blank" rel="noopener" href="' + esc(x.donate || x.url) + '">Official donation page ↗</a> ' +
        '<a target="_blank" rel="noopener" href="' + esc(x.url) + '">Emergency page ↗</a>')).join('') +
        card('About donations', '<p class="muted">' + esc(d.donationPolicy || '') + '</p>')
      : card('Donation links held back', '<p class="muted">' + esc(d.donationPolicy || '') + '</p>'));
    setMeta('relief', items.length + ' organisation' + (items.length === 1 ? '' : 's') + ' with donation pages');
  }

  function renderDirectories(d) {
    const dirs = (d.directories || []).map(x => card(x.name, '<p class="muted">' + esc(x.kind || '') + '</p>',
      '<a class="btn" target="_blank" rel="noopener" href="' + esc(x.url) + '">Open ↗</a>'));
    const provenance = card('Where this information comes from',
      '<ul class="intellist">' + (d.sources || []).map(s =>
        '<li>' + esc(s.name) + ': ' + esc(s.role) + ' · <b>' + (s.items || 0) + '</b> item' + (s.items === 1 ? '' : 's') + '</li>').join('') + '</ul>',
      '<p class="muted" style="margin-top:8px">' + esc(d.disclaimer || '') + '</p>');
    setBody('directories', dirs.join('') + provenance);
    /* The fallback used to assert a five-minute rate, so a payload with no
       coverage block still published a refresh rate nothing was meeting. */
    setMeta('directories', 'How often this updates: ' + ((d.coverage && d.coverage.refreshTarget) || 'each time the page loads'));
  }

  function render(d, e) {
    renderWhenWhere(d, e);
    renderDistress(d);
    renderNews(d);
    renderReports(d);
    renderVideos(d);
    renderHelplines(d);
    renderAuthorities(d);
    renderSupport(d);
    renderRelief(d);
    renderDirectories(d);
  }

  function failure(message) {
    PANELS.forEach(([id]) => {
      setBody(id, card('This information is not available right now',
        '<p class="muted">' + esc(message) + ' The rest of this page is still live. This section will try again by itself.</p>'));
      setMeta(id, 'Trying again');
    });
  }

  let current = null;
  let lastLoad = 0;
  let timer = null;

  async function fetchAndRender(e) {
    const params = new URLSearchParams({
      title: e.title || '', country: e.country || '', region: e.region || '',
      type: e.type || '', updated: e.updated || '', forecast: e.forecast ? 'true' : 'false'
    });
    if (Number.isFinite(+e.lat) && Number.isFinite(+e.lon)) {
      params.set('lat', String(+e.lat));
      params.set('lon', String(+e.lon));
    }
    const r = await fetch('/api/event-enrichment?' + params.toString(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    render(await r.json(), e);
    lastLoad = Date.now();
  }

  async function load(e) {
    const mount = document.getElementById('eventEnrichment');
    if (!mount || !e) return;
    current = e;
    if (!mount.dataset.ready) {
      mount.innerHTML = shell();
      mount.dataset.ready = '1';
    }
    try {
      await fetchAndRender(e);
    } catch (err) {
      failure('Our help-information service did not respond.');
    }
    if (!timer) {
      timer = setInterval(() => {
        if (!current || Date.now() - lastLoad < REFRESH_MS - 5000) return;
        fetchAndRender(current).catch(() => {});
      }, TICK_MS);
    }
  }

  /*
   * A place, not an event (/location-detail).
   *
   * The place page used to call load() with a made-up event titled
   * "<place> natural disaster", and drew it: "When it was reported ... just
   * now ... Type Earthquake", who may need help, immediate needs, news and
   * videos, for a place where nothing had happened. A place gets its
   * contacts only: emergency numbers, national agencies and support groups.
   * News appears only beside a real reported event near the place, only
   * about that event, and only from the last 30 days. Never videos.
   *
   * p: { name, country, countryCode, lat, lon }
   * opts: { contacts: element id, news: element id, event: the real event or null }
   */
  const PLACE_PANELS = ['helplines', 'authorities', 'support'];
  const NEWS_DAYS = 30;
  let placeKey = '', newsKey = '';

  function query(o) {
    const params = new URLSearchParams();
    Object.keys(o).forEach(k => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') params.set(k, String(o[k])); });
    return params.toString();
  }

  async function loadPlaceContacts(p, mount) {
    mount.innerHTML = shell(PLACE_PANELS);
    try {
      const r = await fetch('/api/event-enrichment?' + query({
        mode: 'place', country: p.country || '', cc: p.countryCode || '', region: p.name || '',
        lat: Number.isFinite(+p.lat) && p.lat !== null && p.lat !== '' ? +p.lat : '',
        lon: Number.isFinite(+p.lon) && p.lon !== null && p.lon !== '' ? +p.lon : ''
      }), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      renderHelplines(d);
      renderAuthorities(d);
      renderSupport(d);
    } catch (err) {
      PLACE_PANELS.forEach(id => {
        setBody(id, card('This information is not available right now',
          '<p class="muted">Our help-information service did not respond. In an emergency, call your local emergency number.</p>'));
        setMeta(id, 'Trying again on the next visit');
      });
    }
  }

  function renderPlaceNews(d, e, mount) {
    const items = recentNews(d.news, NEWS_DAYS);
    mount.innerHTML = STYLE + '<section class="panel"><div class="ph"><h2>News about this event</h2>' +
      '<span class="intelmeta" id="placeNewsMeta"></span></div><div class="intelgrid" id="placeNewsBody"></div></section>';
    const body = el('placeNewsBody');
    const meta = el('placeNewsMeta');
    if (meta) meta.textContent = items.length + ' report' + (items.length === 1 ? '' : 's') + ' from the last ' + NEWS_DAYS +
      ' days about \u201c' + (e.title || 'this event') + '\u201d, from established newsrooms only';
    if (body) body.innerHTML = items.length ? items.map(newsCard).join('')
      : card('No news reports from the last ' + NEWS_DAYS + ' days',
        '<p class="muted">We show news only about a reported event near this place, and only when it is recent.</p>');
  }

  async function loadPlace(p, opts) {
    const o = opts || {};
    const contacts = o.contacts && el(o.contacts);
    const news = o.news && el(o.news);
    const pk = [p && p.name, p && p.country, p && p.countryCode, p && p.lat, p && p.lon].join('|');
    if (contacts && p && pk !== placeKey) { placeKey = pk; await loadPlaceContacts(p, contacts); }
    if (!news) return;
    const e = o.event && !o.event.forecast ? o.event : null;
    if (!e) { newsKey = ''; news.innerHTML = ''; news.hidden = true; return; }
    if (String(e.id) === newsKey) return;
    newsKey = String(e.id);
    news.hidden = false;
    try {
      const r = await fetch('/api/event-enrichment?' + query({
        mode: 'news', title: e.title || '', type: e.type || '', country: e.country || '', region: e.region || '', updated: e.updated || ''
      }), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (el(o.news)) renderPlaceNews(d, e, news);
    } catch (err) { newsKey = ''; news.innerHTML = ''; news.hidden = true; }
  }

  window.PNDEventEnrichment = { load, render, shell, loadPlace, newsDate, stripSource, recentNews };
})();
