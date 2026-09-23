'use strict';
/**
 * The alert store: Upstash Redis over its REST interface.
 *
 * Background alerts need somewhere to keep a browser's push subscription and
 * the places it asked about, because the whole point is that the page is
 * closed when the check runs. That cannot live in this repository - it is
 * personal, it changes constantly, and the repository is public - so without
 * a store the service is not offered at all (see api/alerts.js).
 *
 * The Vercel Marketplace integration names its variables KV_REST_API_*; a
 * store connected directly from Upstash uses UPSTASH_REDIS_REST_*. Either is
 * read. Nothing else about the store is assumed.
 */
function config(env) {
  env = env || process.env;
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '';
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

function client(env, fetchImpl) {
  const c = config(env);
  if (!c) return null;
  const f = fetchImpl || fetch;
  const call = async (path, body) => {
    const res = await f(c.url + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000)
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) throw new Error('store ' + res.status + ': ' + ((data && data.error) || 'request failed'));
    return data;
  };
  return {
    /** One command, e.g. cmd('SET', key, value, 'NX'). */
    async cmd(...args) {
      const d = await call('', args.map(String));
      if (d && d.error) throw new Error('store: ' + d.error);
      return d ? d.result : null;
    },
    /** Several commands in one round trip; resolves to their results in order. */
    async pipeline(cmds) {
      if (!cmds.length) return [];
      const d = await call('/pipeline', cmds.map(a => a.map(String)));
      return (d || []).map(r => (r && r.error) ? { error: r.error } : (r ? r.result : null));
    }
  };
}

module.exports = { config, client };
