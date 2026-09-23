'use strict';
/* Small request helpers shared by the alert functions. */

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

module.exports = { rawBody, jsonBody, header, send };
