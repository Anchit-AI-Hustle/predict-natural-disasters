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

/** The jobs of a workflow: name, the job's own settings before its steps, and its steps. */
function jobs(y) {
  const body = y.slice(y.indexOf('\njobs:') + 6);
  return body.split(/\n(?=  [\w-]+:\s*\n)/).filter(j => /^\s*[\w-]+:/.test(j)).map(j => ({
    name: /^\s*([\w-]+):/.exec(j)[1],
    head: j.slice(0, j.indexOf('\n    steps:') >= 0 ? j.indexOf('\n    steps:') : j.length),
    steps: steps(j)
  }));
}
/** A job's condition, folded onto one line. */
const jobIf = j => ((/\n    if: (?:>-?\s*)?([\s\S]*?)(?=\n    [\w-]+:)/.exec(j.head + '\n    end:') || [])[1] || '').replace(/\s+/g, ' ').trim();

test('the forecast-model workflow commits only from main, started by hand or on its schedule', () => {
  const js = jobs(read('forecast-models.yml'));
  const pushing = js.flatMap(j => j.steps.filter(s => /git push|push-with-retry\.sh/.test(s)).map(s => ({ job: j, step: s })));
  assert.deepEqual(pushing.map(p => p.job.name), ['models', 'publish'], 'expected one pushing step in each of the two jobs');
  /* The climatology and backtest: only by hand on main. */
  assert.match(pushing[0].step, /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/,
    'the climatology commit must not run on pull requests or on other branches');
  /* The daily forecasts: the whole job runs only on main, on the schedule or by hand, never for a pull request. */
  const cond = jobIf(pushing[1].job);
  assert.match(cond, /github\.ref == 'refs\/heads\/main'/, 'publish must run only on main: ' + cond);
  assert.match(cond, /github\.event_name == 'schedule'/, cond);
  assert.match(cond, /github\.event_name == 'workflow_dispatch'/, cond);
  assert.doesNotMatch(cond, /pull_request/, cond);
  /* Started by hand, publish waits for the new climatology and reads it from main. */
  assert.match(pushing[1].job.head, /\n    needs: models\b/, 'publish must wait for the models job');
  assert.match(cond, /needs\.models\.result == 'success'/, cond);
  assert.match(pushing[1].job.steps[0], /actions\/checkout@v5[\s\S]*ref: main\b/, 'publish must check out main as the models job left it');
  assert.doesNotMatch(read('forecast-models.yml'), /ref: \$\{\{ github\.head_ref/, 'no need to check out the PR branch itself when nothing is pushed to it');
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
    const onPr = /\n\s+pull_request(_target)?:/.test(y.slice(0, y.indexOf('\njobs:')));
    if (!onPr) continue;
    for (const j of jobs(y)) {
      const cond = jobIf(j);
      /* A job limited to main by events other than pull requests never runs for one. */
      const jobSafe = /github\.ref == 'refs\/heads\/main'/.test(cond) && !/pull_request/.test(cond) &&
        /github\.event_name == '(schedule|workflow_dispatch)'/.test(cond);
      for (const s of j.steps.filter(s => /git push|push-with-retry\.sh/.test(s))) {
        assert.ok(jobSafe || /if: .*github\.event_name == 'workflow_dispatch'/.test(s),
          f + ' can push a commit from a pull-request run (job ' + j.name + ')');
      }
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
