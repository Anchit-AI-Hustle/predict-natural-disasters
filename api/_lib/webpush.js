'use strict';
/**
 * Web Push, written against the two RFCs rather than pulled in as a package.
 *
 *   RFC 8291  Message Encryption for Web Push (aes128gcm, RFC 8188 framing)
 *   RFC 8292  VAPID - identifying this server to the push service
 *
 * The site has no package.json at its root and every function so far runs on
 * Node's standard library alone. Both halves are small, and both are checked
 * in the tests against an independent decryption of what this produces.
 *
 * Nothing here holds a secret. The VAPID private key is supplied by the caller
 * (see store.js: it lives in the alert store, never in the repository).
 */
const crypto = require('crypto');

const b64u = {
  encode: buf => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: str => Buffer.from(String(str || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
};

/* ------------------------------------------------------------------ VAPID */

/** A fresh P-256 key pair, in the forms the rest of this file uses. */
function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { publicKey: b64u.encode(rawPublicKey(publicKey)), privateJwk: jwk };
}

/** The uncompressed point (65 bytes) the browser's applicationServerKey wants. */
function rawPublicKey(keyObject) {
  const jwk = keyObject.export({ format: 'jwk' });
  return Buffer.concat([Buffer.from([4]), b64u.decode(jwk.x), b64u.decode(jwk.y)]);
}

/**
 * The Authorization header for one request to one push service.
 *
 * The audience is the push service's origin, not the endpoint: a token is
 * scoped to whoever receives it. Twelve hours is well inside the 24-hour
 * ceiling RFC 8292 sets.
 */
function vapidHeader(endpoint, vapid, subject, nowMs) {
  const aud = new URL(endpoint).origin;
  const now = Math.floor((nowMs || Date.now()) / 1000);
  const header = b64u.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u.encode(JSON.stringify({ aud, exp: now + 12 * 3600, sub: subject }));
  const input = header + '.' + claims;
  const key = crypto.createPrivateKey({ key: vapid.privateJwk, format: 'jwk' });
  /* JOSE wants r||s, not the DER that sign() returns by default. */
  const sig = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + input + '.' + b64u.encode(sig) + ', k=' + vapid.publicKey;
}

/* ------------------------------------------------------------- encryption */

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

/**
 * Encrypt one payload for one subscription (RFC 8291 section 3, RFC 8188).
 *
 * `opts.salt` and `opts.localKey` exist only so the tests can reproduce a
 * known output; in use both are fresh for every message.
 */
function encrypt(payload, keys, opts) {
  opts = opts || {};
  const uaPublic = b64u.decode(keys && keys.p256dh);
  const authSecret = b64u.decode(keys && keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('p256dh is not an uncompressed P-256 point');
  if (authSecret.length !== 16) throw new Error('auth secret is not 16 bytes');

  const local = opts.localKey || crypto.createECDH('prime256v1');
  if (!opts.localKey) local.generateKeys();
  const asPublic = local.getPublicKey();
  const ecdhSecret = local.computeSecret(uaPublic);
  const salt = opts.salt || crypto.randomBytes(16);

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);

  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);

  /* One record: the payload, then the 0x02 delimiter that marks it as last. */
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/* -------------------------------------------------------------- endpoints */

/**
 * The push services a subscription may point at.
 *
 * The endpoint comes from the browser, which means from whoever sends the
 * request, and this server will POST to it on a schedule. Without a list it
 * is a way to make this site send requests anywhere - an internal address, a
 * third party - so only the services browsers actually use are accepted.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Edge on Android, Opera, Samsung Internet
  /^android\.googleapis\.com$/,             // older Chrome endpoints
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.notify\.windows\.com$/,     // Edge on Windows
  /^web\.push\.apple\.com$/,                // Safari
  /^[a-z0-9-]+\.push\.apple\.com$/
];

function endpointAllowed(endpoint) {
  let u;
  try { u = new URL(String(endpoint || '')); } catch (e) { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
  return PUSH_HOSTS.some(re => re.test(u.hostname));
}

/**
 * Send one message. Resolves to { ok, status, gone }: `gone` means the push
 * service says this subscription no longer exists and it should be forgotten.
 */
async function send(subscription, payload, vapid, subject, fetchImpl, opts) {
  opts = opts || {};
  if (!endpointAllowed(subscription && subscription.endpoint)) {
    return { ok: false, status: 0, gone: true, error: 'endpoint not allowed' };
  }
  const body = encrypt(payload, subscription.keys);
  const res = await (fetchImpl || fetch)(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl || 6 * 3600),
      Urgency: opts.urgency || 'high',
      Authorization: vapidHeader(subscription.endpoint, vapid, subject)
    },
    body,
    signal: AbortSignal.timeout(opts.timeoutMs || 10000)
  });
  const status = res.status;
  return { ok: status >= 200 && status < 300, status, gone: status === 404 || status === 410 };
}

module.exports = { b64u, generateVapidKeys, vapidHeader, encrypt, endpointAllowed, send, PUSH_HOSTS };
