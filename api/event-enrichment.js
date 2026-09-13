const TRUSTED_RELIEF = [
  {name:'IFRC / Red Cross Red Crescent',kind:'Relief network + emergency appeals',url:'https://www.ifrc.org/emergencies/all',donate:'https://www.ifrc.org/donate',note:'Global humanitarian network with country-level National Societies and active emergency appeals.'},
  {name:'UNICEF',kind:'Children + family emergency support',url:'https://www.unicef.org/emergencies',donate:'https://help.unicef.org/en/give-now',note:'Emergency response for children, families, health, water, nutrition and protection.'},
  {name:'UN World Food Programme',kind:'Food + logistics support',url:'https://www.wfp.org/emergencies',donate:'https://www.wfp.org/support-us',note:'Emergency food assistance and humanitarian logistics.'}
];

const COUNTRY_AUTHORITIES = {
  'vietnam': [{name:'Vietnam National Center for Hydro-Meteorological Forecasting',url:'https://nchmf.gov.vn/'},{name:'Vietnam Disaster and Dyke Management Authority',url:'https://phongchongthientai.mard.gov.vn/'}],
  'nepal': [{name:'Department of Hydrology and Meteorology Nepal',url:'https://www.dhm.gov.np/'},{name:'Nepal Red Cross Society',url:'https://nrcs.org/'}],
  'india': [{name:'National Disaster Management Authority India',url:'https://ndma.gov.in/'},{name:'India Meteorological Department',url:'https://mausam.imd.gov.in/'}],
  'philippines': [{name:'NDRRMC Philippines',url:'https://ndrrmc.gov.ph/'},{name:'PAGASA',url:'https://www.pagasa.dost.gov.ph/'}],
  'japan': [{name:'Japan Meteorological Agency',url:'https://www.jma.go.jp/jma/indexe.html'}],
  'united states': [{name:'FEMA',url:'https://www.fema.gov/'},{name:'National Weather Service',url:'https://www.weather.gov/'}],
  'indonesia': [{name:'BMKG Indonesia',url:'https://www.bmkg.go.id/'}]
};

function decodeXml(s=''){return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');}
function strip(s=''){return decodeXml(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();}
function pick(tag,block){const m=block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'));return m?decodeXml(m[1]).trim():'';}
function parseRss(xml,max=16){const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,max);return items.map(m=>{const b=m[1],title=strip(pick('title',b)),link=strip(pick('link',b)),pubDate=strip(pick('pubDate',b)),description=strip(pick('description',b)),source=strip(pick('source',b));return {title,link,pubDate,description,source};}).filter(x=>x.title&&x.link);}
function cleanTitle(t=''){return t.replace(/\s+-\s+[^-]{1,80}$/,'').trim();}
function dedupe(arr,key='link'){const seen=new Set();return arr.filter(x=>{const v=x[key]||x.title;if(!v||seen.has(v))return false;seen.add(v);return true;});}
async function getText(url,timeout=6500){const c=new AbortController();const timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{signal:c.signal,headers:{'user-agent':'Mozilla/5.0 PredictNaturalDisasters/1.0'}});if(!r.ok)throw new Error(String(r.status));return await r.text();}finally{clearTimeout(timer)}}
async function news(query){const u='https://news.google.com/rss/search?q='+encodeURIComponent(query)+'&hl=en-US&gl=US&ceid=US:en';try{return parseRss(await getText(u),18).map(x=>({...x,title:cleanTitle(x.title)}));}catch{return []}}
async function youtube(query){const url='https://www.youtube.com/results?search_query='+encodeURIComponent(query);try{const html=await getText(url);const out=[];const re=/"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,450}?"title":\{"runs":\[\{"text":"([^"]{2,180})"/g;let m;while((m=re.exec(html))&&out.length<12){out.push({id:m[1],title:decodeXml(m[2]),url:'https://www.youtube.com/watch?v='+m[1],thumbnail:'https://i.ytimg.com/vi/'+m[1]+'/hqdefault.jpg'});}return dedupe(out,'id');}catch{return []}}

export default async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=900');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const q=req.query||{};const title=String(q.title||'').slice(0,180),country=String(q.country||'').slice(0,80),type=String(q.type||'').slice(0,80),region=String(q.region||'').slice(0,120);
  if(!title&&!country&&!type)return res.status(400).json({error:'Missing event context'});
  const base=[title,type,country,region].filter(Boolean).join(' ');
  const newsQuery=`${base} disaster OR emergency OR flood OR earthquake OR cyclone OR wildfire OR landslide`;
  const videoQuery=`${base} disaster news`;
  const [latestNews,videos]=await Promise.all([news(newsQuery),youtube(videoQuery)]);
  const authority=COUNTRY_AUTHORITIES[country.toLowerCase()]||[];
  const searches={
    googleNews:'https://news.google.com/search?q='+encodeURIComponent(base),
    youtube:'https://www.youtube.com/results?search_query='+encodeURIComponent(videoQuery),
    ifrc:'https://www.ifrc.org/emergencies/all',
    gdacs:'https://www.gdacs.org/'
  };
  res.status(200).json({generatedAt:new Date().toISOString(),query:base,news:latestNews,videos,relief:TRUSTED_RELIEF,authorities:authority,searches,disclaimer:'Donation links shown are official organization destinations. Confirm the emergency/country designation on the receiving organization before donating. Emergency instructions must come from local authorities.'});
}
