'use strict';
/**
 * Background alerts: whether they are available, and signing a device up.
 *
 *   GET    /api/alerts   what this deployment can do, measured
 *   POST   /api/alerts   { subscription, places }  switch alerts on, or update the places
 *   DELETE /api/alerts   { endpoint }              switch them off and forget the device
 *
 * The service is offered only where it can actually run: a store to keep the
 * subscription in (api/_lib/store.js) and a schedule to check on it
 * (api/_lib/qstash.js). Without both, GET says which is missing and the page
 * says the same thing to the reader, rather than offering a switch that would
 * do nothing.
 *
 * What is kept is the least that can raise an alert: the push subscription
 * the browser issued, and each place as its kind (Home, Office...) and a
 * position rounded to two decimal places - about a kilometre. No name, no
 * address, no account, no IP address. It expires 90 days after the device
 * last checked in, and is deleted outright on switching off or when the push
 * service reports the subscription gone.
 */
const crypto = require('crypto');
const STORE = require('./_lib/store.js');
const QSTASH = require('./_lib/qstash.js');
const WEBPUSH = require('./_lib/webpush.js');
const { jsonBody, header, send } = require('./_lib/http.js');
const RULES = require('../alert-rules.js');

const KEYS = {
  vapid: 'pnd:alerts:vapid',
  subs: 'pnd:alerts:subs',
  sub: id => 'pnd:alerts:sub:' + id,
  lastRun: 'pnd:alerts:last-run',
  schedule: 'pnd:alerts:schedule',
  rate: h => 'pnd:alerts:rate:' + h,
  lock: 'pnd:alerts:lock',
  sent: (id, key) => 'pnd:alerts:sent:' + id + ':' + key
};
const KEEP_DAYS = 90;
const MAX_PLACES = 10;
const KINDS = ['Home', 'Office', 'Family', 'Travel', 'Current location'];
const RATE_LIMIT = 30;            // requests per device network per ten minutes

function availability(env) {
  const store = STORE.config(env), schedule = QSTASH.config(env);
  let reason = null;
  if (!store && !schedule) reason = 'Background alerts are not switched on for this site: it has no store to keep a subscription in and no schedule to check for hazards while the site is closed.';
  else if (!store) reason = 'Background alerts are not switched on for this site: it has no store to keep a subscription in.';
  else if (!schedule) reason = 'Background alerts are not switched on for this site: nothing is scheduled to check for hazards while the site is closed, so a subscription would never be used.';
  return { store: !!store, schedule: !!schedule, available: !!(store && schedule), reason };
}

const subscriptionId = endpoint =>
  crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32);

/**
 * The key pair that identifies this site to push services.
 *
 * Generated once, on first use, inside the store - never in the repository
 * and never in a build log. SET NX makes two first requests agree on one
 * pair. A deployment that prefers to hold the pair itself can set
 * VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY instead.
 */
async function vapidKeys(store, env) {
  env = env || process.env;
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    const pub = WEBPUSH.b64u.decode(env.VAPID_PUBLIC_KEY);
    return {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateJwk: { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY,
        x: WEBPUSH.b64u.encode(pub.subarray(1, 33)), y: WEBPUSH.b64u.encode(pub.subarray(33, 65)) }
    };
  }
  let v = await store.cmd('GET', KEYS.vapid);
  if (!v) {
    await store.cmd('SET', KEYS.vapid, JSON.stringify(WEBPUSH.generateVapidKeys()), 'NX');
    v = await store.cmd('GET', KEYS.vapid);
  }
  return JSON.parse(v);
}

function siteOrigin(req, env) {
  env = env || process.env;
  const host = env.VERCEL_PROJECT_PRODUCTION_URL || header(req, 'x-forwarded-host') || header(req, 'host');
  return host ? 'https://' + String(host).replace(/^https?:\/\//, '').replace(/\/+$/, '') : null;
}

/** A subscription as the browser serialises it, checked field by field. */
function cleanSubscription(s) {
  if (!s || typeof s !== 'object' || !s.keys) return null;
  if (!WEBPUSH.endpointAllowed(s.endpoint)) return null;
  const p256dh = WEBPUSH.b64u.decode(s.keys.p256dh), auth = WEBPUSH.b64u.decode(s.keys.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return { endpoint: String(s.endpoint), keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) } };
}

/** Places reduced to what an alert needs, and rounded here whatever the page sent. */
function cleanPlaces(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_PLACES) return null;
  const out = [];
  for (const p of list) {
    const lat = RULES.roundCoord(p && p.lat), lon = RULES.roundCoord(p && p.lon);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    out.push({ kind: KINDS.indexOf(p.kind) >= 0 ? p.kind : null, lat, lon });
  }
  return out;
}

/** Make sure the five-minute check exists and points here. */
async function ensureSchedule(store, req, env, fetchImpl) {
  const q = QSTASH.config(env), origin = siteOrigin(req, env);
  if (!q || !origin) return { scheduled: false, reason: 'No schedule is configured.' };
  const destination = origin + '/api/alerts-run';
  const marker = destination + ' ' + QSTASH.CRON;
  if (await store.cmd('GET', KEYS.schedule) === marker) return { scheduled: true };
  try {
    await QSTASH.ensureSchedule(q, destination, fetchImpl);
    await store.cmd('SET', KEYS.schedule, marker);
    return { scheduled: true };
  } catch (e) {
    return { scheduled: false, reason: 'The five-minute check could not be scheduled: ' + e.message };
  }
}

async function rateLimited(store, req) {
  const ip = (header(req, 'x-forwarded-for').split(',')[0] || header(req, 'x-real-ip') || '').trim();
  if (!ip) return false;
  const k = KEYS.rate(crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16));
  const [n] = await store.pipeline([['INCR', k], ['EXPIRE', k, 600]]);
  return Number(n) > RATE_LIMIT;
}

async function handler(req, res, deps) {
  deps = deps || {};
  const env = deps.env || process.env;
  const method = String(req.method || 'GET').toUpperCase();
  const a = availability(env);
  const store = a.store ? STORE.client(env, deps.fetch) : null;

  if (method === 'GET') {
    const out = {
      available: a.available,
      reason: a.reason,
      /* The schedule as configured; lastRun below is what it actually did. */
      schedule: a.available ? { everyMinutes: 5, cron: QSTASH.CRON } : null,
      keeps: 'For each place: its kind (Home, Office, Family, Travel or Current location) and its position rounded to about 1 km. No name, address or account. Deleted when alerts are switched off, and 90 days after this device last opened the site.',
      rules: { nearKm: RULES.NEAR_KM, severeNearKm: RULES.SEVERE_NEAR_KM, recentHours: RULES.RECENT_HOURS },
      publicKey: null,
      lastRun: null
    };
    if (a.available) {
      try {
        out.publicKey = (await vapidKeys(store, env)).publicKey;
        const last = await store.cmd('GET', KEYS.lastRun);
        out.lastRun = last ? JSON.parse(last) : null;
      } catch (e) {
        out.available = false;
        out.reason = 'The alert store did not answer, so alerts cannot be switched on right now.';
      }
    }
    return send(res, 200, out);
  }

  if (method !== 'POST' && method !== 'DELETE') return send(res, 405, { error: 'method not allowed' });
  if (!a.available) return send(res, 503, { ok: false, reason: a.reason });

  try {
    if (await rateLimited(store, req)) return send(res, 429, { ok: false, reason: 'Too many requests from this network. Try again in a few minutes.' });
    const body = await jsonBody(req, 16384);
    if (!body) return send(res, 400, { ok: false, reason: 'The request body is not valid JSON.' });

    if (method === 'DELETE') {
      if (!body.endpoint) return send(res, 400, { ok: false, reason: 'No subscription named.' });
      const id = subscriptionId(body.endpoint);
      const [removed] = await store.pipeline([['DEL', KEYS.sub(id)], ['SREM', KEYS.subs, id]]);
      return send(res, 200, { ok: true, removed: Number(removed) > 0 });
    }

    const sub = cleanSubscription(body.subscription);
    if (!sub) return send(res, 400, { ok: false, reason: 'This browser’s push subscription was not recognised.' });
    const places = cleanPlaces(body.places);
    if (!places) return send(res, 400, { ok: false, reason: 'Between 1 and ' + MAX_PLACES + ' places with a valid position are needed.' });

    const id = subscriptionId(sub.endpoint);
    const record = { endpoint: sub.endpoint, keys: sub.keys, places, updatedAt: new Date().toISOString() };
    await store.pipeline([
      ['SET', KEYS.sub(id), JSON.stringify(record), 'EX', KEEP_DAYS * 86400],
      ['SADD', KEYS.subs, id]
    ]);
    const sched = await ensureSchedule(store, req, env, deps.fetch);
    return send(res, 200, { ok: true, places, keptDays: KEEP_DAYS, scheduled: sched.scheduled,
      reason: sched.scheduled ? null : sched.reason });
  } catch (e) {
    return send(res, 502, { ok: false, reason: 'The alert store did not answer: ' + e.message });
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.KEYS = KEYS;
module.exports.availability = availability;
module.exports.vapidKeys = vapidKeys;
module.exports.subscriptionId = subscriptionId;
module.exports.cleanPlaces = cleanPlaces;
module.exports.cleanSubscription = cleanSubscription;
module.exports.siteOrigin = siteOrigin;
module.exports.KEEP_DAYS = KEEP_DAYS;
