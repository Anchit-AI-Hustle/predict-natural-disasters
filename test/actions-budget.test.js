'use strict';
/**
 * The repository is private, so GitHub Actions has 2,000 free minutes a month.
 * September used 2,021: every run from 27 September on - refresh and CI alike -
 * failed in two seconds without starting, until the month turned. Two things
 * spent them: CI ran twice for every pull-request push, and the refresh job
 * warmed the enrichment of all 1,513 events, 14.5 of its 15 minutes, for
 * records that expired long before the next run. These keep both fixed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('CI runs once per change, not once for the push and again for the pull request', () => {
  const y = read('.github/workflows/ci.yml');
  const on = y.slice(y.indexOf('\non:'), y.indexOf('\njobs:'));
  assert.match(on, /push:\s*\n\s*branches: \[main\]/, 'pushes to every branch are tested again by their pull request');
  assert.match(on, /pull_request:/, 'pull requests must still be tested');
  assert.match(on, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/,
    'a superseded pull-request run should be cancelled, and a run on main never');
});

test('the refresh job warms a bounded number of records', () => {
  const y = read('.github/workflows/refresh-disaster-data.yml');
  const limit = Number((y.match(/WARM_LIMIT = (\d+)/) || [])[1]);
  assert.ok(limit > 0 && limit <= 300, `warm limit is ${limit}`);
  assert.match(y, /pool\.map\(warm, targets\)/, 'the warm must run over the bounded list, not every event');
  assert.doesNotMatch(y, /pool\.map\(warm, events\)/);
});

test('no workflow is pinned to an action that runs on the retired Node 20', () => {
  for (const f of ['ci.yml', 'refresh-disaster-data.yml']) {
    const y = read(path.join('.github', 'workflows', f));
    assert.doesNotMatch(y, /actions\/(checkout|setup-node)@v4/, f);
  }
});
