const crypto = require('crypto');

const PASSWORD = process.env.JARVIS_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || 'cambia-esto-en-produccion';
const COOKIE_NAME = 'jarvis_auth';

function expectedToken() {
  return crypto.createHmac('sha256', SECRET).update('jarvis-authenticated').digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function isAuthed(req) {
  if (!PASSWORD) return true;
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] === expectedToken();
}

function login(password) {
  if (!PASSWORD) return null;
  if (password !== PASSWORD) return false;
  return expectedToken();
}

const PUBLIC_PATHS = new Set(['/login.html', '/login.css', '/login.js', '/api/login']);

function authMiddleware(req, res, next) {
  if (!PASSWORD) return next();
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (isAuthed(req)) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  return res.redirect('/login.html');
}

module.exports = { authMiddleware, login, COOKIE_NAME, isPasswordSet: () => !!PASSWORD };
