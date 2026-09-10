'use strict';

function getPolarApiBase(sandbox) {
  return sandbox ? 'https://sandbox-api.polar.sh/v1' : 'https://api.polar.sh/v1';
}

/**
 * @param {string} path
 * @param {Object} opts
 * @param {string} opts.method
 * @param {Object} [opts.body]
 * @param {string} opts.accessToken
 * @param {boolean} [opts.sandbox=false]
 */
async function polarApiRequest(path, { method = 'GET', body, accessToken, sandbox = false } = {}) {
  if (!accessToken) {
    throw new Error('POLAR_ACCESS_TOKEN is not configured');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const res = await fetch(`${getPolarApiBase(sandbox)}${normalizedPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }
  }

  if (!res.ok) {
    const detail = typeof data?.detail === 'string'
      ? data.detail
      : JSON.stringify(data?.detail || data?.error || data?.error_description || raw).slice(0, 500);
    throw new Error(`Polar API ${res.status}: ${detail}`);
  }

  return data || {};
}

module.exports = {
  getPolarApiBase,
  polarApiRequest,
};
