const PND={
  async getEvents(){
    const r=await fetch('/api/events?ts='+Date.now(),{cache:'no-store'}); if(!r.ok) throw new Error('Live feed unavailable'); return r.json();
  },
  esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
  qs(k){return new URLSearchParams(location.search).get(k)||'';},
  fmtDate(v){if(!v)return '—'; const d=new Date(v); return isNaN(d)?v:d.toLocaleString([], {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});},
  riskClass(v=''){v=String(v).toLowerCase();return v.includes('red')||v.includes('critical')?'critical':v.includes('orange')||v.includes('high')?'high':v.includes('purple')||v.includes('very')?'veryhigh':'moderate';},
  eventUrl(e){return '/event-detail?id='+encodeURIComponent(e.id||'')},
  nav(active=''){return `<header class="top"><a class="logo" href="/"><span class="globe">◎</span><span><b>Predict Natural Disasters</b><small>Data. Patterns. Forecasts. A Safer Tomorrow.</small></span></a><nav>${[['Home','/'],['Live Map','/live-map'],['Forecasts','/forecasts'],['Alerts','/alerts'],['Regions','/regions'],['Verification','/verification'],['Methodology','/methodology'],['Insights','/insights'],['About','/about']].map(([n,u])=>`<a class="${active===n?'active':''}" href="${u}">${n}</a>`).join('')}</nav><a class="live" href="/events">● Live</a></header>`;},
  sourceBadge(e){return `<span class="source">${this.esc(e.source||'Source')}</span>`;},
  statusText(meta){if(!meta)return 'Live'; return meta.live?'Live':'Cached fallback';}
};
window.PND=PND;