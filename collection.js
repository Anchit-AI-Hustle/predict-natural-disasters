(()=>{const mode=document.body.dataset.view||'events';/* [page heading, one-line summary, what an empty list is "no ... of"] */const cfg={events:['Events happening now','Disasters reported by official agencies, and our own forecasts of what may happen next.','events'],'recent-events':['Recent events','The latest disasters reported by official agencies.','recent events'],'official-warnings':['Official warnings','Warnings and watches that official agencies have issued and that are in force now. Reports of disasters that already happened are on Alerts & events.','official warnings'],'hazard-types':['Disasters by type','Every type of hazard in the current reports, with its own page. Below them, every current event; our own forecasts are labelled as forecasts.','events'],directory:['Event directory','Search current events reported by official agencies. Our own forecasts are listed too, each labelled as a forecast.','events'],'forecast-list':['Our forecasts','All our current forecasts of what may happen next, including test cases that were not made in advance.','forecasts'],'forecast-calendar':['Forecast calendar','Each current forecast, shown across the days it covers.','forecasts'],'historical-events':['Past and recent events','Recent past events from GDACS, plus the events happening now.','events'],'alerts-notifications':['Current alerts','Warnings and watches that official agencies have issued and that are in force now, with a link to each source. Reports of disasters that already happened are on Alerts & events.','alerts'],'compare-locations':['Compare places','Search for a place to see its current events. Then search for another place to compare.','events'],resources:['Our sources','Every source we read, whether it answered this time, and what it means when a source reports nothing.','sources']}[mode]||['Events','Current events from official agencies.','events'];
const SORT_KEYS=mode==='resources'?['curated','name','nameDesc']:mode==='forecast-list'||mode==='forecast-calendar'?['newest','severity','windowEnd','oldest','country','type','title']:mode==='historical-events'?['newest','oldest','severity','country','type','title']:PND.EVENT_SORTS;
nav.innerHTML=PND.nav(mode==='forecast-list'||mode==='forecast-calendar'?'Forecasts':mode==='official-warnings'||mode==='alerts-notifications'?'Alerts':'');pageTitle.textContent=cfg[0];pageSub.textContent=cfg[1];heading.textContent=cfg[0];let all=[];let lastMeta=null;
/* The outlook views build their hazard filter from the outlooks themselves
   and match it exactly; the fixed lists on the other views still match by
   stem, which is what their option wording was written for. */
const forecastMode=mode==='forecast-list'||mode==='forecast-calendar';
/* "See all events" on a region page links here with ?region=, which nothing
   read, so Japan's link opened all 780 records. The region narrows the list,
   and the page says so with a way back to everything. */
const regionScope=(new URLSearchParams(location.search).get('region')||'').trim();
function scoped(){const k=all.filter(keep);return regionScope&&regionScope.toLowerCase()!=='world'?k.filter(e=>PND.inPlace(e,regionScope)):k}
function scopeNote(){if(!regionScope||regionScope.toLowerCase()==='world'||mode==='resources')return;let n=document.getElementById('regionScope');
 if(!n){n=document.createElement('p');n.id='regionScope';n.className='muted';n.setAttribute('role','note');cards.parentNode.insertBefore(n,cards)}
 n.innerHTML='Showing only '+PND.esc(regionScope)+'. <a href="'+location.pathname+'">Show everywhere →</a>';}
/* An official warning is what the feed classifies as one (PND.isOfficialWarning), the same definition the home tile counts. "Official and red or orange, or any USGS record" listed 338 here against 17 on the tile, 322 of them earthquakes that had already happened. */function keep(e){if(mode==='official-warnings'||mode==='alerts-notifications')return PND.isOfficialWarning(e);if(mode==='forecast-list'||mode==='forecast-calendar')return e.forecast===true&&PND.openForecasts([e]).length===1;if(mode==='recent-events')return e.sourceType==='official';return true}
/* The same disclaimer sentence rides on 24 of the 30 outlooks, so repeating it
   on every card spends a third of each one saying what is true of all of them.
   It is stated once for the page instead, and kept in full on the detail page.
   Older ledger rows still carry the earlier wording, so both are stripped. */
const BOILERPLATE=/\s*(This is not a deterministic prediction and must not replace official warnings|This is our own estimate, not an official warning)\.?\s*$/;
function gist(text){return PND.summary(String(text||'').replace(BOILERPLATE,''))}
function pageNote(){
 if(mode!=='forecast-list'&&mode!=='forecast-calendar')return;
 /* Refreshed rather than created once: the first draw can run before the feed
    has arrived, and a note written then would keep a blank horizon forever. */
 let n=document.getElementById('forecastNote');
 /* The horizon is one sentence on two pages, with a time zone in it. Expanded as the page's first use of UTC on one page and not on the other, the two read differently; a time stamp's zone is a label here as it is in the trust note. */if(!n){n=document.createElement('p');n.id='forecastNote';n.className='tl-note muted';n.setAttribute('data-keep-acronyms','');
  cards.parentNode.insertBefore(n,cards);}
 n.textContent=(lastMeta?PND.horizonText(lastMeta)+' ':'')+
  /* Two kinds, said as two kinds: this said every forecast was "based on a
     current official report", which our weather models' are not. */
  (PND.forecastKinds(scoped()).text?PND.forecastKinds(scoped()).text+' ':'')+
  'A forecast made in advance by our weather models comes from the coming week\u2019s weather compared with 30 years of records at that place. '+
  'The others restate an alert an official agency has already issued, or follow an earthquake. '+
  'Any of them may be wrong. Each is not an official warning and does not replace one.';
}
/* A forecast is a window in time, not a row in a list. The calendar view lays
   each outlook across the days it actually covers, so what is running now,
   what overlaps and what is about to expire can be read at a glance -- which a
   grid of cards, every one of them starting "just now", cannot show. */
const DAY=864e5;
/* Dates the way every other page writes them: "27 Oct", never "Oct 27", and
   "Sep" rather than whichever of "Sep" and "Sept" the browser prefers. */
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function dmy(t){const d=new Date(t);return d.getDate()+' '+MON[d.getMonth()]}
function dayRange(a,b){const x=dmy(a),y=dmy(b);return x===y?x:x+' to '+y}
function dayLabel(t){const d=new Date(t);return{dow:DOW[d.getDay()],day:d.getDate(),mon:MON[d.getMonth()]}}
/* Two weeks at a time, from the start of the earliest open window to the
   end of the latest, with a way to move through them. It showed a fixed 15
   days from today, so a page saying forecasts reach 25 Nov never showed 25
   Nov, and a 30-day drought bar ran off its edge. */
const CAL_DAYS=14;let calOffset=0;
function timeline(list){
 if(!list.length)return '<div class="card"><b>No forecasts to show for these dates.</b><p class="muted">Try removing a filter, or refresh the page.</p></div>';
 const now=Date.now();const midnight=new Date();midnight.setHours(0,0,0,0);const today=midnight.getTime();
 const ends=list.map(e=>Date.parse(e.targetEnd||'')).filter(n=>Number.isFinite(n));
 const last=ends.length?Math.max(...ends):today+3*DAY;
 const maxOffset=Math.max(0,Math.ceil((last-today)/DAY)-CAL_DAYS+1);
 calOffset=Math.max(-7,Math.min(calOffset,maxOffset));
 const from=today+calOffset*DAY,to=from+CAL_DAYS*DAY;
 const span=to-from;const days=[];for(let t=from;t<to;t+=DAY)days.push(t);
 const pct=t=>Math.max(0,Math.min(100,(t-from)/span*100));
 const nowIn=now>=from&&now<to;
 const R=window.PNDRisk;
 const inView=list.filter(e=>{const s=Date.parse(e.targetStart||e.startedAt||'')||from,en=Date.parse(e.targetEnd||'')||(s+DAY);return en>from&&s<to});
 const nav=`<div class="tl-nav" role="group" aria-label="Move through the dates"><button type="button" class="btn" data-cal="-7"${calOffset<=-7?' disabled':''}>Previous week</button>`+
   `<button type="button" class="btn" data-cal="0"${calOffset===0?' disabled':''}>Today</button>`+
   `<button type="button" class="btn" data-cal="7"${calOffset>=maxOffset?' disabled':''}>Next week</button>`+
   `<span class="muted" role="status">${PND.esc(dmy(from)+' to '+dmy(to-DAY)+' '+new Date(to-DAY).getFullYear())}. Forecasts run to ${PND.esc(dmy(last))}. ${inView.length} of ${list.length} forecasts fall in these dates.</span></div>`;
 const groups={};inView.forEach(e=>{(groups[e.type||'Other']=groups[e.type||'Other']||[]).push(e)});
 const head='<div class="tl-head"><div class="tl-label"></div><div class="tl-track">'+
   days.map(t=>{const d=dayLabel(t);const isToday=t===today;
     return `<div class="tl-day${isToday?' is-today':''}"><span>${d.dow}</span><b>${d.day}</b><span>${d.mon}</span></div>`}).join('')+
   (nowIn?`<div class="tl-now" style="left:${pct(now)}%" title="Now"></div>`:'')+'</div></div>';
 const rows=Object.keys(groups).sort().map(type=>{
  const items=groups[type].slice().sort((a,b)=>Date.parse(a.targetStart||a.startedAt||0)-Date.parse(b.targetStart||b.startedAt||0));
  return `<div class="tl-group"><div class="tl-group-name">${PND.esc(type)}</div>`+items.map(e=>{
    const s=Date.parse(e.targetStart||e.startedAt||'')||from;
    const en=Date.parse(e.targetEnd||'')||(s+DAY);
    const left=pct(s),right=pct(en);const width=Math.max(1.4,right-left);
    const live=now>=s&&now<=en;
    /* The bar takes its colour from the same level as the badge beside it
       (risk.js keyFor). It took the alert word, a step off the badge. */
    const key=R&&R.keyFor?R.keyFor(e):'UNKNOWN';
    const cls='risk risk-'+key.toLowerCase();
    const place=PND.placeOf(e,'Place not given'),where=PND.esc(place);
    const when=PND.windowText?PND.esc(PND.windowText(e)||''):'';
    const more=(s<from?'← ':'')+PND.esc(dayRange(s,en))+(en>to?' →':'');
    return `<div class="tl-row"><a class="tl-label" href="${PND.eventUrl(e)}" title="${where}">`+
      `${PND.riskTag(e)}`+
      `<span class="tl-where">${where}</span></a>`+
      `<div class="tl-track">${nowIn?`<div class="tl-now" style="left:${pct(now)}%"></div>`:''}<a class="tl-bar ${cls}${live?' is-live':''}" style="left:${left}%;width:${width}%" `+
      `href="${PND.eventUrl(e)}" title="${PND.esc(PND.titleOf(e))}${when?': '+when:''}">`+
      `<span>${more}</span></a></div></div>`}).join('')+'</div>'}).join('');
 return '<div class="tl">'+nav+head+(rows||'<div class="card"><b>No forecast falls in these dates.</b></div>')+'</div>'+
   '<p class="tl-note muted">Each bar runs from the start of a forecast to its expected end, coloured by the same level as its badge. The line marks now. An arrow means the forecast carries on beyond these dates. '+
   'Forecasts are our own estimates, not official warnings.</p>';
}
document.addEventListener('click',ev=>{const b=ev.target&&ev.target.closest&&ev.target.closest('[data-cal]');if(!b)return;const n=+b.getAttribute('data-cal');calOffset=n===0?0:calOffset+n;draw();const f=document.querySelector('.tl-nav [data-cal="'+(n>0?7:n<0?-7:0)+'"]');if(f&&!f.disabled)f.focus()});
/* The sources this site actually reads, from the feed's own scan record.
 *
 * This page used to list four names written into the file - one of which,
 * WMO, nothing here has ever read - and omitted four that are read on every
 * request. It offered a "Refresh source status" button beside a status line
 * that described the event feed, not the sources. What a reader needs from a
 * page called Authoritative sources is which ones answered this time, what
 * each one covers, and what its silence does and does not establish. All of
 * that is in meta.scan; none of it was shown.
 */
const SCAN_STATE={SCANNED:['ok','Answered this time'],INCOMPLETE_SCAN:['warn','Answered in part'],
  DATA_UNAVAILABLE:['bad','Did not answer'],NOT_ATTEMPTED:['muted','Not checked this time']};
/* The source's entry in trust.js, which carries its own website and the
   names its records go by in the feed. */
function sourceOf(p){const T=window.PNDTrust&&PNDTrust.SOURCES;return T&&(T.feed||[]).find(x=>x.key===p.provider)||null}
/* How many of our open forecasts start from this source's reports. */
function derivedFrom(p){const src=sourceOf(p);const names=(src&&src.feed||[p.label||p.provider]).map(n=>String(n).toLowerCase());
  return PND.openForecasts(all).filter(e=>{const m=/derived from\s+(.+)$/i.exec(String(e.source||''));return !!m&&names.includes(m[1].trim().toLowerCase())}).length}
/* The feed's reason in plain words. */
function plainReason(r){return String(r||'').replace(/: the search failed or every page asked for came back full\.?/,': either the request failed, or there were more older records than we read, so some older ones may be missing.')}
function providerCard(p){
  const st=SCAN_STATE[p.status]||['muted',p.status||'Status not recorded'];
  const reach=p.geographicCoverage||(p.scope&&p.scope.kind==='global'?'Global':'');
  const absence=p.recordsObservations===false
    ?'It lists warnings or published statuses, not observations of what happened. So if it lists nothing, that does not mean no disaster happened.'
    :p.completeness==='exhaustive'
      ?'It lists every event within its stated limits. So if it reports nothing, that is real evidence that nothing happened within those limits. '+(p.completenessBasis||'')
      :'It does not list every event. So if it reports nothing, that is not evidence that nothing happened. '+(p.completenessBasis||'');
  /* Whether it can support a forecast at all, or only report what has
     happened: a source of the second kind being scanned puts nobody in a
     position to predict anything, which is what decides whether a disaster
     nothing forecast is a forecasting failure or simply unforecast. */
  /* Said from the feed, not assumed: "no forecast can be made from it"
     stood beside 65 of our storm outlooks started from GDACS reports. A
     source that reports only what has happened can still be where one of
     our forecasts starts. */
  const fc=derivedFrom(p);
  const started=fc?' '+fc+' of our current forecasts '+(fc===1?'starts':'start')+' from its reports.':'';
  const input=p.inputKind==='forecast'
    ?'It says what is expected, so a forecast can be made from it. '+(p.inputBasis||'')+started
    :p.inputKind==='observation'
      ?'It reports what has already happened, not what will. '+(p.inputBasis||'')+(started||' None of our current forecasts start from it.')
      :'Not recorded, so we cannot say whether a forecast could be made from it.'+started;
  const page=sourceOf(p);
  const counted=[Number.isFinite(p.recordsEvaluated)?p.recordsEvaluated+' reports read':null,
    Number.isFinite(p.recordsServed)?p.recordsServed+' shown on this site':null].filter(Boolean).join(' · ');
  return `<article class="event-card"><span class="source status-${st[0]}">${PND.esc(st[1])}</span>
    <h3>${PND.esc(p.label||p.provider)}</h3>
    <p><b>Hazards</b> ${PND.esc((p.hazards||[]).join(', ')||'Not stated')}<br>
    <b>Reach</b> ${PND.esc(reach||'Not stated')}<br>
    <b>What it lists</b> ${PND.esc(p.coverageResolution||'Not stated')}<br>
    <b>If it reports nothing</b> ${PND.esc(absence.trim())}<br>
    <b>Can a forecast be made from it?</b> ${PND.esc(input.trim())}</p>
    <small class="muted">${PND.esc(counted||'No count recorded this time')}${p.failureReason?' · '+PND.esc(plainReason(p.failureReason)):''}${p.dataFreshness?' · latest data from '+PND.esc(PND.fmtDate(p.dataFreshness)):''}</small>
    <small class="muted" style="display:block;margin-top:4px">${page?`<a href="${PND.esc(page.url)}" target="_blank" rel="noopener">${PND.esc(page.name)} website</a>`:''}${page&&p.endpoint?' · ':''}${p.endpoint?`<a href="${PND.esc(p.endpoint)}" target="_blank" rel="noopener" title="${PND.esc(p.endpoint)}">Raw data feed (${/rss|xml/i.test(p.endpoint)?'RSS':'JSON'}, for developers)</a>`:''}</small></article>`;
}
/* The hazard-types page opens on one tile per hazard, each linked to its own
   page, with agency reports and our open forecasts counted apart. It had no
   link to any hazard page, and counted 12 Extreme Heat "events" that were
   all our forecasts while the Extreme Heat page said 0. */
function hazardTiles(loaded){const box=document.getElementById('hazTiles');if(!box)return;const list=scoped();const by={};
  /* Every hazard the model knows has a tile from the start, so the list below does not move when the counts arrive. */Object.keys((window.PNDHazards&&PNDHazards.HAZARDS)||{}).forEach(k=>{by[k]={obs:0,fc:0}});
  list.forEach(e=>{const k=PND.hazardKey(e.type);const t=by[k]||(by[k]={obs:0,fc:0});if(e.forecast){if(!e.windowClosed&&e.live!==false)t.fc++}else if(e.live!==false)t.obs++});
  const one=(n,w)=>n+' '+w+(n===1?'':'s');
  box.innerHTML=Object.entries(by).sort((a,b)=>b[1].obs-a[1].obs||b[1].fc-a[1].fc||a[0].localeCompare(b[0])).map(([k,t])=>`<a class="haztile" href="${PND.hazardUrl(k)}"><b>${PND.esc(k)}</b><span>${loaded===false?'Loading…':one(t.obs,'current event')+(t.fc?' · '+one(t.fc,'open forecast'):'')}</span></a>`).join('')||'<p class="muted">No hazards in the current reports.</p>'}
function draw(){if(mode==='resources'){
  const scan=(lastMeta&&lastMeta.scan)||null;
  const ps=(scan&&scan.providers)||[];
  if(!ps.length){cards.innerHTML='<div class="empty">We could not get the list of sources read this time, so this page cannot show them. This does not mean no sources were read.</div>';return}
  const rk=PND.sortValue('sortBy',SORT_KEYS);
  const rs=ps.slice();
  const name=p=>String(p.label||p.provider||'');
  if(rk==='name')rs.sort((a,b)=>name(a).localeCompare(name(b)));
  else if(rk==='nameDesc')rs.sort((a,b)=>name(b).localeCompare(name(a)));
  /* Which hazards nobody here can establish an absence for. Stated on the
     page because it is the limit that decides what the verification page is
     allowed to call a false positive. */
  /* Grouped by the same hazard families the verification engine grades on,
     rather than by each provider's own vocabulary: NWS alone names ice,
     tornado, winter storm and severe storm, and listing those separately
     would turn one limit into four. */
  const fam=h=>(window.PNDObserved&&PNDObserved.familiesOf?PNDObserved.familiesOf(h,'')[0]:String(h||'').toLowerCase());
  const hazards={};
  ps.forEach(p=>(p.hazards||[]).forEach(h=>{const f=fam(h);if(f==='other')return;
    hazards[f]=hazards[f]||false;
    if(p.completeness==='exhaustive'&&p.recordsObservations!==false)hazards[f]=true}));
  const blind=Object.keys(hazards).filter(h=>!hazards[h]).sort();
  const blindList=blind.map(h=>h.replace(/-/g,' '));
  const blindText=blindList.length>1?blindList.slice(0,-1).join(', ')+' and '+blindList[blindList.length-1]:blindList.join('');
  const answered=ps.filter(p=>p.status==='SCANNED').length;
  const partial=ps.filter(p=>p.status==='INCOMPLETE_SCAN').length;
  /* "Answered" and "answered in full" are different counts, and printing one
     of them beside a status line reporting the other made the page disagree
     with itself. Both are stated. */
  cards.innerHTML=`<div class="panel" style="grid-column:1/-1;padding:12px"><b>${answered+partial} of ${ps.length} sources working: ${answered} answered in full this time${partial?' and '+partial+' in part':''}.</b>
    ${blind.length?PND.esc('For '+blindText+', none of our sources gives a complete list of disasters that have happened. So we cannot say that no such disaster happened, only that none was reported.'):'For every hazard listed here, at least one source gives a complete list of disasters that have happened. So if that source reports nothing, that is real evidence.'}</div>`
    +rs.map(providerCard).join('');
  return}const s=q.value.toLowerCase(),t=type.value.toLowerCase(),l=level.value;const es=PND.sortBy('sortBy',scoped().filter(e=>(!s||PND.matches(e,s))&&(!t||(forecastMode?String(e.type).toLowerCase()===t:PND.sameHazard(e.type,type.value)))&&PND.matchesRiskLevel(e,l)),SORT_KEYS);pageNote();scopeNote();if(mode==='forecast-calendar'){cards.className='';cards.innerHTML=timeline(es);return}
if(mode==='forecast-list'){cards.className='';
 cards.innerHTML=es.length?PNDForecastTable.render(es)
  :PND.emptyHtml(q.value,scoped(),all,cfg[2]);
 return}
cards.className='event-grid';cards.innerHTML=es.length?es.map(e=>`<a class="event-card" href="${PND.eventUrl(e)}">${PND.riskTag(e)} ${PND.sourceBadge(e)} ${e.forecast?`<span class="prov">${PND.esc(PND.provenanceOf(e))}</span>`:''}${e.windowClosed?'<span class="prov">Forecast period ended</span>':''}<h3>${PND.esc(PND.titleOf(e))}</h3><p>${PND.esc(e.type)} · ${PND.esc(PND.placeOf(e,'Place not given'))}${(()=>{/* One line of figures per card. The key-facts line and the impact line
   stated the same deaths, displaced and affected twice, one under the other,
   and a storm's prose then repeated its wind and pressure a third time. The
   prose is the fallback for a record with no figures; the full text is on the
   record's own page. */const k=PND.keyFactsLine(e,3);return k?'<br><b>'+k+'</b>':'<br>'+PND.esc(gist(PND.impactText(e)||e.details||''));})()}</p><small class="muted">${e.forecast&&e.targetEnd?`${PND.windowText(e)} · `:''}Source updated ${PND.fmtDate(e.updated)} · ${PND.age(e.updated)}</small></a>`).join(''):PND.emptyHtml(q.value,scoped(),all,cfg[2])}
/* A list that holds agency reports and our own forecasts says how many of each: "765 events" counted 56 forecasts as events, so the same moment read 765 here and 709 on Alerts. */function countText(shown,noun){const one=(n,w)=>n+' '+(n===1?w.replace(/s$/,''):w);/* Open forecasts only, counted as everywhere else (PND.openForecasts): an ended one was listed, so this said "114 forecasts: 113 open, 1 ended" beside a page heading of 113. Ended forecasts are on the track record. */if(forecastMode)return one(shown,'open '+noun);const fc=scoped().filter(e=>e&&e.forecast).length;return fc?one(shown-fc,noun)+' · '+one(fc,'forecasts'):one(shown,noun)}async function load(){statusLine.textContent='Loading the latest data…';try{const d=await PND.getEvents({all:mode==='historical-events'});all=d.events;lastMeta=d.meta;const shown=scoped().length;
/* The sources view is about the sources, so its status line counts those
   rather than the records they produced. */
/* Every list builds its hazard filter from the hazards in it: the fixed six could not select Extreme Heat, aftershock sequences, storm warnings or ice. */if(document.getElementById('type'))PND.fillHazardSelect(document.getElementById('type'),scoped(),!forecastMode);if(forecastMode&&document.getElementById('level'))PND.pruneRiskOptions(document.getElementById('level'),scoped());hazardTiles();

statusLine.textContent=mode==='resources'
  ?`${PND.statusText(d.meta)} · sources checked ${PND.fmtDate((d.meta&&d.meta.scan&&d.meta.scan.scanTimestamp)||d.generatedAt)} · updated ${PND.age(d.generatedAt)}`
  :`${PND.statusText(d.meta)} · ${countText(shown,cfg[2])} · updated ${PND.age(d.generatedAt)}`;draw()}catch(e){statusLine.textContent='Live data unavailable. Trying again automatically.'}}PND.SORT_DEFS.curated={label:'Suggested order',cmp:()=>0};PND.SORT_DEFS.name=PND.SORT_DEFS.name||{label:'Name - A to Z',cmp:(a,b)=>0};PND.SORT_DEFS.nameDesc={label:'Name - Z to A',cmp:(a,b)=>0};PND.initSort('sortBy',SORT_KEYS,draw);
/* Looked up rather than assumed: the sources view has no search box and no
   hazard or level filter, because on that page they filtered nothing and a
   control that cannot be operated is not a control. */
const el=id=>document.getElementById(id);
if(el('q'))PNDSearch.initSearch(el('q'),draw);
if(el('type'))el('type').onchange=draw;
if(el('level'))el('level').onchange=draw;
if(el('refresh'))el('refresh').onclick=load;
hazardTiles(false);PND.autoRefresh(load,60000)})();