require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5'; // el más rápido, ideal para conversación
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // voz "Rachel" (premade), usada si el usuario no eligió otra

if (!GEMINI_API_KEY) {
  console.warn('⚠️  No se encontró GEMINI_API_KEY. El chat fallará hasta que la configures.');
}
if (!ELEVENLABS_API_KEY) {
  console.warn('⚠️  No se encontró ELEVENLABS_API_KEY. La voz de ElevenLabs no funcionará hasta que la configures.');
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
  { name: 'get_datetime', description: 'Devuelve la fecha y hora actuales.', parameters: { type: 'OBJECT', properties: {} } },
  {
    name: 'open_text_chat',
    description: 'Abre/despliega el panel de chat de texto en la pantalla. Úsala cuando el usuario pida ver el chat, el texto, la transcripción, o abrir/desplegar el panel de texto.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'close_text_chat',
    description: 'Cierra el panel de chat de texto y regresa a la vista principal de voz.',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

async function callGemini(contents, systemInstruction) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    tools: [{ functionDeclarations: toolDeclarations }],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }
  return res.json();
}

app.get('/api/settings', async (req, res) => {
  try {
    const s = await db.getSettings(req.userId);
    res.json({ assistantName: s.assistant_name, userDisplayName: s.user_display_name, voiceId: s.voice_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { assistantName, userDisplayName, voiceId } = req.body || {};
    await db.updateSettings(req.userId, { assistantName, userDisplayName, voiceId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/voices', async (_req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) return res.status(500).json({ error: 'No hay ELEVENLABS_API_KEY configurada.' });
    const r = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
    });
    if (!r.ok) throw new Error(`ElevenLabs error ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const voices = (data.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name }));
    res.json({ voices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Falta "text" en el body.' });
    if (!ELEVENLABS_API_KEY) return res.status(500).json({ error: 'No hay ELEVENLABS_API_KEY configurada.' });

    const settings = await db.getSettings(req.userId);
    const voiceId = settings.voice_id || DEFAULT_VOICE_ID;

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
      }),
    });
    if (!r.ok) throw new Error(`ElevenLabs error ${r.status}: ${await r.text()}`);

    res.setHeader('Content-Type', 'audio/mpeg');
    const buffer = Buffer.from(await r.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error(err);
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
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'El servidor no tiene configurada GEMINI_API_KEY.' });
    }

    const convId = await db.ensureConversation(req.userId, conversationId);
    const pastHistory = await db.loadHistory(req.userId, convId);
    const userParts = [{ text: message }];
    const settings = await db.getSettings(req.userId);
    const systemInstruction = buildSystemInstruction({
      assistantName: settings.assistant_name,
      userDisplayName: settings.user_display_name,
    });

    let contents = [...pastHistory, { role: 'user', parts: userParts }];
    await db.saveMessage(convId, 'user', userParts);
    await db.maybeSetTitle(convId, message);

    let data = await callGemini(contents, systemInstruction);
    let candidate = data.candidates?.[0];
    let parts = candidate?.content?.parts || [];

    const functionCall = parts.find((p) => p.functionCall)?.functionCall;
    let uiAction = null;
    if (functionCall && toolImplementations[functionCall.name]) {
      if (UI_ACTION_TOOLS.has(functionCall.name)) uiAction = functionCall.name;
      const toolResult = toolImplementations[functionCall.name](functionCall.args || {});
      contents = [
        ...contents,
        { role: 'model', parts },
        { role: 'user', parts: [{ functionResponse: { name: functionCall.name, response: toolResult } }] },
      ];
      data = await callGemini(contents, systemInstruction);
      candidate = data.candidates?.[0];
      parts = candidate?.content?.parts || [];
    }

    const replyText = parts.map((p) => p.text).filter(Boolean).join('\n') || '(sin respuesta)';
    await db.saveMessage(convId, 'model', [{ text: replyText }]);

    res.json({ reply: replyText, uiAction, conversationId: convId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, model: MODEL, provider: 'gemini', memory: db.isEnabled() }));

db.initDb()
  .catch((err) => console.error('Error inicializando la base de datos:', err))
  .finally(() => {
    app.listen(PORT, () => console.log(`🧠 Jarvis corriendo en http://localhost:${PORT}`));
  });