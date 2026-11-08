'use strict';
/**
 * The outlook list, shared by every page that shows one.
 *
 * It lived inside collection.js, which only the /forecast-list page loads,
 * while the forecasts page kept its own grid of cards - the same records,
 * rendered two ways, with two sets of columns to drift apart. One renderer,
 * loaded by both.
 *
 * Loaded as a plain script in the browser (window.PNDForecastTable).
 */
(function (root) {

/*
 * One row per outlook, rather than a card the height of a paragraph.
 *
 * Thirty outlooks as cards ran to several screens of the same shape repeated,
 * and most of each card was prose that is identical on all of them. A list
 * this long is read by comparing rows - which window opens first, which are
 * independent predictions rather than continuations - and that is a table.
 * The prose it replaces is not deleted: every row opens the outlook's own
 * page, where the evidence and the grading rule are kept in full.
 *
 * On a phone the same rows are read as stacked cards, because a
 * ten-column table on a 320px screen is a horizontal scroll and nothing
 * else. The columns that do not survive that fold are the ones a reader can
 * get from the row they open: provenance, source and the update time. What
 * the fold adds is the window as one line and whether it is still open.
 */
var FORECAST_COLUMNS=['Risk','Forecast','Geography','Hazard','Starts','Ends','Class','Provenance','Source','Updated'];
var NARROW_COLUMNS=['Window','Status'];
/* What a reader sees at the head of each column. The keys above stay as they
   are: pages ask for columns by key, and the stylesheet sizes each column by
   its key. On a phone a cell's data-label is printed beside it, so it carries
   the reader's word too - except for the columns the phone fold hides, which
   portal.css finds by data-label and whose label is never shown there. */
var HEADINGS={Risk:'Risk',Forecast:'Forecast',Geography:'Place',Hazard:'Hazard',
 Starts:'Starts',Ends:'Ends',Class:'Kind of forecast',Provenance:'What it is',
 Source:'Source',Updated:'Updated',Window:'Dates',Status:'Status'};
var FOLDED_ON_PHONE=['Starts','Ends','Provenance','Source','Updated'];
function headingOf(key){return HEADINGS[key]||key}
function dataLabelOf(key){return FOLDED_ON_PHONE.indexOf(key)>=0?key:headingOf(key)}
function provenanceOf(e){
 if(window.PND&&PND.provenanceOf)return PND.provenanceOf(e);
 if(!e.forecast)return 'Official report';
 if(e.forecastKind==='frozen-benchmark')return 'Test case';
 if(e.forecastOf)return 'Our estimate';
 return 'Our own estimate';
}
function classLabel(e){
 const M=window.PNDHazards&&PNDHazards.FORECAST_CLASSES;
 const k=e.forecastClass&&M&&M[e.forecastClass];
 return k?k.label:(e.forecastClass?String(e.forecastClass):'Not recorded');
}
function classTitle(e){
 const M=window.PNDHazards&&PNDHazards.FORECAST_CLASSES;
 const k=e.forecastClass&&M&&M[e.forecastClass];
 return k?k.definition:'We did not record what kind of forecast this is.';
}
/* Each column carries its own class, so the stylesheet can size it: with
   ten columns shared out evenly the outlook's name got a tenth of the row
   and broke after every few letters, while a two-word hazard had the same
   room as a paragraph of geography. */
function colClass(label){return 'c-'+String(label).toLowerCase()}
function cell(label,html,cls){
 return '<td data-label="'+PND.esc(dataLabelOf(label))+'" class="'+colClass(label)+(cls?' '+cls:'')+'">'+html+'</td>';
}
/* Every derived outlook's source reads "Predict Natural Disasters \u00b7
   derived from" an agency, and the Provenance column already says it is a
   model outlook - so the row names the agency, and the full attribution
   stays in the tooltip and on the outlook's own page. */
function sourceText(e){
 const full=String(e.source||'');
 const m=/^Predict Natural Disasters\s*\u00b7\s*derived from\s+(.+)$/i.exec(full);
 return m?'From '+m[1]:full;
}
/* A page that shows the list in a narrower column asks for fewer columns
   rather than scrolling sideways inside its own panel: the row opens the
   outlook, where everything left out is kept. */
function columnsFor(opts){
 var want=opts&&opts.columns;
 if(!want||!want.length)return FORECAST_COLUMNS;
 return FORECAST_COLUMNS.filter(function(c){return want.indexOf(c)>=0});
}
function forecastRow(e,opts){
 var cols=columnsFor(opts);
 var want=function(c){return cols.indexOf(c)>=0};
 /* The place once: "Hanoi, Vietnam \u00b7 Vietnam" repeated the country. */
 const geo=(window.PND&&PND.placeOf)?PND.placeOf(e,'Global'):([e.region,e.country].filter(Boolean).join(' \u00b7 ')||'Global');
 const win=e.targetStart||e.targetEnd?PND.windowText(e):'No dates recorded';
 const status=!e.forecast?'Reported event':(e.windowClosed?'Ended':'Active');
 var html={
  Risk:PND.riskTag(e),
  /* A real link, not only a clickable row: a row opens on click and on
     Enter, but it cannot be opened in a new tab, copied, or read out as a
     link by a screen reader. The name of the thing is the link. */
  Forecast:'<a href="'+PND.eventUrl(e)+'"><b>'+PND.esc(PND.titleOf(e))+'</b></a>',
  /* Clamped to three lines, whole in the tooltip: a US warning's area is a
     list of every county it names, and ran a single row to a screen. */
  Geography:'<span class="clamp" title="'+PND.esc(geo)+'">'+PND.esc(geo)+'</span>',
  Hazard:PND.esc(e.type||'-'),
  Starts:e.targetStart?PND.esc(PND.fmtWhen(e.targetStart,e.targetEnd)):'-',
  Ends:e.targetEnd?PND.esc(PND.fmtWhen(e.targetEnd,e.targetStart,'end')):'-',
  Class:'<span title="'+PND.esc(classTitle(e))+'">'+PND.esc(classLabel(e))+'</span>',
  Provenance:'<span class="prov">'+PND.esc(provenanceOf(e))+'</span>',
  Source:e.source?'<span title="'+PND.esc(e.source)+'">'+PND.esc(sourceText(e))+'</span>':'-',
  Updated:'<span title="'+PND.esc(PND.fmtDate(e.updated))+'">'+PND.esc(PND.age(e.updated))+'</span>'
 };
 return '<tr data-href="'+PND.eventUrl(e)+'">'+
  cols.map(function(c){return cell(c,html[c])}).join('')+
  cell('Window',PND.esc(win),'only-narrow')+
  cell('Status',PND.esc(status),'only-narrow')+
 '</tr>';
}
function forecastTable(list,opts){
 const cols=columnsFor(opts);
 const head=cols.map(c=>'<th scope="col" class="'+colClass(c)+'">'+PND.esc(headingOf(c))+'</th>').join('')+
  NARROW_COLUMNS.map(c=>'<th scope="col" class="'+colClass(c)+' only-narrow">'+PND.esc(headingOf(c))+'</th>').join('');
 return '<div class="tablewrap"><table class="table ftable"><caption class="sr-only">'+
  'Forecasts, one per row. Select a row to see its details.'+
  '</caption><thead><tr>'+head+'</tr></thead><tbody>'+
  list.map(function(e){return forecastRow(e,opts)}).join('')+'</tbody></table></div>';
}

  root.PNDForecastTable = {
    COLUMNS: FORECAST_COLUMNS,
    NARROW_COLUMNS: NARROW_COLUMNS,
    render: forecastTable,
    row: forecastRow,
    provenanceOf: provenanceOf,
    sourceText: sourceText
  };
})(typeof window !== 'undefined' ? window : this);
