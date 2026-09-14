import {GLOBAL_RELIEF,COUNTRY_SUPPORT,countryKey} from './verified-support.js';

function decodeXml(s=''){return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>')}
function strip(s=''){return decodeXml(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim()}
function pick(tag,block){const m=block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'));return m?decodeXml(m[1]).trim():''}
function parseRss(xml,max=20){return[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0,max).map(m=>{const b=m[1];return{title:strip(pick('title',b)),link:strip(pick('link',b)),pubDate:strip(pick('pubDate',b)),description:strip(pick('description',b)),source:strip(pick('source',b))}}).filter(x=>x.title&&x.link)}
function cleanTitle(t=''){return t.replace(/\s+-\s+[^-]{1,80}$/,'').trim()}
function dedupe(arr,key='link'){const seen=new Set();return arr.filter(x=>{const v=x[key]||x.title;if(!v||seen.has(v))return false;seen.add(v);return true})}
async function getText(url,timeout=7000){const c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(url,{signal:c.signal,headers:{'user-agent':'Mozilla/5.0 PredictNaturalDisasters/1.0'}});if(!r.ok)throw new Error(String(r.status));return await r.text()}finally{clearTimeout(timer)}}
async function news(query){const u='https://news.google.com/rss/search?q='+encodeURIComponent(query)+'&hl=en-US&gl=US&ceid=US:en';try{return parseRss(await getText(u),20).map(x=>({...x,title:cleanTitle(x.title)}))}catch{return[]}}
async function youtube(query){const url='https://www.youtube.com/results?search_query='+encodeURIComponent(query);try{const html=await getText(url),out=[];const re=/"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,450}?"title":\{"runs":\[\{"text":"([^"]{2,180})"/g;let m;while((m=re.exec(html))&&out.length<12)out.push({id:m[1],title:decodeXml(m[2]),url:'https://www.youtube.com/watch?v='+m[1],thumbnail:'https://i.ytimg.com/vi/'+m[1]+'/hqdefault.jpg'});return dedupe(out,'id')}catch{return[]}}

export default async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const q=req.query||{},title=String(q.title||'').slice(0,180),country=String(q.country||'').slice(0,80),type=String(q.type||'').slice(0,80),region=String(q.region||'').slice(0,120);
  if(!title&&!country&&!type)return res.status(400).json({error:'Missing event context'});
  const base=[title,type,country,region].filter(Boolean).join(' '),newsQuery=`${base} disaster OR emergency OR flood OR earthquake OR cyclone OR wildfire OR landslide`,videoQuery=`${base} disaster news`;
  const[latestNews,videos]=await Promise.all([news(newsQuery),youtube(videoQuery)]),support=COUNTRY_SUPPORT[countryKey(country)]||{authorities:[],contacts:[]};
  const searches={googleNews:'https://news.google.com/search?q='+encodeURIComponent(base),youtube:'https://www.youtube.com/results?search_query='+encodeURIComponent(videoQuery),gdacs:'https://www.gdacs.org/',reliefweb:'https://reliefweb.int/search?search='+encodeURIComponent(base),ocha:'https://www.unocha.org/',ifrc:'https://www.ifrc.org/emergencies/all'};
  res.status(200).json({generatedAt:new Date().toISOString(),query:base,news:latestNews,videos,relief:GLOBAL_RELIEF,authorities:support.authorities,contacts:support.contacts,searches,coverage:{refreshTarget:'5 minutes',news:'Google News RSS',videos:'YouTube public search',humanitarian:['IFRC','UNICEF','WFP','UNHCR','UN Crisis Relief','ReliefWeb','OCHA']},disclaimer:'Only verified official emergency numbers are displayed. If no verified number is available, use the linked national authority or local emergency service. Donation links point to official organization domains; confirm the relevant emergency/country before donating.'});
}
