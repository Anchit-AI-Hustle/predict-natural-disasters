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
  riskClass(v=''){const s=String(v).toLowerCase();
    /* Word boundaries, not substrings: "yellow" contains "low", and a bare
       includes() check would paint a yellow alert as routine. */
    if(/\b(red|critical|extreme)\b/.test(s))return 'critical';
    if(/\b(purple|very)\b/.test(s))return 'veryhigh';
    if(/\b(orange|high|severe)\b/.test(s))return 'high';
    if(/\b(moderate|yellow)\b/.test(s))return 'moderate';
    if(/\b(watch|advisory|minor)\b/.test(s))return 'watch';
    if(/\b(green|low|informational|routine)\b/.test(s))return 'routine';
    /* An unrecognised level is not a warning. It used to fall through to the
       amber "moderate" badge, so 732 Green records in the live feed were
       painted as warnings while their own label read Green. */
    return 'neutral';},
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
  severityBadge(e){const v=e&&e.severity;if(!v)return '';const M=(typeof window!=='undefined'&&window.PNDHazards)||null;const def=M&&(M.SEVERITY.find(x=>x.key===v)||{}).meaning||'';return `<span class="sev sev-${this.slug(v)}" title="${this.esc(def)}">${this.esc(v)}</span>`;},
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
    if(!h||!h.furthestWindowEnds)return 'No outlook windows are open right now.';
    const d=h.daysAhead;
    const ahead=d>=1?Math.round(d)+' day'+(Math.round(d)===1?'':'s'):'less than a day';
    return 'Forecasts currently run to '+this.fmtDate(h.furthestWindowEnds)+
      ' — '+ahead+' ahead. Windows are '+
      (h.windowLengthDays&&h.windowLengthDays.length
        ? h.windowLengthDays.join(', ')+' day'+(h.windowLengthDays.length===1&&h.windowLengthDays[0]===1?'':'s')+' long'
        : 'of varying length')+
      '. Nothing here looks further ahead, and that is a limit of the method rather than a forecast of calm.';
  },
  /* "Has anything changed in the forecasts since I last looked" had no answer:
     the ledger appends a re-issued outlook as a new row indistinguishable from
     a new one, and an outlook that stopped being issued left no trace. */
  changesHtml(meta){
    const c=meta&&meta.forecastChanges;
    if(!c)return '<p class="muted">No change record has been written yet.</p>';
    const when=this.fmtDate(c.at)+' · '+this.age(c.at);
    if(c.baseline)return '<p class="muted">First recorded check, '+this.esc(when)+
      '. '+c.activeOutlooks+' outlooks are open; there is nothing earlier to compare them with yet.</p>';
    const gap=typeof c.sinceHours==='number'&&c.sinceHours>0
      ? ' (' + (c.sinceHours<1 ? Math.round(c.sinceHours*60)+' minutes' : c.sinceHours+' hours') + ' after the one before)'
      : '';
    /* An outage is not a change in the forecasts, so it is deliberately not
       counted in total — but it still has to be shown. Returning on total
       alone meant a run whose only exceptional result was an unreachable
       source reported "nothing changed" and dropped the outage rows entirely,
       which is the opposite of what recording them was for. */
    const un=Number(c.unavailable)||0;
    if(!c.total&&!un)return '<p class="muted">Checked '+this.esc(when)+this.esc(gap)+
      '. None of the '+c.activeOutlooks+' open outlooks changed level, window or status.</p>';
    const R=c.records||{};
    const row=(label,list,fmt)=>(list&&list.length)
      ? '<div><b>'+label+' ('+list.length+')</b>'+list.slice(0,8).map(x=>
          '<p class="muted">'+this.esc(fmt(x))+'</p>').join('')+
          (list.length>8?'<p class="muted">…and '+(list.length-8)+' more</p>':'')+'</div>'
      : '';
    const headline=c.total
      ? c.total+' change'+(c.total===1?'':'s')+' across '+c.activeOutlooks+' open outlooks'
      : 'no changes across '+c.activeOutlooks+' open outlooks';
    const caveat=un?', and '+un+' that could not be checked':'';
    return '<p class="muted">Checked '+this.esc(when)+this.esc(gap)+' · '+
      this.esc(headline+caveat)+'.</p>'+
      row('Newly issued',R.added,x=>x.title+' — '+x.alert)+
      row('Raised',R.raised,x=>x.title+' — '+x.from+' → '+x.to)+
      row('Lowered',R.lowered,x=>x.title+' — '+x.from+' → '+x.to)+
      row('Window moved',R.windowMoved,x=>x.title+' — now ends '+this.fmtDate(x.toEnd))+
      row('No longer issued',R.gone,x=>x.title+' — the signal behind it stopped')+
      /* An outlook whose window simply ended did what it said it would. It
         must not read as a withdrawal. */
      row('Window closed as scheduled',R.expired,x=>x.title+' — its forecast window ended')+
      /* Not a change in the forecasts at all — a gap in what could be seen.
         Reporting it as a withdrawal would blame the forecast for our
         outage, and blame it again as a new forecast on recovery. */
      row('Could not be checked',R.unavailable,x=>x.title+
        ' — its source was unreachable on this run, so it is unchanged rather than withdrawn');
  },
  SORT_DEFS:{
    severity:{label:'Severity — highest first',cmp(a,b){return PND.rankOf(b)-PND.rankOf(a)||PND.timeOf(b)-PND.timeOf(a)}},
    newest:{label:'Updated — newest first',cmp(a,b){return PND.timeOf(b)-PND.timeOf(a)}},
    oldest:{label:'Updated — oldest first',cmp(a,b){return PND.timeOf(a)-PND.timeOf(b)}},
    deaths:{label:'Reported deaths — highest',cmp(a,b){return PND.numOf(b.deaths)-PND.numOf(a.deaths)||PND.timeOf(b)-PND.timeOf(a)}},
    affected:{label:'People affected — highest',cmp(a,b){return PND.numOf(b.affected)-PND.numOf(a.affected)||PND.numOf(b.displaced)-PND.numOf(a.displaced)||PND.timeOf(b)-PND.timeOf(a)}},
    country:{label:'Country / region — A to Z',cmp(a,b){return PND.textOf(a,'country','region').localeCompare(PND.textOf(b,'country','region'))||PND.timeOf(b)-PND.timeOf(a)}},
    type:{label:'Hazard type — A to Z',cmp(a,b){return PND.textOf(a,'type').localeCompare(PND.textOf(b,'type'))||PND.rankOf(b)-PND.rankOf(a)}},
    source:{label:'Source — A to Z',cmp(a,b){return PND.textOf(a,'source').localeCompare(PND.textOf(b,'source'))||PND.timeOf(b)-PND.timeOf(a)}},
    title:{label:'Title — A to Z',cmp(a,b){return PND.textOf(a,'title','name').localeCompare(PND.textOf(b,'title','name'))}},
    distance:{label:'Distance — nearest first',cmp(a,b){return (Number.isFinite(a._d)?a._d:Infinity)-(Number.isFinite(b._d)?b._d:Infinity)}},
    windowEnd:{label:'Ending soonest first',cmp(a,b){const x=Date.parse(a.targetEnd||'')||Infinity,y=Date.parse(b.targetEnd||'')||Infinity;return x-y}},
    yearNew:{label:'Date — most recent first',cmp(a,b){return PND.numOf(b.sort)-PND.numOf(a.sort)}},
    yearOld:{label:'Date — earliest first',cmp(a,b){return PND.numOf(a.sort)-PND.numOf(b.sort)}},
    name:{label:'Name — A to Z',cmp(a,b){return PND.textOf(a,'name','title').localeCompare(PND.textOf(b,'name','title'))}},
    countDesc:{label:'Active records — most first',cmp(a,b){return PND.numOf(b.count)-PND.numOf(a.count)}},
    countAsc:{label:'Active records — fewest first',cmp(a,b){return PND.numOf(a.count)-PND.numOf(b.count)}}
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
    if(s==='forecast'||(!s&&e&&e.forecast))return e.forecastKind==='frozen-benchmark'?'EXPERIMENTAL PREDICTION':'MODEL-DERIVED OUTLOOK';
    if(s==='official-warning')return 'OFFICIAL WARNING';
    return 'OBSERVED EVENT';},
  savedLocations(){try{return JSON.parse(localStorage.getItem('pnd_saved_locations')||'[]')}catch(e){return[]}},
  saveLocation(x){const a=this.savedLocations();a.push({...x,id:'loc-'+Date.now()});localStorage.setItem('pnd_saved_locations',JSON.stringify(a));return a},
  removeLocation(id){const a=this.savedLocations().filter(x=>x.id!==id);localStorage.setItem('pnd_saved_locations',JSON.stringify(a));return a},
  distanceKm(a,b,c,d){const r=Math.PI/180,R=6371,x=(c-a)*r,y=(d-b)*r,z=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(z))},
  evaluateRiskNotifications(events=[]){if(!('Notification' in window)||Notification.permission!=='granted')return;/* Same banding as the page, from the same model. A notification is the
     most intrusive claim this app makes, so it fires only where the record
     places the hazard at this place - inside a published area, or at an
     incident coordinate close by - and never off an area centroid. */
    const H=typeof PNDHazards!=='undefined'?PNDHazards:null;if(!H)return;const locs=this.savedLocations(),seen=JSON.parse(localStorage.getItem('pnd_notified')||'{}'),now=Date.now();locs.forEach(x=>events.forEach(e=>{const r=H&&H.riskRow(e,x);if(!r)return;const ser=String(e.alert||e.severity||'').toLowerCase(),key=x.id+'|'+e.id+'|'+ser;let body='';if(r.band==='B'&&r.containment===true)body=(e.type||'Hazard')+' · your saved place is inside the warned area · '+(e.alert||e.severity||'active');else if(r.band==='A'&&r.containment===true)body=(e.type||'Hazard')+' · your saved place is inside the reported affected area · '+(e.alert||e.severity||'active');else if(r.band==='A'&&r.claimDistance&&r.distanceKm<=100&&(/red|orange|severe|extreme|catastrophic/.test(ser)||r.distanceKm<=30))body=(e.type||'Hazard')+' · '+Math.round(r.distanceKm)+' km away · '+(e.alert||e.severity||'active');if(body&&(!seen[key]||now-seen[key]>21600000)){new Notification('Hazard near '+x.name,{body:body});seen[key]=now}}));localStorage.setItem('pnd_notified',JSON.stringify(seen))},
  startTour(force=false){
    if(!force&&localStorage.getItem('pnd_tour_done'))return;
    const steps=[
      {sel:'#leafletMap,#map',title:'Global Live Hazard Map',text:'See active hazards worldwide. Pan, zoom and select a marker for the underlying event.',fallback:'/live-map'},
      {sel:'button[onclick*="personal-risk"],.side-item[onclick*="personal-risk"]',title:'Personal Risk',text:'Save Home, Office, Family or Travel locations and monitor hazards relevant to those places.',fallback:'/personal-risk'},
      {sel:'.utility-home-grid button:nth-child(2)',title:'What should I do now?',text:'Open an active event to see severity, evidence, official sources and immediate safety priorities.',fallback:'/events'},
      {sel:'button[onclick*="forecasts"],a[href="/forecasts"]',title:'Forecasts + provenance',text:'See what may happen next and whether the information is an official warning, observed event or model outlook.',fallback:'/forecasts'},
      {sel:'button[onclick*="accuracy"],a[href="/accuracy"]',title:'Verification & Track Record',text:'Audit verified predictions, partials, false alarms, missed events and coverage failures.',fallback:'/accuracy'}
    ];
    let i=0,old=document.activeElement,scrollY=window.scrollY;
    /* The frame callback is optional too, for the same reason as the
       scrolling calls above: a harness with no visual loop has none. */
    const raf=typeof requestAnimationFrame==='function'?requestAnimationFrame:(fn=>setTimeout(fn,16));
    const root=document.createElement('div');root.className='pnd-coach';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
    root.innerHTML='<div class="coach-shade"></div><div class="coach-ring" aria-hidden="true"></div><div class="coach-card"><div class="coach-top"><span class="coach-progress"></span><button class="coach-x" data-a="skip" aria-label="Close tour">×</button></div><h2></h2><p></p><div class="coach-actions"><button data-a="skip">Skip tour</button><button data-a="back">Back</button><a data-a="open">Open feature</a><button data-a="next">Next</button></div><div class="coach-arrow" aria-hidden="true"></div></div>';
    document.body.appendChild(root);const card=root.querySelector('.coach-card'),ring=root.querySelector('.coach-ring');let target=null;
    const clamp=(v,lo,hi)=>Math.max(lo,Math.min(Math.max(lo,hi),v));
    /*
     * Where the card goes.
     *
     * Everything here is in pixels the script has measured, and the card is
     * never moved by a percentage translate. It used to be: with no target the
     * card was centred with left:50% and translate(-50%,-50%), which is fine
     * until a stylesheet has an opinion about left. The phone breakpoint did --
     * it forced left:12px!important -- and nothing overrode the translate, so
     * the card sat 12px from the edge and was then dragged half its own width
     * off the left of the screen. On a 390px phone that put its Back and Open
     * buttons at -154px and -41px: the tutorial was unreadable and unusable on
     * every phone, and only on phones.
     */
    const put=(r)=>{
      const cw=Math.min(390,innerWidth-24);
      card.style.width=cw+'px';
      card.style.transform='none';
      /* Measured, not assumed: the old code tested against a hard-coded 190 and
         190 is not what the card is once its text wraps on a narrow screen. */
      const ch=card.offsetHeight||190;
      const maxL=innerWidth-cw-12,maxT=innerHeight-ch-12;
      let left,top,above=false;
      if(r){
        left=clamp(r.left+r.width/2-cw/2,12,maxL);
        const under=r.bottom+16,over=r.top-ch-16;
        if(under+ch+12<=innerHeight)top=under;
        else if(over>=12){top=over;above=true}
        /* Neither side has room -- a target taller than the screen minus the
           card. Pinned to whichever edge has more space, so it covers as
           little of the thing it describes as possible, rather than landing
           dead centre on top of it. */
        else if(innerHeight-r.bottom>=r.top)top=innerHeight-ch-12;
        else top=12;
      } else {
        left=(innerWidth-cw)/2;
        top=(innerHeight-ch)/2;
      }
      card.style.left=clamp(left,12,maxL)+'px';
      card.style.top=clamp(top,12,maxT)+'px';
      card.classList.toggle('above',above);
      /* The arrow points at what is being described, rather than at whatever
         happens to be under the middle of the card once it has been clamped. */
      card.classList.toggle('no-arrow',!r);
      if(r){const ax=clamp(r.left+r.width/2-clamp(left,12,maxL)-8,10,cw-24);card.style.setProperty('--arrow-x',ax+'px')}
    };
    /* A step whose target has not rendered yet is retried before it is given up
       on: the tour opens 650ms after load and the map it describes first is
       drawn from the feed, so on a slow connection every step fell through to
       the centred card with no highlight at all. */
    let tries=0;
    /* The first match that is actually on the page, not merely in the DOM.
       Several steps name both a header link and a card that do the same thing,
       and the header nav is display:none below 760px -- so on a phone
       querySelector handed back a hidden link, its rectangle was 0x0 at 0,0,
       and the tour drew a 14px highlight in the top-left corner and pointed
       the card at it. Three of the five steps did this on an iPhone 14. */
    const onScreen=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0};
    /* And not the tutorial's own furniture. draw() puts the step's fallback
       URL on the coach's "Open feature" anchor before place() goes looking,
       so a step whose selector names a link -- a[href="/forecasts"] -- finds
       that anchor sitting in the document with exactly that href. On a phone,
       where the real header link is display:none and skipped as off-screen,
       it was the only match left: on personal-risk step 4 ringed the coach's
       own Open feature button, and step 5 ringed where that button had been
       before put() moved the card. Measured at 390x844, both at 120x71.
       A tour that highlights itself also hides that it found nothing, because
       the missing-target retry never runs. */
    const pick=sel=>{const all=document.querySelectorAll(sel);
      for(let k=0;k<all.length;k++)if(!root.contains(all[k])&&onScreen(all[k]))return all[k];
      return null};
    const place=()=>{const st=steps[i];target=pick(st.sel);
      /* The previous step's highlight comes down before the next one goes up.
         It used to stay on screen for the whole scroll to the next target,
         ringing whatever happened to be underneath on the way -- and it left
         the tour with no state that says "this step is placed", so a checker
         waiting for a highlight saw the old one and measured mid-flight. */
      ring.style.display='none';
      if(!target){put(null);if(tries++<12)setTimeout(place,250);return}
      tries=0;
      /* A target taller than about half the screen is scrolled to the top
         rather than the middle, because centring it leaves no room either side
         for the card that describes it. */
      const r0=target.getBoundingClientRect();
      /* Centring a target only works if what is left either side can hold the
         card. A 300px map centred on a 667px phone leaves 183px a side and the
         card is 210, so it had nowhere to go but on top of the map. When
         centring would not leave room, the target goes to the top instead and
         the card sits under it. */
      const roomIfCentred=(innerHeight-r0.height)/2;
      /* matchMedia is not guaranteed: it is absent in the test harness, and
         asking for it unguarded threw a ReferenceError that took the whole
         tour down. A missing media-query API is not a reason to lose the
         tutorial; it just means the motion preference is unknown. */
      const reduced=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
      const smooth=reduced?'auto':'smooth';
      /* Scrolled by hand rather than with block:'start', which aligns the
         target flush to the top edge and leaves the highlight's own 7px
         outline above the screen. */
      /* Both scrolling calls are optional: neither exists in the test harness,
         and an environment without them should still get a placed card rather
         than a TypeError that kills the tour. Nothing below depends on the
         scroll having happened -- the position is measured afterwards either
         way. */
      try{
        if(roomIfCentred<246){if(typeof scrollTo==='function')scrollTo({top:Math.max(0,scrollY+r0.top-16),behavior:smooth})}
        else if(typeof target.scrollIntoView==='function')target.scrollIntoView({block:'center',inline:'center',behavior:smooth});
      }catch(e){ /* a harness without a scrolling view */ }
      /* Measured once the scroll has stopped, not 80ms after it started. A
         smooth scroll is still moving at 80ms, so the highlight was drawn
         around wherever the target happened to be mid-flight: on a 667px phone
         it landed at y=861, entirely below the screen, with the card dutifully
         positioned against it. */
      let lastY=null,still=0,frames=0;
      const settle=()=>{
        if(!target||!target.isConnected||!root.isConnected)return;
        frames++;
        const y=window.scrollY;
        if(lastY!==null&&Math.abs(y-lastY)<0.5)still++;else still=0;
        lastY=y;
        /* A smooth scroll has not necessarily started moving on the first
           frames, so an early run of identical positions is the page sitting
           still before the animation begins, not the animation having
           finished. Believing it put the highlight 865px down a 915px screen.
           Stability counts only after the scroll has had time to start. */
        if((frames<12||still<3)&&frames<90){raf(settle);return}
        const r=target.getBoundingClientRect(),pad=7;ring.style.display='block';ring.style.left=(r.left-pad)+'px';ring.style.top=(r.top-pad)+'px';ring.style.width=(r.width+pad*2)+'px';ring.style.height=(r.height+pad*2)+'px';put(r);
      };
      raf(settle);};
    const draw=()=>{const st=steps[i];root.querySelector('.coach-progress').textContent=`${i+1} of ${steps.length}`;root.querySelector('h2').textContent=st.title;root.querySelector('p').textContent=st.text;root.querySelector('[data-a=open]').href=st.fallback;root.querySelector('[data-a=back]').disabled=i===0;root.querySelector('[data-a=next]').textContent=i===steps.length-1?'Done':'Next';place()};
    const close=done=>{if(done)localStorage.setItem('pnd_tour_done','1');removeEventListener('resize',onResize);removeEventListener('orientationchange',onResize);root.remove();window.scrollTo({top:scrollY,behavior:'auto'});old&&old.focus&&old.focus()};
    root.addEventListener('click',e=>{const x=e.target.dataset.a;if(x==='skip')close(true);if(x==='back'&&i){i--;draw()}if(x==='next'){if(i===steps.length-1)close(true);else{i++;draw()}}});
    root.addEventListener('keydown',e=>{if(e.key==='Escape')close(true);if(e.key==='Tab'){const f=[...root.querySelectorAll('button:not([disabled]),a')];const n=f.indexOf(document.activeElement);if(e.shiftKey&&n<=0){e.preventDefault();f.at(-1).focus()}else if(!e.shiftKey&&n===f.length-1){e.preventDefault();f[0].focus()}}});
    /* Rotating the phone changes every number above, so this is not a
       one-shot listener any more; it is removed when the tour closes. */
    const onResize=()=>place();addEventListener('resize',onResize);addEventListener('orientationchange',onResize);
    draw();setTimeout(()=>root.querySelector('[data-a=next]').focus(),100)
  },
  replayTour(){localStorage.removeItem('pnd_tour_done');this.startTour(true)},
  nav(active=''){return `<header class="top"><a class="logo" href="/"><span class="globe">◎</span><span><b>Predict Natural Disasters</b><small>Data. Patterns. Forecasts. A Safer Tomorrow.</small></span></a><nav>${[['Home','/'],['Calamities','/calamities'],['Live Map','/live-map'],['Forecasts','/forecasts'],['Alerts','/alerts'],['Regions','/regions'],['Personal Risk','/personal-risk'],['Verification','/accuracy'],['Methodology','/methodology'],['Insights','/insights'],['About','/about']].map(([n,u])=>`<a class="${active===n?'active':''}" href="${u}">${n}</a>`).join('')}</nav><select id="pndTimezone" aria-label="Display timezone" onchange="PND.setTimezone(this.value)" style="max-width:150px;background:#09231b;color:#eaf7f1;border:1px solid #285f4b;border-radius:8px;padding:7px 8px;font-size:11px">${this.timezoneOptions()}</select><a class="live" href="/events">● Live</a></header>`;},
  sourceBadge(e){return `<span class="source" data-source="${this.esc(e&&e.source||'Source')}">${this.esc(e&&e.source||'Source')}</span>`;},
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
    if(!start)return 'Start not supplied by the source';
    const dur=this.duration(start,e&&e.targetEnd);
    return 'Starts '+this.fmtDate(start)+(dur?' · expected duration '+dur:' · duration not stated');
  },
  statusText(meta){if(!meta)return 'Refreshing';const all=Object.values(meta.sources||{});const n=all.filter(x=>x&&x.ok).length;/* The denominator was hard-coded to 3 while the feed grew to eight providers, so a healthy feed read "7/3 sources online". */return meta.live?`Live · ${n}/${all.length||n} sources online`:'Source outage · verified fallbacks only';},
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
  keyFactsLine(e,max){const f=this.keyFacts(e).filter(x=>x.reported).slice(0,max||3);
    return f.map(x=>this.esc(x.label)+' '+this.esc(String(x.value))).join(' · ');},
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
  /* data-keep-href opts a link out of canonicalisation. The not-found page needs it:
     its recovery link is deliberately in query form, and rewriting it back to the
     pretty URL the visitor just failed to open would send them straight back. */
  function normalizeLinks(root=document){root.querySelectorAll('a[href]:not([data-keep-href])').forEach(a=>{const old=a.getAttribute('href'),next=PND.canonicalDetailUrl(old);if(next&&next!==old)a.setAttribute('href',next);});}
  function normalizeRows(root=document){root.querySelectorAll(clickableSelectors).forEach(el=>{const href=PND.routeFromDataset(el);if(href)el.dataset.href=href;if(!el.dataset.href)return;el.dataset.href=PND.canonicalDetailUrl(el.dataset.href);el.style.cursor='pointer';el.style.pointerEvents='auto';el.title='Open independent detail page';el.setAttribute('role','link');el.setAttribute('tabindex','0');});root.querySelectorAll('.event,.riskitem,.calamity-card,.forecast-card,.alert-card,.region-card,.hazard-card,.historical-card').forEach(el=>{if(!el.dataset.href){const href=PND.routeFromDataset(el);if(href)el.dataset.href=href}if(el.dataset.href){el.dataset.href=PND.canonicalDetailUrl(el.dataset.href);el.style.cursor='pointer';el.style.pointerEvents='auto';el.setAttribute('role','link');el.setAttribute('tabindex','0');el.title='Open independent detail page';}});}
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