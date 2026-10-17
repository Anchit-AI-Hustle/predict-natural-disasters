/* The search rules, in one place and loadable on their own.
   portal.js delegates to this, and the pages that do not load portal.js
   (the dashboard) load only this, so no page has to keep its own copy of
   the matching rules - which is how the field lists drifted apart in the
   first place. */
/* Wrapped, because a top-level const in a classic script becomes a global
   binding: an unwrapped `const S` here collided with the same name in a
   page's own inline script and killed that script outright. */
(function(){
const S={
  /* Kept identical to portal.js's; a test sweeps both over every code point
     that either one escapes, so the two copies cannot drift. */
  esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));},
  /* One search index for every page. Each page used to pick its own field
     subset, so the same word answered differently depending on where it was
     typed: the homepage's list omitted the hazard type entirely and matched 1
     of 349 earthquake records for "earthquake". */
  SEARCH_FIELDS:['title','name','country','affectedCountries','region','location','type','hazard',
    'source','src','details','summary','id','eventId'],
  /* Built once per record and cached off the enumerable keys, because a
     keystroke re-filters the whole feed. A refresh replaces the records, so
     the cache cannot outlive the data it describes. */
  searchText(e){
    if(!e||typeof e!=='object')return String(e==null?'':e).toLowerCase();
    if(e.__pndSearch)return e.__pndSearch;
    let t=S.SEARCH_FIELDS.map(k=>e[k])
      .filter(v=>v!==undefined&&v!==null&&v!=='').join(' ');
    const g=typeof window!=='undefined'&&window.__pndGlossary;
    /* Titles render with acronyms written out, so "California" has to find a
       record whose stored field only says "CA". */
    if(g&&g.expandAlways){try{t+=' '+g.expandAlways(t)}catch(err){}}
    t=t.toLowerCase();
    try{Object.defineProperty(e,'__pndSearch',{value:t,enumerable:false,configurable:true})}
    catch(err){}
    return t;
  },
  /* Every whitespace-separated term must appear, so "india flood" narrows the
     list instead of looking for that exact phrase. */
  matches(e,q){
    const terms=String(q==null?'':q).toLowerCase().split(/\s+/).filter(Boolean);
    if(!terms.length)return true;
    const t=S.searchText(e);
    return terms.every(w=>t.indexOf(w)>=0);
  },
  /* The query a reader typed, from either spelling of the parameter. The
     homepage sent them to /events?search=… and nothing on the receiving page
     ever read it, so every search from the front page arrived as an unfiltered
     list with an empty box. */
  searchParam(){
    if(typeof location==='undefined')return '';
    const p=new URLSearchParams(location.search);
    return p.get('q')||p.get('search')||'';
  },
  /* Seeds a search box from the URL and keeps the URL in step, so a result
     list can be linked to and a reload does not silently drop the query. */
  initSearch(id,draw){
    const el=typeof id==='string'?document.getElementById(id):id;
    if(!el)return null;
    const seed=S.searchParam();
    if(seed&&!el.value)el.value=seed;
    let t=null;
    el.addEventListener('input',()=>{
      clearTimeout(t);
      t=setTimeout(()=>{
        try{
          const u=new URL(location.href);
          if(el.value)u.searchParams.set('q',el.value);else u.searchParams.delete('q');
          u.searchParams.delete('search');
          history.replaceState(null,'',u);
        }catch(err){}
      },300);
      if(typeof draw==='function')draw();
    });
    return el;
  },
  /* Place-scoped match, for the controls that filter by geography rather than
     by free text: a region box must not match a record because the word
     appears in its source name or its narrative. */
  /* No title. It was included because a few records carry their place only
     there, but it made a geography box searchable by hazard text: 'flood'
     matched 323 of the live feed's 792 records through their titles, and
     /regions would then list flood records worldwide while its button
     opened a region named "flood". Measured against the same feed, only 2
     records have no country, region or location at all, and both are named
     storms whose titles are storm names rather than places. */
  PLACE_FIELDS:['country','affectedCountries','region','location'],
  matchesPlace(e,q){
    const terms=String(q==null?'':q).toLowerCase().split(/\s+/).filter(Boolean);
    if(!terms.length)return true;
    const t=S.PLACE_FIELDS.map(k=>e&&e[k])
      .filter(v=>v!==undefined&&v!==null&&v!=='').join(' ').toLowerCase();
    return terms.every(w=>t.indexOf(w)>=0);
  },
  /* An empty result is ambiguous - a broken box looks exactly like a feed with
     nothing in it. Say which one it is, and say it from the data rather than
     from a guess. */
  emptyHtml(query,pool,all,noun){
    const q=String(query==null?'':query).trim();
    const what=noun||'events';
    if(!q)return '<div class="card"><b>No '+S.esc(what)+' to show right now.</b></div>';
    const whole=Array.isArray(all)?all:(Array.isArray(pool)?pool:[]);
    const elsewhere=whole.filter(e=>S.matches(e,q)).length;
    let msg='<div class="card"><b>No '+S.esc(what)+' match “'+S.esc(q)+'”.</b>';
    if(elsewhere>0){
      msg+='<p class="muted">'+elsewhere+' other event'+(elsewhere===1?'':'s')+
        ' in our current data '+(elsewhere===1?'matches':'match')+' this search. This page shows only '+
        S.esc(what)+'.</p>'+
        '<p><a class="btn" href="/events?q='+encodeURIComponent(q)+
        '">See '+(elsewhere===1?'it':'all '+elsewhere)+' on the events page →</a></p>';
    }else{
      const countries=[];
      for(const e of whole){const c=e&&e.country;if(c&&countries.indexOf(c)<0)countries.push(c)}
      msg+='<p class="muted">Nothing in our current data matches it. Right now we have '+
        whole.length+' event'+(whole.length===1?'':'s')+' from '+countries.length+
        (countries.length===1?' country or territory':' countries and territories')+'. '+
        'We only show what official sources are reporting. If a place has no current '+
        'official report, it is not listed here. That does not mean nothing is happening there.</p>';
    }
    return msg+'</div>';
  },
};
if(typeof window!=='undefined')window.PNDSearch=S;
if(typeof module!=='undefined'&&module.exports)module.exports=S;
})();
