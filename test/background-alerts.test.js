'use strict';
/*
 * Background alerts: what reaches a reader while the site is closed.
 *
 * Every piece is exercised here without a network: the push encryption
 * against RFC 8291's own worked example and against an independent
 * decryption written from the receiving side, the VAPID token against its
 * public key, the QStash signature both ways, the store over a fake of the
 * Upstash REST protocol, and the five-minute run end to end - down to
 * decrypting what it would have sent, as the browser would.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { renderPage, closeAllWindows } = require('./render.js');

test.after(closeAllWindows);

const ROOT = path.join(__dirname, '..');
const WP = require('../api/_lib/webpush.js');
const QS = require('../api/_lib/qstash.js');
const STORE = require('../api/_lib/store.js');
const ALERTS = require('../api/alerts.js');
const RUN = require('../api/alerts-run.js');
const RULES = require('../alert-rules.js');
const H = require('../hazard-model.js');
const b64u = WP.b64u;

/* ---------------------------------------------------------------- helpers */

/** A browser's side of a subscription: its keys, and a way to read a message. */
function browser(endpoint) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint: endpoint || 'https://fcm.googleapis.com/fcm/send/device-' + crypto.randomBytes(4).toString('hex'),
    keys: { p256dh: b64u.encode(ecdh.getPublicKey()), auth: b64u.encode(auth) } };
  /* Written from the receiving side of RFC 8291 / RFC 8188, not by calling
     the code under test backwards. */
  const decrypt = body => {
    const salt = body.subarray(0, 16), idlen = body[20];
    const asPublic = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
    const secret = ecdh.computeSecret(asPublic);
    const mac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
    const ikm = mac(mac(auth, secret), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic, Buffer.from([1])]));
    const prk = mac(salt, ikm);
    const cek = mac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
    const nonce = mac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
    const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    assert.equal(plain[plain.length - 1], 2, 'the last record is not marked as last');
    return plain.subarray(0, plain.length - 1).toString('utf8');
  };
  return { sub, decrypt };
}

/** Upstash's REST protocol over a Map, with expiry. */
function fakeUpstash(url) {
  const kv = new Map(), sets = new Map(), ttl = new Map(), calls = [];
  const alive = k => !(ttl.has(k) && ttl.get(k) <= Date.now());
  const run = a => {
    const [c, ...x] = a.map(String); calls.push(c);
    switch (c.toUpperCase()) {
      case 'GET': return alive(x[0]) && kv.has(x[0]) ? kv.get(x[0]) : null;
      case 'SET': {
        const nx = x.includes('NX'), ex = x.indexOf('EX');
        if (nx && alive(x[0]) && kv.has(x[0])) return null;
        kv.set(x[0], x[1]);
        if (ex > 0) ttl.set(x[0], Date.now() + Number(x[ex + 1]) * 1000); else ttl.delete(x[0]);
        return 'OK';
      }
      case 'DEL': { let n = 0; for (const k of x) { if (kv.delete(k) || sets.delete(k)) n++; } return n; }
      case 'SADD': { const s = sets.get(x[0]) || new Set(); const b = s.size; x.slice(1).forEach(v => s.add(v)); sets.set(x[0], s); return s.size - b; }
      case 'SREM': { const s = sets.get(x[0]) || new Set(); let n = 0; x.slice(1).forEach(v => { if (s.delete(v)) n++; }); return n; }
      case 'SMEMBERS': return [...(sets.get(x[0]) || [])];
      case 'MGET': return x.map(k => alive(k) && kv.has(k) ? kv.get(k) : null);
      case 'INCR': { const v = Number(kv.get(x[0]) || 0) + 1; kv.set(x[0], String(v)); return v; }
      case 'EXPIRE': ttl.set(x[0], Date.now() + Number(x[1]) * 1000); return 1;
      default: throw new Error('fake store does not know ' + c);
    }
  };
  const handle = async (u, init) => {
    const body = JSON.parse(init.body);
    assert.equal(init.headers.Authorization, 'Bearer store-token', 'the store token was not sent');
    const json = u.endsWith('/pipeline') ? body.map(a => ({ result: run(a) })) : { result: run(body) };
    return { ok: true, status: 200, json: async () => json };
  };
  return { url, kv, sets, ttl, calls, handle };
}

const ENV = {
  KV_REST_API_URL: 'https://store.example', KV_REST_API_TOKEN: 'store-token',
  QSTASH_TOKEN: 'qstash-token', QSTASH_CURRENT_SIGNING_KEY: 'sig_current', QSTASH_NEXT_SIGNING_KEY: 'sig_next',
  VERCEL_PROJECT_PRODUCTION_URL: 'disasters.example'
};

/** One fetch for everything the server talks to: the store, QStash, push services. */
function world() {
  const store = fakeUpstash(ENV.KV_REST_API_URL);
  const schedules = [], pushes = [];
  let pushStatus = () => 201;
  const fetch = async (u, init) => {
    u = String(u);
    if (u.startsWith(store.url)) return store.handle(u, init);
    if (u.startsWith('https://qstash.upstash.io/')) {
      schedules.push({ url: u, headers: init.headers });
      return { ok: true, status: 201, json: async () => ({ scheduleId: QS.SCHEDULE_ID }) };
    }
    pushes.push({ url: u, headers: init.headers, body: init.body });
    const status = pushStatus(u);
    return { ok: status < 300, status, json: async () => ({}) };
  };
  return { store, schedules, pushes, fetch, setPush: f => { pushStatus = f; } };
}

function res() {
  return { statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
async function call(handler, req, deps) {
  const r = res();
  await handler(Object.assign({ method: 'GET', headers: {}, query: {} }, req), r, deps);
  return r;
}

function qstashSignature(body, key, claims) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Object.assign({ iss: 'Upstash', sub: 'https://disasters.example/api/alerts-run',
    exp: now + 300, nbf: now - 1, iat: now, jti: 'j1',
    body: crypto.createHash('sha256').update(body).digest('base64url') }, claims || {});
  const input = enc({ alg: 'HS256', typ: 'JWT' }) + '.' + enc(payload);
  return input + '.' + crypto.createHmac('sha256', key).update(input).digest('base64url');
}

/* ------------------------------------------------------------ encryption */

test('the encryption reproduces RFC 8291’s worked example exactly', () => {
  const as = crypto.createECDH('prime256v1');
  as.setPrivateKey(b64u.decode('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'));
  const out = WP.encrypt('When I grow up, I want to be a watermelon', {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg'
  }, { salt: b64u.decode('DGv6ra1nlYgDCS1FRnbzlw'), localKey: as });
  assert.equal(b64u.encode(out),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('a browser holding the subscription keys can read what is sent, and nobody else can', () => {
  const a = browser(), b = browser();
  const msg = JSON.stringify({ title: 'Flood warning covers your home', body: 'Ünïcode ✓ '.repeat(30) });
  const body = WP.encrypt(msg, a.sub.keys);
  assert.equal(a.decrypt(body), msg);
  assert.throws(() => b.decrypt(body), 'a different device could read the message');
  assert.notDeepEqual(WP.encrypt(msg, a.sub.keys), body, 'two messages shared a salt and key');
});

test('malformed subscription keys are refused rather than encrypted to', () => {
  assert.throws(() => WP.encrypt('x', { p256dh: b64u.encode(Buffer.alloc(33, 2)), auth: b64u.encode(Buffer.alloc(16)) }));
  assert.throws(() => WP.encrypt('x', { p256dh: browser().sub.keys.p256dh, auth: b64u.encode(Buffer.alloc(8)) }));
});

test('the VAPID token is signed by the key the browser was given, for that push service only', () => {
  const v = WP.generateVapidKeys();
  const h = WP.vapidHeader('https://fcm.googleapis.com/fcm/send/abc', v, 'https://disasters.example');
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m, 'header shape: ' + h);
  assert.equal(m[4], v.publicKey);
  const claims = JSON.parse(b64u.decode(m[2]).toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com', 'the audience must be the push service origin');
  assert.equal(claims.sub, 'https://disasters.example');
  assert.ok(claims.exp - Date.now() / 1000 <= 24 * 3600, 'RFC 8292 caps a token at 24 hours');
  const raw = b64u.decode(v.publicKey);
  const pub = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256',
    x: b64u.encode(raw.subarray(1, 33)), y: b64u.encode(raw.subarray(33)) } });
  assert.ok(crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]),
    { key: pub, dsaEncoding: 'ieee-p1363' }, b64u.decode(m[3])), 'the signature does not verify');
});

/* ------------------------------------------------------------- endpoints */

test('only the push services browsers use can be posted to', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://web.push.apple.com/QK1', 'https://api.push.apple.com/3/device/x']) {
    assert.equal(WP.endpointAllowed(ok), true, ok);
  }
  for (const bad of ['http://fcm.googleapis.com/fcm/send/x', 'https://fcm.googleapis.com.evil.example/x',
    'https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x', 'https://store.example/', 'javascript:alert(1)', '', null]) {
    assert.equal(WP.endpointAllowed(bad), false, String(bad));
  }
});

test('a push the service reports gone is marked for deletion, and a refused endpoint is never contacted', async () => {
  const w = world(), v = WP.generateVapidKeys(), a = browser();
  w.setPush(() => 410);
  const r = await WP.send(a.sub, '{}', v, 'https://disasters.example', w.fetch);
  assert.deepEqual([r.ok, r.gone], [false, true]);
  const before = w.pushes.length;
  const r2 = await WP.send({ endpoint: 'https://169.254.169.254/x', keys: a.sub.keys }, '{}', v, 's', w.fetch);
  assert.equal(r2.ok, false);
  assert.equal(w.pushes.length, before, 'a request went to an address that is not a push service');
});

/* ---------------------------------------------------------------- QStash */

test('only a delivery signed by the schedule starts a run', () => {
  const keys = ['sig_current', 'sig_next'];
  assert.equal(QS.verify(qstashSignature('', 'sig_current'), '', keys).ok, true);
  assert.equal(QS.verify(qstashSignature('', 'sig_next'), '', keys).ok, true, 'a rotated key dropped a cycle');
  assert.equal(QS.verify(qstashSignature('', 'someone_else'), '', keys).ok, false);
  assert.equal(QS.verify(qstashSignature('', 'sig_current'), 'tampered', keys).ok, false, 'the body is not bound');
  assert.equal(QS.verify(qstashSignature('', 'sig_current', { exp: 1000 }), '', keys).ok, false, 'an expired token was accepted');
  assert.equal(QS.verify(qstashSignature('', 'sig_current', { iss: 'Mallory' }), '', keys).ok, false);
  assert.equal(QS.verify('', '', keys).ok, false);
});

test('the schedule is one fixed schedule every five minutes, pointed at the run', async () => {
  const w = world();
  await QS.ensureSchedule(QS.config(ENV), 'https://disasters.example/api/alerts-run', w.fetch);
  assert.equal(w.schedules.length, 1);
  assert.equal(w.schedules[0].url, 'https://qstash.upstash.io/v2/schedules/https://disasters.example/api/alerts-run');
  assert.equal(w.schedules[0].headers['Upstash-Cron'], '*/5 * * * *');
  assert.equal(w.schedules[0].headers['Upstash-Schedule-Id'], QS.SCHEDULE_ID,
    'without a fixed id every call would add another schedule');
});

/* ----------------------------------------------------------------- store */

test('the store is read from either name Upstash gives its variables', () => {
  assert.deepEqual(STORE.config({ KV_REST_API_URL: 'https://a/', KV_REST_API_TOKEN: 't' }), { url: 'https://a', token: 't' });
  assert.deepEqual(STORE.config({ UPSTASH_REDIS_REST_URL: 'https://b', UPSTASH_REDIS_REST_TOKEN: 'u' }), { url: 'https://b', token: 'u' });
  assert.equal(STORE.config({ KV_REST_API_URL: 'https://a' }), null, 'a store with no token is not a store');
});

/* ------------------------------------------------------------ /api/alerts */

test('without a store and a schedule the service says it is off, and why', async () => {
  const none = await call(ALERTS, {}, { env: {} });
  assert.equal(none.body.available, false);
  assert.match(none.body.reason, /not switched on/);
  assert.match(none.body.reason, /nowhere to keep your alert settings/);
  assert.equal(none.body.publicKey, null);
  const storeOnly = await call(ALERTS, {}, { env: { KV_REST_API_URL: 'https://s', KV_REST_API_TOKEN: 't' } });
  assert.equal(storeOnly.body.available, false);
  assert.match(storeOnly.body.reason, /Nothing checks for dangers while the site is closed/, 'a store with no schedule would take subscriptions and never use them');
  const post = await call(ALERTS, { method: 'POST', body: {} }, { env: {} });
  assert.equal(post.statusCode, 503);
});

test('switched on, it publishes one key pair, made once and kept in the store', async () => {
  const w = world();
  const a = await call(ALERTS, {}, { env: ENV, fetch: w.fetch });
  const b = await call(ALERTS, {}, { env: ENV, fetch: w.fetch });
  assert.equal(a.body.available, true);
  assert.equal(b64u.decode(a.body.publicKey).length, 65);
  assert.equal(a.body.publicKey, b.body.publicKey, 'a second request generated a second key pair');
  assert.ok(w.store.kv.get(ALERTS.KEYS.vapid).includes('"d"'), 'the private key is not in the store');
  assert.equal(JSON.stringify(a.body).includes('"d"'), false, 'the private key was published');
  assert.deepEqual(a.body.schedule, { everyMinutes: 5, cron: '*/5 * * * *' });
  assert.equal(a.body.lastRun, null, 'a check was claimed before one had happened');
  assert.match(a.body.keeps, /about 1 km/);
});

test('signing up keeps the subscription and rounded places, and nothing else', async () => {
  const w = world(), a = browser();
  const r = await call(ALERTS, { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body: {
    subscription: a.sub,
    places: [{ kind: 'Home', name: 'Mum’s house, 12 Some Street', lat: 28.613939, lon: 77.209021, country: 'India' },
      { kind: 'Current location', lat: -33.868820, lon: 151.209290 }]
  } }, { env: ENV, fetch: w.fetch });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.scheduled, true);
  const id = ALERTS.subscriptionId(a.sub.endpoint);
  const stored = w.store.kv.get(ALERTS.KEYS.sub(id));
  assert.ok(stored, 'nothing was stored');
  const rec = JSON.parse(stored);
  assert.deepEqual(rec.places, [{ kind: 'Home', lat: 28.61, lon: 77.21 }, { kind: 'Current location', lat: -33.87, lon: 151.21 }]);
  for (const leaked of ['Mum', 'Some Street', 'India', '28.613939', '203.0.113.9']) {
    assert.equal(stored.includes(leaked), false, leaked + ' was kept');
  }
  assert.deepEqual(Object.keys(rec).sort(), ['endpoint', 'keys', 'places', 'updatedAt']);
  const days = (w.store.ttl.get(ALERTS.KEYS.sub(id)) - Date.now()) / 864e5;
  assert.ok(days > 89 && days <= 90, 'the subscription does not expire after 90 days');
  assert.ok(w.store.sets.get(ALERTS.KEYS.subs).has(id));
  assert.equal(w.schedules.length, 1, 'the five-minute check was not scheduled');
  await call(ALERTS, { method: 'POST', body: { subscription: a.sub, places: [{ kind: 'Home', lat: 1, lon: 2 }] } }, { env: ENV, fetch: w.fetch });
  assert.equal(w.schedules.length, 1, 'every sign-up re-created the schedule');
});

test('what cannot be alerted about safely is refused', async () => {
  const w = world(), a = browser();
  const post = body => call(ALERTS, { method: 'POST', body }, { env: ENV, fetch: w.fetch });
  const bad = Object.assign({}, a.sub, { endpoint: 'https://169.254.169.254/latest' });
  assert.equal((await post({ subscription: bad, places: [{ lat: 1, lon: 1 }] })).statusCode, 400);
  assert.equal((await post({ subscription: a.sub, places: [] })).statusCode, 400);
  assert.equal((await post({ subscription: a.sub, places: [{ lat: 91, lon: 0 }] })).statusCode, 400);
  assert.equal((await post({ subscription: a.sub, places: Array(11).fill({ lat: 1, lon: 1 }) })).statusCode, 400);
  assert.equal((await post({ subscription: a.sub, places: [{ lat: null, lon: 1 }] })).statusCode, 400,
    'a missing coordinate was read as zero');
  assert.equal(w.store.kv.has(ALERTS.KEYS.sub(ALERTS.subscriptionId(a.sub.endpoint))), false);
});

test('switching off deletes the device outright', async () => {
  const w = world(), a = browser();
  await call(ALERTS, { method: 'POST', body: { subscription: a.sub, places: [{ kind: 'Home', lat: 1, lon: 2 }] } }, { env: ENV, fetch: w.fetch });
  const id = ALERTS.subscriptionId(a.sub.endpoint);
  const r = await call(ALERTS, { method: 'DELETE', body: { endpoint: a.sub.endpoint } }, { env: ENV, fetch: w.fetch });
  assert.deepEqual(r.body, { ok: true, removed: true });
  assert.equal(w.store.kv.has(ALERTS.KEYS.sub(id)), false);
  assert.equal(w.store.sets.get(ALERTS.KEYS.subs).has(id), false);
});

test('one network cannot flood the store', async () => {
  const w = world(), a = browser();
  let last;
  for (let i = 0; i < 31; i++) {
    last = await call(ALERTS, { method: 'POST', headers: { 'x-forwarded-for': '198.51.100.7' },
      body: { subscription: a.sub, places: [{ lat: 1, lon: 2 }] } }, { env: ENV, fetch: w.fetch });
  }
  assert.equal(last.statusCode, 429);
});

/* -------------------------------------------------------------- the rules */

const NOW = Date.parse('2026-09-23T12:00:00Z');
const HOME = { id: 'h', kind: 'Home', name: 'Home', lat: 30, lon: 70 };
const hoursAgo = h => new Date(NOW - h * 3600e3).toISOString();
const square = (lat, lon, d) => ({ type: 'Polygon', coordinates: [[[lon - d, lat - d], [lon + d, lat - d],
  [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });
function incident(over) {
  return Object.assign({ id: 'q-' + Math.random().toString(36).slice(2), type: 'Earthquake', title: 'M 5.1 earthquake',
    source: 'USGS', sourceType: 'official', evidenceState: 'observed', locationPrecision: 'incident',
    proximityEligible: true, lat: 30.15, lon: 70, alert: 'Green', updated: hoursAgo(2) }, over);
}
const warning = over => Object.assign({ id: 'w-1', type: 'Flood', title: 'Flood Warning', source: 'NOAA / National Weather Service',
  sourceType: 'official', evidenceState: 'official-warning', locationPrecision: 'polygon', geometry: square(30, 70, 0.5),
  lat: 30.1, lon: 70.1, alert: 'Orange', updated: hoursAgo(1), expiresAt: new Date(NOW + 6 * 3600e3).toISOString() }, over);

test('an alert is raised only where the record places the hazard at the place', () => {
  const at = e => RULES.alertFor(e, HOME, H, NOW);
  assert.match(at(warning()).title, /^Flood warning covers your home$/);
  assert.match(at(incident()).title, /^Earthquake 17 km from your home$/);
  assert.equal(at(incident({ lat: 30.6 })), null, 'a minor incident 67 km away is not an alert');
  assert.match(at(incident({ lat: 30.6, alert: 'Red' })).title, /67 km/, 'a severe incident 67 km away should alert');
  assert.equal(at(incident({ lat: 31.2, alert: 'Red' })), null, 'past the severe radius');
  assert.equal(at(incident({ proximityEligible: false, locationPrecision: 'regional' })), null,
    'an area’s centre point was treated as the incident');
  assert.equal(at(incident({ forecast: true, evidenceState: 'forecast' })), null, 'an experimental outlook was pushed');
  assert.equal(at(warning({ expiresAt: hoursAgo(1) })), null, 'an expired warning was pushed');
  assert.equal(at(incident({ cached: true })), null, 'a record retained from an earlier fetch is not news');
  assert.equal(at(incident({ updated: hoursAgo(24 * 10) })), null, 'a ten-day-old record was pushed as news');
  assert.equal(RULES.alertFor(incident(), { kind: 'Home', lat: null, lon: 70 }, H, NOW), null,
    'a place with no latitude was measured from the equator');
});

test('one alert per record, naming the place it bears on most directly', () => {
  const office = { id: 'o', kind: 'Office', lat: 30.1, lon: 70 };
  const list = RULES.alertsFor([incident({ id: 'q1' }), warning()], [HOME, office], H, NOW);
  assert.equal(list.length, 2);
  assert.equal(list[0].eventId, 'w-1', 'being inside a warning should outrank a distance');
  assert.match(list[1].title, /from your office$/, 'the nearer place was not named');
});

/* -------------------------------------------------------------- the run */

async function signedUp(w, places) {
  const a = browser();
  await call(ALERTS, { method: 'POST', body: { subscription: a.sub, places } }, { env: ENV, fetch: w.fetch });
  return a;
}
function runReq(body) {
  return { method: 'POST', headers: { 'upstash-signature': qstashSignature(body || '', 'sig_current'),
    host: 'disasters.example' }, body: body || '' };
}
const feedOf = events => async (req, r) => r.status(200).json({ generatedAt: new Date(NOW).toISOString(), events });

test('nothing runs without the schedule’s signature, and nothing is read', async () => {
  const w = world();
  const r = await call(RUN, { method: 'POST', headers: { 'upstash-signature': qstashSignature('', 'wrong') } },
    { env: ENV, fetch: w.fetch, eventsHandler: feedOf([]) });
  assert.equal(r.statusCode, 401);
  assert.equal(w.store.calls.length, 0, 'the store was read for an unsigned request');
  const noSig = await call(RUN, { method: 'POST' }, { env: ENV, fetch: w.fetch, eventsHandler: feedOf([]) });
  assert.equal(noSig.statusCode, 401);
});

test('a run sends each device what bears on its places, once, and says what it did', async () => {
  const w = world();
  const a = await signedUp(w, [{ kind: 'Home', lat: 30, lon: 70 }]);
  const far = await signedUp(w, [{ kind: 'Home', lat: -40, lon: -70 }]);
  const events = [warning(), incident({ id: 'q-near' }), incident({ id: 'q-far', lat: 35 }),
    incident({ id: 'f', forecast: true, evidenceState: 'forecast' })];
  const deps = { env: ENV, fetch: w.fetch, eventsHandler: feedOf(events), now: NOW };

  const first = await call(RUN, runReq(), deps);
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.body.ran, true);
  assert.equal(w.pushes.length, 2, 'expected the warning and the nearby incident, and nothing for the far device');
  assert.ok(w.pushes.every(p => p.url === a.sub.endpoint));
  const got = w.pushes.map(p => JSON.parse(a.decrypt(p.body)));
  assert.deepEqual(got.map(g => g.title), ['Flood warning covers your home', 'Earthquake 17 km from your home']);
  assert.equal(got[0].url, '/alerts/w-1');
  assert.ok(w.pushes.every(p => p.headers['Content-Encoding'] === 'aes128gcm' && /^vapid t=/.test(p.headers.Authorization)));
  assert.throws(() => far.decrypt(w.pushes[0].body), 'another device could read the alert');
  assert.deepEqual([first.body.subscriptions, first.body.alerted, first.body.sent, first.body.failed], [2, 1, 2, 0]);

  const second = await call(RUN, runReq(), deps);
  assert.equal(second.body.sent, 0, 'the same records were sent again');
  assert.equal(w.pushes.length, 2);

  /* The same record, rated more severely, is new. */
  const worse = await call(RUN, runReq(), Object.assign({}, deps,
    { eventsHandler: feedOf([incident({ id: 'q-near', alert: 'Red' })]) }));
  assert.equal(worse.body.sent, 1, 'an escalation was treated as already told');

  const last = JSON.parse(w.store.kv.get(ALERTS.KEYS.lastRun));
  assert.equal(last.at, new Date(NOW).toISOString());
  assert.equal(JSON.stringify(last).includes(a.sub.endpoint), false, 'the run log names a device');
});

test('a burst is three alerts and a summary, not a flood', async () => {
  const w = world();
  const a = await signedUp(w, [{ kind: 'Home', lat: 30, lon: 70 }]);
  const events = [0, 1, 2, 3, 4, 5].map(i => incident({ id: 'q' + i, lat: 30 + i * 0.01 }));
  const r = await call(RUN, runReq(), { env: ENV, fetch: w.fetch, eventsHandler: feedOf(events), now: NOW });
  assert.equal(r.body.sent, 4);
  const titles = w.pushes.map(p => JSON.parse(a.decrypt(p.body)).title);
  assert.equal(titles[3], '3 more hazards near your places');
});

test('a device the push service has forgotten is forgotten here too', async () => {
  const w = world();
  const a = await signedUp(w, [{ kind: 'Home', lat: 30, lon: 70 }]);
  w.setPush(() => 410);
  const r = await call(RUN, runReq(), { env: ENV, fetch: w.fetch, eventsHandler: feedOf([warning()]), now: NOW });
  assert.equal(r.body.removed, 1);
  const id = ALERTS.subscriptionId(a.sub.endpoint);
  assert.equal(w.store.kv.has(ALERTS.KEYS.sub(id)), false);
  assert.equal(w.store.sets.get(ALERTS.KEYS.subs).has(id), false);
});

test('an alert that failed to send is tried again, not remembered as sent', async () => {
  const w = world();
  await signedUp(w, [{ kind: 'Home', lat: 30, lon: 70 }]);
  const deps = { env: ENV, fetch: w.fetch, eventsHandler: feedOf([warning()]), now: NOW };
  w.setPush(() => 503);
  const first = await call(RUN, runReq(), deps);
  assert.deepEqual([first.body.sent, first.body.failed], [0, 1]);
  w.setPush(() => 201);
  const second = await call(RUN, runReq(), deps);
  assert.equal(second.body.sent, 1, 'the undelivered alert was never retried');
});

test('two deliveries of one tick do not both send', async () => {
  const w = world();
  await signedUp(w, [{ kind: 'Home', lat: 30, lon: 70 }]);
  let release;
  const slow = (req, r) => new Promise(res => { release = () => res(r.status(200).json({ events: [warning()] })); });
  const deps = { env: ENV, fetch: w.fetch, eventsHandler: slow, now: NOW };
  const one = call(RUN, runReq(), deps);
  await new Promise(r => setTimeout(r, 20));
  const two = await call(RUN, runReq(), deps);
  assert.equal(two.body.ran, false);
  assert.match(two.body.reason, /already in progress/);
  release();
  assert.equal((await one).body.sent, 1);
});

test('the run reads the same live feed the site serves', async () => {
  const { callApi } = require('./render.js');
  const feed = await RUN.loadFeed(async (req, r) => {
    const out = await callApi(require('../api/events.js'), '/api/events');
    return r.status(out.status).json(await out.json());
  });
  assert.ok(Array.isArray(feed.events) && feed.events.length > 0);
  await assert.rejects(RUN.loadFeed(async (req, r) => r.status(500).json({ error: 'x' })), /live feed/);
});

/* --------------------------------------------------------- service worker */

function worker() {
  const listeners = {}, shown = [], opened = [];
  const self = {
    location: { origin: 'https://disasters.example' },
    addEventListener: (t, f) => { listeners[t] = f; },
    skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [], openWindow: async u => { opened.push(u); } },
    registration: { showNotification: async (t, o) => { shown.push({ t, o }); } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), { self, URL, JSON, Date, caches: {}, fetch: async () => ({}) });
  const fire = async (type, ev) => {
    let p = Promise.resolve();
    listeners[type](Object.assign({ waitUntil: x => { p = x; } }, ev));
    await p;
  };
  return { fire, shown, opened };
}

test('the worker shows what was pushed, and opens only this site', async () => {
  const w = worker();
  await w.fire('push', { data: { json: () => ({ title: 'Flood warning covers your home', body: 'b', url: '/alerts/w-1', tag: 'pnd-w-1' }) } });
  assert.equal(w.shown[0].t, 'Flood warning covers your home');
  assert.equal(w.shown[0].o.tag, 'pnd-w-1');
  assert.equal(w.shown[0].o.data.url, '/alerts/w-1');
  await w.fire('push', { data: { json: () => { throw new Error('not JSON'); } } });
  assert.equal(w.shown[1].t, 'Predict Natural Disasters', 'an unreadable push invented a hazard');
  await w.fire('notificationclick', { notification: { close() {}, data: { url: '/alerts/w-1' } } });
  await w.fire('notificationclick', { notification: { close() {}, data: { url: 'https://evil.example/phish' } } });
  assert.deepEqual(w.opened, ['https://disasters.example/alerts/w-1', 'https://disasters.example/personal-risk']);
});

/* ------------------------------------------------------------------ page */

const hasText = re => d => re.test((d.getElementById('alertsStatus') || {}).textContent || '');

test('where the service is off, the page offers only what works, and says it as a benefit', async () => {
  /* It used to say "Background alerts are not switched on for this site yet.
     It has nowhere to keep your alert settings ...", which read as a note
     about an unfinished backend (launch audit A13). What it says now is what
     still works for the reader, and where to get alerts that reach a phone. */
  const r = await renderPage('personal-risk.html', { waitFor: hasText(/While this page is open, we tell you/) });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const status = r.document.getElementById('alertsStatus').textContent;
  assert.doesNotMatch(status, /not switched on|nowhere to keep/);
  assert.match(status, /While this page is open, we tell you when a danger is reported/);
  assert.match(status, /Nothing is sent once you close it/);
  assert.match(status, /sign up with your national or regional disaster agency/);
  assert.equal(r.document.getElementById('alertsToggle').textContent, 'Alert me while this page is open');
  r.close();
});

function pushBrowser(w, posted, opts) {
  opts = opts || {};
  return function beforeParse(win) {
    const permission = { v: 'default' };
    function N() {}
    Object.defineProperty(N, 'permission', { get: () => permission.v });
    N.requestPermission = async () => { permission.v = 'granted'; return 'granted'; };
    win.Notification = N;
    win.PushManager = function () {};
    let sub = null;
    const pm = {
      getSubscription: async () => sub,
      subscribe: async o => {
        assert.ok(o.userVisibleOnly);
        assert.equal(o.applicationServerKey.length, 65, 'the server key was not passed as bytes');
        sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/page-test', toJSON: () => ({ endpoint: sub.endpoint,
          keys: browser().sub.keys }), unsubscribe: async () => { sub = null; return true; } };
        return sub;
      }
    };
    const reg = { pushManager: pm };
    Object.defineProperty(win.navigator, 'serviceWorker', { value: {
      register: async () => reg, ready: Promise.resolve(reg), getRegistration: async () => reg, controller: null } });
    if (opts.coords) {
      Object.defineProperty(win.navigator, 'geolocation', { value: {
        getCurrentPosition: ok => ok({ coords: opts.coords }) } });
    }
    const real = win.fetch;
    win.fetch = async (input, init) => {
      const url = String(input && input.url ? input.url : input);
      if (/\/api\/alerts/.test(url)) {
        const method = (init && init.method) || 'GET';
        const body = init && init.body ? JSON.parse(init.body) : undefined;
        if (method !== 'GET') posted.push({ method, body });
        const out = await call(ALERTS, { method, body, headers: {} }, { env: ENV, fetch: w.fetch });
        return { ok: out.statusCode < 300, status: out.statusCode, json: async () => out.body };
      }
      return real(input, init);
    };
  };
}

test('where it is on, one tap subscribes this device and sends only kinds and rounded positions', async () => {
  const w = world(), posted = [];
  const place = { id: 'p1', kind: 'Home', name: 'Mum’s house, 12 Some Street', lat: 28.613939, lon: 77.209021, country: 'India' };
  const r = await renderPage('personal-risk.html', {
    storage: { pnd_saved_locations: JSON.stringify([place]) },
    beforeParse: pushBrowser(w, posted),
    waitFor: hasText(/Get an alert on this device/)
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  const toggle = r.document.getElementById('alertsToggle');
  assert.equal(toggle.textContent, 'Turn on alerts');
  assert.match(r.document.getElementById('alertsKeeps').textContent, /about 1 km/);
  toggle.click();
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !/^On for/.test(r.document.getElementById('alertsStatus').textContent)) {
    await new Promise(res => setTimeout(res, 30));
  }
  assert.match(r.document.getElementById('alertsStatus').textContent, /^Alerts are on for 1 place on this device/);
  assert.equal(toggle.textContent, 'Turn off alerts');
  const signup = posted.find(p => p.method === 'POST');
  assert.deepEqual(signup.body.places, [{ kind: 'Home', lat: 28.61, lon: 77.21 }]);
  assert.equal(JSON.stringify(signup.body).includes('Some Street'), false, 'the place name left the browser');
  assert.equal(w.store.sets.get(ALERTS.KEYS.subs).size, 1);

  toggle.click();
  const until = Date.now() + 4000;
  while (Date.now() < until && toggle.textContent !== 'Turn on alerts') await new Promise(res => setTimeout(res, 30));
  assert.ok(posted.some(p => p.method === 'DELETE'), 'switching off did not tell the service');
  assert.equal(w.store.sets.get(ALERTS.KEYS.subs).size, 0, 'the device was not deleted');
  r.close();
});

test('the current location is saved to the nearest kilometre, named locally, and kept in step', async () => {
  const w = world(), posted = [];
  const r = await renderPage('personal-risk.html', {
    beforeParse: pushBrowser(w, posted, { coords: { latitude: 19.076090, longitude: 72.877426 } }),
    waitFor: hasText(/Get an alert on this device/)
  });
  r.document.getElementById('useLocation').click();
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && !/Saved as/.test(r.document.getElementById('locationStatus').textContent)) {
    await new Promise(res => setTimeout(res, 30));
  }
  assert.match(r.document.getElementById('locationStatus').textContent, /nearest kilometre \(India\)/);
  const saved = JSON.parse(r.window.localStorage.getItem('pnd_saved_locations'));
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].kind, saved[0].lat, saved[0].lon, saved[0].country], ['Current location', 19.08, 72.88, 'India']);
  assert.equal(r.apiCalls.some(u => /nominatim/.test(u)), false, 'the position was sent away to be named');
  /* Using it again replaces it rather than adding a second. */
  r.document.getElementById('useLocation').click();
  await new Promise(res => setTimeout(res, 200));
  assert.equal(JSON.parse(r.window.localStorage.getItem('pnd_saved_locations')).length, 1);
  r.close();
});

test('the page and the service link a record to the same detail page', async () => {
  const r = await renderPage('personal-risk.html', { waitFor: d => !!d.getElementById('alertsStatus') });
  const PND = r.window.PND, R = r.window.PNDAlertRules;
  for (const e of [warning(), warning({ alert: 'Yellow' }), incident(), { id: 'OUT-1', forecast: true }]) {
    assert.equal(R.urlFor(e), PND.eventUrl(e), 'the pushed link and the page disagree for ' + e.id);
  }
  r.close();
});

/* ------------------------------------------------- the home page, personalised */

test('a returning reader is answered for their own place first, without asking', async () => {
  const home = { id: 'loc-1', kind: 'Home', name: 'Delhi home', lat: 28.61, lon: 77.21, country: 'India' };
  const here = { id: 'loc-current', kind: 'Current location', name: 'Current location', lat: 19.08, lon: 72.88, country: 'India' };
  const r = await renderPage('index.html', {
    storage: { pnd_saved_locations: JSON.stringify([home, here]) },
    timeoutMs: 15000,
    waitFor: d => d.getElementById('placeResult') && !d.getElementById('placeResult').hidden
  });
  assert.equal(r.errors.length, 0, r.errors.map(String).join('|'));
  assert.equal(r.document.getElementById('placeResult').hidden, false, 'the reader’s place was not answered');
  assert.match(r.document.getElementById('checkNote').textContent, /Showing your current location/,
    'the current location should come before other saved places');
  assert.match(r.document.querySelector('#placeResult h2').textContent, /Current location/);
  r.close();

  const fresh = await renderPage('index.html', { timeoutMs: 8000,
    waitFor: d => (d.getElementById('lastUpdated') || {}).textContent !== '' });
  assert.equal(fresh.document.getElementById('placeResult').hidden, true,
    'a first-time reader was shown an answer for a place they never gave');
  fresh.close();
});

test('“Use my location” on the home page names the country locally', async () => {
  const r = await renderPage('index.html', {
    timeoutMs: 15000,
    beforeParse(w) {
      Object.defineProperty(w.navigator, 'geolocation', { value: {
        getCurrentPosition: ok => ok({ coords: { latitude: 48.8566, longitude: 2.3522 } }) } });
      w.HTMLElement.prototype.scrollIntoView = function () {};   // jsdom has none
    },
    waitFor: d => (d.getElementById('lastUpdated') || {}).textContent !== ''
  });
  r.document.getElementById('useLoc').click();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !/France/.test(r.document.getElementById('checkNote').textContent)) {
    await new Promise(res => setTimeout(res, 30));
  }
  assert.match(r.document.getElementById('checkNote').textContent, /in France/);
  assert.equal(r.apiCalls.some(u => /nominatim/.test(u)), false, 'the position was sent away to be named');
  r.close();
});
