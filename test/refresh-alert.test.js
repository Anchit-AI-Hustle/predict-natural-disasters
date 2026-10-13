'use strict';
/**
 * The refresh job says so when it stops working. From 27 September to 12
 * October every scheduled run failed in seconds and nobody was told: the
 * feed went stale while the site looked fine. tools/refresh-alert.js opens
 * an issue when the feed comes back empty, or when the job fails twice in a
 * row, and adds to the open issue rather than opening another each hour.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../tools/refresh-alert.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('an empty or malformed feed is a problem; a feed with events is not', () => {
  assert.equal(A.feedProblem({ events: [{ id: 'a' }], meta: {} }), null);
  for (const bad of [null, {}, { events: [] }, { events: 'x' }, { meta: { live: true } }]) {
    assert.ok(A.feedProblem(bad), 'not flagged: ' + JSON.stringify(bad));
  }
});

test('an empty feed alerts at once; a failure alerts only when the previous run failed too', () => {
  assert.equal(A.decide({ reason: 'empty', previous: 'success' }).open, true);
  assert.equal(A.decide({ reason: 'failed', previous: 'failure' }).open, true);
  assert.equal(A.decide({ reason: 'failed', previous: 'timed_out' }).open, true);
  assert.equal(A.decide({ reason: 'failed', previous: 'success' }).open, false);
  assert.equal(A.decide({ reason: 'failed', previous: null }).open, false, 'a first failure with no history is not two in a row');
  assert.equal(A.decide({ reason: 'failed', previous: 'cancelled' }).open, false);
});

/** A fake GitHub API that records what was sent. */
function fakeGitHub({ runs, issues }) {
  const sent = [];
  const fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    sent.push({ method, url, body: opts.body ? JSON.parse(opts.body) : null, auth: (opts.headers || {}).authorization });
    let body = {};
    if (method === 'GET' && /\/actions\/workflows\/.+\/runs/.test(url)) body = { workflow_runs: runs };
    else if (method === 'GET' && /\/issues\?/.test(url)) body = issues;
    else if (method === 'POST') body = { html_url: 'https://github.com/o/r/issues/9' };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { fetch, sent };
}
const env = { GITHUB_TOKEN: 't0k', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '500', GITHUB_SERVER_URL: 'https://github.com', WORKFLOW_FILE: 'refresh-disaster-data.yml' };

test('the second failure in a row opens an issue that links the run', async () => {
  const gh = fakeGitHub({ runs: [{ id: 500, conclusion: null }, { id: 499, conclusion: 'failure' }], issues: [] });
  const r = await A.alert('failed', env, gh.fetch);
  assert.equal(r.action, 'opened');
  const post = gh.sent.find(s => s.method === 'POST');
  assert.match(post.url, /\/repos\/o\/r\/issues$/);
  assert.equal(post.body.title, A.ISSUE_TITLE);
  assert.match(post.body.body, /https:\/\/github\.com\/o\/r\/actions\/runs\/500/);
  assert.equal(post.auth, 'Bearer t0k');
});

test('an open issue gets a comment instead of a duplicate', async () => {
  const gh = fakeGitHub({ runs: [{ id: 499, conclusion: 'failure' }], issues: [{ number: 7, title: A.ISSUE_TITLE }] });
  const r = await A.alert('failed', env, gh.fetch);
  assert.equal(r.action, 'commented');
  const posts = gh.sent.filter(s => s.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/issues\/7\/comments$/);
});

test('a single failure after a success stays quiet, and an empty feed does not wait for a second', async () => {
  const quiet = fakeGitHub({ runs: [{ id: 499, conclusion: 'success' }], issues: [] });
  assert.equal((await A.alert('failed', env, quiet.fetch)).action, 'none');
  assert.equal(quiet.sent.filter(s => s.method === 'POST').length, 0);
  const empty = fakeGitHub({ runs: [{ id: 499, conclusion: 'success' }], issues: [] });
  assert.equal((await A.alert('empty', env, empty.fetch)).action, 'opened');
});

test('the refresh workflow checks the feed, alerts on failure, and avoids the top of the hour', () => {
  const y = read('.github/workflows/refresh-disaster-data.yml');
  const cron = (y.match(/cron: '([^']+)'/) || [])[1];
  assert.ok(cron, 'no schedule');
  assert.notEqual(cron.split(' ')[0], '0', 'GitHub drops queued scheduled jobs under load, and the start of every hour is its busiest time');
  assert.match(y, /issues: write/, 'opening an issue needs issues: write');
  assert.match(y, /actions: read/, 'reading the previous run needs actions: read');
  assert.ok(y.indexOf('refresh-alert.js check') > 0 && y.indexOf('refresh-alert.js check') < y.indexOf('record-outlooks.js'),
    'the feed must be checked before anything is recorded from it');
  const alertStep = y.slice(y.indexOf('refresh-alert.js alert') - 400, y.indexOf('refresh-alert.js alert'));
  assert.match(alertStep, /if: failure\(\)/, 'the alert must run when an earlier step failed');
});
