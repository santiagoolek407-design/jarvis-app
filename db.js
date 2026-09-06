const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

let pool = null;
if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });
} else {
  console.warn('⚠️  No se encontró DATABASE_URL. Nada de esto va a funcionar sin base de datos.');
}

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      assistant_name TEXT NOT NULL DEFAULT 'Jarvis',
      user_display_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS assistant_name TEXT NOT NULL DEFAULT 'Jarvis';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS user_display_name TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Nueva conversación',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      parts JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log('🗄️  Base de datos lista (users + conversations + messages).');
}

async function createUser(email, passwordHash) {
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
    [email, passwordHash]
  );
  return rows[0];
}

async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function getSettings(userId) {
  const { rows } = await pool.query(
    'SELECT assistant_name, user_display_name FROM users WHERE id = $1',
    [userId]
  );
  return rows[0] || { assistant_name: 'Jarvis', user_display_name: null };
}

async function updateSettings(userId, { assistantName, userDisplayName }) {
  await pool.query(
    'UPDATE users SET assistant_name = $1, user_display_name = $2 WHERE id = $3',
    [assistantName || 'Jarvis', userDisplayName || null, userId]
  );
}

async function listConversations(userId) {
  const { rows } = await pool.query(
    'SELECT id, title, created_at FROM conversations WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

async function createConversation(userId, title = 'Nueva conversación') {
  const { rows } = await pool.query(
    'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id, title, created_at',
    [userId, title]
  );
  return rows[0];
}

async function ensureConversation(userId, conversationId) {
  if (conversationId) {
    const { rows } = await pool.query(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
      [conversationId, userId]
    );
    if (rows[0]) return rows[0].id;
  }
  const created = await createConversation(userId);
  return created.id;
}

async function maybeSetTitle(conversationId, firstUserText) {
  const { rows } = await pool.query('SELECT title FROM conversations WHERE id = $1', [conversationId]);
  if (rows[0] && rows[0].title === 'Nueva conversación') {
    const title = firstUserText.slice(0, 48) + (firstUserText.length > 48 ? '…' : '');
    await pool.query('UPDATE conversations SET title = $1 WHERE id = $2', [title, conversationId]);
  }
}

async function deleteConversation(userId, conversationId) {
  await pool.query('DELETE FROM conversations WHERE id = $1 AND user_id = $2', [conversationId, userId]);
}

async function loadHistory(userId, conversationId, limit = 200) {
  if (!conversationId) return [];
  const owns = await pool.query('SELECT id FROM conversations WHERE id = $1 AND user_id = $2', [conversationId, userId]);
  if (!owns.rows[0]) return [];
  const { rows } = await pool.query(
    'SELECT role, parts FROM messages WHERE conversation_id = $1 ORDER BY id ASC LIMIT $2',
    [conversationId, limit]
  );
  return rows.map((r) => ({ role: r.role, parts: r.parts }));
}

async function saveMessage(conversationId, role, parts) {
  await pool.query(
    'INSERT INTO messages (conversation_id, role, parts) VALUES ($1, $2, $3)',
    [conversationId, role, JSON.stringify(parts)]
  );
}

module.exports = {
  initDb,
  createUser,
  getUserByEmail,
  getSettings,
  updateSettings,
  listConversations,
  createConversation,
  ensureConversation,
  maybeSetTitle,
  deleteConversation,
  loadHistory,
  saveMessage,
  isEnabled: () => !!pool,
};