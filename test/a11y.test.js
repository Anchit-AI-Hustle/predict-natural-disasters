'use strict';
/*
 * Can the site be operated by someone who cannot see it?
 *
 * Measured in Chromium (tools/a11y-nav-check.js), 18 of the site's 21 index
 * pages had at least one control with no accessible name: every search box on
 * the site, every hazard and alert-level filter, every sort control, and the
 * latitude and longitude fields on the personal risk page. A placeholder is
 * not a name - it is a hint that disappears the moment anything is typed, and
 * a <select> is not named by the options inside it - so a screen reader
 * announced most of this site's controls as "edit text" and "combo box".
 *
 * That is a static property of the markup, so it is held here rather than in
 * the browser tool: the tool measures the rendered page and this stops the
 * markup regressing without one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html')).sort();
const docOf = f => new JSDOM(fs.readFileSync(path.join(ROOT, f), 'utf8')).window.document;

/* The accessible name of a form control, by the rules a screen reader uses:
   aria-label, aria-labelledby, an associated <label>, or title. Never the
   placeholder, and never the text inside the element. */
function named(doc, c) {
  if ((c.getAttribute('aria-label') || '').trim()) return true;
  const by = c.getAttribute('aria-labelledby');
  if (by && by.split(/\s+/).some(id => doc.getElementById(id))) return true;
  if (c.id && doc.querySelector('label[for="' + c.id.replace(/"/g, '\\"') + '"]')) return true;
  if (c.closest('label') && (c.closest('label').textContent || '').trim()) return true;
  if ((c.getAttribute('title') || '').trim()) return true;
  return false;
}

test('every control on every page has a name a screen reader can announce', () => {
  const unnamed = [];
  for (const f of PAGES) {
    const doc = docOf(f);
    doc.querySelectorAll('input,select,textarea').forEach(c => {
      if (c.type === 'hidden') return;
      if (!named(doc, c)) {
        unnamed.push(f + ' ' + c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') +
          (c.getAttribute('placeholder') ? ' (placeholder "' + c.getAttribute('placeholder') + '" is not a name)' : ''));
      }
    });
  }
  assert.deepEqual(unnamed, [],
    unnamed.length + ' control(s) would be announced with no name:\n  ' + unnamed.join('\n  '));
});

test('a control is never named by the text inside it', () => {
  /* The trap this test exists for: the first version of the browser sweep
     fell back to textContent, so a <select> full of options looked named and
     every filter on the site passed. */
  const doc = docOf('events.html');
  const sel = doc.getElementById('level');
  assert.ok(sel, 'fixture: the risk-level filter should exist');
  /* The levels are filled in from the one scale at load, so in the static
     document this select carries a marker rather than its options. Either
     shape is a control whose name cannot come from its contents. */
  const filled = sel.options.length > 1;
  const marked = [...sel.childNodes].some(n => n.nodeType === 8 && String(n.data).trim() === 'risk-levels');
  assert.ok(filled || marked, 'fixture: it should have options, or the marker they are filled from');
  assert.ok((sel.getAttribute('aria-label') || '').trim(),
    'the risk-level filter relies on its option text for a name');
  assert.equal(/All risk levels|Red|Orange|Severe|Moderate/.test(sel.getAttribute('aria-label')), false,
    'the name is a list of the options rather than what the control does');
});

test('every page announces its language, its title and one heading', () => {
  const problems = [];
  const titles = new Map();
  for (const f of PAGES) {
    const doc = docOf(f);
    if (!doc.documentElement.getAttribute('lang')) problems.push(f + ': no lang on <html>');
    const title = (doc.title || '').trim();
    if (!title) problems.push(f + ': no <title>');
    else if (titles.has(title)) problems.push(f + ': the same <title> as ' + titles.get(title));
    else titles.set(title, f);
    const h1 = doc.querySelectorAll('h1');
    if (h1.length !== 1) problems.push(f + ': ' + h1.length + ' <h1> elements');
    if (!doc.querySelector('main')) problems.push(f + ': no <main> landmark');
  }
  assert.deepEqual(problems, [], problems.join('\n  '));
});

test('no page takes an element out of the tab order it belongs in', () => {
  const problems = [];
  for (const f of PAGES) {
    docOf(f).querySelectorAll('[tabindex]').forEach(el => {
      if (Number(el.getAttribute('tabindex')) > 0) {
        problems.push(f + ': ' + el.tagName.toLowerCase() + ' tabindex=' + el.getAttribute('tabindex'));
      }
    });
  }
  assert.deepEqual(problems, [],
    'a positive tabindex jumps the reading order:\n  ' + problems.join('\n  '));
});

test('every image says what it shows, or says it shows nothing', () => {
  const problems = [];
  for (const f of PAGES) {
    docOf(f).querySelectorAll('img').forEach(i => {
      if (i.getAttribute('aria-hidden') === 'true') return;
      if (i.getAttribute('alt') === null) problems.push(f + ': <img src="' + (i.getAttribute('src') || '') + '">');
    });
  }
  assert.deepEqual(problems, [], problems.join('\n  '));
});
