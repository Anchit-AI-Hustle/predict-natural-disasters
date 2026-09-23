'use strict';
/**
 * The schedule that makes alerts "background": Upstash QStash calls
 * /api/alerts-run every five minutes, whether or not anyone has the site open.
 *
 * Vercel's own cron was not used: on the Hobby plan it runs at most once a
 * day, and a deployment asking for more is rejected outright. The repository's
 * GitHub Actions schedule was not used either - measured, it fires about a
 * fortieth as often as it asks to (see refreshTarget in api/events.js), which
 * is no basis for a warning.
 */
const crypto = require('crypto');

const CRON = '*/5 * * * *';
const SCHEDULE_ID = 'pnd-background-alerts';

function config(env) {
  env = env || process.env;
  const token = env.QSTASH_TOKEN || '';
  const keys = [env.QSTASH_CURRENT_SIGNING_KEY, env.QSTASH_NEXT_SIGNING_KEY].filter(Boolean);
  if (!token || !keys.length) return null;
  return { token, keys, url: String(env.QSTASH_URL || 'https://qstash.upstash.io').replace(/\/+$/, '') };
}

const b64u = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unpad = s => String(s || '').replace(/=+$/, '');

/**
 * Is this request really from the schedule?
 *
 * QStash signs every delivery with a JWT (HS256) under the current or the
 * next signing key - both are accepted so a key rotation does not drop a
 * cycle. The token binds the exact body by its SHA-256, so a captured
 * signature cannot be replayed with anything else, and it expires.
 */
function verify(signature, rawBody, keys, nowMs) {
  const parts = String(signature || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'no signature' };
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    claims = JSON.parse(Buffer.from(parts[1], 'base64').toString());
  } catch (e) { return { ok: false, reason: 'malformed signature' }; }
  if (header.alg !== 'HS256') return { ok: false, reason: 'unexpected algorithm' };
  const input = parts[0] + '.' + parts[1];
  const given = Buffer.from(unpad(parts[2]));
  const signed = (keys || []).some(k => {
    const want = Buffer.from(b64u(crypto.createHmac('sha256', k).update(input).digest()));
    return want.length === given.length && crypto.timingSafeEqual(want, given);
  });
  if (!signed) return { ok: false, reason: 'signature does not verify' };
  const now = Math.floor((nowMs || Date.now()) / 1000);
  if (claims.iss !== 'Upstash') return { ok: false, reason: 'wrong issuer' };
  if (typeof claims.exp === 'number' && now > claims.exp + 60) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && now < claims.nbf - 60) return { ok: false, reason: 'not yet valid' };
  const bodyHash = b64u(crypto.createHash('sha256').update(rawBody || '').digest());
  if (unpad(claims.body) !== bodyHash) return { ok: false, reason: 'body does not match' };
  return { ok: true, claims };
}

/**
 * Create the schedule, or bring it back to this destination and cadence.
 *
 * The id is fixed, so calling this again updates the one schedule rather than
 * adding another: a second subscriber cannot double the rate.
 */
async function ensureSchedule(cfg, destination, fetchImpl) {
  const res = await (fetchImpl || fetch)(cfg.url + '/v2/schedules/' + destination, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      'Upstash-Cron': CRON,
      'Upstash-Schedule-Id': SCHEDULE_ID,
      'Upstash-Retries': '1'
    },
    signal: AbortSignal.timeout(8000)
  });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  if (!res.ok) throw new Error('schedule ' + res.status + ': ' + ((body && body.error) || 'not created'));
  return { scheduleId: (body && body.scheduleId) || SCHEDULE_ID, cron: CRON, destination };
}

module.exports = { config, verify, ensureSchedule, CRON, SCHEDULE_ID };
