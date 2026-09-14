const PND={
  timezone:localStorage.getItem('pnd_timezone')||'Asia/Kolkata',
  async getEvents(){
    const r=await fetch('/api/events?ts='+Date.now(),{cache:'no-store',headers:{'cache-control':'no-cache'}});if(!r.ok)throw new Error('Live feed unavailable');return r.json();
  },
  autoRefresh(fn,ms=60000){let busy=false;const run=async()=>{if(busy)return;busy=true;try{await fn()}finally{busy=false}};run();return setInterval(run,Math.min(ms,60000))},
  esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
  pathParam(k){const p=location.pathname.split('/').filter(Boolean);const map={disasters:'id',calamities:'id',alerts:'id',forecasts:'id',history:'id',regions:'region',locations:'location',hazards:'type',sources:'source'};if(p.length>=2&&map[p[0]]===k){try{return decodeURIComponent(p.slice(1).join('/'))}catch(e){return p.slice(1).join('/')}}return ''},
  qs(k){return new URLSearchParams(location.search).get(k)||this.pathParam(k)||'';},
  getTZ(){return this.timezone;},
  tzLabel(tz=this.timezone){const aliases={'Asia/Kolkata':'IST','UTC':'UTC','America/New_York':'ET','America/Los_Angeles':'PT','Europe/London':'UK','Asia/Dubai':'GST','Asia/Singapore':'SGT','Asia/Tokyo':'JST','Australia/Sydney':'Sydney'};return aliases[tz]||tz;},
  fmtDate(v){if(!v)return '—';const d=new Date(v);if(isNaN(d))return v;return d.toLocaleString('en-IN',{timeZone:this.timezone,day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).replace(/\bam\b/i,'AM').replace(/\bpm\b/i,'PM')+' '+this.tzLabel();},
  fmtTime(v){if(!v)return '—';const d=new Date(v);if(isNaN(d))return v;return d.toLocaleTimeString('en-IN',{timeZone:this.timezone,hour:'numeric',minute:'2-digit',hour12:true}).replace(/\bam\b/i,'AM').replace(/\bpm\b/i,'PM')+' '+this.tzLabel();},
  age(v){if(!v)return 'unknown';const m=Math.max(0,Math.round((Date.now()-new Date(v))/60000));return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} hr ago`:`${Math.round(m/1440)} d ago`;},
  riskClass(v=''){v=String(v).toLowerCase();return v.includes('red')||v.includes('critical')?'critical':v.includes('orange')||v.includes('high')?'high':v.includes('purple')||v.includes('very')?'veryhigh':'moderate';},
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
  initTimezonePicker(){const s=document.getElementById('pndTimezone');if(!s)return;const base=['Asia/Kolkata','UTC','America/New_York','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Dubai','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];let zones=base;try{if(Intl.supportedValuesOf)zones=Intl.supportedValuesOf('timeZone')}catch(e){}const preferred=[this.timezone,...base,...zones].filter((v,i,a)=>a.indexOf(v)===i);s.innerHTML=preferred.map(z=>`<option value="${this.esc(z)}" ${z===this.timezone?'selected':''}>${this.esc(z==='Asia/Kolkata'?'IST · India':z)}</option>`).join('');},
  nav(active=''){setTimeout(()=>this.initTimezonePicker(),0);return `<header class="top"><a class="logo" href="/"><span class="globe">◎</span><span><b>Predict Natural Disasters</b><small>Data. Patterns. Forecasts. A Safer Tomorrow.</small></span></a><nav>${[['Home','/'],['Calamities','/calamities'],['Live Map','/live-map'],['Forecasts','/forecasts'],['Alerts','/alerts'],['Regions','/regions'],['Verification','/verification'],['Methodology','/methodology'],['Insights','/insights'],['About','/about']].map(([n,u])=>`<a class="${active===n?'active':''}" href="${u}">${n}</a>`).join('')}</nav><select id="pndTimezone" aria-label="Display timezone" onchange="PND.setTimezone(this.value)" style="max-width:150px;background:#09231b;color:#eaf7f1;border:1px solid #285f4b;border-radius:8px;padding:7px 8px;font-size:11px"></select><a class="live" href="/events">● Live</a></header>`;},
  sourceBadge(e){return `<span class="source" data-source="${this.esc(e&&e.source||'Source')}">${this.esc(e&&e.source||'Source')}</span>`;},
  statusText(meta){if(!meta)return 'Refreshing';const n=Object.values(meta.sources||{}).filter(x=>x&&x.ok).length;return meta.live?`Live · ${n}/3 sources online`:'Source outage · verified fallbacks only';},
  impactText(e){const p=[];if(e.deaths)p.push(`${e.deaths.toLocaleString()} deaths`);if(e.displaced)p.push(`${e.displaced.toLocaleString()} displaced`);if(e.affected)p.push(`${e.affected.toLocaleString()} affected`);return p.join(' · ')},
  countryOptions(){let names=[];try{const dn=new Intl.DisplayNames(['en'],{type:'region'});for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b),name=dn.of(code);if(name&&name!==code&&!/Unknown Region/i.test(name))names.push(name)}}catch(e){}return [...new Set(names)].sort((a,b)=>a.localeCompare(b));}
};
window.PND=PND;
const __pndSetInterval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>__pndSetInterval(fn,Math.min(Number(ms)||60000,60000),...args);

(function(){
  const clickableSelectors='tr[data-href],[data-href],[data-event-id],[data-calamity-id],[data-forecast-id],[data-alert-id],[data-historical-id],[data-region],[data-location],[data-hazard],[data-source],[data-kind][data-id]';
  const entityPrefixes=/^\/(disasters|calamities|alerts|forecasts|regions|locations|hazards|history|sources)\//;
  function nearestHeading(el){const box=el.closest('.panel,.events-card,.mapcard,.verification,section,article,.card,.table-wrap')||el.parentElement;if(!box)return '';const h=box.querySelector('h1,h2,h3,h4,.panel-head,.events-head,.section-title,.title');return h?h.textContent:'';}
  function normalizeViewAll(root=document){root.querySelectorAll('.viewall,a[data-view-all],button[data-view-all]').forEach(el=>{const explicit=el.getAttribute('href');if(el.tagName==='A'&&explicit&&explicit!=='#'&&!/^javascript:/i.test(explicit))return;const label=(el.dataset.viewAll||nearestHeading(el)||el.textContent||'').trim();const kind=PND.inferCollection(label),href=PND.collectionUrl(kind);if(el.tagName==='A')el.setAttribute('href',href);else{el.dataset.href=href;el.setAttribute('role','link');el.setAttribute('tabindex','0')}el.title='Open complete '+kind+' page';});}
  function normalizeLinks(root=document){root.querySelectorAll('a[href]').forEach(a=>{const old=a.getAttribute('href'),next=PND.canonicalDetailUrl(old);if(next&&next!==old)a.setAttribute('href',next);});}
  function normalizeRows(root=document){root.querySelectorAll(clickableSelectors).forEach(el=>{const href=PND.routeFromDataset(el);if(href)el.dataset.href=href;if(!el.dataset.href)return;el.dataset.href=PND.canonicalDetailUrl(el.dataset.href);el.style.cursor='pointer';el.style.pointerEvents='auto';el.title='Open independent detail page';el.setAttribute('role','link');el.setAttribute('tabindex','0');});root.querySelectorAll('.event,.riskitem,.calamity-card,.forecast-card,.alert-card,.region-card,.hazard-card,.historical-card').forEach(el=>{if(!el.dataset.href){const href=PND.routeFromDataset(el);if(href)el.dataset.href=href}if(el.dataset.href){el.dataset.href=PND.canonicalDetailUrl(el.dataset.href);el.style.cursor='pointer';el.style.pointerEvents='auto';el.setAttribute('role','link');el.setAttribute('tabindex','0');el.title='Open independent detail page';}});}
  function normalizeInlineHandlers(root=document){root.querySelectorAll('[onclick]').forEach(el=>{if(el.dataset.href)return;const raw=el.getAttribute('onclick')||'';const m=raw.match(/(?:window\.)?location(?:\.href)?\s*=\s*['\"]([^'\"]+)/)||raw.match(/location\.assign\(['\"]([^'\"]+)/);if(m){el.dataset.href=PND.canonicalDetailUrl(m[1]);el.removeAttribute('onclick');el.style.cursor='pointer';el.setAttribute('role','link');el.setAttribute('tabindex','0');}});}
  function wire(root=document){normalizeLinks(root);normalizeViewAll(root);normalizeRows(root);normalizeInlineHandlers(root);}
  function navigateFrom(el){const href=el&&el.dataset&&el.dataset.href;if(href)PND.redirect(href);}
  document.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0)return;const dataEl=e.target.closest('[data-href]');if(dataEl){e.preventDefault();e.stopPropagation();navigateFrom(dataEl);return}const a=e.target.closest('a[href]');if(!a||a.target==='_blank')return;const href=PND.canonicalDetailUrl(a.getAttribute('href'));if(entityPrefixes.test(href)){e.preventDefault();PND.redirect(href);}},true);
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
    try{const d=await PND.getEvents();e=PND.findEvent(d.events,id)}catch(err){return}
    if(!e)return;
    const run=()=>{if(window.PNDEventEnrichment)window.PNDEventEnrichment.load(e)};
    if(window.PNDEventEnrichment){run();return}
    if(document.querySelector('script[data-pnd-enrichment]')){
      document.querySelector('script[data-pnd-enrichment]').addEventListener('load',run);return}
    const s=document.createElement('script');
    s.src='/event-enrichment.js?v=8';s.setAttribute('data-pnd-enrichment','1');s.onload=run;
    document.body.appendChild(s);
  }
  function init(){wire();const mo=new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes)if(n.nodeType===1)wire(n)});mo.observe(document.body,{childList:true,subtree:true});attachEnrichment();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();