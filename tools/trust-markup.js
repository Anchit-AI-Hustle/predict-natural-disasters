#!/usr/bin/env node
'use strict';
/**
 * Write the trust note into every page's HTML.
 *
 *   node tools/trust-markup.js          rewrite the pages
 *   node tools/trust-markup.js --check  exit 1 if any page is out of date
 *
 * The note is drawn by trust.js's noteHtml() from the groups a page names on
 * its script tag (data-trust="feed models"), and carried in the page itself
 * so it is there at first paint: added by script, it moved the whole page
 * down after it had drawn. Every page also links trust.css, which styles the
 * note and the footer list.
 *
 * Where it goes: first in <main>, except on the homepage, where the risk
 * answer sits above <main> under the place-check controls, and on the track
 * record page, whose answer has to follow its title directly.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* trust.js as a page would load it, minus a document to draw into. */
function registry() {
  const win = { fetch: null };
  const doc = { currentScript: null, readyState: 'loading', addEventListener() {} };
  new Function('window', 'document', read('trust.js'))(win, doc);
  return win.PNDTrust;
}

const AFTER = {
  'index.html': html => {
    const at = html.indexOf('<div class="checkalt">');
    return at < 0 ? -1 : html.indexOf('</div>', at) + '</div>'.length;
  },
  'accuracy.html': html => {
    const at = html.indexOf('<header class="hero2">');
    return at < 0 ? -1 : html.indexOf('</p>', at) + '</p>'.length;
  }
};

function place(file, html, note) {
  const old = html.match(/<aside class="trust"[\s\S]*?<\/aside>/);
  if (old) return html.replace(old[0], () => note);
  let at = AFTER[file] ? AFTER[file](html) : -1;
  if (at < 0) {
    const m = html.match(/<main[^>]*>/);
    if (!m) throw new Error(file + ': no <main> to put the note in');
    at = m.index + m[0].length;
  }
  return html.slice(0, at) + note + html.slice(at);
}

function update(file, T) {
  let html = read(file);
  const tag = (html.match(/<script src="\/trust\.js"[^>]*><\/script>/) || [])[0];
  if (!tag) throw new Error(file + ': no trust.js');
  if (!/<link rel="stylesheet" href="\/trust\.css">/.test(html)) {
    html = html.replace(tag, () => '<link rel="stylesheet" href="/trust.css">' + tag);
  }
  const groups = ((tag.match(/data-trust="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(g => T.SOURCES[g]);
  if (groups.length) html = place(file, html, T.noteHtml(groups));
  return html;
}

if (require.main === module) {
  const T = registry();
  const check = process.argv.includes('--check');
  const stale = [];
  for (const f of fs.readdirSync(ROOT).filter(x => x.endsWith('.html')).sort()) {
    const next = update(f, T);
    if (next === read(f)) continue;
    if (check) stale.push(f); else fs.writeFileSync(path.join(ROOT, f), next);
  }
  if (check && stale.length) { console.error('out of date: ' + stale.join(', ')); process.exit(1); }
}

module.exports = { registry, update };
