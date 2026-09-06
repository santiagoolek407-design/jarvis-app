const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || 'cambia-esto-en-produccion';
const COOKIE_NAME = 'jarvis_session';

// ---------- Contraseñas ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const testHash = crypto.scryptSync(password, salt, 64);
  return hashBuffer.length === testHash.length && crypto.timingSafeEqual(hashBuffer, testHash);
}

// ---------- Cookie de sesión (firmada, sin necesitar guardar sesiones en el servidor) ----------
function sign(userId) {
  return crypto.createHmac('sha256', SECRET).update(String(userId)).digest('hex');
}

function makeSessionCookie(userId) {
  const value = `${userId}.${sign(userId)}`;
  return `${COOKIE_NAME}=${value}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function getUserId(req) {
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  const [userId, signature] = raw.split('.');
  if (!userId || !signature) return null;
  if (sign(userId) !== signature) return null;
  return Number(userId);
}

// Solo estas rutas HTML/API quedan accesibles sin haber iniciado sesión.
const PUBLIC_API = new Set(['/api/signup', '/api/login']);

function authMiddleware(req, res, next) {
  const isApp = req.path === '/' || req.path === '/index.html';
  const isApi = req.path.startsWith('/api/');

  if (isApi) {
    if (PUBLIC_API.has(req.path)) return next();
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: 'No autenticado' });
    req.userId = userId;
    return next();
  }

  if (isApp) {
    const userId = getUserId(req);
    if (!userId) return res.redirect('/login.html');
  }

  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  makeSessionCookie,
  clearSessionCookie,
  getUserId,
  authMiddleware,
};