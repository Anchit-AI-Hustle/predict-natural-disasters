#!/usr/bin/env node
'use strict';
/**
 * Says so when the refresh job stops working.
 *
 *   node tools/refresh-alert.js check <events.json>   exit 1 if the feed is empty
 *   node tools/refresh-alert.js alert <empty|failed>  open or add to an issue
 *
 * From 27 September to 12 October every scheduled run failed within seconds
 * and nothing said so: the ledger stopped growing while the site looked
 * fine. "alert" runs when a step of the job has failed. An empty feed opens
 * an issue at once; any other failure opens one only when the previous run
 * failed too, so one bad hour upstream does not page anyone. While an issue
 * is open, later alerts are added to it as comments instead of new issues.
 *
 * It cannot report a run that never started (the billing failure above
 * ended jobs before their first step), because then no step runs at all.
 * GitHub emails the workflow's owner about failed scheduled runs; that is
 * the alert for that case.
 */

const ISSUE_TITLE = 'The scheduled data refresh is failing';
const API = 'https://api.github.com';

/** Why a fetched feed cannot be recorded, or null when it can. */
function feedProblem(doc) {
  if (!doc || typeof doc !== 'object') return 'the feed is not a JSON object';
  if (!Array.isArray(doc.events)) return 'the feed has no events list';
  if (doc.events.length === 0) return 'the feed returned no events';
  return null;
}

/** Whether to alert, from this run's failure and the previous run's outcome. */
function decide({ reason, previous }) {
  if (reason === 'empty') return { open: true, why: 'the feed returned no events' };
  if (previous === 'failure' || previous === 'timed_out' || previous === 'startup_failure') {
    return { open: true, why: 'this run failed, and so did the one before it (' + previous + ')' };
  }
  return { open: false, why: previous ? 'the previous run ended in ' + previous : 'there is no earlier run to compare with' };
}

async function gh(fetchImpl, env, method, url, body) {
  const r = await fetchImpl(url, {
    method,
    headers: {
      authorization: 'Bearer ' + env.GITHUB_TOKEN,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'pnd-refresh-alert'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(method + ' ' + url + ' -> HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

async function alert(reason, env, fetchImpl = fetch) {
  const repo = env.GITHUB_REPOSITORY, runId = String(env.GITHUB_RUN_ID);
  const branch = env.GITHUB_REF_NAME || 'main';
  const runs = await gh(fetchImpl, env, 'GET', API + '/repos/' + repo + '/actions/workflows/' + env.WORKFLOW_FILE +
    '/runs?status=completed&per_page=5&branch=' + encodeURIComponent(branch));
  const prev = (runs.workflow_runs || []).find(r => String(r.id) !== runId && r.conclusion);
  const d = decide({ reason, previous: prev ? prev.conclusion : null });
  if (!d.open) return { action: 'none', why: d.why };

  const runUrl = (env.GITHUB_SERVER_URL || 'https://github.com') + '/' + repo + '/actions/runs/' + runId;
  const text = 'Run ' + runUrl + ' failed: ' + d.why + '.\n\n' +
    'Until this is fixed the forecast ledger, the change log and the coverage record stop growing, and the site keeps serving the last ones it has.';
  const open = await gh(fetchImpl, env, 'GET', API + '/repos/' + repo + '/issues?state=open&per_page=100');
  const existing = (open || []).find(i => i.title === ISSUE_TITLE && !i.pull_request);
  if (existing) {
    await gh(fetchImpl, env, 'POST', API + '/repos/' + repo + '/issues/' + existing.number + '/comments', { body: text });
    return { action: 'commented', why: d.why, issue: existing.number };
  }
  const made = await gh(fetchImpl, env, 'POST', API + '/repos/' + repo + '/issues', { title: ISSUE_TITLE, body: text });
  return { action: 'opened', why: d.why, url: made.html_url };
}

module.exports = { ISSUE_TITLE, feedProblem, decide, alert };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'check') {
    let doc = null;
    try { doc = JSON.parse(require('fs').readFileSync(arg, 'utf8')); } catch (e) { /* reported below */ }
    const p = feedProblem(doc);
    if (p) { console.error('FAIL: ' + p); process.exit(1); }
    console.log('feed: ' + doc.events.length + ' events');
  } else if (cmd === 'alert') {
    alert(arg === 'empty' ? 'empty' : 'failed', process.env)
      .then(r => console.log('alert: ' + r.action + ' (' + r.why + ')' + (r.url ? ' ' + r.url : '')))
      .catch(e => { console.error(e.message); process.exit(1); });
  } else {
    console.error('usage: refresh-alert.js check <events.json> | alert <empty|failed>');
    process.exit(2);
  }
}
