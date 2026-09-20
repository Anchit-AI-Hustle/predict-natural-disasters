(()=>{const mode=document.body.dataset.view||'events';const cfg={events:['Live Global Events','Current and recent multi-hazard events from authoritative feeds.'],'recent-events':['Recent Major Events','Latest observed disasters and significant hazard activity.'],'official-warnings':['Official Warnings & Alerts','Higher-priority official alerts and agency-observed events.'],'hazard-types':['Hazards by Type','Browse current events by flood, earthquake, wildfire, volcano, storm and drought.'],'forecast-list':['Experimental Risk Outlooks','All active short-horizon outlooks and frozen benchmark forecasts.'],'forecast-calendar':['Forecast Calendar','Upcoming monitored forecast windows with current hazard context.'],'historical-events':['Historical & Recent Event Explorer','Recent GDACS event history plus current feeds.'],'alerts-notifications':['Alerts & Notifications','Current higher-priority alerts with source links and freshness.'],'compare-locations':['Compare Locations','Compare current hazard signals across locations.'],resources:['Learn & Resources','Authoritative data sources, methodology and safety guidance.']}[mode]||['Disaster Intelligence','Live global hazard intelligence'];
const SORT_KEYS=mode==='resources'?['curated','name','nameDesc']:mode==='forecast-list'||mode==='forecast-calendar'?['newest','severity','windowEnd','oldest','country','type','title']:mode==='historical-events'?['newest','oldest','severity','country','type','title']:PND.EVENT_SORTS;
nav.innerHTML=PND.nav(mode==='forecast-list'||mode==='forecast-calendar'?'Forecasts':mode==='official-warnings'||mode==='alerts-notifications'?'Alerts':'');pageTitle.textContent=cfg[0];pageSub.textContent=cfg[1];heading.textContent=cfg[0];let all=[];let lastMeta=null;
function keep(e){if(mode==='official-warnings'||mode==='alerts-notifications')return e.sourceType==='official'&&(['Red','Orange'].includes(e.alert)||e.source==='USGS');if(mode==='forecast-list'||mode==='forecast-calendar')return e.forecast===true;if(mode==='recent-events')return e.sourceType==='official';return true}
/* The same disclaimer sentence rides on 24 of the 30 outlooks, so repeating it
   on every card spends a third of each one saying what is true of all of them.
   It is stated once for the page instead, and kept in full on the detail page. */
const BOILERPLATE=/\s*This is not a deterministic prediction and must not replace official warnings\.?\s*$/;
function gist(text){return String(text||'').replace(BOILERPLATE,'').trim()}
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
      `<span class="badge ${cls}">${PND.esc(e.alert||'Watch')}</span>`+
      `${PND.severityBadge(e)}`+
      `<span class="tl-where">${where}</span></a>`+
      `<div class="tl-track"><a class="tl-bar ${cls}${live?' is-live':''}" style="left:${left}%;width:${width}%" `+
      `href="${PND.eventUrl(e)}" title="${PND.esc(e.title)}${when?' — '+when:''}">`+
      `<span>${PND.esc(dayRange(s,en))}</span></a>`+
      `<div class="tl-now" style="left:${pct(now)}%"></div></div></div>`}).join('')+'</div>'}).join('');
 return '<div class="tl">'+head+rows+'</div>'+
   '<p class="tl-note muted">Bars span each outlook’s own window, from its start to its expected end. The line marks now. '+
   'Outlooks are experimental and derived from active official signals — they are not deterministic predictions and do not replace official warnings.</p>';
}
function draw(){if(mode==='resources'){const RES=[['GDACS','Global Disaster Alert and Coordination System','https://www.gdacs.org/'],['USGS','Earthquake Hazards Program','https://earthquake.usgs.gov/'],['NASA EONET','Earth Observatory Natural Event Tracker','https://eonet.gsfc.nasa.gov/'],['WMO','World Meteorological Organization','https://wmo.int/']];const rk=PND.sortValue('sortBy',SORT_KEYS);const rs=RES.slice();if(rk==='name')rs.sort((a,b)=>a[0].localeCompare(b[0]));else if(rk==='nameDesc')rs.sort((a,b)=>b[0].localeCompare(a[0]));cards.innerHTML=rs.map(([a,b,u])=>`<a class="event-card" href="${u}" target="_blank" rel="noopener"><span class="source">Authoritative source</span><h3>${a}</h3><p>${b}</p></a>`).join('');return}const s=q.value.toLowerCase(),t=type.value.toLowerCase(),l=level.value;const es=PND.sortBy('sortBy',all.filter(keep).filter(e=>(!s||PND.matches(e,s))&&(!t||String(e.type).toLowerCase().includes(t.replace('s','')))&&(!l||e.alert===l)),SORT_KEYS);pageNote();if(mode==='forecast-calendar'){cards.className='';cards.innerHTML=timeline(es);return}
cards.className='event-grid';cards.innerHTML=es.length?es.map(e=>`<a class="event-card" href="${PND.eventUrl(e)}"><span class="badge ${PND.riskClass(e.alert)}">${PND.esc(e.alert||'Watch')}</span> ${PND.severityBadge(e)} ${PND.sourceBadge(e)} ${e.forecast?`<span class="source">${PND.esc(e.forecastKind==='frozen-benchmark'?'Frozen benchmark':'Experimental outlook')}</span>`:''}${e.windowClosed?'<span class="source">Window closed</span>':''}<h3>${PND.esc(e.title)}</h3><p>${PND.esc(e.type)} · ${PND.esc(e.country||e.region||'Global')}${(()=>{const k=PND.keyFactsLine(e,3);return k?'<br><b>'+k+'</b>':''})()}<br>${PND.esc(gist(PND.impactText(e)||e.details||''))}</p><small class="muted">${e.forecast&&e.targetEnd?`${PND.windowText(e)} · `:''}Source update ${PND.fmtDate(e.updated)} · ${PND.age(e.updated)}</small></a>`).join(''):PND.emptyHtml(q.value,all.filter(keep),all,cfg[0].toLowerCase())}
async function load(){statusLine.textContent='Refreshing authoritative feeds…';try{const d=await PND.getEvents();all=d.events;lastMeta=d.meta;const shown=all.filter(keep).length;statusLine.textContent=`${PND.statusText(d.meta)} · ${shown} matching records · fetched ${PND.age(d.generatedAt)}`;draw()}catch(e){statusLine.textContent='Upstream feed unavailable · retrying automatically'}}PND.SORT_DEFS.curated={label:'Suggested order',cmp:()=>0};PND.SORT_DEFS.name=PND.SORT_DEFS.name||{label:'Name — A to Z',cmp:(a,b)=>0};PND.SORT_DEFS.nameDesc={label:'Name — Z to A',cmp:(a,b)=>0};PND.initSort('sortBy',SORT_KEYS,draw);
PNDSearch.initSearch(q,draw);type.onchange=draw;level.onchange=draw;refresh.onclick=load;PND.autoRefresh(load,60000)})();