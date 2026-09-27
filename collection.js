(()=>{const mode=document.body.dataset.view||'events';const cfg={events:['Live Global Events','Current and recent multi-hazard events from authoritative feeds.'],'recent-events':['Recent Major Events','Latest observed disasters and significant hazard activity.'],'official-warnings':['Official Warnings & Alerts','Higher-priority official alerts and agency-observed events.'],'hazard-types':['Hazards by Type','Browse current events by flood, earthquake, wildfire, volcano, storm and drought.'],'forecast-list':['Experimental Risk Outlooks','All active short-horizon outlooks and frozen benchmark forecasts.'],'forecast-calendar':['Forecast Calendar','Upcoming monitored forecast windows with current hazard context.'],'historical-events':['Historical & Recent Event Explorer','Recent GDACS event history plus current feeds.'],'alerts-notifications':['Alerts & Notifications','Current higher-priority alerts with source links and freshness.'],'compare-locations':['Compare Locations','Compare current hazard signals across locations.'],resources:['Sources & coverage','Every source this site reads, what it answered this time, and what its silence does and does not establish.']}[mode]||['Disaster Intelligence','Live global hazard intelligence'];
const SORT_KEYS=mode==='resources'?['curated','name','nameDesc']:mode==='forecast-list'||mode==='forecast-calendar'?['newest','severity','windowEnd','oldest','country','type','title']:mode==='historical-events'?['newest','oldest','severity','country','type','title']:PND.EVENT_SORTS;
nav.innerHTML=PND.nav(mode==='forecast-list'||mode==='forecast-calendar'?'Forecasts':mode==='official-warnings'||mode==='alerts-notifications'?'Alerts':'');pageTitle.textContent=cfg[0];pageSub.textContent=cfg[1];heading.textContent=cfg[0];let all=[];let lastMeta=null;
/* The outlook views build their hazard filter from the outlooks themselves
   and match it exactly; the fixed lists on the other views still match by
   stem, which is what their option wording was written for. */
const forecastMode=mode==='forecast-list'||mode==='forecast-calendar';
function keep(e){if(mode==='official-warnings'||mode==='alerts-notifications')return e.sourceType==='official'&&(['Red','Orange'].includes(e.alert)||e.source==='USGS');if(mode==='forecast-list'||mode==='forecast-calendar')return e.forecast===true;if(mode==='recent-events')return e.sourceType==='official';return true}
/* The same disclaimer sentence rides on 24 of the 30 outlooks, so repeating it
   on every card spends a third of each one saying what is true of all of them.
   It is stated once for the page instead, and kept in full on the detail page. */
const BOILERPLATE=/\s*This is not a deterministic prediction and must not replace official warnings\.?\s*$/;
function gist(text){return PND.summary(String(text||'').replace(BOILERPLATE,''))}
function pageNote(){
 if(mode!=='forecast-list'&&mode!=='forecast-calendar')return;
 /* Refreshed rather than created once: the first draw can run before the feed
    has arrived, and a note written then would keep a blank horizon forever. */
 let n=document.getElementById('forecastNote');
 if(!n){n=document.createElement('p');n.id='forecastNote';n.className='tl-note muted';
  cards.parentNode.insertBefore(n,cards);}
 n.textContent=(lastMeta?PND.horizonText(lastMeta)+' ':'')+
  'Outlooks are experimental and derived from active official signals. '+
  'They are not deterministic predictions and do not replace official warnings.';
}
/* A forecast is a window in time, not a row in a list. The calendar view lays
   each outlook across the days it actually covers, so what is running now,
   what overlaps and what is about to expire can be read at a glance -- which a
   grid of cards, every one of them starting "just now", cannot show. */
const DAY=864e5;
function dayRange(a,b){const f=t=>new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short'});const x=f(a),y=f(b);return x===y?x:x+' \u2013 '+y}
function dayLabel(t){const d=new Date(t);return{dow:d.toLocaleDateString(undefined,{weekday:'short'}),day:d.getDate(),mon:d.toLocaleDateString(undefined,{month:'short'})}}
function timeline(list){
 if(!list.length)return '<div class="card"><b>No outlooks in the current window</b><p class="muted">Try removing filters or refresh the feeds.</p></div>';
 const now=Date.now();const midnight=new Date();midnight.setHours(0,0,0,0);const from=midnight.getTime();
 const ends=list.map(e=>Date.parse(e.targetEnd||'')).filter(n=>Number.isFinite(n));
 const last=ends.length?Math.max(...ends):from+3*DAY;
 const to=Math.min(from+15*DAY,Math.max(from+4*DAY,last+DAY));
 const span=to-from;const days=[];for(let t=from;t<to;t+=DAY)days.push(t);
 const pct=t=>Math.max(0,Math.min(100,(t-from)/span*100));
 const groups={};list.forEach(e=>{(groups[e.type||'Other']=groups[e.type||'Other']||[]).push(e)});
 const head='<div class="tl-head"><div class="tl-label"></div><div class="tl-track">'+
   days.map(t=>{const d=dayLabel(t);const today=t===from;
     return `<div class="tl-day${today?' is-today':''}"><span>${d.dow}</span><b>${d.day}</b><span>${d.mon}</span></div>`}).join('')+
   `<div class="tl-now" style="left:${pct(now)}%" title="Now"></div></div></div>`;
 const rows=Object.keys(groups).sort().map(type=>{
  const items=groups[type].slice().sort((a,b)=>Date.parse(a.targetStart||a.startedAt||0)-Date.parse(b.targetStart||b.startedAt||0));
  return `<div class="tl-group"><div class="tl-group-name">${PND.esc(type)}</div>`+items.map(e=>{
    const s=Date.parse(e.targetStart||e.startedAt||'')||from;
    const en=Date.parse(e.targetEnd||'')||(s+DAY);
    const left=pct(s),right=pct(en);const width=Math.max(1.4,right-left);
    const live=now>=s&&now<=en;
    const cls=PND.riskClass(e.alert);
    const where=PND.esc(e.country||e.region||'Global');
    const when=PND.windowText?PND.esc(PND.windowText(e)||''):'';
    return `<div class="tl-row"><a class="tl-label" href="${PND.eventUrl(e)}">`+
      `${PND.riskTag(e)}`+
      `<span class="tl-where">${where}</span></a>`+
      `<div class="tl-track"><a class="tl-bar ${cls}${live?' is-live':''}" style="left:${left}%;width:${width}%" `+
      `href="${PND.eventUrl(e)}" title="${PND.esc(e.title)}${when?' — '+when:''}">`+
      `<span>${PND.esc(dayRange(s,en))}</span></a>`+
      `<div class="tl-now" style="left:${pct(now)}%"></div></div></div>`}).join('')+'</div>'}).join('');
 return '<div class="tl">'+head+rows+'</div>'+
   '<p class="tl-note muted">Bars span each outlook’s own window, from its start to its expected end. The line marks now. '+
   'Outlooks are experimental and derived from active official signals — they are not deterministic predictions and do not replace official warnings.</p>';
}
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
const SCAN_STATE={SCANNED:['ok','Answered this scan'],INCOMPLETE_SCAN:['warn','Answered in part'],
  DATA_UNAVAILABLE:['bad','Did not answer'],NOT_ATTEMPTED:['muted','Not attempted this scan']};
function providerCard(p){
  const st=SCAN_STATE[p.status]||['muted',p.status||'Status not recorded'];
  const reach=p.geographicCoverage||(p.scope&&p.scope.kind==='global'?'Global':'');
  const absence=p.recordsObservations===false
    ?'Its records are warnings or published statuses, not observations, so its silence cannot establish that no disaster occurred.'
    :p.completeness==='exhaustive'
      ?'Exhaustive within its stated bounds, so an absence here is meaningful. '+(p.completenessBasis||'')
      :'Not exhaustive, so an absence here is not evidence that nothing happened. '+(p.completenessBasis||'');
  /* Whether it can support a forecast at all, or only report what has
     happened: a source of the second kind being scanned puts nobody in a
     position to predict anything, which is what decides whether a disaster
     nothing forecast is a forecasting failure or simply unforecast. */
  const input=p.inputKind==='forecast'
    ?'States what is expected, so it can support a forecast. '+(p.inputBasis||'')
    :p.inputKind==='observation'
      ?'Reports what has already happened, so nothing forecast can be derived from it. '+(p.inputBasis||'')
      :'Not recorded, so nothing here establishes that it could support a forecast.';
  const counted=[Number.isFinite(p.recordsEvaluated)?p.recordsEvaluated+' records evaluated':null,
    Number.isFinite(p.recordsServed)?p.recordsServed+' served':null].filter(Boolean).join(' · ');
  return `<article class="event-card"><span class="source status-${st[0]}">${PND.esc(st[1])}</span>
    <h3>${PND.esc(p.label||p.provider)}</h3>
    <p><b>Hazards</b> ${PND.esc((p.hazards||[]).join(', ')||'Not stated')}<br>
    <b>Reach</b> ${PND.esc(reach||'Not stated')}<br>
    <b>What it lists</b> ${PND.esc(p.coverageResolution||'Not stated')}<br>
    <b>If it reports nothing</b> ${PND.esc(absence.trim())}<br>
    <b>What it can forecast</b> ${PND.esc(input.trim())}</p>
    <small class="muted">${PND.esc(counted||'Nothing counted this scan')}${p.failureReason?' · '+PND.esc(p.failureReason):''}${p.dataFreshness?' · data '+PND.esc(p.dataFreshness):''}</small>
    ${p.endpoint?`<small class="muted" style="display:block;margin-top:4px"><a href="${PND.esc(p.endpoint)}" target="_blank" rel="noopener">${PND.esc(p.endpoint)}</a></small>`:''}</article>`;
}
function draw(){if(mode==='resources'){
  const scan=(lastMeta&&lastMeta.scan)||null;
  const ps=(scan&&scan.providers)||[];
  if(!ps.length){cards.innerHTML='<div class="empty">The feed did not report which sources it read, so this page cannot say. It is not a claim that none were read.</div>';return}
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
  const answered=ps.filter(p=>p.status==='SCANNED').length;
  const partial=ps.filter(p=>p.status==='INCOMPLETE_SCAN').length;
  /* "Answered" and "answered in full" are different counts, and printing one
     of them beside a status line reporting the other made the page disagree
     with itself. Both are stated. */
  cards.innerHTML=`<div class="panel" style="grid-column:1/-1;padding:12px"><b>${answered} of ${ps.length} sources answered this scan in full${partial?', '+partial+' in part':''}.</b>
    ${blind.length?PND.esc('For '+blind.join(', ').replace(/-/g,' ')+' no source here is both exhaustive and an observer, so nothing on this site can establish that no such disaster occurred \u2014 only that none was reported.'):'Every hazard listed here has a source whose silence is evidence.'}</div>`
    +rs.map(providerCard).join('');
  return}const s=q.value.toLowerCase(),t=type.value.toLowerCase(),l=level.value;const es=PND.sortBy('sortBy',all.filter(keep).filter(e=>(!s||PND.matches(e,s))&&(!t||(forecastMode?String(e.type).toLowerCase()===t:String(e.type).toLowerCase().includes(t.replace('s',''))))&&PND.matchesRiskLevel(e,l)),SORT_KEYS);pageNote();if(mode==='forecast-calendar'){cards.className='';cards.innerHTML=timeline(es);return}
if(mode==='forecast-list'){cards.className='';
 cards.innerHTML=es.length?PNDForecastTable.render(es)
  :PND.emptyHtml(q.value,all.filter(keep),all,cfg[0].toLowerCase());
 return}
cards.className='event-grid';cards.innerHTML=es.length?es.map(e=>`<a class="event-card" href="${PND.eventUrl(e)}">${PND.riskTag(e)} ${PND.sourceBadge(e)} ${e.forecast?`<span class="prov">${PND.esc(e.forecastKind==='frozen-benchmark'?'Frozen benchmark':'Experimental outlook')}</span>`:''}${e.windowClosed?'<span class="prov">Window closed</span>':''}<h3>${PND.esc(e.title)}</h3><p>${PND.esc(e.type)} · ${PND.esc(e.country||e.region||'Global')}${(()=>{/* One line of figures per card. The key-facts line and the impact line
   stated the same deaths, displaced and affected twice, one under the other,
   and a storm's prose then repeated its wind and pressure a third time. The
   prose is the fallback for a record with no figures; the full text is on the
   record's own page. */const k=PND.keyFactsLine(e,3);return k?'<br><b>'+k+'</b>':'<br>'+PND.esc(gist(PND.impactText(e)||e.details||''));})()}</p><small class="muted">${e.forecast&&e.targetEnd?`${PND.windowText(e)} · `:''}Source update ${PND.fmtDate(e.updated)} · ${PND.age(e.updated)}</small></a>`).join(''):PND.emptyHtml(q.value,all.filter(keep),all,cfg[0].toLowerCase())}
async function load(){statusLine.textContent='Refreshing authoritative feeds…';try{const d=await PND.getEvents();all=d.events;lastMeta=d.meta;const shown=all.filter(keep).length;
/* The sources view is about the sources, so its status line counts those
   rather than the records they produced. */
if(forecastMode)PND.fillHazardSelect(document.getElementById('type'),all.filter(keep));
statusLine.textContent=mode==='resources'
  ?`${PND.statusText(d.meta)} · scan ${PND.fmtDate((d.meta&&d.meta.scan&&d.meta.scan.scanTimestamp)||d.generatedAt)} · fetched ${PND.age(d.generatedAt)}`
  :`${PND.statusText(d.meta)} · ${shown} matching records · fetched ${PND.age(d.generatedAt)}`;draw()}catch(e){statusLine.textContent='Upstream feed unavailable · retrying automatically'}}PND.SORT_DEFS.curated={label:'Suggested order',cmp:()=>0};PND.SORT_DEFS.name=PND.SORT_DEFS.name||{label:'Name — A to Z',cmp:(a,b)=>0};PND.SORT_DEFS.nameDesc={label:'Name — Z to A',cmp:(a,b)=>0};PND.initSort('sortBy',SORT_KEYS,draw);
/* Looked up rather than assumed: the sources view has no search box and no
   hazard or level filter, because on that page they filtered nothing and a
   control that cannot be operated is not a control. */
const el=id=>document.getElementById(id);
if(el('q'))PNDSearch.initSearch(el('q'),draw);
if(el('type'))el('type').onchange=draw;
if(el('level'))el('level').onchange=draw;
if(el('refresh'))el('refresh').onclick=load;
PND.autoRefresh(load,60000)})();