'use strict';
/*
 * Rules that keep a page from scrolling sideways.
 *
 * jsdom reports every rectangle as zero, so nothing in this suite can measure
 * a layout. What it can do is check the rules that produced the measurements,
 * which is what tools/layout-browser-check.js found in a real browser: every
 * page in the repository overflowed somewhere, up to 252px on a 360px phone.
 *
 * These are written against the two mistakes behind that, so that a third
 * copy of the header, or a new panel holding a map, cannot quietly bring it
 * back:
 *
 *   1. a header laid out as a flex row that cannot wrap. There were three
 *      copies of it - portal.css, app-pages.css and index.html's own style -
 *      and all three had it.
 *   2. a grid or flex item left at its automatic minimum size, which is its
 *      content's. .map asks for a 600px minimum, because width:100% with
 *      aspect-ratio 2/1 and a 300px height floor cannot be narrower than
 *      twice that floor.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Every stylesheet in the repository, plus the <style> blocks inside pages. */
function sheets() {
  const out = [];
  for (const f of fs.readdirSync(ROOT)) {
    const p = path.join(ROOT, f);
    if (f.endsWith('.css')) { out.push({ file: f, css: fs.readFileSync(p, 'utf8') }); continue; }
    if (!f.endsWith('.html')) continue;
    const html = fs.readFileSync(p, 'utf8');
    const blocks = html.match(/<style>([\s\S]*?)<\/style>/g) || [];
    if (blocks.length) out.push({ file: f, css: blocks.join('\n') });
  }
  return out;
}

/* Every rule block whose selector list names this exact selector. Crude, and
   deliberately so: a parser that understood the whole grammar would also need
   testing, and these stylesheets are written in one flat style. */
function blocksFor(css, selector) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sels = m[1].split(',').map(s => s.trim().replace(/^.*[{}]\s*/, ''));
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out;
}

const declares = (block, prop) => new RegExp('(^|;)\\s*' + prop + '\\s*:', 'i').test(block);
const valueOf = (block, prop) => {
  const m = block.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i'));
  return m ? m[1].trim() : null;
};

/* ------------------------------------------------------- the site header */

test('every copy of the site header is allowed to wrap', () => {
  const found = [];
  for (const { file, css } of sheets()) {
    const blocks = blocksFor(css, '.top');
    const base = blocks.filter(b => declares(b, 'display'));
    if (!base.length) continue;
    found.push(file);
    for (const b of base) {
      assert.match(valueOf(b, 'display'), /flex/,
        file + ': .top is no longer a flex row, so this test needs rewriting');
      assert.equal(valueOf(b, 'flex-wrap'), 'wrap',
        file + ': the header cannot wrap, so whatever does not fit is pushed off the page');
    }
  }
  assert.ok(found.length >= 3,
    'expected the header to be defined in at least three places, found: ' + found.join(', '));
});

test('no copy of the header is pinned to a height it can overflow', () => {
  for (const { file, css } of sheets()) {
    for (const b of blocksFor(css, '.top')) {
      const h = valueOf(b, 'height');
      assert.equal(h, null,
        file + ': .top fixes height to ' + h + ', so a wrapped second row is clipped. Use min-height.');
    }
  }
});

test('the logo cannot reserve space the viewport does not have', () => {
  for (const { file, css } of sheets()) {
    for (const b of blocksFor(css, '.logo')) {
      const mw = valueOf(b, 'min-width');
      if (mw === null) continue;
      const px = Number(String(mw).replace('px', ''));
      assert.ok(!Number.isFinite(px) || px === 0,
        file + ': .logo reserves ' + mw + ', which on a 360px phone is most of the row');
    }
  }
});

/* --------------------------------------------- items that have to shrink */

test('a panel holding a map cannot drag its column wider than the screen', () => {
  const css = fs.readFileSync(path.join(ROOT, 'portal.css'), 'utf8');
  /* The automatic minimum size of a grid or flex item is its content's, and
     .map's content minimum is twice its height floor. Either the item is
     allowed to shrink or the page overflows; there is no third option. */
  for (const sel of ['.cols>*', '.split>*', '.grid>*', '.event-grid>*']) {
    const blocks = blocksFor(css, sel);
    assert.ok(blocks.length, 'portal.css no longer lets ' + sel + ' shrink below its content');
    assert.ok(blocks.some(b => valueOf(b, 'min-width') === '0'),
      sel + ' does not set min-width:0, so a map inside it forces the column wide');
  }
  assert.ok(blocksFor(css, '.map').some(b => valueOf(b, 'min-width') === '0'),
    '.map does not set min-width:0');
});

test('the map still has a height floor, which is why it has to be allowed to shrink', () => {
  const css = fs.readFileSync(path.join(ROOT, 'portal.css'), 'utf8');
  const map = blocksFor(css, '.map').find(b => declares(b, 'aspect-ratio'));
  assert.ok(map, 'control: .map should still be sized by an aspect ratio');
  assert.ok(declares(map, 'min-height'),
    'control: .map should still have a height floor - if it does not, the shrink rules above are no longer load-bearing');
  const ratio = valueOf(map, 'aspect-ratio');
  const floor = Number(String(valueOf(map, 'min-height')).replace('px', ''));
  assert.ok(floor > 0 && /2\s*\/\s*1/.test(ratio),
    'control: the 600px minimum this guards against comes from ' + ratio + ' with a ' + floor + 'px floor');
});

test('a box sized by an aspect ratio declares its own width', () => {
  /* An aspect ratio with a height floor and no width is a width floor in
     disguise: 300px tall at 2/1 is 600px wide, whatever the screen is, and no
     amount of letting its ancestors shrink helps because the box itself is
     asking for 600. portal.css always declared width:100% here and never had
     the problem; dashboard.html's copy of the same rule did not, and was the
     worst page on the site at 360px. */
  const offenders = [];
  for (const { file, css } of sheets()) {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const block = m[2];
      if (!declares(block, 'aspect-ratio') || !declares(block, 'min-height')) continue;
      if (declares(block, 'width')) continue;
      offenders.push(file + ': ' + m[1].trim().replace(/^.*[{}]\s*/, ''));
    }
  }
  assert.deepEqual(offenders, [],
    'these rules let a height floor decide the width, which overflows narrow screens');
});

/* ----------------------------------------------- the wrapped row reads right */

test('the header tail is right-aligned from its first item, not its last', () => {
  const css = fs.readFileSync(path.join(ROOT, 'portal.css'), 'utf8');
  /* With the automatic margin on the last item, a wrapped header stranded the
     timezone picker alone on the left of the second row. */
  assert.ok(blocksFor(css, '#pndTimezone').some(b => valueOf(b, 'margin-left') === 'auto'),
    'nothing pushes the header tail to the right, so a wrapped row starts at the left margin');
  for (const b of blocksFor(css, '.live')) {
    assert.notEqual(valueOf(b, 'margin-left'), 'auto',
      '.live also claims the automatic margin, which splits the wrapped row instead of keeping it together');
  }
});

/* ------------------------------------------------ the panel header wraps too */

test('a panel heading keeps a readable width next to a long description', () => {
  const css = fs.readFileSync(path.join(ROOT, 'portal.css'), 'utf8');
  const ph = blocksFor(css, '.ph').find(b => declares(b, 'display'));
  assert.ok(ph, 'portal.css should still define the panel header');
  assert.equal(valueOf(ph, 'flex-wrap'), 'wrap',
    'the panel header cannot wrap, so a long note beside the heading squeezes it to one word per line');
  const heads = blocksFor(css, '.ph h3');
  assert.ok(heads.some(b => declares(b, 'min-width')),
    'the heading has no width floor, so it is whatever is left over');
});
