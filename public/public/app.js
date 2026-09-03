const thread = document.getElementById('thread');
const composer = document.getElementById('composer');
const input = document.getElementById('input');
const orb = document.getElementById('orb');
const statusEl = document.getElementById('status');
const modelNameEl = document.getElementById('modelName');
const modeNameEl = document.getElementById('modeName');
const clockEl = document.getElementById('clock');
const micBtn = document.getElementById('micBtn');
const modeToggle = document.getElementById('modeToggle');

let history = [];
let voiceModeOn = false;

setInterval(() => {
  clockEl.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}, 1000);

fetch('/api/health').then((r) => r.json()).then((d) => {
  modelNameEl.textContent = d.model || '—';
}).catch(() => { modelNameEl.textContent = 'sin conexión'; });

function setStatus(text, orbState) {
  statusEl.textContent = text;
  orb.className = 'orb' + (orbState ? ' ' + orbState : '');
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'model');
  div.innerHTML = `<div class="msg-label">${role === 'user' ? 'TÚ' : 'JARVIS'}</div><div class="msg-text"></div>`;
  div.querySelector('.msg-text').textContent = text;
  thread.appendChild(div);
  thread.scrollTop = thread.scrollHeight;
}

async function sendMessage(text) {
  addMessage('user', text);
  setStatus('PROCESANDO', 'thinking');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    history = data.history;
    addMessage('model', data.reply);

    if (voiceModeOn) speak(data.reply);
    setStatus('EN ESPERA', '');
  } catch (err) {
    addMessage('model', `⚠️ ${err.message}`);
    setStatus('ERROR', '');
  }
}

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendMessage(text);
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = 'es-MX';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => { setStatus('ESCUCHANDO', 'listening'); micBtn.classList.add('active'); };
  recognition.onerror = () => { setStatus('EN ESPERA', ''); micBtn.classList.remove('active'); };
  recognition.onend = () => { micBtn.classList.remove('active'); };
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    sendMessage(transcript);
  };
} else {
  micBtn.disabled = true;
  micBtn.title = 'Tu navegador no soporta reconocimiento de voz';
}

micBtn.addEventListener('click', () => {
  if (!recognition) return;
  recognition.start();
});

function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'es-MX';
  utter.rate = 1.02;
  window.speechSynthesis.speak(utter);
}

modeToggle.addEventListener('click', () => {
  voiceModeOn = !voiceModeOn;
  modeToggle.textContent = voiceModeOn ? 'Desactivar voz' : 'Activar voz';
  modeToggle.classList.toggle('active', voiceModeOn);
  modeNameEl.textContent = voiceModeOn ? 'VOZ' : 'TEXTO';
});
