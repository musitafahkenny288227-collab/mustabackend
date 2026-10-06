const crypto = require('crypto');
const config = require('./config');

function b64url(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64decode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
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
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const expected = crypto.createHmac('sha256', config.JWT_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const a = Buffer.from(expected);
    const b = Buffer.from(parts[2]);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(b64decode(parts[1]));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function getUser(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return token ? verifyJWT(token) : null;
}

module.exports = {
  signJWT,
  verifyJWT,
  getUser
};
