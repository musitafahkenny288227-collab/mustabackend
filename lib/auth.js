const crypto = require('crypto');
const config = require('./config');

function b64url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64decode(str) {
  const normalized = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLength), 'base64').toString('utf8');
}

function b64urlDecode(str) {
  const normalized = String(str || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLength), 'base64');
}

function signJWT(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
  }));

  const sig = crypto.createHmac('sha256', config.JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;

    const expected = crypto.createHmac('sha256', config.JWT_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest();
    const received = b64urlDecode(parts[2]);

    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;

    const payload = JSON.parse(b64decode(parts[1]));
    if (!payload || typeof payload !== 'object' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function getUser(req) {
  const authHeader = req && req.headers ? (req.headers.authorization || req.headers.Authorization || '') : '';
  const match = String(authHeader).match(/^\s*Bearer\s+(.+?)\s*$/i);
  const token = match ? match[1] : null;
  return token ? verifyJWT(token) : null;
}

module.exports = {
  signJWT,
  verifyJWT,
  getUser
};
