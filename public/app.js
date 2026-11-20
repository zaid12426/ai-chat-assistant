// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let currentConversationId = null;
let currentTone = 'professional';
let isStreaming = false;

const $ = (id) => document.getElementById(id);
const messagesEl = $('messages');
const historyEl = $('historyList');
const inputEl = $('input');
const sendBtn = $('sendBtn');
const titleEl = $('chatTitle');

// ---------------------------------------------------------------------------
// Tone Toggle
// ---------------------------------------------------------------------------
document.querySelectorAll('.tone').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentTone = btn.dataset.tone;
    document.querySelectorAll('.tone').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });
  });
});

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
function formatTime(date) {
  return new Date(date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function clearMessages() {
  messagesEl.innerHTML = '';
}

function showEmptyState() {
  messagesEl.innerHTML = `
    <div class="empty">
      <h2>How can I help you today?</h2>
      <p>Pick a tone above, then ask anything.</p>
    </div>`;
}

function addBubble(role, text, { time, tone } = {}) {
  messagesEl.querySelector('.empty')?.remove();

  const row = document.createElement('div');
  row.className = `row ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${role === 'user' ? 'You' : 'AI'} · ${formatTime(time || Date.now())}`;
  if (tone && role === 'ai') {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = tone;
    meta.appendChild(tag);
  }

  row.append(bubble, meta);
  messagesEl.appendChild(row);
  scrollToBottom();
  return bubble;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// History Sidebar
// ---------------------------------------------------------------------------
async function loadHistory() {
  const res = await fetch('/api/conversations');
  const list = await res.json();
  historyEl.innerHTML = '';

  if (!list.length) {
    historyEl.innerHTML = '<li class="h-empty">No conversations yet</li>';
    return;
  }

  for (const c of list) {
    const li = document.createElement('li');
    if (c._id === currentConversationId) li.classList.add('active');

    const text = document.createElement('div');
    text.className = 'h-text';
    text.innerHTML = '<span class="h-title"></span><span class="h-date"></span>';
    text.querySelector('.h-title').textContent = c.title;
    text.querySelector('.h-date').textContent = formatTime(c.updatedAt);

    const del = document.createElement('button');
    del.className = 'h-del';
    del.title = 'Delete conversation';
    del.textContent = '✕';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this conversation?')) return;
      await fetch(`/api/conversations/${c._id}`, { method: 'DELETE' });
      if (c._id === currentConversationId) newChat();
      loadHistory();
    });

    li.append(text, del);
    li.addEventListener('click', () => openConversation(c._id));
    historyEl.appendChild(li);
  }
}

async function openConversation(id) {
  if (isStreaming) return;
  const res = await fetch(`/api/conversations/${id}`);
  if (!res.ok) return;
  const convo = await res.json();

  currentConversationId = convo._id;
  titleEl.textContent = convo.title;
  clearMessages();
  for (const ex of convo.exchanges) {
    addBubble('user', ex.userPrompt, { time: ex.timestamp });
    addBubble('ai', ex.aiResponse, { time: ex.timestamp, tone: ex.tone });
  }
  if (!convo.exchanges.length) showEmptyState();
  $('sidebar').classList.remove('open');
  loadHistory();
}

function newChat() {
  if (isStreaming) return;
  currentConversationId = null;
  titleEl.textContent = 'New chat';
  showEmptyState();
  loadHistory();
  inputEl.focus();
}

// ---------------------------------------------------------------------------
// Streaming View: typewriter queue so text appears character-by-character
// ---------------------------------------------------------------------------
function createTypewriter(bubble) {
  let queue = '';
  let finished = false;
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));

  function tick() {
    if (queue.length) {
      // Type faster when a big backlog builds up, so we never fall far behind.
      const n = Math.max(1, Math.ceil(queue.length / 40));
      bubble.textContent += queue.slice(0, n);
      queue = queue.slice(n);
      scrollToBottom();
    }
    if (finished && !queue.length) return resolveDone();
    setTimeout(tick, 15);
  }
  tick();

  return {
    push: (text) => (queue += text),
    finish: () => { finished = true; return done; },
  };
}

// ---------------------------------------------------------------------------
// Send a message and read the SSE stream from the backend
// ---------------------------------------------------------------------------
async function sendMessage(text) {
  isStreaming = true;
  sendBtn.disabled = true;

  addBubble('user', text);
  const aiBubble = addBubble('ai', '', { tone: currentTone });
  aiBubble.classList.add('streaming', 'thinking');
  const typer = createTypewriter(aiBubble);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: currentConversationId, message: text, tone: currentTone }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = raw.match(/^event: (.*)$/m)?.[1];
        const data = JSON.parse(raw.match(/^data: (.*)$/m)?.[1] || '{}');

        if (event === 'meta') {
          currentConversationId = data.conversationId;
          titleEl.textContent = data.title;
        } else if (event === 'delta') {
          aiBubble.classList.remove('thinking');
          typer.push(data.text);
        } else if (event === 'error') {
          throw new Error(data.message);
        }
      }
    }
    await typer.finish();
  } catch (err) {
    await typer.finish();
    aiBubble.classList.remove('thinking');
    aiBubble.classList.add('error');
    aiBubble.textContent += (aiBubble.textContent ? '\n\n' : '') + '⚠ ' + err.message;
  } finally {
    aiBubble.classList.remove('streaming', 'thinking');
    isStreaming = false;
    sendBtn.disabled = false;
    inputEl.focus();
    loadHistory();
  }
}

// ---------------------------------------------------------------------------
// Composer events
// ---------------------------------------------------------------------------
$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text || isStreaming) return;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  sendMessage(text);
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
});

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = inputEl.scrollHeight + 'px';
});

$('newChatBtn').addEventListener('click', newChat);
$('menuBtn').addEventListener('click', () => $('sidebar').classList.toggle('open'));

loadHistory();
