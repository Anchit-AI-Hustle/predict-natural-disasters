'use strict';
/**
 * The jobs that commit data push with tools/push-with-retry.sh.
 *
 * A plain `git push` is rejected whenever anything lands on main while the
 * job runs, a pull request merged or another job's commit, and the hourly
 * refresh would count that as a failure; two in a row now open an issue.
 * The script rebases onto what landed and tries again, and still fails,
 * loudly, when the two changes really conflict.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'push-with-retry.sh');
const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' });
const git = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim();

/** A remote with one commit on main, and two clones of it. */
function setup() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-push-'));
  const remote = path.join(d, 'remote.git');
  git(d, 'init', '-q', '--bare', '-b', 'main', remote);
  const a = path.join(d, 'a'), b = path.join(d, 'b');
  git(d, 'clone', '-q', remote, a);
  git(a, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(a, 'shared.txt'), 'one\n');
  git(a, 'add', '.'); git(a, 'commit', '-q', '-m', 'start'); git(a, 'push', '-q', 'origin', 'main');
  git(d, 'clone', '-q', remote, b);
  return { remote, a, b };
}
const commit = (repo, file, text, msg) => { fs.writeFileSync(path.join(repo, file), text); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', msg); };
/* The workflows check out with actions/checkout, which clones one commit deep. */
function shallowClone(remote) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pnd-shallow-'));
  git(d, 'clone', '-q', '--depth', '1', 'file://' + remote, 'c');
  return path.join(d, 'c');
}
const run = repo => spawnSync('bash', [SCRIPT, 'main'], { cwd: repo, env, encoding: 'utf8' });

test('a push that main has moved past is rebased and pushed', () => {
  const { remote, a, b } = setup();
  commit(b, 'other.txt', 'merged meanwhile\n', 'a pull request merged');
  git(b, 'push', '-q', 'origin', 'main');
  commit(a, 'ledger.json', '{}\n', 'Record outlooks');
  assert.notEqual(spawnSync('git', ['push', 'origin', 'main'], { cwd: a, env }).status, 0, 'the plain push should have been rejected');
  const r = run(a);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const log = git(remote, 'log', '--format=%s', 'main');
  assert.match(log, /Record outlooks/); assert.match(log, /a pull request merged/);
});

test('it works from a one-commit-deep checkout, as in Actions', () => {
  const { remote, b } = setup();
  const c = shallowClone(remote);
  commit(b, 'other.txt', 'merged meanwhile\n', 'a pull request merged'); git(b, 'push', '-q', 'origin', 'main');
  commit(c, 'ledger.json', '{}\n', 'Record outlooks');
  const r = run(c);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(git(remote, 'log', '--format=%s', 'main'), /Record outlooks[\s\S]*a pull request merged/);
});

test('a real conflict still fails, with a non-zero exit', () => {
  const { a, b } = setup();
  commit(b, 'shared.txt', 'two\n', 'their edit'); git(b, 'push', '-q', 'origin', 'main');
  commit(a, 'shared.txt', 'three\n', 'our edit');
  const r = run(a);
  assert.notEqual(r.status, 0, 'a conflicting push was reported as a success');
  assert.match(r.stdout + r.stderr, /CONFLICT|could not apply/i, 'it failed, but not on the conflict: ' + r.stderr);
});

test('both jobs that commit data push through the script', () => {
  for (const f of ['refresh-disaster-data.yml', 'forecast-models.yml']) {
    const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8');
    assert.match(y, /bash tools\/push-with-retry\.sh/, f + ' does not use the retrying push');
    assert.doesNotMatch(y, /^\s*git push\s*$/m, f + ' still has a bare git push');
  }
});
