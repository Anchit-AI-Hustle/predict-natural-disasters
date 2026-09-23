'use strict';
/**
 * The five-minute check behind background alerts.
 *
 * Called by the QStash schedule (see api/_lib/qstash.js), never by a reader:
 * a request that does not carry a valid QStash signature - or, where
 * CRON_SECRET is set, that bearer token - is refused before anything is read.
 *
 * Each run reads the live feed once, asks alert-rules.js which records bear on
 * each device's places (the same rules the page applies while it is open),
 * and sends what that device has not already been sent. A device hears about
 * a record once; the same record rated more severely later is new. At most
 * three alerts go to a device per run, and anything beyond that is one
 * summary rather than a burst. A subscription the push service reports gone
 * is deleted on the spot.
 *
 * What a run found is written to the store as last-run, which is how the page
 * can say when the service last checked instead of asserting that it does.
 */
const crypto = require('crypto');
const STORE = require('./_lib/store.js');
const QSTASH = require('./_lib/qstash.js');
const WEBPUSH = require('./_lib/webpush.js');
const { rawBody, header, send } = require('./_lib/http.js');
const ALERTS = require('./alerts.js');
const RULES = require('../alert-rules.js');
const HAZARDS = require('../hazard-model.js');

const KEYS = ALERTS.KEYS;
const PER_RUN = 3;
const SENT_DAYS = 14;
const BATCH = 10;

/** The live feed, from the same handler /api/events runs, without a network hop. */
async function loadFeed(eventsHandler) {
  const h = eventsHandler || require('./events.js');
  let body = null, status = 0;
  const res = {
    setHeader() { return this; }, getHeader() { return undefined; },
    status(c) { status = c; return this; },
    json(b) { body = b; return this; },
    end() { return this; }
  };
  await h({ method: 'GET', query: {}, url: '/api/events', headers: {} }, res);
  if (!body || !Array.isArray(body.events)) throw new Error('the live feed returned ' + (status || 'nothing'));
  return body;
}

function authorised(req, raw, env, nowMs) {
  const q = QSTASH.config(env);
  const sig = header(req, 'upstash-signature');
  if (q && sig && QSTASH.verify(sig, raw, q.keys, nowMs).ok) return true;
  const secret = env.CRON_SECRET;
  if (secret) {
    const given = Buffer.from(header(req, 'authorization'));
    const want = Buffer.from('Bearer ' + secret);
    if (given.length === want.length && crypto.timingSafeEqual(given, want)) return true;
  }
  return false;
}

async function run(store, deps, req) {
  const env = deps.env, now = deps.now || Date.now();
  const feed = await loadFeed(deps.eventsHandler);
  const vapid = await ALERTS.vapidKeys(store, env);
  /* Who push services should contact about this sender: the site itself. */
  const subject = env.VAPID_SUBJECT || ALERTS.siteOrigin(req, env);
  if (!subject) throw new Error('no site address to identify this sender by');
  const ids = (await store.cmd('SMEMBERS', KEYS.subs)) || [];
  const stats = { subscriptions: ids.length, alerted: 0, sent: 0, failed: 0, removed: 0 };

  const handle = async (id, rec) => {
    if (!rec) { await store.cmd('SREM', KEYS.subs, id); stats.removed++; return; }
    const sub = JSON.parse(rec);
    const alerts = RULES.alertsFor(feed.events, sub.places, HAZARDS, now);
    if (!alerts.length) return;
    const sentKey = a => KEYS.sent(id, crypto.createHash('sha256').update(a.key).digest('hex').slice(0, 24));
    /* Claimed before sending, so an overlapping delivery cannot send it too. */
    const claimed = await store.pipeline(alerts.map(a => ['SET', sentKey(a), '1', 'NX', 'EX', SENT_DAYS * 86400]));
    const fresh = alerts.filter((a, i) => claimed[i] === 'OK');
    if (!fresh.length) return;
    stats.alerted++;
    const out = fresh.slice(0, PER_RUN).map(a => ({ msg: { title: a.title, body: a.body, url: a.url, tag: a.tag }, covers: [a] }));
    if (fresh.length > PER_RUN) {
      const rest = fresh.slice(PER_RUN), more = rest.length;
      out.push({ msg: { title: more + ' more hazard' + (more === 1 ? '' : 's') + ' near your places',
        body: 'Open Personal Risk to see every record that bears on them.', url: '/personal-risk', tag: 'pnd-more' }, covers: rest });
    }
    for (let i = 0; i < out.length; i++) {
      let r;
      try {
        r = await WEBPUSH.send(sub, JSON.stringify(Object.assign({ at: new Date(now).toISOString() }, out[i].msg)),
          vapid, subject, deps.fetch);
      } catch (e) { r = { ok: false, gone: false }; }
      if (r.ok) { stats.sent++; continue; }
      stats.failed++;
      if (r.gone) {
        await store.pipeline([['DEL', KEYS.sub(id)], ['SREM', KEYS.subs, id]]);
        stats.removed++;
        return;
      }
      /* Not delivered, so not sent: released for the next run to try again,
         rather than remembered as told. */
      await store.pipeline(out[i].covers.map(a => ['DEL', sentKey(a)]));
    }
  };

  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    const recs = await store.cmd('MGET', ...chunk.map(KEYS.sub));
    await Promise.all(chunk.map((id, j) => handle(id, recs && recs[j])));
  }

  const summary = Object.assign({ at: new Date(now).toISOString(), feedGeneratedAt: feed.generatedAt || null,
    records: feed.events.length }, stats);
  await store.cmd('SET', KEYS.lastRun, JSON.stringify(summary));
  return summary;
}

async function handler(req, res, deps) {
  deps = Object.assign({ env: process.env }, deps || {});
  const store = STORE.client(deps.env, deps.fetch);
  const raw = await rawBody(req);
  /* Checked against the real clock, whatever time the run is told it is. */
  if (!authorised(req, raw, deps.env)) return send(res, 401, { ran: false, reason: 'Only the schedule may start a run.' });
  if (!store) return send(res, 503, { ran: false, reason: 'No alert store is configured.' });
  /* Two deliveries of one tick, or a retry landing while a slow run is still
     going, would otherwise race each other to the same devices. */
  const lock = await store.cmd('SET', KEYS.lock, String(Date.now()), 'NX', 'EX', 240);
  if (lock !== 'OK') return send(res, 200, { ran: false, reason: 'A run is already in progress.' });
  try {
    const summary = await run(store, deps, req);
    return send(res, 200, Object.assign({ ran: true }, summary));
  } catch (e) {
    return send(res, 500, { ran: false, reason: e.message });
  } finally {
    try { await store.cmd('DEL', KEYS.lock); } catch (e) { /* the lock expires on its own */ }
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.loadFeed = loadFeed;
module.exports.authorised = authorised;
