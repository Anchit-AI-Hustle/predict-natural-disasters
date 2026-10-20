const PND={
  /* The visitor's own zone until they pick one: a reader in New York was
     shown every time in IST, beside a trust note in their own zone. */
  timezone:localStorage.getItem('pnd_timezone')||(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata'}catch(e){return 'Asia/Kolkata'}})(),
  /* Lists show what is live. A record its provider stopped updating (the
     feed marks it live:false) still opens on its own page, so a detail page
     asks for everything with {all:true}. */
  async getEvents(opts){
    /* The feed is one shared copy at the edge, rebuilt once it is 30 seconds
       old (api/events.js), so a page opens on it at once instead of waiting
       3 to 6 seconds for every provider. A Refresh button asks past it: the
       click is marked before the page's own handler runs (see init). */
    const fresh=!!(opts&&opts.fresh)||PND._freshNext;PND._freshNext=false;
    const r=await fetch(fresh?'/api/events?ts='+Date.now():'/api/events',fresh?{cache:'no-store'}:{});if(!r.ok)throw new Error('Live feed unavailable');
    const d=await r.json();if(opts&&opts.all)return d;
    const ev=Array.isArray(d.events)?d.events:[];
    return Object.assign({},d,{events:ev.filter(e=>e&&e.live!==false),notLive:ev.filter(e=>e&&e.live===false)});
  },
  /* Where a record is, in words. The feed computes it; the rest is for a
     ledger row or an older payload that carries no place of its own. */
  placeOf(e,fallback=''){if(!e)return fallback;
    const tidy=v=>String(v||'').replace(/[\s,;]+$/,'').trim();
    if(tidy(e.place))return tidy(e.place);
    const t=tidy(e.title).toLowerCase(),c=tidy(e.country);let r=tidy(e.region);
    /* A region that only repeats a name ("Flood in China") is not a place;
       a frozen corridor is, and it is what a forecast was issued for. */
    if(r&&(r.toLowerCase()===t||/^(flood|drought|wildfire|forest fires?|earthquake|volcano|tropical cyclone)\b.*\bin\b/i.test(r)||/^tropical cyclone\s/i.test(r)))r='';
    if(r&&c&&!r.toLowerCase().includes(c.toLowerCase()))return r+', '+c;
    return r||c||fallback;},
  /* A forecast's name as a reader should see it. Forecasts recorded before
     September 2026 were titled "3-day Flood risk outlook - Nepal", and the
     record keeps them as written; this only changes how that name is shown. */
  titleOf(e){const t=String((e&&e.title)||'');let m=/^(\d+)-(day|hour) (.+?) risk outlook - (.+)$/.exec(t);
    if(m)return m[3]+' risk in '+m[4]+' - '+m[1]+'-'+m[2]+' forecast';
    m=/^Aftershock-sequence outlook - (.+)$/.exec(t);if(m)return 'Aftershock risk '+(/^\d/.test(m[1])?'':'near ')+m[1]+' - 7-day forecast';
    return t;},
  /* How many countries a list names. A drought's country field lists every
     country it covers, and counting that string as one country - and a
     storm's "Western Pacific Ocean" as another - is how the homepage came to
     report 195 countries. */
  countryCount(list){const s=new Set();(list||[]).forEach(e=>String(e&&e.country||'').split(',').forEach(c=>{c=c.trim();if(c)s.add(c.toLowerCase())}));return s.size;},
  /* One answer for each quantity the site states on more than one page.
     Each page counted for itself, so at one moment the same feed read 92 open
     forecasts on the home page and 93 on /forecasts, 687 events here and 780
     on /regions/World, and 349 earthquakes against 339. */
  /* What agencies reported and is still being updated: not our forecasts. */
  observed(list){return (list||[]).filter(e=>e&&e.live!==false&&!e.forecast)},
  /* Our forecasts whose window has not ended. One that ended is graded, not open. */
  openForecasts(list){return (list||[]).filter(e=>e&&e.live!==false&&e.forecast&&!e.windowClosed)},
  /* A report an agency rated red, orange or high. Never one of our forecasts. */
  isHighAlert(e){return !!e&&!e.forecast&&['Red','Orange','High'].includes(e.alert)},
  /* A warning an agency issued and that is in force, as the feed classifies it
     (evidenceState). Counting every red or orange official record instead
     made "17 official warnings" on the home page open a page saying 338, 329
     of them earthquakes that had already happened. */
  isOfficialWarning(e){if(!e||e.forecast)return false;const s=e.evidenceState;
    return s?s==='official-warning':!!(e.sourceType==='official'&&e.expiresAt);},
  officialWarnings(list){return (list||[]).filter(e=>e&&e.live!==false&&this.isOfficialWarning(e))},
  /* What "official warnings" counts, said wherever the number is. */
  WARNING_MEANING:'Warnings and watches issued by agencies and in force now. Reports of disasters that already happened are not counted.',
  /* How many named sources a list comes from. */
  sourcesReporting(list){return new Set((list||[]).map(e=>e&&e.source).filter(Boolean)).size},
  /* The hazard a type names, matched whole. Matching on the first word made
     "Extreme Cold" find every "Extreme Heat" forecast, and an unknown type
     fell back to Flood. Types the hazard model knows resolve to its entry
     ("Volcanic Eruption" is Volcano); any other type is only itself. */
  hazardKey(t){const s=String(t||'').trim();const M=(typeof window!=='undefined'&&window.PNDHazards)||null;
    if(M){const h=M.hazardOf(s);if(h&&h!==M.DEFAULT){for(const k in M.HAZARDS)if(M.HAZARDS[k]===h)return k}}
    return s;},
  sameHazard(a,b){return this.hazardKey(a).toLowerCase()===this.hazardKey(b).toLowerCase()},
  /* A place box: a continent is the countries on it (continents.js), anything
     else is matched against the record's place fields. */
  inPlace(e,q){const C=(typeof window!=='undefined'&&window.PNDContinents)||null;
    if(C&&C.continentNamed(q))return C.onContinent(e,q);
    /* The feed names a record's countries in `countries` as well, and fills it
       from the map outline where a provider gave none. */
    const t=String(q||'').toLowerCase().trim();
    return this.matchesPlace(e,t)||(Array.isArray(e&&e.countries)&&e.countries.some(c=>String(c).toLowerCase().includes(t)));},
  /* A failed load is not a quiet world. Zeros and a stuck "Loading…" both
     read as nothing happening, so every figure says it is unavailable and
     every list says why it is empty. */
  unavailableHtml(){return '<div class="card unavailable" role="status"><b>Live data unavailable.</b><p class="muted">We could not load the latest reports, so nothing can be shown here. This does not mean nothing is happening. Trying again automatically.</p></div>'},
  feedDown(kpis,lists){(kpis||[]).forEach(id=>{const el=document.getElementById(id);if(el){el.textContent='Unavailable';el.classList.remove('pending');el.removeAttribute('aria-busy')}});
    (lists||[]).forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=this.unavailableHtml()});},
  /* The data-status word for a record. A record its provider stopped
     updating (live:false) was labelled "LIVE EVENT" and "Live" directly
     under the note saying it had not been updated for 48 days. */
  liveWord(e){return !e?'-':e.cached?'Saved copy':e.forecast?'Our forecast':e.live===false?'Not updated recently':'Live'},
  /* Shown under a detail page's heading when the record is no longer live. */
  showQuiet(e,after,text){const t=text||this.quietNote(e);let n=document.getElementById('quietNote');
    if(!t){if(n)n.remove();return}
    if(!n&&after){n=document.createElement('p');n.id='quietNote';n.className='stale';n.setAttribute('role','note');after.insertAdjacentElement('afterend',n)}
    if(n)n.textContent=t;},
  /* Said on a record's own page when its provider has gone quiet. */
  quietNote(e){if(!e||e.live!==false)return '';const d=Number(e.quietDays);
    return `Not updated by ${e.source||'its source'} for ${Number.isFinite(d)?d+' day'+(d===1?'':'s'):'some time'}. It may have ended; check the source for its current status.`;},
  autoRefresh(fn,ms=60000){let busy=false;const run=async()=>{if(busy)return;busy=true;try{await fn()}finally{busy=false}};run();return setInterval(run,Math.min(ms,60000))},
  esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
  pathParam(k){const p=location.pathname.split('/').filter(Boolean);const map={disasters:'id',calamities:'id',alerts:'id',forecasts:'id',history:'id',regions:'region',locations:'location',hazards:'type',sources:'source'};if(p.length>=2&&map[p[0]]===k){try{return decodeURIComponent(p.slice(1).join('/'))}catch(e){return p.slice(1).join('/')}}return ''},
  qs(k){return new URLSearchParams(location.search).get(k)||this.pathParam(k)||'';},
  getTZ(){return this.timezone;},
  tzLabel(tz=this.timezone){const aliases={'Asia/Kolkata':'IST','UTC':'UTC','America/New_York':'ET','America/Los_Angeles':'PT','Europe/London':'UK','Asia/Dubai':'GST','Asia/Singapore':'SGT','Asia/Tokyo':'JST','Australia/Sydney':'Sydney'};return aliases[tz]||tz;},
  /* One formatter per zone and shape, made once. toLocaleString builds a new
     one on every call, and /accuracy formats thousands of dates: it was the
     largest single cost of that page's 6-second main-thread task. Output is
     identical, since toLocaleString is defined as exactly this. */
  _fmts:{},
  _fmt(locale,opts){const k=locale+JSON.stringify(opts);return this._fmts[k]||(this._fmts[k]=new Intl.DateTimeFormat(locale,opts))},
  fmtDate(v){if(!v)return '-';const d=new Date(v);if(isNaN(d))return v;return this._fmt('en-IN',{timeZone:this.timezone,day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(d).replace(/\bam\b/i,'AM').replace(/\bpm\b/i,'PM')+' '+this.tzLabel();},
  /* A forecast window edge. Whole-day windows are stored as UTC midnight to
     23:59:59Z, or midnight to midnight with the end excluded, and fmtDate
     turned each edge into a time of day in the reader's zone: "19 Oct to
     21 Oct" ran from "19 Oct, 5:30 AM IST" to "22 Oct, 5:29 AM IST", and
     west of UTC it started the day before. An edge of a whole-day window is
     that day, for everyone: a midnight end excludes its own day, so the last
     day shown is the one before. `other` is the window's other edge (a
     midnight opening a window that ends at a real moment is a moment too);
     `role` is 'end' for an end. Any other edge keeps its time. */
  fmtWhen(v,other,role){if(!v)return '-';
    const edge=x=>{const m=/^(\d{4})-(\d\d)-(\d\d)T(00:00:00|23:59:59)(\.0+|\.9+)?Z$/.exec(String(x||''));return m?{t:Date.UTC(+m[1],+m[2]-1,+m[3]),last:m[4]==='23:59:59'}:null};
    const m=edge(v);if(!m||(other&&!edge(other)))return this.fmtDate(v);
    const day=m.last||role!=='end'?m.t:m.t-864e5;
    return this._fmt('en-IN',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(new Date(day));},
  fmtTime(v){if(!v)return '-';const d=new Date(v);if(isNaN(d))return v;return d.toLocaleTimeString('en-IN',{timeZone:this.timezone,hour:'numeric',minute:'2-digit',hour12:true}).replace(/\bam\b/i,'AM').replace(/\bpm\b/i,'PM')+' '+this.tzLabel();},
  age(v){if(!v)return 'unknown';const m=Math.max(0,Math.round((Date.now()-new Date(v))/60000));return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} hr ago`:`${Math.round(m/1440)} d ago`;},
  /* The one risk scale, from risk.js. This used to be a second vocabulary
     mapping onto a second palette, which is how `.badge.watch` came to be
     blue on one page while the same level was yellow on the next. Two
     classes, because `.risk` carries the shape that keeps the level from
     being colour alone. An unrecognised level is still not a warning: it
     returns risk-unknown, which has no colour from the scale at all. */
  riskClass(v=''){const R=(typeof window!=='undefined'&&window.PNDRisk)||null;
    return R?('risk '+R.classOf(v)):'risk risk-unknown';},
  /* Colour, text and shape together, which is the only way a level is ever
     shown. `text` defaults to the record's own word, because the six levels
     are a display scale and what the provider published is the fact. */
  riskBadge(v,opts){const R=(typeof window!=='undefined'&&window.PNDRisk)||null;
    return R?R.badge(v,opts):this.esc(String(v||''));},
  /*
   * One resolved risk level for a record, in words a reader already knows.
   *
   * Every list showed two badges: the provider's own alert word and this
   * site's severity word, in the same visual style, unlabelled. Measured on
   * the live feed that produced, on one card, "Green" beside "Informational",
   * and on the next "Orange" beside "Moderate" - and on a third, "Moderate"
   * beside "Moderate", the same fact printed twice. "Green" and "Orange" are
   * GDACS's internal vocabulary; they tell a reader nothing, and side by side
   * with a second badge they read as two different claims about one record.
   *
   * There is one badge now and it names the level on this site's six-level
   * scale. The provider's own word is not discarded - it is what the badge is
   * derived from, so it goes in the badge's title and on the detail page,
   * where it is attributable.
   *
   * Where the two inputs disagree the higher one decides, because a record
   * carrying an agency's Orange alert and this site's Severe assessment is
   * not a Moderate record; and the title says both, so the reader can see the
   * disagreement rather than having it averaged away silently.
   */
  /* The record's level on this site's scale, as a word - the same answer the
     badge gives, for the places that print text rather than a badge. */
  riskLabel(e){
    const R=(typeof window!=='undefined'&&window.PNDRisk)||null;
    if(!R)return 'Not rated';
    const sv=R.levelOf(e&&e.severity),a=R.levelOf(e&&e.alert);
    const k=sv!=='UNKNOWN'?sv:(a!=='UNKNOWN'?a:null);
    return k&&R.BY_KEY[k]?R.BY_KEY[k].label:'Not rated';
  },
  riskTag(e,opts){
    const R=(typeof window!=='undefined'&&window.PNDRisk)||null;
    if(!R)return '';
    const o=opts||{};
    const rawAlert=e&&e.alert,rawSev=e&&e.severity;
    const a=R.levelOf(rawAlert),sv=R.levelOf(rawSev);
    /* Not the higher of the two: severityOf already takes the worse of what
       was observed and what the authority assessed, so the severity subsumes
       the alert. Taking the maximum across both counted the alert twice, on
       two scales that name the same rank differently - a forecast carrying
       alert "High" was published as "Severe" because the severity table calls
       rank 4 Severe. The severity is the record's answer where it has one. */
    const known=(sv!=='UNKNOWN'?[sv]:[]).concat(a!=='UNKNOWN'?[a]:[]).slice(0,1);
    if(!known.length){
      /* Never a made-up level. These lists used to print "Live" or "Watch"
         where a record carried no level at all, which invents one. */
      return R.badgeForLevel('UNKNOWN',{text:'Not rated',className:o.className,
        title:'No alert level was published for this record and no severity has been assessed for it.'});
    }
    const top=known.reduce((x,y)=>R.BY_KEY[x].rank>=R.BY_KEY[y].rank?x:y);
    const from=[];
    /* A merged storm can carry a level another agency gave; it names that
       agency, not the one whose report leads the record. */
    const alertBy=e.alertSource||e.source;
    if(a!=='UNKNOWN')from.push('the alert level \u201c'+rawAlert+'\u201d'+
      (alertBy?' published by '+this.shortSource(alertBy):''));
    if(sv!=='UNKNOWN')from.push('an assessed severity of \u201c'+rawSev+'\u201d');
    const title=R.BY_KEY[top].label+' on this site\u2019s six-level risk scale, from '+
      from.join(' and ')+(a!=='UNKNOWN'&&sv!=='UNKNOWN'&&a!==sv?'. Where these differ the higher decides.':'.');
    return R.badgeForLevel(top,{className:o.className,title});
  },
  /*
   * A source name short enough to sit in a row of pills.
   *
   * The feed's own names run to "Predict Natural Disasters \u00b7 derived from
   * NOAA / National Weather Service", which wrapped across two lines on a
   * phone and broke mid-phrase. The full name is kept as the pill's title, so
   * nothing about provenance is lost by shortening what is drawn.
   */
  /* The agencies' own abbreviations, not invented ones. Which office inside
     NOAA issued a record is provenance worth keeping, and "NOAA" alone loses
     it while the full name does not fit in a pill. */
  SOURCE_ABBR:{
    'NOAA / National Weather Service':'NOAA/NWS',
    'NOAA National Weather Service':'NOAA/NWS',
    'NOAA National Hurricane Center':'NOAA/NHC',
    'National Weather Service':'NWS',
    'National Hurricane Center':'NHC',
    'USGS Volcano Hazards Program':'USGS Volcano',
    'USGS verified recent snapshot':'USGS (verified)',
    'GDACS verified snapshot':'GDACS (verified)',
    'ReliefWeb (UN OCHA)':'ReliefWeb',
    'Predict Natural Disasters':'This site'
  },
  shortSource(name){
    const s=String(name||'').trim();
    if(!s)return 'Source not stated';
    if(this.SOURCE_ABBR[s])return this.SOURCE_ABBR[s];
    const derived=/^(.*?)\s*[\u00b7|]\s*derived from\s+(.*)$/i.exec(s);
    if(derived)return this.clipSource('Derived \u00b7 '+this.shortSource(derived[2]));
    const paren=/\(([A-Z][A-Za-z0-9/&. -]{1,24})\)\s*$/.exec(s);
    if(paren)return paren[1];
    const slash=s.split(/\s*\/\s*/);
    if(slash.length>1&&slash[0].length<=12)return slash[0];
    return this.clipSource(s);
  },
  /* A pill that wraps is not a pill. 28 characters is what fits beside a risk
     badge at 320px, measured. */
  clipSource(s){return s.length<=28?s:s.slice(0,27).replace(/[\s,;:.\u00b7-]+$/,'')+'\u2026';},
  /*
   * The filter speaks the same vocabulary as the badges.
   *
   * Every list offered "Red / Orange / Green" while the badges beside them
   * said Severe, Moderate and Low - so a reader who saw a Severe card could
   * not filter for Severe, and the two controls in the same toolbar used two
   * different languages for one thing. The options are the six levels of the
   * scale, and matching resolves the record the same way the badge does, so
   * "Moderate" finds a GDACS Orange as well as a record already called
   * Moderate.
   */
  riskLevelOptions(selected){
    const R=(typeof window!=='undefined'&&window.PNDRisk)||null;
    if(!R)return '';
    return R.LEVELS.slice().reverse().map(l=>
      `<option value="${l.key}"${selected===l.key?' selected':''}>${l.label}</option>`).join('')+
      `<option value="UNKNOWN"${selected==='UNKNOWN'?' selected':''}>Not rated</option>`;
  },
  /* The hazard filter, built from the records it filters.
   *
   * It was a fixed list of six, so the outlook list offered "Drought", which
   * had no outlook, and no way to pick the storm warnings, severe storms,
   * aftershock sequences and flood-landslides that made up a third of the
   * list. Each hazard present is offered with how many records it has, most
   * first; one selected earlier and now absent stays selectable with a 0,
   * rather than the filter quietly switching itself back to everything. */
  hazardOptions(records,selected){
    const counts={};
    (records||[]).forEach(e=>{const t=e&&e.type;if(t)counts[t]=(counts[t]||0)+1});
    if(selected&&!(selected in counts))counts[selected]=0;
    const esc=v=>this.esc(v);
    return `<option value="">All hazards (${(records||[]).length})</option>`+
      Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
        .map(([t,n])=>`<option value="${esc(t)}"${selected===t?' selected':''}>${esc(t)} (${n})</option>`).join('');
  },
  fillHazardSelect(sel,records){
    if(!sel)return;
    const was=sel.value;
    sel.innerHTML=this.hazardOptions(records,was);
    sel.value=was;
  },
  /** Does this record sit at the level the filter asks for? */
  matchesRiskLevel(e,key){
    if(!key)return true;
    const R=(typeof window!=='undefined'&&window.PNDRisk)||null;
    if(!R)return true;
    /* The same resolution the badge uses, or the filter and the badge
       disagree about the same record. */
    const a=R.levelOf(e&&e.alert),sv=R.levelOf(e&&e.severity);
    const known=(sv!=='UNKNOWN'?[sv]:[]).concat(a!=='UNKNOWN'?[a]:[]).slice(0,1);
    if(!known.length)return key==='UNKNOWN';
    return known[0]===key;
  },
  riskLevel(v){const R=(typeof window!=='undefined'&&window.PNDRisk)||null;
    return R?R.levelOf(v):'UNKNOWN';},
  slug(v=''){return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');},
  enc(v=''){return encodeURIComponent(String(v))},
  eventUrl(e){const id=this.enc(e&&e.id||'');if(e&&e.forecast)return '/forecasts/'+id;if(e&&e.sourceType==='official'&&['Red','Orange'].includes(e.alert))return '/alerts/'+id;return '/disasters/'+id;},
  /* Resolve a record by id even when the id was re-encoded by a rewrite, changed case,
     or arrived slugified from an older link. Returns null when nothing matches. */
  findEvent(events,id){
    if(!Array.isArray(events)||!id)return null;
    const raw=String(id);let dec=raw;try{dec=decodeURIComponent(raw)}catch(e){}
    const norm=v=>String(v==null?'':v).toLowerCase().replace(/[^a-z0-9]+/g,'');
    const wanted=[raw,dec];
    for(const w of wanted){const hit=events.find(e=>String(e.id)===w);if(hit)return hit}
    const n=norm(dec);
    const byNorm=events.find(e=>norm(e.id)===n);if(byNorm)return byNorm;
    const byTitle=events.find(e=>norm(e.title)===n);if(byTitle)return byTitle;
    const bySuffix=events.find(e=>norm(e.id).endsWith(n)||n.endsWith(norm(e.id)));
    return bySuffix||null;
  },
  /* ---------------------------------------------------------------- sorting
     One sort vocabulary shared by every page that lists records, so the
     control behaves and is remembered the same way everywhere. */
  RISK_RANK:{red:5,critical:5,orange:4,high:4,veryhigh:4,moderate:3,watch:2,green:1,low:1},
  rankOf(e){const r=Number(e&&e.severityRank);if(Number.isFinite(r)&&r>0)return r;return this.RISK_RANK[String(e&&e.alert||'').toLowerCase()]||0},
  /* A chip for the cross-hazard severity, with the scale's own wording as its
     tooltip so the level is never just a colour. */
  severityBadge(e){const v=e&&e.severity;if(!v)return '';const M=(typeof window!=='undefined'&&window.PNDHazards)||null;const def=M&&(M.SEVERITY.find(x=>x.key===v)||{}).meaning||'';
    /* The scale's own wording stays as the tooltip, and the level's word
       stays as the text; what changes is that the colour is now the shared
       one and comes with the shape that goes with it. */
    const R=(typeof window!=='undefined'&&window.PNDRisk)||null;
    return R?R.badge(v,{text:v,className:'sev',title:def||undefined})
      :`<span class="sev sev-${this.slug(v)}" title="${this.esc(def)}">${this.esc(v)}</span>`;},
  /* How far ahead of its own window a forecast was issued. Zero means it
     describes something already happening. */
  leadText(e){const M=(typeof window!=='undefined'&&window.PNDHazards)||null;return M?M.leadTimeText(e):'';},
  hazardOf(t){const M=(typeof window!=='undefined'&&window.PNDHazards)||null;return M?M.hazardOf(t):null;},
  timeOf(e){const t=Date.parse((e&&(e.updated||e.targetStart||e.startedAt))||'');return Number.isFinite(t)?t:0},
  numOf(v){const n=Number(v);return Number.isFinite(n)?n:0},
  /* Sort on the displayed text. Titles are rendered with acronyms written out,
     so sorting the raw feed value put the list out of A-Z order on screen. */
  textOf(e,...keys){for(const k of keys){let v=e&&e[k];if(v){v=String(v);const g=typeof window!=='undefined'&&window.__pndGlossary;if(g&&g.expandAlways)v=g.expandAlways(v);return v.toLowerCase()}}return '￿'},
  /* The matching rules live in search.js, so the pages that do not load this
     file get exactly the same ones rather than a copy that drifts. A test
     asserts every page calling these also loads it. */
  matches(e,q){return window.PNDSearch.matches(e,q)},
  matchesPlace(e,q){return window.PNDSearch.matchesPlace(e,q)},
  searchText(e){return window.PNDSearch.searchText(e)},
  searchParam(){return window.PNDSearch.searchParam()},
  initSearch(id,draw){return window.PNDSearch.initSearch(id,draw)},
  emptyHtml(q,pool,all,noun){return window.PNDSearch.emptyHtml(q,pool,all,noun)},
  /* "Until when have predictions been made" had no answer anywhere on the
     site: the horizon lived inside each record's own window and was never
     stated. Phrased once here so every page says the same thing. */
  horizonText(meta){
    const h=meta&&meta.forecastHorizon;
    if(!h||!h.furthestWindowEnds)return 'There are no open forecasts right now.';
    const d=h.daysAhead;
    const ahead=d>=1?Math.round(d)+' day'+(Math.round(d)===1?'':'s'):'less than a day';
    const lens=(h.windowLengthDays||[]).slice();
    const lenText=lens.length?(lens.length>1?lens.slice(0,-1).join(', ')+' or '+lens[lens.length-1]:lens[0])+' day'+(lens.length===1&&lens[0]===1?'':'s'):'';
    return 'Our forecasts reach as far as '+this.fmtWhen(h.furthestWindowEnds,null,'end')+
      ' ('+ahead+' from now)'+(lenText?'. Each one covers '+lenText:'')+
      '. We do not forecast further ahead than that. It does not mean nothing will happen after that date.';
  },
  /* "Has anything changed in the forecasts since I last looked" had no answer:
     the ledger appends a re-issued outlook as a new row indistinguishable from
     a new one, and an outlook that stopped being issued left no trace. */
  changesHtml(meta){
    const c=meta&&meta.forecastChanges;
    if(!c)return '<p class="muted">No changes have been recorded yet.</p>';
    const when=this.fmtDate(c.at)+' · '+this.age(c.at);
    if(c.baseline)return '<p class="muted">First check, '+this.esc(when)+
      '. '+c.activeOutlooks+' forecasts are open. There is nothing earlier to compare them with yet.</p>';
    const gap=typeof c.sinceHours==='number'&&c.sinceHours>0
      ? ' (' + (c.sinceHours<1 ? Math.round(c.sinceHours*60)+' minutes' : c.sinceHours+(c.sinceHours===1?' hour':' hours')) + ' after the check before)'
      : '';
    /* An outage is not a change in the forecasts, so it is deliberately not
       counted in total - but it still has to be shown. Returning on total
       alone meant a run whose only exceptional result was an unreachable
       source reported "nothing changed" and dropped the outage rows entirely,
       which is the opposite of what recording them was for. */
    const un=Number(c.unavailable)||0;
    if(!c.total&&!un)return '<p class="muted">Checked '+this.esc(when)+this.esc(gap)+
      '. None of the '+c.activeOutlooks+' open forecasts changed their risk level, dates or status.</p>';
    const R=c.records||{};
    const row=(label,list,fmt)=>(list&&list.length)
      ? '<div><b>'+label+' ('+list.length+')</b>'+list.slice(0,8).map(x=>
          '<p class="muted">'+this.esc(fmt(x))+'</p>').join('')+
          (list.length>8?'<p class="muted">…and '+(list.length-8)+' more</p>':'')+'</div>'
      : '';
    const headline=c.total
      ? c.total+' change'+(c.total===1?'':'s')+' across '+c.activeOutlooks+' open forecasts'
      : 'no changes across '+c.activeOutlooks+' open forecasts';
    const caveat=un?', and '+un+' that could not be checked':'';
    return '<p class="muted">Checked '+this.esc(when)+this.esc(gap)+' · '+
      this.esc(headline+caveat)+'.</p>'+
      row('New',R.added,x=>this.titleOf(x)+' - '+x.alert)+
      row('Raised',R.raised,x=>this.titleOf(x)+' - '+x.from+' → '+x.to)+
      row('Lowered',R.lowered,x=>this.titleOf(x)+' - '+x.from+' → '+x.to)+
      row('Dates changed',R.windowMoved,x=>this.titleOf(x)+' - now ends '+this.fmtWhen(x.toEnd,null,'end'))+
      row('Stopped',R.gone,x=>this.titleOf(x)+' - the event it followed is no longer reported')+
      /* An outlook whose window simply ended did what it said it would. It
         must not read as a withdrawal. */
      row('Ended on schedule',R.expired,x=>this.titleOf(x)+' - its forecast period ended')+
      /* Not a change in the forecasts at all - a gap in what could be seen.
         Reporting it as a withdrawal would blame the forecast for our
         outage, and blame it again as a new forecast on recovery. */
      row('Could not be checked',R.unavailable,x=>this.titleOf(x)+
        ' - we could not reach its source this time, so it is unchanged, not withdrawn');
  },
  SORT_DEFS:{
    severity:{label:'Most serious first',cmp(a,b){return PND.rankOf(b)-PND.rankOf(a)||PND.timeOf(b)-PND.timeOf(a)}},
    newest:{label:'Newest first',cmp(a,b){return PND.timeOf(b)-PND.timeOf(a)}},
    oldest:{label:'Oldest first',cmp(a,b){return PND.timeOf(a)-PND.timeOf(b)}},
    deaths:{label:'Most deaths first',cmp(a,b){return PND.numOf(b.deaths)-PND.numOf(a.deaths)||PND.timeOf(b)-PND.timeOf(a)}},
    affected:{label:'Most people affected first',cmp(a,b){return PND.numOf(b.affected)-PND.numOf(a.affected)||PND.numOf(b.displaced)-PND.numOf(a.displaced)||PND.timeOf(b)-PND.timeOf(a)}},
    country:{label:'Place (A to Z)',cmp(a,b){return PND.textOf(a,'place','country','region').localeCompare(PND.textOf(b,'place','country','region'))||PND.timeOf(b)-PND.timeOf(a)}},
    type:{label:'Type of hazard (A to Z)',cmp(a,b){return PND.textOf(a,'type').localeCompare(PND.textOf(b,'type'))||PND.rankOf(b)-PND.rankOf(a)}},
    source:{label:'Source (A to Z)',cmp(a,b){return PND.textOf(a,'source').localeCompare(PND.textOf(b,'source'))||PND.timeOf(b)-PND.timeOf(a)}},
    title:{label:'Name (A to Z)',cmp(a,b){return PND.textOf(a,'title','name').localeCompare(PND.textOf(b,'title','name'))}},
    distance:{label:'Nearest first',cmp(a,b){return (Number.isFinite(a._d)?a._d:Infinity)-(Number.isFinite(b._d)?b._d:Infinity)}},
    /* A window that already ended is not ending soon: it sank to the top as the
       earliest end of all, so a forecast over since September led the list. */
    windowEnd:{label:'Ending soonest first',cmp(a,b){const now=Date.now(),x=Date.parse(a.targetEnd||'')||Infinity,y=Date.parse(b.targetEnd||'')||Infinity,xa=x<=now||!!a.windowClosed,ya=y<=now||!!b.windowClosed;return xa!==ya?(xa?1:-1):xa?y-x:x-y}},
    yearNew:{label:'Most recent first',cmp(a,b){return PND.numOf(b.sort)-PND.numOf(a.sort)}},
    yearOld:{label:'Earliest first',cmp(a,b){return PND.numOf(a.sort)-PND.numOf(b.sort)}},
    name:{label:'Name (A to Z)',cmp(a,b){return PND.textOf(a,'name','title').localeCompare(PND.textOf(b,'name','title'))}},
    countDesc:{label:'Most events first',cmp(a,b){return PND.numOf(b.count)-PND.numOf(a.count)}},
    countAsc:{label:'Fewest events first',cmp(a,b){return PND.numOf(a.count)-PND.numOf(b.count)}}
  },
  /** Default option set for a list of live hazard records. */
  EVENT_SORTS:['newest','severity','oldest','deaths','affected','country','type','source','title'],
  sortStoreKey(id){return 'pnd_sort_'+location.pathname+'_'+id},
  /** Populate a <select>, restore the remembered choice and wire onChange. Returns the active key. */
  initSort(id,keys,onChange){
    const list=(keys&&keys.length?keys:this.EVENT_SORTS);
    const el=document.getElementById(id);
    if(!el)return list[0];
    let cur='';try{cur=localStorage.getItem(this.sortStoreKey(id))||''}catch(e){}
    if(list.indexOf(cur)<0)cur=list[0];
    el.innerHTML=list.map(k=>`<option value="${this.esc(k)}">${this.esc((this.SORT_DEFS[k]||{}).label||k)}</option>`).join('');
    el.value=cur;
    if(!el.dataset.pndSortWired){
      el.dataset.pndSortWired='1';
      el.setAttribute('aria-label','Sort results');
      el.addEventListener('change',()=>{
        try{localStorage.setItem(this.sortStoreKey(id),el.value)}catch(e){}
        if(typeof onChange==='function')onChange(el.value);
      });
    }
    return cur;
  },
  sortValue(id,keys){const el=document.getElementById(id);const list=(keys&&keys.length?keys:this.EVENT_SORTS);return el&&el.value?el.value:list[0]},
  /** Return a sorted copy; unknown keys leave the order untouched. */
  applySort(list,key){
    if(!Array.isArray(list))return list;
    const def=this.SORT_DEFS[key];
    return def?list.slice().sort(def.cmp):list.slice();
  },
  /** Sort by the current value of a page's sort control in one step. */
  sortBy(id,list,keys){return this.applySort(list,this.sortValue(id,keys))},
  calamityUrl(e){return '/calamities/'+this.enc(e&&e.id||'');},
  historicalUrl(e){return '/history/'+this.enc(this.slug(e&&e.name||e&&e.title||''));},
  regionUrl(name){return '/regions/'+this.enc(name||'World');},
  locationUrl(name){return '/locations/'+this.enc(name||'World');},
  hazardUrl(type,region=''){return '/hazards/'+this.enc(type||'Flood')+(region?'?region='+this.enc(region):'');},
  sourceDetailUrl(source){return '/sources/'+this.enc(source||'GDACS');},
  entityDetailUrl(kind,id){return '/'+this.enc(kind)+'-detail?'+({insight:'topic',methodology:'section',metric:'metric',resource:'id',about:'section',calendar:'id',comparison:'id',notification:'id'}[kind]||'id')+'='+this.enc(id||'overview');},
  detailUrl(kind,obj){if(kind==='calamity')return this.calamityUrl(obj);if(kind==='historical')return this.historicalUrl(obj);if(kind==='event')return this.eventUrl(obj);if(kind==='forecast')return '/forecasts/'+this.enc(obj&&obj.id||'');if(kind==='alert')return '/alerts/'+this.enc(obj&&obj.id||'');if(kind==='region')return this.regionUrl(obj&&obj.name||obj);if(kind==='location')return this.locationUrl(obj&&obj.name||obj);if(kind==='hazard')return this.hazardUrl(obj&&obj.type||obj);if(kind==='source')return this.sourceDetailUrl(obj&&obj.source||obj);return this.entityDetailUrl(kind,obj&&obj.id||obj&&obj.name||obj);},
  canonicalDetailUrl(raw){try{const u=new URL(raw,location.origin);if(u.origin!==location.origin)return raw;const q=u.searchParams,p=u.pathname;if(p==='/event-detail')return '/disasters/'+this.enc(q.get('id')||'');if(p==='/calamity-detail')return '/calamities/'+this.enc(q.get('id')||'');if(p==='/alert-detail')return '/alerts/'+this.enc(q.get('id')||'');if(p==='/forecast-detail')return '/forecasts/'+this.enc(q.get('id')||'');if(p==='/region-detail')return '/regions/'+this.enc(q.get('region')||q.get('country')||'World');if(p==='/location-detail')return '/locations/'+this.enc(q.get('location')||'World');if(p==='/hazard-detail')return '/hazards/'+this.enc(q.get('type')||'Flood')+(q.get('region')?'?region='+this.enc(q.get('region')):'');if(p==='/historical-event-detail')return '/history/'+this.enc(q.get('id')||q.get('name')||'');if(p==='/source-detail')return '/sources/'+this.enc(q.get('source')||'GDACS');return raw}catch(e){return raw}},
  redirect(url){window.location.assign(this.canonicalDetailUrl(url));},
  collectionRoutes:{events:'/events',calamities:'/calamities',forecasts:'/forecast-list',alerts:'/official-warnings',regions:'/regions',historical:'/historical-events',hazards:'/hazard-types',sources:'/resources',verification:'/verification',calendar:'/forecast-calendar',compare:'/compare-locations',notifications:'/alerts-notifications',map:'/live-map'},
  collectionUrl(kind){return this.collectionRoutes[kind]||'/events';},
  inferCollection(text=''){const t=String(text).toLowerCase();if(/map/.test(t))return 'map';if(/calamit/.test(t))return 'calamities';if(/forecast|prediction|outlook/.test(t))return 'forecasts';if(/warning|alert/.test(t))return 'alerts';if(/region|country|location/.test(t))return 'regions';if(/histor/.test(t))return 'historical';if(/hazard|disaster type/.test(t))return 'hazards';if(/source/.test(t))return 'sources';if(/verif/.test(t))return 'verification';if(/calendar/.test(t))return 'calendar';if(/compare/.test(t))return 'compare';if(/notification/.test(t))return 'notifications';return 'events';},
  routeFromDataset(el){if(!el||!el.dataset)return '';const d=el.dataset;if(d.href)return this.canonicalDetailUrl(d.href);if(d.eventId)return '/disasters/'+this.enc(d.eventId);if(d.calamityId)return '/calamities/'+this.enc(d.calamityId);if(d.forecastId)return '/forecasts/'+this.enc(d.forecastId);if(d.alertId)return '/alerts/'+this.enc(d.alertId);if(d.historicalId)return '/history/'+this.enc(d.historicalId);if(d.region)return this.regionUrl(d.region);if(d.location)return this.locationUrl(d.location);if(d.hazard)return this.hazardUrl(d.hazard,d.region||'');if(d.source)return this.sourceDetailUrl(d.source);if(d.kind&&d.id)return this.detailUrl(d.kind,{id:d.id,name:d.name||d.id,type:d.type||d.id,source:d.source||d.id});return '';},
  setTimezone(tz){this.timezone=tz||'Asia/Kolkata';localStorage.setItem('pnd_timezone',this.timezone);location.reload();},
  /* The options are built into the markup nav() returns rather than injected
     into it afterwards. Filling the picker from a timer meant the header could
     be in the page with an empty dropdown in it for as long as the timer took
     to run - on a busy machine the whole parse, every script and the entire
     promise-driven data load can complete in one turn, so that "moment" lasted
     over a second and anything looking at the page in it saw a dropdown with
     nothing to pick. */
  timezoneOptions(){const base=['Asia/Kolkata','UTC','America/New_York','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Dubai','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];let zones=base;try{if(Intl.supportedValuesOf)zones=Intl.supportedValuesOf('timeZone')}catch(e){}const preferred=[this.timezone,...base,...zones].filter((v,i,a)=>a.indexOf(v)===i);return preferred.map(z=>`<option value="${this.esc(z)}" ${z===this.timezone?'selected':''}>${this.esc(z==='Asia/Kolkata'?'IST · India':z)}</option>`).join('');},
  /* Still here for a header put into the page some other way; a no-op once the
     markup already carries its own options. */
  initTimezonePicker(){const s=document.getElementById('pndTimezone');if(!s||s.options.length)return;s.innerHTML=this.timezoneOptions();},
  /* The record's own evidence class, which the feed now states. Deciding it
     here from sourceType plus alert colour meant every red-level observation
     read as a warning: a USGS earthquake that had already happened was
     labelled OFFICIAL WARNING and sat in the same list as the warnings. Where
     the feed says nothing, this falls to the weaker claim rather than
     inventing a warning nobody issued. */
  provenance(e){const s=e&&e.evidenceState;
    if(s==='forecast'||(!s&&e&&e.forecast))return e.forecastKind==='frozen-benchmark'?'TEST FORECAST':'OUR FORECAST';
    if(s==='official-warning')return 'OFFICIAL WARNING';
    return 'REPORTED EVENT';},
  savedLocations(){try{return JSON.parse(localStorage.getItem('pnd_saved_locations')||'[]')}catch(e){return[]}},
  saveLocation(x){const a=this.savedLocations();a.push({...x,id:'loc-'+Date.now()});localStorage.setItem('pnd_saved_locations',JSON.stringify(a));return a},
  removeLocation(id){const a=this.savedLocations().filter(x=>x.id!==id);localStorage.setItem('pnd_saved_locations',JSON.stringify(a));return a},
  distanceKm(a,b,c,d){const r=Math.PI/180,R=6371,x=(c-a)*r,y=(d-b)*r,z=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(z))},
  evaluateRiskNotifications(events=[]){if(!('Notification' in window)||Notification.permission!=='granted')return;/* The same rules the background service applies (alert-rules.js), so the
     page open in a tab and the service behind it never disagree about what is
     worth a notification. Where the service is on for this device it has
     already sent these; raising them again here would say everything twice. */
    const H=typeof PNDHazards!=='undefined'?PNDHazards:null,R=typeof PNDAlertRules!=='undefined'?PNDAlertRules:null;if(!H||!R)return;
    if(typeof PNDAlerts!=='undefined'&&PNDAlerts.isOn())return;
    let seen={};try{seen=JSON.parse(localStorage.getItem('pnd_notified')||'{}')}catch(e){seen={}}const now=Date.now();
    R.alertsFor(events,this.savedLocations(),H,now).forEach(a=>{if(!seen[a.key]||now-seen[a.key]>21600000){try{const n=new Notification(a.title,{body:a.body,tag:a.tag});if(n&&typeof window!=='undefined'){n.onclick=()=>{window.focus();if(a.url)window.location.href=a.url}}}catch(err){}seen[a.key]=now}});
    /* Notifications for major global events: severe disasters, M6.5+ quakes, Red alerts, tsunamis */
    (events||[]).forEach(e=>{
      if(!e||e.forecast||e.isForecast||e.live===false||e.cached)return;
      const t=Date.parse(e.updated||e.startedAt||e.issuedAt||'');
      if(!Number.isFinite(t)||now-t>72*3600e3)return;
      const isRed=e.alert==='Red'&&e.sourceType==='official';
      const isM65=e.type==='Earthquake'&&Number(e.magnitude)>=6.5;
      const isTsunami=/tsunami/i.test(e.type||e.title||'');
      const isSevereCyclone=/cyclone|typhoon|hurricane/i.test(e.type||'')&&(/cat(egory)?\s*[345]|severe|super/i.test(e.severity||e.title||'')||e.alert==='Red');
      if(!isRed&&!isM65&&!isTsunami&&!isSevereCyclone)return;
      const mKey='major-'+e.id+'|'+(e.alert||'').toLowerCase();
      if(seen[mKey]&&now-seen[mKey]<=21600000)return;
      const mTag='pnd-major-'+String(e.id);
      let mTitle='Major Alert: '+(e.type||'Disaster');
      if(isM65)mTitle='Major Earthquake M'+e.magnitude+(e.country?' ('+e.country+')':'');
      else if(isTsunami)mTitle='Tsunami Alert'+(e.country?' ('+e.country+')':'');
      else if(isSevereCyclone)mTitle='Severe Storm Alert: '+(e.title||e.type);
      else if(isRed)mTitle='Red Alert: '+(e.type||'Disaster')+(e.country?' ('+e.country+')':'');
      const mBody=(e.title||e.type)+' · '+(e.alert?e.alert+' alert · ':'')+(e.source||'Official agency');
      try{const n=new Notification(mTitle,{body:mBody,tag:mTag});if(n&&typeof window!=='undefined'){n.onclick=()=>{window.focus();window.location.href=PND.eventUrl?PND.eventUrl(e):'/alerts/'+encodeURIComponent(e.id)}}}catch(err){}
      seen[mKey]=now;
    });
    try{localStorage.setItem('pnd_notified',JSON.stringify(seen))}catch(e){}},
  /* Five destinations, each a question a reader arrives with: what is
     happening and where (Map), what has been reported or warned (Alerts &
     events), what may come (Forecasts), what bears on my places (My places),
     and whether any of this can be trusted (Track record). The logo is the
     sixth: it is "check a place", the question the home page answers first.
     Everything else is one tap away in the footer rather than eleven links
     across the top. */
  NAV:[['Map','/live-map'],['Alerts & events','/alerts'],['Forecasts','/forecasts'],['My places','/personal-risk'],['Track record','/accuracy']],
  NAV_ALIAS:{'Live Map':'Map','Alerts':'Alerts & events','Calamities':'Alerts & events','Events':'Alerts & events','Personal Risk':'My places','Verification':'Track record','Accuracy':'Track record'},
  nav(active=''){const on=this.NAV_ALIAS[active]||active;return `<header class="top"><a class="logo" href="/" aria-label="Predict Natural Disasters - check a place"><span class="globe">◎</span><span><b>Predict Natural Disasters</b><small>Check a place · live hazards · forecasts</small></span></a><nav aria-label="Main">${this.NAV.map(([n,u])=>`<a class="${on===n?'active':''}" href="${u}"${on===n?' aria-current="page"':''}>${n}</a>`).join('')}</nav><select id="pndTimezone" aria-label="Display timezone" onchange="PND.setTimezone(this.value)" style="max-width:150px;background:#09231b;color:#eaf7f1;border:1px solid #285f4b;border-radius:8px;padding:7px 8px;font-size:11px">${this.timezoneOptions()}</select><a class="live" href="/events">● Live</a></header>`;},
  /* Everything that left the top bar, kept one tap away on every page. */
  FOOT:[['Check a place','/'],['Live events','/events'],['Official warnings','/official-warnings'],['Disasters now and in the past','/calamities'],['Regions','/regions'],['Forecast calendar','/forecast-calendar'],['How it works','/methodology'],['Our sources','/resources'],['Insights','/insights'],['About','/about']],
  footer(){return `<footer class="sitefoot" aria-label="More of this site"><nav>${this.FOOT.map(([n,u])=>`<a href="${u}">${n}</a>`).join('')}</nav><p>Up-to-date information from public sources. This is not an official warning service. In an emergency, follow your local authorities.</p></footer>`;},
  sourceBadge(e){const full=(e&&e.source)||'Source not stated';
    return `<span class="source" data-source="${this.esc(full)}" title="${this.esc(full)}">${this.esc(this.shortSource(full))}</span>`;},
  /* A window is stated as a start plus how long it is expected to run, never as
     a date range: a joined pair of dates reads as one continuous event, and a second
     occurrence of the same hazard is a separate record with its own start. */
  duration(fromISO,toISO){
    const a=Date.parse(fromISO||''),b=Date.parse(toISO||'');
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return '';
    const hours=(b-a)/3600e3;
    if(hours<1)return 'under an hour';
    const h=Math.round(hours);
    if(h<48)return h+(h===1?' hour':' hours');
    const d=Math.round(h/24);
    return d+(d===1?' day':' days');
  },
  /* "Starts <date> · expected duration <n>" for a forecast record. */
  windowText(e){
    const start=e&&(e.targetStart||e.startedAt||e.updated);
    if(!start)return 'The source gives no start time';
    const dur=this.duration(start,e&&e.targetEnd);
    return 'Starts '+this.fmtWhen(start,e&&e.targetEnd)+(dur?' · lasts '+dur:' · length not stated');
  },
  statusText(meta){if(!meta)return 'Refreshing';const all=Object.values(meta.sources||{});const n=all.filter(x=>x&&x.ok).length;/* The denominator was hard-coded to 3 while the feed grew to eight providers, so a healthy feed read "7/3 sources online". */return meta.live?`Live · ${n} of ${all.length||n} sources working`:'Our data sources are not answering · showing saved copies only';},
  /* Online/total upstream providers. Pages must use this rather than a literal
     denominator: the provider list grows, and a hard-coded one reads "7/3". */
  sourcesRatio(meta){const all=Object.values((meta&&meta.sources)||{});const n=all.filter(x=>x&&x.ok).length;return n+'/'+(all.length||n);},
  /* The measurements that matter for this hazard, in the order a reader wants
     them. A magnitude means nothing for a fire and a burned area means nothing
     for an earthquake, so the hazard decides its own. */
  keyFacts(e){const M=(typeof window!=='undefined'&&window.PNDHazards)||null;return M?M.keyFacts(e||{}):[];},
  /* Full grid, for a detail page. A figure no connected source publishes says
     so: an omitted death toll would otherwise read as nobody died. */
  keyFactsHtml(e){const f=this.keyFacts(e);if(!f.length)return '';
    return '<div class="keyfacts">'+f.map(x=>`<div class="keyfact${x.reported?'':' kf-missing'}"${x.note?` title="${this.esc(x.note)}"`:''}>`+
      `<span class="kf-l">${this.esc(x.label)}</span>`+
      `<span class="kf-v">${x.reported?this.esc(String(x.value)):'Not reported'}</span></div>`).join('')+'</div>';},
  /* Compact line, for a card: only what is actually reported. */
  /* A value that already names itself is printed on its own: the category of
     a storm is "Category 3" or "Tropical storm", and prefixing the label made
     the card read "Category Category 3". */
  keyFactsLine(e,max){const f=this.keyFacts(e).filter(x=>x.reported).slice(0,max||3);
    return f.map(x=>{const v=String(x.value);
      const named=x.key==='category'||v.toLowerCase().indexOf(String(x.label).toLowerCase())===0;
      return named?this.esc(v):this.esc(x.label)+' '+this.esc(v);}).join(' · ');},
  /* What a card says about a record: its first sentence, and no more than
     a line and a half. A card is a way into the record, and the whole
     description - often 50 or 60 words - is on the record's own page. */
  summary(text,max=160){let t=String(text||'').replace(/\s*(This is not a deterministic prediction and must not replace official warnings|This is our own estimate, not an official warning)\.?\s*$/,'').replace(/\s+/g,' ').trim();
    const first=t.match(/^.{20,}?[.!?](?=\s+[A-Z(]|$)/);if(first)t=first[0];
    if(t.length<=max)return t;const cut=t.slice(0,max);return cut.slice(0,Math.max(cut.lastIndexOf(' '),max*0.6|0)).replace(/[\s,;:·\u2014-]+$/,'')+'…';},
  impactText(e){const p=[];if(e.deaths)p.push(`${e.deaths.toLocaleString()} deaths`);if(e.displaced)p.push(`${e.displaced.toLocaleString()} displaced`);if(e.affected)p.push(`${e.affected.toLocaleString()} affected`);return p.join(' · ')},
  countryOptions(){let names=[];try{const dn=new Intl.DisplayNames(['en'],{type:'region'});for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b),name=dn.of(code);if(name&&name!==code&&!/Unknown Region|Pseudo|European Union|Eurozone|United Nations|Outlying Oceania|^world$/i.test(name))names.push(name)}}catch(e){}return [...new Set(names)].sort((a,b)=>a.localeCompare(b));}
};
window.PND=PND;
const __pndSetInterval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>__pndSetInterval(fn,Math.min(Number(ms)||60000,60000),...args);

(function(){
  const clickableSelectors='tr[data-href],[data-href],[data-event-id],[data-calamity-id],[data-forecast-id],[data-alert-id],[data-historical-id],[data-region],[data-location],[data-hazard],[data-source],[data-kind][data-id]';
  const entityPrefixes=/^\/(disasters|calamities|alerts|forecasts|regions|locations|hazards|history|sources)\//;
  function nearestHeading(el){const box=el.closest('.panel,.events-card,.mapcard,.verification,section,article,.card,.table-wrap')||el.parentElement;if(!box)return '';const h=box.querySelector('h1,h2,h3,h4,.panel-head,.events-head,.section-title,.title');return h?h.textContent:'';}
  function normalizeViewAll(root=document){root.querySelectorAll('.viewall,a[data-view-all],button[data-view-all]').forEach(el=>{const explicit=el.getAttribute('href');if(el.tagName==='A'&&explicit&&explicit!=='#'&&!/^javascript:/i.test(explicit))return;const label=(el.dataset.viewAll||nearestHeading(el)||el.textContent||'').trim();const kind=PND.inferCollection(label),href=PND.collectionUrl(kind);if(el.tagName==='A')el.setAttribute('href',href);else{el.dataset.href=href;el.setAttribute('role','link');el.setAttribute('tabindex','0')}el.title='Open complete '+kind+' page';});}
  /* data-keep-href opts a link out of canonicalisation. The not-found page needs it:
     its recovery link is deliberately in query form, and rewriting it back to the
     pretty URL the visitor just failed to open would send them straight back. */
  function normalizeLinks(root=document){root.querySelectorAll('a[href]:not([data-keep-href])').forEach(a=>{const old=a.getAttribute('href'),next=PND.canonicalDetailUrl(old);if(next&&next!==old)a.setAttribute('href',next);});}
  function normalizeRows(root=document){root.querySelectorAll(clickableSelectors).forEach(el=>{/* Inside a card that is already a link, a chip made into a second link is a control nested in a control, and a 17px target: the card's own link is the one way in. */if(el.parentElement&&el.parentElement.closest('a[href],button'))return;const href=PND.routeFromDataset(el);if(href)el.dataset.href=href;if(!el.dataset.href)return;el.dataset.href=PND.canonicalDetailUrl(el.dataset.href);el.style.cursor='pointer';el.style.pointerEvents='auto';el.title='Open details';el.setAttribute('role','link');el.setAttribute('tabindex','0');});root.querySelectorAll('.event,.riskitem,.calamity-card,.forecast-card,.alert-card,.region-card,.hazard-card,.historical-card').forEach(el=>{if(!el.dataset.href){const href=PND.routeFromDataset(el);if(href)el.dataset.href=href}if(el.dataset.href){el.dataset.href=PND.canonicalDetailUrl(el.dataset.href);el.style.cursor='pointer';el.style.pointerEvents='auto';el.setAttribute('role','link');el.setAttribute('tabindex','0');el.title='Open details';}});}
  function normalizeInlineHandlers(root=document){root.querySelectorAll('[onclick]').forEach(el=>{if(el.dataset.href)return;const raw=el.getAttribute('onclick')||'';const m=raw.match(/(?:window\.)?location(?:\.href)?\s*=\s*['\"]([^'\"]+)/)||raw.match(/location\.assign\(['\"]([^'\"]+)/);if(m){el.dataset.href=PND.canonicalDetailUrl(m[1]);el.removeAttribute('onclick');el.style.cursor='pointer';el.setAttribute('role','link');el.setAttribute('tabindex','0');}});}
  function wire(root=document){normalizeLinks(root);normalizeViewAll(root);normalizeRows(root);normalizeInlineHandlers(root);}
  function navigateFrom(el){const href=el&&el.dataset&&el.dataset.href;if(href)PND.redirect(href);}
  document.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0)return;const dataEl=e.target.closest('[data-href]');if(dataEl){e.preventDefault();e.stopPropagation();navigateFrom(dataEl);return}const a=e.target.closest('a[href]');if(!a||a.target==='_blank'||a.hasAttribute('data-keep-href'))return;const href=PND.canonicalDetailUrl(a.getAttribute('href'));if(entityPrefixes.test(href)){e.preventDefault();PND.redirect(href);}},true);
  document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const el=e.target.closest&&e.target.closest('[data-href]');if(el){e.preventDefault();navigateFrom(el)}},true);
  const DETAIL_PATH=/^\/(disasters|alerts|calamities|forecasts)\//;
  const DETAIL_PAGES=['/event-detail','/alert-detail','/calamity-detail','/forecast-detail',
    '/event-detail.html','/alert-detail.html','/calamity-detail.html','/forecast-detail.html'];
  async function attachEnrichment(){
    const path=location.pathname;
    if(!(DETAIL_PATH.test(path)||DETAIL_PAGES.includes(path)))return;
    const id=PND.qs('id');
    if(!id)return;
    let mount=document.getElementById('eventEnrichment');
    if(!mount){const main=document.querySelector('main');if(!main)return;
      mount=document.createElement('section');mount.id='eventEnrichment';mount.className='wrap';
      main.insertAdjacentElement('afterend',mount)}
    let e=null;
    try{const d=await PND.getEvents({all:true});e=PND.findEvent(d.events,id)}catch(err){return}
    if(!e)return;
    const run=()=>{if(window.PNDEventEnrichment)window.PNDEventEnrichment.load(e)};
    if(window.PNDEventEnrichment){run();return}
    if(document.querySelector('script[data-pnd-enrichment]')){
      document.querySelector('script[data-pnd-enrichment]').addEventListener('load',run);return}
    const s=document.createElement('script');
    s.src='/event-enrichment.js?v=8';s.setAttribute('data-pnd-enrichment','1');s.onload=run;
    document.body.appendChild(s);
  }
  /* Fill every risk filter from the one scale.
   *
   * The pages carry an HTML comment where their options used to be, so the
   * list cannot drift page by page the way "Red / Orange / Green" did - one
   * page had a stray "High" option that matched nothing the feed ever set. */
  function fillRiskFilters(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('select').forEach(sel=>{
      for(const node of Array.from(sel.childNodes)){
        if(node.nodeType!==8||String(node.data).trim()!=='risk-levels')continue;
        /* Whatever was chosen stays chosen. Adding options moved the
           selection to the last one, so every list opened filtered to "Not
           rated" and showed nothing at all. */
        const was=sel.value;
        const box=document.createElement('select');
        box.innerHTML=PND.riskLevelOptions();
        while(box.firstChild)sel.insertBefore(box.firstChild,node);
        node.remove();
        sel.value=was;
        if(sel.selectedIndex<0)sel.selectedIndex=0;
      }
    });
  }
  /* A skip link, and every part of the page inside a named landmark. Each
     page's hero and the enrichment section sat outside <main>, unnamed, and
     no page had a way past the header and its links. */
  function landmarks(){const main=document.querySelector('main');if(!main)return;if(!main.id)main.id='main';if(!main.hasAttribute('tabindex'))main.setAttribute('tabindex','-1');
    if(!document.querySelector('a.skip'))document.body.insertAdjacentHTML('afterbegin','<a class="skip" href="#'+main.id+'">Skip to main content</a>');
    document.querySelectorAll('body > section').forEach(sec=>{if(sec.hasAttribute('aria-label')||sec.hasAttribute('aria-labelledby'))return;const h=sec.querySelector('h1,h2');
      if(h){if(!h.id)h.id='h-'+Math.random().toString(36).slice(2,8);sec.setAttribute('aria-labelledby',h.id)}else sec.setAttribute('aria-label',sec.id==='eventEnrichment'?'More about this':'Summary')});}
  function init(){landmarks();if(document.body&&!document.querySelector('.sitefoot,.seo-nav'))document.body.insertAdjacentHTML('beforeend',PND.footer());document.addEventListener('click',e=>{if(e.target&&e.target.closest&&e.target.closest('#refresh'))PND._freshNext=true},true);wire();fillRiskFilters();const mo=new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes)if(n.nodeType===1){wire(n);fillRiskFilters(n)}});mo.observe(document.body,{childList:true,subtree:true});attachEnrichment();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();