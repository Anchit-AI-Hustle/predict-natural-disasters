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
function provenanceOf(e){
 if(!e.forecast)return 'Observed event';
 if(e.forecastKind==='frozen-benchmark')return 'Frozen benchmark';
 if(e.forecastOf)return 'Model outlook';
 return 'Experimental forecast';
}
function classLabel(e){
 const M=window.PNDHazards&&PNDHazards.FORECAST_CLASSES;
 const k=e.forecastClass&&M&&M[e.forecastClass];
 return k?k.label:(e.forecastClass?String(e.forecastClass):'Not classified');
}
function classTitle(e){
 const M=window.PNDHazards&&PNDHazards.FORECAST_CLASSES;
 const k=e.forecastClass&&M&&M[e.forecastClass];
 return k?k.definition:'This outlook carries no recorded class.';
}
function cell(label,html,cls){
 return '<td data-label="'+PND.esc(label)+'"'+(cls?' class="'+cls+'"':'')+'>'+html+'</td>';
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
 const geo=[e.region,e.country].filter(Boolean).join(' \u00b7 ')||'Global';
 const win=e.targetStart||e.targetEnd?PND.windowText(e):'No window recorded';
 const status=!e.forecast?'Observed':(e.windowClosed?'Window closed':'Window open');
 var html={
  Risk:PND.riskTag(e),
  /* A real link, not only a clickable row: a row opens on click and on
     Enter, but it cannot be opened in a new tab, copied, or read out as a
     link by a screen reader. The name of the thing is the link. */
  Forecast:'<a href="'+PND.eventUrl(e)+'"><b>'+PND.esc(e.title)+'</b></a>',
  Geography:PND.esc(geo),
  Hazard:PND.esc(e.type||'\u2014'),
  Starts:e.targetStart?PND.esc(PND.fmtDate(e.targetStart)):'\u2014',
  Ends:e.targetEnd?PND.esc(PND.fmtDate(e.targetEnd)):'\u2014',
  Class:'<span title="'+PND.esc(classTitle(e))+'">'+PND.esc(classLabel(e))+'</span>',
  Provenance:'<span class="prov">'+PND.esc(provenanceOf(e))+'</span>',
  Source:PND.esc(e.source||'\u2014'),
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
 const head=cols.map(c=>'<th scope="col">'+c+'</th>').join('')+
  NARROW_COLUMNS.map(c=>'<th scope="col" class="only-narrow">'+c+'</th>').join('');
 return '<div class="tablewrap"><table class="table ftable"><caption class="sr-only">'+
  'Recorded outlooks, one row each. Every row opens that outlook\u2019s own page.'+
  '</caption><thead><tr>'+head+'</tr></thead><tbody>'+
  list.map(function(e){return forecastRow(e,opts)}).join('')+'</tbody></table></div>';
}

  root.PNDForecastTable = {
    COLUMNS: FORECAST_COLUMNS,
    NARROW_COLUMNS: NARROW_COLUMNS,
    render: forecastTable,
    row: forecastRow,
    provenanceOf: provenanceOf
  };
})(typeof window !== 'undefined' ? window : this);
