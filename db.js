const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

let pool = null;
if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
  });
} else {
  console.warn('⚠️  No se encontró DATABASE_URL. La memoria persistente estará desactivada (todo se olvida al reiniciar).');
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL,
      parts JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  console.log('🗄️  Base de datos lista (tabla "messages" verificada).');
}

async function loadHistory(limit = 200) {
  if (!pool) return [];
  const { rows } = await pool.query(
    'SELECT role, parts FROM messages ORDER BY id ASC LIMIT $1',
    [limit]
  );
  return rows.map((r) => ({ role: r.role, parts: r.parts }));
}

async function saveMessage(role, parts) {
  if (!pool) return;
  await pool.query('INSERT INTO messages (role, parts) VALUES ($1, $2)', [role, JSON.stringify(parts)]);
}

async function clearHistory() {
  if (!pool) return;
  await pool.query('DELETE FROM messages');
}

module.exports = { initDb, loadHistory, saveMessage, clearHistory, isEnabled: () => !!pool };
