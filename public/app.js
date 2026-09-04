// ============ Referencias DOM ============
const canvas = document.getElementById('orbCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const talkBtn = document.getElementById('talkBtn');
const talkBtnLabel = document.getElementById('talkBtnLabel');
const chatToggle = document.getElementById('chatToggle');
const drawer = document.getElementById('drawer');
const drawerClose = document.getElementById('drawerClose');
const thread = document.getElementById('thread');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const modelNameEl = document.getElementById('modelName');
const clockEl = document.getElementById('clock');

let state = 'idle'; // idle | listening | thinking | speaking
let conversationActive = false; // true mientras el ciclo de voz continua está corriendo

// ============ Reloj, salud y carga de memoria previa ============
setInterval(() => {
  clockEl.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}, 1000);

fetch('/api/health').then((r) => r.json()).then((d) => {
  modelNameEl.textContent = d.model || '—';
}).catch(() => { modelNameEl.textContent = 'sin conexión'; });

// Al abrir la página, trae la conversación guardada y la pinta en el chat de texto
// (sin hacerla hablar en voz alta, solo para que quede el registro).
fetch('/api/history').then((r) => r.json()).then((d) => {
  (d.history || []).forEach((msg) => {
    const text = (msg.parts || []).map((p) => p.text).filter(Boolean).join('\n');
    if (text) addMessage(msg.role === 'user' ? 'user' : 'model', text);
  });
}).catch(() => {});

// ============ Esfera de partículas (canvas) ============
const DPR = Math.min(window.devicePixelRatio || 1, 2);
function resizeCanvas() {
  const size = canvas.clientWidth || 420;
  canvas.width = size * DPR;
  canvas.height = size * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function fibonacciSphere(samples) {
  const pts = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < samples; i++) {
    const y = 1 - (i / (samples - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = phi * i;
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
  }
  return pts;
}

const POINTS = fibonacciSphere(900);
let angle = 0;
let t = 0;

const STATE_STYLE = {
  idle: { color: [61, 139, 255], speed: 0.0025, ampBase: 0.02, ampWave: 0.01, glow: 0.35 },
  listening: { color: [111, 180, 255], speed: 0.008, ampBase: 0.05, ampWave: 0.05, glow: 0.6 },
  thinking: { color: [140, 190, 255], speed: 0.02, ampBase: 0.03, ampWave: 0.02, glow: 0.55 },
  speaking: { color: [90, 200, 255], speed: 0.01, ampBase: 0.07, ampWave: 0.06, glow: 0.75 },
};

function draw() {
  const size = canvas.clientWidth || 420;
  const cx = size / 2;
  const cy = size / 2;
  const baseRadius = size * 0.34;

  ctx.clearRect(0, 0, size, size);

  const style = STATE_STYLE[state];
  t += 1;
  const pulse = style.ampBase + style.ampWave * (0.5 + 0.5 * Math.sin(t * 0.05)) * (0.6 + 0.4 * Math.sin(t * 0.13 + 1.7));
  const radius = baseRadius * (1 + pulse);

  const rotated = POINTS.map((p) => {
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    return {
      x: p.x * cosA + p.z * sinA,
      y: p.y,
      z: -p.x * sinA + p.z * cosA,
    };
  }).sort((a, b) => a.z - b.z);

  for (const p of rotated) {
    const depth = (p.z + 1) / 2;
    const sx = cx + p.x * radius;
    const sy = cy + p.y * radius;
    const r = 0.6 + depth * 1.8;
    const alpha = 0.15 + depth * style.glow;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${style.color[0]}, ${style.color[1]}, ${style.color[2]}, ${alpha})`;
    ctx.fill();
  }

  angle += style.speed;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ============ Estado / UI ============
const STATUS_LABEL = { idle: 'EN ESPERA', listening: 'ESCUCHANDO', thinking: 'PENSANDO', speaking: 'HABLANDO' };

function setState(next) {
  state = next;
  statusEl.textContent = STATUS_LABEL[next];
  talkBtn.classList.toggle('listening', next === 'listening');
  talkBtnLabel.textContent = next === 'listening' ? 'Escuchando…' : (conversationActive ? 'Detener conversación' : 'Toca para hablar');
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'model');
  div.innerHTML = `<div class="msg-label">${role === 'user' ? 'TÚ' : 'JARVIS'}</div><div class="msg-text"></div>`;
  div.querySelector('.msg-text').textContent = text;
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
}

// ============ Conversación con el backend ============
async function sendMessage(text) {
  addMessage('user', text);
  setState('thinking');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    addMessage('model', data.reply);
    speak(data.reply);
  } catch (err) {
    addMessage('model', `⚠️ ${err.message}`);
    setState('idle');
  }
}

// ============ Voz: síntesis (TTS) ============
function speak(text) {
  if (!('speechSynthesis' in window)) {
    setState('idle');
    return;
  }
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'es-MX';
  utter.rate = 1.02;

  utter.onstart = () => setState('speaking');
  utter.onend = () => {
    setState('idle');
    if (conversationActive) startListening();
  };
  utter.onerror = () => { setState('idle'); if (conversationActive) startListening(); };

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

// ============ Voz: reconocimiento (STT) ============
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'es-MX';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => setState('listening');
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    sendMessage(transcript);
  };
  recognition.onerror = (event) => {
    if (event.error === 'no-speech' && conversationActive) {
      startListening();
    } else {
      setState('idle');
      conversationActive = false;
      talkBtnLabel.textContent = 'Toca para hablar';
    }
  };
} else {
  talkBtn.disabled = true;
  talkBtnLabel.textContent = 'Voz no soportada en este navegador';
}

function startListening() {
  if (!recognition) return;
  try { recognition.start(); } catch (_e) { /* ya estaba escuchando */ }
}

// ============ Botón principal: conversación continua ============
talkBtn.addEventListener('click', () => {
  if (!recognition) return;

  if (conversationActive) {
    conversationActive = false;
    window.speechSynthesis.cancel();
    recognition.stop();
    setState('idle');
  } else {
    conversationActive = true;
    talkBtnLabel.textContent = 'Detener conversación';
    startListening();
  }
});

// ============ Chat de texto (secundario) ============
composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendMessage(text);
});

chatToggle.addEventListener('click', () => drawer.classList.add('open'));
drawerClose.addEventListener('click', () => drawer.classList.remove('open'));