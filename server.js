require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

if (!GEMINI_API_KEY) {
  console.warn('⚠️  No se encontró GEMINI_API_KEY en las variables de entorno. El chat fallará hasta que la configures.');
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Personalidad base de tu asistente. Ajusta esto libremente.
const SYSTEM_INSTRUCTION = `Eres JARVIS, el asistente personal de IA del usuario.
Hablas en español por defecto (a menos que el usuario te escriba en otro idioma), de forma directa, cálida y ligeramente ingeniosa, como un mayordomo de confianza.
Respuestas concisas cuando la pregunta es simple; detalladas cuando la tarea lo requiere.
Si no puedes hacer algo todavía (por ejemplo, controlar una app externa), dilo con claridad y sugiere el siguiente paso.`;

// --- Herramientas (tools) de ejemplo ---
// Esto es la semilla de la Fase 2: darle a Jarvis acceso a "apps" reales.
// Cada tool tiene una declaración (para que Gemini sepa cuándo usarla) y una función que la ejecuta.
const toolImplementations = {
  get_datetime: () => {
    const now = new Date();
    return { iso: now.toISOString(), local: now.toLocaleString('es-MX') };
  },
};

const toolDeclarations = [
  {
    name: 'get_datetime',
    description: 'Devuelve la fecha y hora actuales.',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

async function callGemini(contents) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
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

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Falta "message" (string) en el body.' });
    }
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'El servidor no tiene configurada GEMINI_API_KEY.' });
    }

    let contents = [...history, { role: 'user', parts: [{ text: message }] }];

    let data = await callGemini(contents);
    let candidate = data.candidates?.[0];
    let parts = candidate?.content?.parts || [];

    // Si Gemini pide ejecutar una función, la corremos y le devolvemos el resultado.
    const functionCall = parts.find((p) => p.functionCall)?.functionCall;
    if (functionCall && toolImplementations[functionCall.name]) {
      const toolResult = toolImplementations[functionCall.name](functionCall.args || {});
      contents = [
        ...contents,
        { role: 'model', parts },
        {
          role: 'function',
          parts: [{ functionResponse: { name: functionCall.name, response: toolResult } }],
        },
      ];
      data = await callGemini(contents);
      candidate = data.candidates?.[0];
      parts = candidate?.content?.parts || [];
    }

    const replyText = parts.map((p) => p.text).filter(Boolean).join('\n') || '(sin respuesta)';

    res.json({
      reply: replyText,
      history: [
        ...contents,
        { role: 'model', parts: [{ text: replyText }] },
      ],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, model: MODEL }));

app.listen(PORT, () => {
  console.log(`🧠 Jarvis MVP corriendo en http://localhost:${PORT}`);
});
