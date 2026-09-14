const PND={
  timezone:localStorage.getItem('pnd_timezone')||'Asia/Kolkata',
  async getEvents(){
    const r=await fetch('/api/events?ts='+Date.now(),{cache:'no-store',headers:{'cache-control':'no-cache'}});if(!r.ok)throw new Error('Live feed unavailable');return r.json();
  },
  autoRefresh(fn,ms=60000){let busy=false;const run=async()=>{if(busy)return;busy=true;try{await fn()}finally{busy=false}};run();return setInterval(run,Math.min(ms,60000))},
  esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));},
  qs(k){return new URLSearchParams(location.search).get(k)||'';},
  getTZ(){return this.timezone;},
  tzLabel(tz=this.timezone){const aliases={'Asia/Kolkata':'IST','UTC':'UTC','America/New_York':'ET','America/Los_Angeles':'PT','Europe/London':'UK','Asia/Dubai':'GST','Asia/Singapore':'SGT','Asia/Tokyo':'JST','Australia/Sydney':'Sydney'};return aliases[tz]||tz;},
  fmtDate(v){if(!v)return '—';const d=new Date(v);if(isNaN(d))return v;return d.toLocaleString('en-IN',{timeZone:this.timezone,day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).replace(/\bam\b/i,'AM').replace(/\bpm\b/i,'PM')+' '+this.tzLabel();},
  fmtTime(v){if(!v)return '—';const d=new Date(v);if(isNaN(d))return v;return d.toLocaleTimeString('en-IN',{timeZone:this.timezone,hour:'numeric',minute:'2-digit',hour12:true}).replace(/\bam\b/i,'AM').replace(/\bpm\b/i,'PM')+' '+this.tzLabel();},
  age(v){if(!v)return 'unknown';const m=Math.max(0,Math.round((Date.now()-new Date(v))/60000));return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} hr ago`:`${Math.round(m/1440)} d ago`;},
  riskClass(v=''){v=String(v).toLowerCase();return v.includes('red')||v.includes('critical')?'critical':v.includes('orange')||v.includes('high')?'high':v.includes('purple')||v.includes('very')?'veryhigh':'moderate';},
  slug(v=''){return String(v).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');},
  eventUrl(e){const id=encodeURIComponent(e&&e.id||'');if(e&&e.forecast)return '/forecast-detail?id='+id;if(e&&e.sourceType==='official'&&['Red','Orange'].includes(e.alert))return '/alert-detail?id='+id;return '/event-detail?id='+id;},
  calamityUrl(e){return '/calamity-detail?id='+encodeURIComponent(e&&e.id||'');},
  historicalUrl(e){return '/historical-event-detail?id='+encodeURIComponent(this.slug(e&&e.name||e&&e.title||''));},
  regionUrl(name){return '/region-detail?region='+encodeURIComponent(name||'World');},
  locationUrl(name){return '/location-detail?location='+encodeURIComponent(name||'World');},
  hazardUrl(type,region=''){return '/hazard-detail?type='+encodeURIComponent(type||'Flood')+(region?'&region='+encodeURIComponent(region):'');},
  sourceDetailUrl(source){return '/source-detail?source='+encodeURIComponent(source||'GDACS');},
  entityDetailUrl(kind,id){return '/'+encodeURIComponent(kind)+'-detail?'+({insight:'topic',methodology:'section',metric:'metric',resource:'id',about:'section',calendar:'id',comparison:'id',notification:'id'}[kind]||'id')+'='+encodeURIComponent(id||'overview');},
  detailUrl(kind,obj){if(kind==='calamity')return this.calamityUrl(obj);if(kind==='historical')return this.historicalUrl(obj);if(kind==='event')return this.eventUrl(obj);if(kind==='forecast')return '/forecast-detail?id='+encodeURIComponent(obj&&obj.id||'');if(kind==='alert')return '/alert-detail?id='+encodeURIComponent(obj&&obj.id||'');if(kind==='region')return this.regionUrl(obj&&obj.name||obj);if(kind==='location')return this.locationUrl(obj&&obj.name||obj);if(kind==='hazard')return this.hazardUrl(obj&&obj.type||obj);if(kind==='source')return this.sourceDetailUrl(obj&&obj.source||obj);return this.entityDetailUrl(kind,obj&&obj.id||obj&&obj.name||obj);},
  collectionRoutes:{
    events:'/events',calamities:'/calamities',forecasts:'/forecast-list',alerts:'/official-warnings',regions:'/regions',historical:'/historical-events',hazards:'/hazard-types',sources:'/sources',verification:'/verification',calendar:'/forecast-calendar',compare:'/compare-locations',notifications:'/alerts-notifications'
  },
  collectionUrl(kind){return this.collectionRoutes[kind]||'/events';},
  inferCollection(text=''){
    const t=String(text).toLowerCase();
    if(/calamit/.test(t))return 'calamities';
    if(/forecast|prediction|outlook/.test(t))return 'forecasts';
    if(/warning|alert/.test(t))return 'alerts';
    if(/region|country|location/.test(t))return 'regions';
    if(/histor|recent major/.test(t))return 'historical';
    if(/hazard|disaster type/.test(t))return 'hazards';
    if(/source/.test(t))return 'sources';
    if(/verif/.test(t))return 'verification';
    if(/calendar/.test(t))return 'calendar';
    if(/compare/.test(t))return 'compare';
    if(/notification/.test(t))return 'notifications';
    return 'events';
  },
  routeFromDataset(el){
    if(!el||!el.dataset)return '';
    const d=el.dataset;
    if(d.href)return d.href;
    if(d.eventId)return '/event-detail?id='+encodeURIComponent(d.eventId);
    if(d.calamityId)return '/calamity-detail?id='+encodeURIComponent(d.calamityId);
    if(d.forecastId)return '/forecast-detail?id='+encodeURIComponent(d.forecastId);
    if(d.alertId)return '/alert-detail?id='+encodeURIComponent(d.alertId);
    if(d.historicalId)return '/historical-event-detail?id='+encodeURIComponent(d.historicalId);
    if(d.region)return this.regionUrl(d.region);
    if(d.location)return this.locationUrl(d.location);
    if(d.hazard)return this.hazardUrl(d.hazard,d.region||'');
    if(d.source)return this.sourceDetailUrl(d.source);
    if(d.kind&&d.id)return this.detailUrl(d.kind,{id:d.id,name:d.name||d.id,type:d.type||d.id,source:d.source||d.id});
    return '';
  },
  setTimezone(tz){this.timezone=tz||'Asia/Kolkata';localStorage.setItem('pnd_timezone',this.timezone);location.reload();},
  initTimezonePicker(){const s=document.getElementById('pndTimezone');if(!s)return;const base=['Asia/Kolkata','UTC','America/New_York','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Dubai','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];let zones=base;try{if(Intl.supportedValuesOf)zones=Intl.supportedValuesOf('timeZone')}catch(e){}const preferred=[this.timezone,...base,...zones].filter((v,i,a)=>a.indexOf(v)===i);s.innerHTML=preferred.map(z=>`<option value="${this.esc(z)}" ${z===this.timezone?'selected':''}>${this.esc(z==='Asia/Kolkata'?'IST · India':z)}</option>`).join('');},
  nav(active=''){setTimeout(()=>this.initTimezonePicker(),0);return `<header class="top"><a class="logo" href="/"><span class="globe">◎</span><span><b>Predict Natural Disasters</b><small>Data. Patterns. Forecasts. A Safer Tomorrow.</small></span></a><nav>${[['Home','/'],['Calamities','/calamities'],['Live Map','/live-map'],['Forecasts','/forecasts'],['Alerts','/alerts'],['Regions','/regions'],['Verification','/verification'],['Methodology','/methodology'],['Insights','/insights'],['About','/about']].map(([n,u])=>`<a class="${active===n?'active':''}" href="${u}">${n}</a>`).join('')}</nav><select id="pndTimezone" aria-label="Display timezone" onchange="PND.setTimezone(this.value)" style="max-width:150px;background:#09231b;color:#eaf7f1;border:1px solid #285f4b;border-radius:8px;padding:7px 8px;font-size:11px"></select><a class="live" href="/events">● Live</a></header>`;},
  sourceBadge(e){return `<a class="source" href="${this.sourceDetailUrl(e&&e.source||'Source')}" onclick="event.stopPropagation()">${this.esc(e&&e.source||'Source')}</a>`;},
  statusText(meta){if(!meta)return 'Refreshing';const n=Object.values(meta.sources||{}).filter(x=>x&&x.ok).length;return meta.live?`Live · ${n}/3 sources online`:'Source outage · verified fallbacks only';},
  impactText(e){const p=[];if(e.deaths)p.push(`${e.deaths.toLocaleString()} deaths`);if(e.displaced)p.push(`${e.displaced.toLocaleString()} displaced`);if(e.affected)p.push(`${e.affected.toLocaleString()} affected`);return p.join(' · ')},
  countryOptions(){let names=[];try{const dn=new Intl.DisplayNames(['en'],{type:'region'});for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b),name=dn.of(code);if(name&&name!==code&&!/Unknown Region/i.test(name))names.push(name)}}catch(e){}return [...new Set(names)].sort((a,b)=>a.localeCompare(b));}
};
window.PND=PND;
const __pndSetInterval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>__pndSetInterval(fn,Math.min(Number(ms)||60000,60000),...args);

(function(){
  const detailPaths=['/event-detail','/alert-detail','/calamity-detail','/forecast-detail','/historical-event-detail','/region-detail','/location-detail','/hazard-detail','/source-detail'];
  const clickableSelectors='tr[data-href],[data-href],[data-event-id],[data-calamity-id],[data-forecast-id],[data-alert-id],[data-historical-id],[data-region],[data-location],[data-hazard],[data-source],[data-kind][data-id]';

  function nearestHeading(el){
    const box=el.closest('.panel,.events-card,.mapcard,.verification,section,article,.card,.table-wrap')||el.parentElement;
    if(!box)return '';
    const h=box.querySelector('h1,h2,h3,h4,.panel-head,.events-head,.section-title,.title');
    return h?h.textContent:'';
  }

  function normalizeViewAll(root=document){
    root.querySelectorAll('.viewall,a[data-view-all],button[data-view-all]').forEach(el=>{
      const label=(el.dataset.viewAll||nearestHeading(el)||el.textContent||'').trim();
      const href=PND.collectionUrl(PND.inferCollection(label));
      if(el.tagName==='A')el.setAttribute('href',href);else{el.dataset.href=href;el.setAttribute('role','link');el.setAttribute('tabindex','0');}
      el.title='Open full '+PND.inferCollection(label)+' directory';
    });
  }

  function normalizeRows(root=document){
    root.querySelectorAll(clickableSelectors).forEach(el=>{
      const href=PND.routeFromDataset(el);
      if(href)el.dataset.href=href;
      if(!el.dataset.href)return;
      el.style.cursor='pointer';el.style.pointerEvents='auto';el.title='Open full detail page';el.setAttribute('role','link');el.setAttribute('tabindex','0');
      if(el.matches('tr')){const last=el.lastElementChild;if(last&&!last.querySelector('.pnd-detail-link')){const a=document.createElement('a');a.className='pnd-detail-link';a.href=el.dataset.href;a.textContent='View details →';a.style.cssText='margin-left:8px;color:#65e7b6;font-weight:800;font-size:10px;white-space:nowrap;text-decoration:none';a.onclick=e=>e.stopPropagation();last.appendChild(a);}}
    });

    root.querySelectorAll('.event,.riskitem,.calamity-card,.forecast-card,.alert-card,.region-card,.hazard-card,.historical-card').forEach(el=>{
      if(!el.dataset.href){
        const href=PND.routeFromDataset(el);
        if(href)el.dataset.href=href;
      }
      if(el.dataset.href){el.style.cursor='pointer';el.style.pointerEvents='auto';el.setAttribute('role','link');el.setAttribute('tabindex','0');el.title='Open full detail page';}
    });
  }

  function normalizeInlineHandlers(root=document){
    root.querySelectorAll('[onclick]').forEach(el=>{
      if(el.dataset.href)return;
      const raw=el.getAttribute('onclick')||'';
      const m=raw.match(/(?:window\.)?location(?:\.href)?\s*=\s*['\"]([^'\"]+)/)||raw.match(/location\.assign\(['\"]([^'\"]+)/);
      if(m){el.dataset.href=m[1];el.style.cursor='pointer';el.setAttribute('role','link');el.setAttribute('tabindex','0');}
    });
  }

  function wire(root=document){normalizeViewAll(root);normalizeRows(root);normalizeInlineHandlers(root);}
  function navigateFrom(el){const href=el&&el.dataset&&el.dataset.href;if(href)window.location.assign(href);}
  document.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0)return;if(e.target.closest('a,button,input,select,textarea'))return;const el=e.target.closest('[data-href]');if(el){e.preventDefault();navigateFrom(el);}},true);
  document.addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const el=e.target.closest&&e.target.closest('[data-href]');if(el){e.preventDefault();navigateFrom(el);}},true);

  async function attachEnrichment(){
    if(!detailPaths.includes(location.pathname))return;
    const id=PND.qs('id');if(!id||!['/event-detail','/alert-detail','/calamity-detail','/forecast-detail','/historical-event-detail'].includes(location.pathname))return;
    let main=document.querySelector('main');if(!main)return;
    if(!document.getElementById('eventEnrichment')){const mount=document.createElement('section');mount.id='eventEnrichment';mount.className='wrap';main.insertAdjacentElement('afterend',mount);}
    try{
      const d=await PND.getEvents();const e=d.events.find(x=>String(x.id)===String(id));if(!e)return;
      const s=document.createElement('script');s.src='/event-enrichment.js?v=4';s.onload=()=>window.PNDEventEnrichment&&window.PNDEventEnrichment.load(e);document.body.appendChild(s);
    }catch(e){}
  }

  function init(){wire();const mo=new MutationObserver(muts=>{for(const m of muts)for(const n of m.addedNodes)if(n.nodeType===1)wire(n);});mo.observe(document.body,{childList:true,subtree:true});attachEnrichment();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();