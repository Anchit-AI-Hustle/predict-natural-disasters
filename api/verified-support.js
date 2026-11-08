'use strict';
/*
 * GET /api/verified-support[?country=<name>]
 *
 * The verified support directory, read-only. The directory itself lives in
 * api/_lib/verified-support.js: Vercel deploys every api/*.js as a function,
 * and while the data sat here as a module with no handler, this address
 * answered 500 FUNCTION_INVOCATION_FAILED. Files under api/_lib are not
 * deployed as functions.
 *
 * CommonJS on purpose (see api/_lib/verified-support.js for why).
 */
const { queryOf } = require('./_lib/http.js');
const support = require('./_lib/verified-support.js');

function handler(req, res) {
  /* The directory changes only with a deployment. */
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
  const q = queryOf(req);
  const body = {
    globalRelief: support.GLOBAL_RELIEF,
    directories: support.GLOBAL_DIRECTORIES,
    countries: Object.keys(support.COUNTRY_SUPPORT).sort()
  };
  if (q.country) body.country = support.supportFor(String(q.country), q.region ? String(q.region) : '');
  res.status(200).json(body);
}

module.exports = handler;
module.exports.default = handler;
