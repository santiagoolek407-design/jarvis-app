const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

let pool = null;
if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });
} else {
  console.warn('⚠️  No se encontró DATABASE_URL. La memoria persistente estará desactivada.');
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Nueva conversación',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      parts JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('🗄️  Base de datos lista (conversations + messages).');
}

async function listConversations() {
  if (!pool) return [];
  const { rows } = await pool.query(`
    SELECT c.id, c.title, c.created_at
    FROM conversations c
    ORDER BY c.created_at DESC
  `);
  return rows;
}

async function createConversation(title = 'Nueva conversación') {
  if (!pool) return { id: null, title, created_at: new Date().toISOString() };
  const { rows } = await pool.query(
    'INSERT INTO conversations (title) VALUES ($1) RETURNING id, title, created_at',
    [title]
  );
  return rows[0];
}

async function ensureConversation(conversationId) {
  if (!pool) return null;
  if (conversationId) {
    const { rows } = await pool.query('SELECT id FROM conversations WHERE id = $1', [conversationId]);
    if (rows[0]) return rows[0].id;
  }
  const created = await createConversation();
  return created.id;
}

async function maybeSetTitle(conversationId, firstUserText) {
  if (!pool) return;
  const { rows } = await pool.query('SELECT title FROM conversations WHERE id = $1', [conversationId]);
  if (rows[0] && rows[0].title === 'Nueva conversación') {
    const title = firstUserText.slice(0, 48) + (firstUserText.length > 48 ? '…' : '');
    await pool.query('UPDATE conversations SET title = $1 WHERE id = $2', [title, conversationId]);
  }
}

async function deleteConversation(conversationId) {
  if (!pool) return;
  await pool.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
}

async function loadHistory(conversationId, limit = 200) {
  if (!pool || !conversationId) return [];
  const { rows } = await pool.query(
    'SELECT role, parts FROM messages WHERE conversation_id = $1 ORDER BY id ASC LIMIT $2',
    [conversationId, limit]
  );
  return rows.map((r) => ({ role: r.role, parts: r.parts }));
}

async function saveMessage(conversationId, role, parts) {
  if (!pool || !conversationId) return;
  await pool.query(
    'INSERT INTO messages (conversation_id, role, parts) VALUES ($1, $2, $3)',
    [conversationId, role, JSON.stringify(parts)]
  );
}

module.exports = {
  initDb,
  listConversations,
  createConversation,
  ensureConversation,
  maybeSetTitle,
  deleteConversation,
  loadHistory,
  saveMessage,
  isEnabled: () => !!pool,
};