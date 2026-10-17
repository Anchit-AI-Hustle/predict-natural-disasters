'use strict';
/* Small request helpers shared by the alert functions. */

/*
 * Query parameters, read from req.url with the WHATWG URL API.
 *
 * Never from req.query: Vercel's Node runtime defines it as a lazy property
 * whose first read parses req.url with the deprecated url.parse()
 * (@vercel/node-bridge, helpers.js, getQueryParser), which logged DEP0169 on
 * /api/events and /api/event-enrichment. A plain query object is used only
 * for keys the URL does not carry, as tests and internal calls pass one, and
 * only when it is a plain value, so the runtime's getter is never run.
 */
function queryOf(req) {
  const out = {};
  if (!req) return out;
  if (typeof req.url === 'string') {
    try { new URL(req.url, 'http://local').searchParams.forEach((v, k) => { if (!(k in out)) out[k] = v; }); }
    catch (e) { /* not a URL; nothing to read */ }
  }
  const d = Object.getOwnPropertyDescriptor(req, 'query');
  if (d && 'value' in d && d.value && typeof d.value === 'object') {
    for (const k of Object.keys(d.value)) if (!(k in out)) out[k] = d.value[k];
  }
  return out;
}

/** The raw request body as a string, whether or not the runtime parsed it. */
async function rawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.rawBody === 'string') return req.rawBody;
  const b = req.body;
  if (Buffer.isBuffer(b)) return b.toString('utf8');
  if (typeof b === 'string') return b;
  if (b && typeof b === 'object' && Object.keys(b).length) return JSON.stringify(b);
  if (typeof req.on !== 'function' || req.readableEnded) return '';
  return new Promise(resolve => {
    const chunks = [];
    const done = () => resolve(Buffer.concat(chunks).toString('utf8'));
    const t = setTimeout(done, 2000);
    req.on('data', c => chunks.push(Buffer.from(c)));
    req.on('end', () => { clearTimeout(t); done(); });
    req.on('error', () => { clearTimeout(t); done(); });
  });
}

/** The parsed JSON body, or null. Anything over `limit` bytes is refused. */
async function jsonBody(req, limit) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) {
    return JSON.stringify(b).length <= limit ? b : null;
  }
  const raw = await rawBody(req);
  if (!raw || raw.length > limit) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function header(req, name) {
  const h = (req && req.headers) || {};
  const v = h[name] !== undefined ? h[name] : h[String(name).toLowerCase()];
  return Array.isArray(v) ? v[0] : (v == null ? '' : String(v));
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).json(body);
}

module.exports = { queryOf, rawBody, jsonBody, header, send };
