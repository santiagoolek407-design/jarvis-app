require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

if (!ANTHROPIC_API_KEY) {
  console.warn('⚠️  No se encontró ANTHROPIC_API_KEY. El chat fallará hasta que la configures.');
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.post('/api/signup', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Correo y contraseña (mínimo 6 caracteres) son obligatorios.' });
    }
    const existing = await db.getUserByEmail(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });

    const passwordHash = auth.hashPassword(password);
    const user = await db.createUser(email.toLowerCase().trim(), passwordHash);

    res.setHeader('Set-Cookie', auth.makeSessionCookie(user.id));
    res.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await db.getUserByEmail((email || '').toLowerCase().trim());
    if (!user || !auth.verifyPassword(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    res.setHeader('Set-Cookie', auth.makeSessionCookie(user.id));
    res.json({ ok: true, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', (_req, res) => {
  res.setHeader('Set-Cookie', auth.clearSessionCookie());
  res.json({ ok: true });
});

app.use(auth.authMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

function buildSystemInstruction({ assistantName, userDisplayName }) {
  const name = assistantName || 'Jarvis';
  const addressLine = userDisplayName
    ? `El usuario quiere que le digas "${userDisplayName}".`
    : '';
  return `Te llamas ${name} y eres el asistente personal de IA del usuario.
Hablas en español por defecto (a menos que el usuario te escriba en otro idioma), de forma directa, cálida y ligeramente ingeniosa, como un mayordomo de confianza.
Respuestas concisas cuando la pregunta es simple; detalladas cuando la tarea lo requiere.
Si no puedes hacer algo todavía, dilo con claridad y sugiere el siguiente paso.
${addressLine}
Tienes memoria de esta conversación: úsala con naturalidad, como alguien que ya conoce al usuario.`;
}

const UI_ACTION_TOOLS = new Set(['open_text_chat', 'close_text_chat']);

const toolImplementations = {
  get_datetime: () => {
    const now = new Date();
    return { iso: now.toISOString(), local: now.toLocaleString('es-MX') };
  },
  open_text_chat: () => ({ status: 'ok', message: 'Panel de texto abierto.' }),
  close_text_chat: () => ({ status: 'ok', message: 'Panel de texto cerrado.' }),
};

const toolDeclarations = [
  { name: 'get_datetime', description: 'Devuelve la fecha y hora actuales.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'open_text_chat',
    description: 'Abre/despliega el panel de chat de texto en la pantalla. Úsala cuando el usuario pida ver el chat, el texto, la transcripción, o abrir/desplegar el panel de texto.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'close_text_chat',
    description: 'Cierra el panel de chat de texto y regresa a la vista principal de voz.',
    input_schema: { type: 'object', properties: {} },
  },
];

async function callClaude(messages, systemInstruction) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemInstruction,
      messages,
      tools: toolDeclarations,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }
  return res.json();
}

app.get('/api/settings', async (req, res) => {
  try {
    const s = await db.getSettings(req.userId);
    res.json({ assistantName: s.assistant_name, userDisplayName: s.user_display_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { assistantName, userDisplayName } = req.body || {};
    await db.updateSettings(req.userId, { assistantName, userDisplayName });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/conversations', async (req, res) => {
  try {
    res.json({ conversations: await db.listConversations(req.userId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/conversations', async (req, res) => {
  try {
    res.json(await db.createConversation(req.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/conversations/:id', async (req, res) => {
  try {
    await db.deleteConversation(req.userId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const history = await db.loadHistory(req.userId, req.query.conversationId);
    res.json({ history, memoryEnabled: db.isEnabled() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationId } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Falta "message" (string) en el body.' });
    }
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'El servidor no tiene configurada ANTHROPIC_API_KEY.' });
    }

    const convId = await db.ensureConversation(req.userId, conversationId);
    const pastHistory = await db.loadHistory(req.userId, convId);
    const userParts = [{ text: message }];
    const settings = await db.getSettings(req.userId);
    const systemInstruction = buildSystemInstruction({
      assistantName: settings.assistant_name,
      userDisplayName: settings.user_display_name,
    });

    await db.saveMessage(convId, 'user', userParts);
    await db.maybeSetTitle(convId, message);

    let claudeMessages = [...pastHistory, { role: 'user', parts: userParts }].map((m) => ({
      role: m.role === 'model' ? 'assistant' : 'user',
      content: (m.parts || []).map((p) => p.text).filter(Boolean).join('\n'),
    }));

    let data = await callClaude(claudeMessages, systemInstruction);
    let blocks = data.content || [];
    let uiAction = null;

    if (data.stop_reason === 'tool_use') {
      const toolUse = blocks.find((b) => b.type === 'tool_use');
      if (toolUse && toolImplementations[toolUse.name]) {
        if (UI_ACTION_TOOLS.has(toolUse.name)) uiAction = toolUse.name;
        const toolResult = toolImplementations[toolUse.name](toolUse.input || {});
        claudeMessages = [
          ...claudeMessages,
          { role: 'assistant', content: blocks },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(toolResult) }] },
        ];
        data = await callClaude(claudeMessages, systemInstruction);
        blocks = data.content || [];
      }
    }

    const replyText = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || '(sin respuesta)';
    await db.saveMessage(convId, 'model', [{ text: replyText }]);

    res.json({ reply: replyText, uiAction, conversationId: convId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, model: MODEL, provider: 'anthropic', memory: db.isEnabled() }));

db.initDb()
  .catch((err) => console.error('Error inicializando la base de datos:', err))
  .finally(() => {
    app.listen(PORT, () => console.log(`🧠 Jarvis corriendo en http://localhost:${PORT}`));
  });