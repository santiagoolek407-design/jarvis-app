// ============ Referencias DOM ============
const canvas = document.getElementById('orbCanvas');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const talkBtn = document.getElementById('talkBtn');
const talkBtnLabel = document.getElementById('talkBtnLabel');
const chatToggle = document.getElementById('chatToggle');
const replayVoiceBtn = document.getElementById('replayVoiceBtn');
const voiceScreen = document.getElementById('voiceScreen');
const chatScreen = document.getElementById('chatScreen');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const menuBtn = document.getElementById('menuBtn');
const backToVoice = document.getElementById('backToVoice');
const newChatBtn = document.getElementById('newChatBtn');
const convList = document.getElementById('convList');
const settingsBtn = document.getElementById('settingsBtn');
const logoutBtn = document.getElementById('logoutBtn');
const settingsModal = document.getElementById('settingsModal');
const assistantNameInput = document.getElementById('assistantNameInput');
const userNameInput = document.getElementById('userNameInput');
const voiceSelect = document.getElementById('voiceSelect');
const settingsCancel = document.getElementById('settingsCancel');
const settingsSave = document.getElementById('settingsSave');
const thread = document.getElementById('thread');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const modelNameEl = document.getElementById('modelName');
const memStatusEl = document.getElementById('memStatus');
const clockEl = document.getElementById('clock');

let state = 'idle';
let conversationActive = false;
let currentConversationId = localStorage.getItem('jarvis_current_conversation') || null;
let assistantName = 'Jarvis';
let selectedVoiceURI = localStorage.getItem('jarvis_voice_uri') || null;
let lastReply = '';

// ============ Reloj y salud ============
setInterval(() => {
  clockEl.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}, 1000);

fetch('/api/health').then((r) => r.json()).then((d) => {
  modelNameEl.textContent = d.model || '—';
  memStatusEl.textContent = d.memory ? 'ACTIVA' : 'INACTIVA';
}).catch(() => { modelNameEl.textContent = 'sin conexión'; });

// ============ Configuración (nombre del asistente, cómo te llama, voz) ============
function applyAssistantName(name) {
  assistantName = name || 'Jarvis';
  document.querySelectorAll('.brand-name').forEach((el) => { el.textContent = assistantName.toUpperCase(); });
  document.title = assistantName;
}

function populateVoiceOptions() {
  const voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  voiceSelect.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Voz por defecto del navegador';
  voiceSelect.appendChild(defaultOpt);

  voices.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})`;
    if (v.voiceURI === selectedVoiceURI) opt.selected = true;
    voiceSelect.appendChild(opt);
  });
}
if (window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = populateVoiceOptions;
  populateVoiceOptions();
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    applyAssistantName(data.assistantName);
    assistantNameInput.value = data.assistantName || '';
    userNameInput.value = data.userDisplayName || '';
  } catch (_e) { /* si falla, se queda con los valores por defecto */ }
}
loadSettings();

function openSettings() { settingsModal.classList.add('open'); populateVoiceOptions(); }
function closeSettings() { settingsModal.classList.remove('open'); }

settingsBtn.addEventListener('click', openSettings);
settingsCancel.addEventListener('click', closeSettings);
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) closeSettings(); });

settingsSave.addEventListener('click', async () => {
  const newAssistantName = assistantNameInput.value.trim() || 'Jarvis';
  const newUserName = userNameInput.value.trim();
  selectedVoiceURI = voiceSelect.value || null;
  if (selectedVoiceURI) localStorage.setItem('jarvis_voice_uri', selectedVoiceURI);
  else localStorage.removeItem('jarvis_voice_uri');

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assistantName: newAssistantName, userDisplayName: newUserName }),
  });
  applyAssistantName(newAssistantName);
  closeSettings();
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// ============ Conversaciones ============
async function refreshConversations() {
  const res = await fetch('/api/conversations');
  const data = await res.json();
  const conversations = data.conversations || [];

  convList.innerHTML = '';
  conversations.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'conv-item' + (String(c.id) === String(currentConversationId) ? ' active' : '');

    const titleSpan = document.createElement('span');
    titleSpan.className = 'conv-title';
    titleSpan.textContent = c.title || 'Nueva conversación';
    titleSpan.addEventListener('click', () => selectConversation(c.id));

    const actions = document.createElement('div');
    actions.className = 'conv-actions';

    const pinBtn = document.createElement('button');
    pinBtn.className = 'conv-icon-btn conv-pin' + (c.pinned ? ' pinned' : '');
    pinBtn.title = c.pinned ? 'Desfijar' : 'Fijar';
    pinBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M16 3l5 5-4 1-4 4 1 5-4-4-5 5v-3l5-5-4-4 5-1 1-4z"/></svg>';
    pinBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await fetch(`/api/conversations/${c.id}/pin`, { method: 'POST' });
      refreshConversations();
    });

    const renameBtn = document.createElement('button');
    renameBtn.className = 'conv-icon-btn';
    renameBtn.title = 'Cambiar nombre';
    renameBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    renameBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const nuevo = prompt('Nuevo nombre para la conversación:', c.title || '');
      if (nuevo === null) return;
      await fetch(`/api/conversations/${c.id}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: nuevo }),
      });
      refreshConversations();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'conv-icon-btn conv-delete';
    deleteBtn.title = 'Eliminar';
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M6 7h12l-1 14H7L6 7zm3-4h6l1 2H8l1-2zM4 5h16v2H4z"/></svg>';
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('¿Eliminar esta conversación? No se puede deshacer.')) return;
      await fetch(`/api/conversations/${c.id}`, { method: 'DELETE' });
      if (String(currentConversationId) === String(c.id)) {
        currentConversationId = null;
        localStorage.removeItem('jarvis_current_conversation');
        thread.innerHTML = '';
      }
      refreshConversations();
    });

    actions.appendChild(pinBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(titleSpan);
    item.appendChild(actions);
    convList.appendChild(item);
  });

  if (!currentConversationId && conversations.length > 0) {
    selectConversation(conversations[0].id);
  } else if (conversations.length === 0) {
    await createNewConversation();
  }
}

async function createNewConversation() {
  const res = await fetch('/api/conversations', { method: 'POST' });
  const conv = await res.json();
  await selectConversation(conv.id);
  await refreshConversations();
}

async function selectConversation(id) {
  currentConversationId = id;
  localStorage.setItem('jarvis_current_conversation', id);
  thread.innerHTML = '';
  closeSidebar();

  const res = await fetch(`/api/history?conversationId=${id}`);
  const data = await res.json();
  (data.history || []).forEach((msg) => {
    const text = (msg.parts || []).map((p) => p.text).filter(Boolean).join('\n');
    if (text) addMessage(msg.role === 'user' ? 'user' : 'model', text);
  });

  [...convList.children].forEach((el, i) => el.classList.remove('active'));
  refreshConversations();
}

newChatBtn.addEventListener('click', createNewConversation);

// ============ Cambiar de pantalla (voz <-> chat) ============
function openChatScreen() {
  chatScreen.classList.add('open');
  refreshConversations();
}
function closeChatScreen() {
  chatScreen.classList.remove('open');
}

chatToggle.addEventListener('click', openChatScreen);
backToVoice.addEventListener('click', closeChatScreen);

// ============ Cajón de conversaciones (móvil) ============
function openSidebar() {
  sidebar.classList.add('open');
  sidebarBackdrop.classList.add('open');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('open');
}
menuBtn.addEventListener('click', openSidebar);
sidebarBackdrop.addEventListener('click', closeSidebar);

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
  idle: { color: [0, 220, 220], speed: 0.0025, ampBase: 0.02, ampWave: 0.01, glow: 0.35 },
  listening: { color: [0, 255, 255], speed: 0.008, ampBase: 0.05, ampWave: 0.05, glow: 0.6 },
  thinking: { color: [90, 255, 255], speed: 0.02, ampBase: 0.03, ampWave: 0.02, glow: 0.55 },
  speaking: { color: [0, 255, 255], speed: 0.01, ampBase: 0.07, ampWave: 0.06, glow: 0.75 },
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
    return { x: p.x * cosA + p.z * sinA, y: p.y, z: -p.x * sinA + p.z * cosA };
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
  replayVoiceBtn.hidden = !(next === 'idle' && lastReply);
}

replayVoiceBtn.addEventListener('click', () => { if (lastReply) speak(lastReply); });

function formatMessage(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'model');
  const replayBtn = role === 'model'
    ? `<button class="replay-btn" title="Repetir en voz alta">
        <svg viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a5 5 0 11-5 5H5a7 7 0 107-7z"/></svg>
       </button>`
    : '';
  div.innerHTML = `<div class="msg-label">${role === 'user' ? 'TÚ' : assistantName.toUpperCase()}${replayBtn}</div><div class="msg-text"></div>`;
  div.querySelector('.msg-text').innerHTML = formatMessage(text);
  if (role === 'model') {
    div.querySelector('.replay-btn').addEventListener('click', () => speak(text));
  }
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
}

// ============ Conversación con el backend ============
async function sendMessage(text) {
  addMessage('user', text);
  setState('thinking');

  try {
    if (!currentConversationId) {
      const res = await fetch('/api/conversations', { method: 'POST' });
      const conv = await res.json();
      currentConversationId = conv.id;
      localStorage.setItem('jarvis_current_conversation', conv.id);
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, conversationId: currentConversationId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    addMessage('model', data.reply);
    lastReply = data.reply;
    if (data.uiAction === 'open_text_chat') openChatScreen();
    if (data.uiAction === 'close_text_chat') closeChatScreen();
    speak(data.reply);
  } catch (err) {
    addMessage('model', `⚠️ ${err.message}`);
    setState('idle');
  }
}

// ============ Voz: síntesis (TTS) ============
function speak(text) {
  if (!('speechSynthesis' in window)) { setState('idle'); return; }
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.02;

  const voices = window.speechSynthesis.getVoices();
  const chosen = selectedVoiceURI && voices.find((v) => v.voiceURI === selectedVoiceURI);
  if (chosen) {
    utter.voice = chosen;
    utter.lang = chosen.lang;
  } else {
    utter.lang = 'es-MX';
  }

  utter.onstart = () => setState('speaking');
  utter.onend = () => { setState('idle'); if (conversationActive) startListening(); };
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
  recognition.onresult = (event) => sendMessage(event.results[0][0].transcript);
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

// ============ Activar con un aplauso ============
let clapAnalyser = null;
let clapDataArray = null;
let lastClapTime = 0;

async function initClapDetector() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    clapAnalyser = audioCtx.createAnalyser();
    clapAnalyser.fftSize = 512;
    source.connect(clapAnalyser);
    clapDataArray = new Uint8Array(clapAnalyser.fftSize);
    monitorClap();
  } catch (_e) {
    // Si no hay permiso de micrófono todavía, simplemente no se activa por aplauso
    // (sigue funcionando el botón normal).
  }
}

function monitorClap() {
  requestAnimationFrame(monitorClap);
  if (!clapAnalyser) return;

  clapAnalyser.getByteTimeDomainData(clapDataArray);
  let sum = 0;
  for (let i = 0; i < clapDataArray.length; i++) {
    const v = (clapDataArray[i] - 128) / 128;
    sum += v * v;
  }
  const volume = Math.sqrt(sum / clapDataArray.length);

  const now = Date.now();
  if (volume > 0.70 && now - lastClapTime > 1200) {
    lastClapTime = now;
    if (!conversationActive && state === 'idle' && !chatScreen.classList.contains('open')) {
      talkBtn.click();
    }
  }
}
initClapDetector();

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

// ============ Chat de texto ============
composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendMessage(text);
});