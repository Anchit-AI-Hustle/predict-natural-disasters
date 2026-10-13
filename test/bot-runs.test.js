'use strict';
/**
 * No workflow commits to a pull request's branch.
 *
 * CI #323 and #325 and Forecast models #2 and #4 "took 43 to 58 minutes and
 * failed" without running a single job. Forecast models committed its results
 * back to the PR branch with the GITHUB_TOKEN; GitHub holds pull_request runs
 * set off by such a push for a maintainer's approval, and these sat in
 * action_required until the PR merged, when GitHub closed them as failed.
 * Pull-request runs now keep their results as an artifact and in the job
 * summary; only a run started by hand on main commits, and a push to main by
 * the GITHUB_TOKEN starts no workflow.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WF = path.join(__dirname, '..', '.github', 'workflows');
const read = f => fs.readFileSync(path.join(WF, f), 'utf8');
const files = fs.readdirSync(WF).filter(f => /\.ya?ml$/.test(f));

/** The steps of a workflow, each as its own block of text. */
function steps(y) {
  return y.split(/\n(?=\s+- (?:name|uses):)/).slice(1);
}

test('the forecast-model workflow commits only when started by hand on main', () => {
  const y = read('forecast-models.yml');
  const pushing = steps(y).filter(s => /git push/.test(s));
  assert.equal(pushing.length, 1, 'expected exactly one step that pushes');
  assert.match(pushing[0], /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
    'the commit step must not run on pull requests or on other branches');
  assert.doesNotMatch(y, /ref: \$\{\{ github\.head_ref/, 'no need to check out the PR branch itself when nothing is pushed to it');
});

test('pull-request runs keep their results as an artifact instead', () => {
  const y = read('forecast-models.yml');
  const up = steps(y).find(s => /actions\/upload-artifact@/.test(s));
  assert.ok(up, 'no artifact upload');
  assert.match(up, /actions\/upload-artifact@v6\b/, 'v6 is the release that runs on Node 24');
  assert.match(up, /data\/climatology\.json/);
  assert.match(up, /data\/model-backtest\.json/);
});

test('no workflow that pushes commits runs on pull requests', () => {
  for (const f of files) {
    const y = read(f);
    const pushes = steps(y).filter(s => /git push/.test(s));
    const onPr = /\n\s+pull_request(_target)?:/.test(y.slice(0, y.indexOf('\njobs:')));
    for (const s of pushes) {
      assert.ok(!onPr || /if: .*github\.event_name == 'workflow_dispatch'/.test(s),
        f + ' can push a commit from a pull-request run');
    }
  }
});

test('every workflow has a concurrency group, and none runs on an action retired with Node 20', () => {
  for (const f of files) {
    const y = read(f);
    assert.match(y, /\nconcurrency:\n\s+group: /, f + ' has no concurrency group');
    assert.doesNotMatch(y, /actions\/(checkout|setup-node)@v4\b/, f);
    assert.doesNotMatch(y, /actions\/upload-artifact@v[1-5]\b/, f);
  }
});
