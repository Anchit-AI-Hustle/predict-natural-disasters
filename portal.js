const PND={
  timezone:localStorage.getItem('pnd_timezone')||'Asia/Kolkata',
  async getEvents(){
    const r=await fetch('/api/events?ts='+Date.now(),{cache:'no-store',headers:{'cache-control':'no-cache'}});if(!r.ok)throw new Error('Live feed unavailable');return r.json();
  },
  autoRefresh(fn,ms=60000){let busy=false;const run=async()=>{if(busy)return;busy=true;try{await fn()}finally{busy=false}};run();return setInterval(run,Math.min(ms,60000))},
  esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
  qs(k){return new URLSearchParams(location.search).get(k)||'';},
  tzLabel(tz=this.timezone){const aliases={'Asia/Kolkata':'IST','UTC':'UTC','America/New_York':'ET','America/Los_Angeles':'PT','Europe/London':'UK','Asia/Dubai':'GST','Asia/Singapore':'SGT','Asia/Tokyo':'JST','Australia/Sydney':'Sydney'};return aliases[tz]||tz;},
  fmtDate(v){if(!v)return '—';const d=new Date(v);if(isNaN(d))return v;return d.toLocaleString('en-IN',{timeZone:this.timezone,day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).replace(/\bam\b/i,'AM').replace(/\bpm\b/i,'PM')+' '+this.tzLabel();},
  fmtTime(v){if(!v)return '—';const d=new Date(v);if(isNaN(d))return v;return d.toLocaleTimeString('en-IN',{timeZone:this.timezone,hour:'numeric',minute:'2-digit',hour12:true}).replace(/\bam\b/i,'AM').replace(/\bpm\b/i,'PM')+' '+this.tzLabel();},
  age(v){if(!v)return 'unknown';const m=Math.max(0,Math.round((Date.now()-new Date(v))/60000));return m<1?'just now':m<60?`${m} min ago`:m<1440?`${Math.round(m/60)} hr ago`:`${Math.round(m/1440)} d ago`;},
  riskClass(v=''){v=String(v).toLowerCase();return v.includes('red')||v.includes('critical')?'critical':v.includes('orange')||v.includes('high')?'high':v.includes('purple')||v.includes('very')?'veryhigh':'moderate';},
  eventUrl(e){return '/event-detail?id='+encodeURIComponent(e.id||'')},
  setTimezone(tz){this.timezone=tz||'Asia/Kolkata';localStorage.setItem('pnd_timezone',this.timezone);location.reload();},
  initTimezonePicker(){const s=document.getElementById('pndTimezone');if(!s)return;const base=['Asia/Kolkata','UTC','America/New_York','America/Los_Angeles','Europe/London','Europe/Paris','Asia/Dubai','Asia/Singapore','Asia/Tokyo','Australia/Sydney'];let zones=base;try{if(Intl.supportedValuesOf)zones=Intl.supportedValuesOf('timeZone')}catch(e){}const preferred=[this.timezone,...base,...zones].filter((v,i,a)=>a.indexOf(v)===i);s.innerHTML=preferred.map(z=>`<option value="${this.esc(z)}" ${z===this.timezone?'selected':''}>${this.esc(z==='Asia/Kolkata'?'IST · India':z)}</option>`).join('');},
  nav(active=''){setTimeout(()=>this.initTimezonePicker(),0);return `<header class="top"><a class="logo" href="/"><span class="globe">◎</span><span><b>Predict Natural Disasters</b><small>Data. Patterns. Forecasts. A Safer Tomorrow.</small></span></a><nav>${[['Home','/'],['Calamities','/calamities'],['Live Map','/live-map'],['Forecasts','/forecasts'],['Alerts','/alerts'],['Regions','/regions'],['Verification','/verification'],['Methodology','/methodology'],['Insights','/insights'],['About','/about']].map(([n,u])=>`<a class="${active===n?'active':''}" href="${u}">${n}</a>`).join('')}</nav><select id="pndTimezone" aria-label="Display timezone" onchange="PND.setTimezone(this.value)" style="max-width:150px;background:#09231b;color:#eaf7f1;border:1px solid #285f4b;border-radius:8px;padding:7px 8px;font-size:11px"></select><a class="live" href="/events">● Live</a></header>`;},
  sourceBadge(e){return `<span class="source">${this.esc(e.source||'Source')}</span>`;},
  statusText(meta){if(!meta)return 'Refreshing';const n=Object.values(meta.sources||{}).filter(x=>x&&x.ok).length;return meta.live?`Live · ${n}/3 sources online`:'Source outage · verified fallbacks only';},
  impactText(e){const p=[];if(e.deaths)p.push(`${e.deaths.toLocaleString()} deaths`);if(e.displaced)p.push(`${e.displaced.toLocaleString()} displaced`);if(e.affected)p.push(`${e.affected.toLocaleString()} affected`);return p.join(' · ')},
  countryOptions(){let names=[];try{const dn=new Intl.DisplayNames(['en'],{type:'region'});for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b),name=dn.of(code);if(name&&name!==code&&!/Unknown Region/i.test(name))names.push(name)}}catch(e){}return [...new Set(names)].sort((a,b)=>a.localeCompare(b));}
};
window.PND=PND;
const __pndSetInterval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>__pndSetInterval(fn,Math.min(Number(ms)||60000,60000),...args);