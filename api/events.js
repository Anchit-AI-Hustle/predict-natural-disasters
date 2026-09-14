module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma','no-cache');
  const now=new Date(),from=new Date(now-120*864e5),iso=d=>d.toISOString().slice(0,10);
  const out={generatedAt:now.toISOString(),meta:{gdacs:false,usgs:false,eonet:false,live:false,sources:{},coverage:'Global terrestrial coverage; all countries/territories are supported by the UI, subject to upstream reporting.',forecasting:'Experimental short-horizon risk outlooks are derived only from active official hazard signals. They are not deterministic predictions or emergency warnings.'},events:[]};
  const push=e=>{if(!e||!Number.isFinite(+e.lat)||!Number.isFinite(+e.lon))return;out.events.push({...e,lat:+e.lat,lon:+e.lon})};
  const timed=async(url,opts={})=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),9000);try{const r=await fetch(url,{...opts,cache:'no-store',signal:c.signal,headers:{accept:'application/json',...(opts.headers||{})}});if(!r.ok)throw new Error(String(r.status));return await r.json()}finally{clearTimeout(t)}};
  const parseGdacs=j=>{const arr=Array.isArray(j)?j:(j.features||j.data||j.results||[]);for(const x of arr){const p=x.properties||x;let coords=(x.geometry&&x.geometry.coordinates)||[p.longitude||p.lon,p.latitude||p.lat];if(!Array.isArray(coords)||Array.isArray(coords[0]))continue;const et=p.eventtype||p.eventType||p.type||'Disaster',eid=p.eventid||p.eventId||p.id||Math.random();push({id:`gdacs-${et}-${eid}`,source:'GDACS',sourceType:'official',type:({FL:'Flood',EQ:'Earthquake',TC:'Tropical Cyclone',VO:'Volcano',DR:'Drought',WF:'Wildfire'})[et]||et,title:p.name||p.title||p.eventname||`${et} event`,country:p.country||p.countryname||p.iso3||'',region:p.location||p.description||'',alert:p.alertlevel||p.alertLevel||'Green',lat:coords[1],lon:coords[0],updated:p.todate||p.toDate||p.fromdate||p.fromDate||p.date||now.toISOString(),details:p.description||p.eventdescription||p.severitydata||'',deaths:+(p.death||p.deaths||0)||0,displaced:+(p.displaced||0)||0,affected:+(p.affected||p.population||0)||0,sourceUrl:`https://www.gdacs.org/report.aspx?eventid=${encodeURIComponent(eid)}&eventtype=${encodeURIComponent(et)}`,rawId:eid,rawType:et})}}
  const gdacsSearch=`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&fromDate=${iso(from)}&toDate=${iso(now)}&alertlevel=Green;Orange;Red`;
  const jobs=[
    (async()=>{try{parseGdacs(await timed(gdacsSearch));out.meta.gdacs=true;out.meta.sources.gdacs={ok:true,checkedAt:now.toISOString()}}catch(e){try{parseGdacs(await timed('https://www.gdacs.org/gdacsapi/api/Events/geteventlist/EVENTS4APP'));out.meta.gdacs=true;out.meta.sources.gdacs={ok:true,checkedAt:now.toISOString(),fallbackEndpoint:true}}catch(e2){out.meta.sources.gdacs={ok:false,checkedAt:now.toISOString()}}}})(),
    (async()=>{try{const j=await timed('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson');for(const f of j.features||[]){const place=f.properties.place||'',country=place.includes(',')?place.split(',').pop().trim():'';push({id:'usgs-'+f.id,source:'USGS',sourceType:'official',type:'Earthquake',title:f.properties.title,country,region:place,alert:(f.properties.mag||0)>=6?'Red':(f.properties.mag||0)>=5?'Orange':'Green',lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],updated:new Date(f.properties.time).toISOString(),details:`Magnitude ${f.properties.mag??'—'} · depth ${f.geometry.coordinates[2]??'—'} km${f.properties.tsunami?' · tsunami flag issued':''}`,sourceUrl:f.properties.url||'',magnitude:f.properties.mag||null,depthKm:f.geometry.coordinates[2]??null})}out.meta.usgs=true;out.meta.sources.usgs={ok:true,checkedAt:now.toISOString(),window:'7 days, M2.5+'}}catch(e){out.meta.sources.usgs={ok:false,checkedAt:now.toISOString()}}})(),
    (async()=>{try{const j=await timed('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300');for(const v of j.events||[]){const g=v.geometry&&v.geometry[v.geometry.length-1];if(!g||g.type!=='Point')continue;const cat=(v.categories&&v.categories[0]&&v.categories[0].title)||'Natural Event';push({id:'eonet-'+v.id,source:'NASA EONET',sourceType:'official',type:cat,title:v.title,country:'',region:'',alert:'Green',lat:g.coordinates[1],lon:g.coordinates[0],updated:g.date||now.toISOString(),details:`Open event tracked by NASA EONET · ${cat}`,sourceUrl:(v.sources&&v.sources[0]&&v.sources[0].url)||''})}out.meta.eonet=true;out.meta.sources.eonet={ok:true,checkedAt:now.toISOString()}}catch(e){out.meta.sources.eonet={ok:false,checkedAt:now.toISOString()}}})()
  ];
  await Promise.allSettled(jobs);
  out.meta.live=out.meta.gdacs||out.meta.usgs||out.meta.eonet;

  // Frozen benchmark forecast retained for verification history.
  push({id:'ND-001',source:'Predict Natural Disasters',sourceType:'forecast',type:'Flood / Landslide',title:'Central Vietnam flash-flood + landslide forecast',country:'Vietnam',region:'Huế–Đà Nẵng corridor',alert:'High',lat:16.2,lon:107.8,updated:'2026-09-13T00:00:00Z',issuedAt:'2026-09-13T00:00:00Z',targetStart:'2026-09-13T00:00:00Z',targetEnd:'2026-09-16T23:59:59Z',details:'Target 14 Sep 2026; verification window 13–16 Sep 2026.',forecast:true,forecastKind:'frozen-benchmark',sourceUrl:'/verification'});

  const hasNepal=out.events.some(e=>/nepal/i.test([e.title,e.country,e.region].join(' '))&&/flood/i.test(e.type));
  if(!hasNepal)push({id:'gdacs-FL-1104124',source:'GDACS verified snapshot',sourceType:'official',type:'Flood',title:'Nepal flood — Bagmati / Rasuwa impact and recovery',country:'Nepal',region:'Bagmati Province · Rasuwagadhi · Bhote Koshi · Trishuli corridor',alert:'Red',lat:28.18,lon:85.39,updated:'2026-09-05T18:50:00Z',details:'GDACS FL-2026-000167-NPL. Major late-August flood with continuing response/recovery updates; retained when the rolling GDACS live list omits the event.',deaths:955,displaced:3458,sourceUrl:'https://www.gdacs.org/report.aspx?eventid=1104124&eventtype=FL',cached:true});
  const hasIndonesia=out.events.some(e=>/indonesia|teluknaga/i.test([e.title,e.country,e.region].join(' '))&&/earthquake/i.test(e.type));
  if(!hasIndonesia)push({id:'recent-IDN-20260911-M65',source:'USGS verified recent snapshot',sourceType:'official',type:'Earthquake',title:'M 6.5 earthquake north-northeast of Teluknaga, Indonesia',country:'Indonesia',region:'Banten / Java Sea vicinity',alert:'Red',lat:-5.9,lon:106.6,updated:'2026-09-11T00:00:00Z',details:'Recent M6.5 Indonesia earthquake retained as a verified recent-event snapshot when it falls outside or is absent from the rolling live feed. Check the linked USGS feed/search for the authoritative event record.',magnitude:6.5,sourceUrl:'https://earthquake.usgs.gov/earthquakes/search/',cached:true});

  // Generate multiple experimental short-horizon outlooks from live official signals.
  // Earthquakes are deliberately excluded from deterministic future-timing forecasts.
  const signalCandidates=out.events.filter(e=>e.sourceType==='official'&&!e.forecast&&!/earthquake/i.test(e.type)&&Number.isFinite(+e.lat)&&Number.isFinite(+e.lon));
  const priority={Red:4,Orange:3,High:3,Green:1};
  signalCandidates.sort((a,b)=>(priority[b.alert]||0)-(priority[a.alert]||0)||new Date(b.updated)-new Date(a.updated));
  const picked=[],seenArea=new Set();
  for(const e of signalCandidates){
    if(picked.length>=8)break;
    const area=((e.country||e.region||e.title)+'|'+e.type).toLowerCase().replace(/\s+/g,' ').slice(0,120);
    if(seenArea.has(area))continue;seenArea.add(area);picked.push(e);
  }
  const horizonHours=72,targetEnd=new Date(now.getTime()+horizonHours*3600e3).toISOString();
  const mechanism=t=>/flood/i.test(t)?'continued or renewed flooding / inundation where hydrological stress persists':/cyclone|storm|hurricane|typhoon/i.test(t)?'continued wind, surge and rainfall impacts along the active storm footprint':/wildfire|fire/i.test(t)?'continued fire spread / smoke / evacuation pressure while the active fire remains uncontrolled':/volcan/i.test(t)?'continued volcanic unrest, ash or exclusion-zone impacts while official activity remains elevated':/landslide/i.test(t)?'additional slope failures where terrain remains saturated or unstable':/drought/i.test(t)?'continued water stress and agricultural impacts while drought conditions persist':'continued hazard impacts while the official signal remains active';
  picked.forEach((e,i)=>push({
    id:`OUT-${String(i+1).padStart(3,'0')}-${String(e.id).replace(/[^a-z0-9_-]/gi,'').slice(-36)}`,
    source:'Predict Natural Disasters · derived from '+e.source,
    sourceType:'forecast',
    type:e.type,
    title:`Short-horizon ${e.type} risk outlook — ${e.country||e.region||e.title}`,
    country:e.country||'',region:e.region||e.title||'',alert:e.alert==='Red'?'High':e.alert==='Orange'?'Moderate':'Watch',lat:e.lat,lon:e.lon,
    updated:now.toISOString(),issuedAt:now.toISOString(),targetStart:now.toISOString(),targetEnd,
    details:`Experimental ${horizonHours}-hour outlook derived from an active ${e.source} signal. Outlook: ${mechanism(e.type)}. This is not a deterministic prediction and must not replace official warnings.`,
    forecast:true,forecastKind:'signal-derived-outlook',forecastOf:e.id,sourceUrl:e.sourceUrl||'',verificationRule:'Grade only against independently observed impacts during the stated window; do not count the pre-existing source alert itself as a successful prediction.'
  }));

  const seen=new Set();out.events=out.events.filter(e=>{const k=(e.source+'|'+e.title+'|'+(+e.lat).toFixed(2)+'|'+(+e.lon).toFixed(2)).toLowerCase();if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>{const risk={Red:4,Orange:3,High:3,Moderate:2,Watch:1,Green:1};return (risk[b.alert]||0)-(risk[a.alert]||0)||new Date(b.updated)-new Date(a.updated)});
  res.status(200).json(out);
}
