// ------------------------------
// Chat client (updated, safe, robust)
// ------------------------------

// DOM Elements
const chatBox = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');
const downloadBtn = document.getElementById('download-btn');
const deleteBtn = document.getElementById('delete-btn');

// Config
const API_URL = window.location.origin + '/chat'; // server proxy endpoint
const REQUEST_TIMEOUT = 20000; // ms
const HISTORY_KEY = 'chatHistory_v1';
const HISTORY_LIMIT = 300;

// Chat History Array (objects: {id, sender, text, ts})
let chatHistory = [];

// ------------------------------
// Utilities
// ------------------------------
function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatTime(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function saveHistory() {
    try {
        // keep only last HISTORY_LIMIT
        if (chatHistory.length > HISTORY_LIMIT) {
            chatHistory = chatHistory.slice(chatHistory.length - HISTORY_LIMIT);
        }
        localStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistory));
    } catch (e) {
        console.warn('Could not save history:', e);
    }
}

function loadHistory() {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return;
        chatHistory = JSON.parse(raw) || [];
        chatHistory.forEach(m => {
            renderMessage(m, false);
        });
        // scroll down
        chatBox.scrollTop = chatBox.scrollHeight;
    } catch (e) {
        console.warn('Could not load history:', e);
        chatHistory = [];
    }
}

// ------------------------------
// 1. Render message (safe)
// ------------------------------
function renderMessage(msgObj, save = true) {
    // msgObj: { id, sender: 'user'|'bot', text, ts }
    const { id, sender, text, ts } = msgObj;

    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', sender === 'user' ? 'user-msg' : 'bot-msg');
    msgDiv.dataset.msgid = id;
    msgDiv.setAttribute('role', 'article');

    const bubble = document.createElement('div');
    bubble.classList.add('msg-bubble');
    // safe insertion
    bubble.textContent = text;

    const timeSpan = document.createElement('span');
    timeSpan.classList.add('time');
    timeSpan.textContent = formatTime(ts);

    // delete icon for each message
    const del = document.createElement('button');
    del.classList.add('msg-delete-btn');
    del.title = 'Delete this message';
    del.type = 'button';
    del.textContent = '🗑';
    del.style.marginLeft = '8px';
    del.addEventListener('click', () => {
        deleteMessageById(id);
    });

    const metaWrap = document.createElement('div');
    metaWrap.classList.add('msg-meta');
    metaWrap.appendChild(timeSpan);
    metaWrap.appendChild(del);

    msgDiv.appendChild(bubble);
    msgDiv.appendChild(metaWrap);

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    if (save) {
        chatHistory.push(msgObj);
        saveHistory();
    }
}

// delete single message (by id)
function deleteMessageById(id) {
    // remove from DOM
    const el = chatBox.querySelector(`[data-msgid="${id}"]`);
    if (el) el.remove();

    // remove from history and persist
    chatHistory = chatHistory.filter(m => m.id !== id);
    saveHistory();
}

// ------------------------------
// 2. Simple client-side fallback ML (Levenshtein similarity + rules)
// ------------------------------
const localDataset = {
    "hello": "Hello! How can I assist with your computer today?",
    "hi": "Hi! How may I help you?",
    "hey": "Hey there! Need any help?",
    "bye": "Goodbye! Have a great day!",
    "slow": "If your computer is slow, try clearing temporary files, checking for malware, or upgrading your RAM.",
    "blue screen": "Blue screens (BSOD) are often driver or hardware issues. Note the error code and restart.",
    "thanks": "You're welcome!"
};

function levenshtein(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

function similarity(a, b) {
    const d = levenshtein(a, b);
    return 1 - d / Math.max(a.length, b.length);
}

function localFallbackResponse(text) {
    text = text.trim().toLowerCase();

    // direct substring triggers
    for (const k of Object.keys(localDataset)) {
        if (text.includes(k)) return localDataset[k];
    }

    // best fuzzy match
    let bestKey = null, bestScore = 0;
    for (const k of Object.keys(localDataset)) {
        const s = similarity(text, k);
        if (s > bestScore) { bestScore = s; bestKey = k; }
    }
    if (bestScore >= 0.55 && bestKey) {
        return localDataset[bestKey];
    }

    // rule-based fallback
    if (/how|what|why|help|problem|error|issue/.test(text)) {
        return "Can you provide more details? For example: OS, exact error message, when it happens.";
    }
    if (/thank|thanks/.test(text)) {
        return "You're welcome!";
    }
    return "Sorry, I don't have an answer offline. Please try again or give more details.";
}

// ------------------------------
// 3. Server call with timeout and robust error handling
// ------------------------------
async function fetchWithTimeout(url, opts = {}, timeout = REQUEST_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(id);
        return res;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

async function getBotResponse(userText) {
    // try server proxy first
    try {
        const res = await fetchWithTimeout(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: userText })
        }, REQUEST_TIMEOUT);

        if (!res.ok) {
            // attempt to read error message
            let body = {};
            try { body = await res.json(); } catch (e) { /* ignore */ }
            throw new Error(body.error || `Server returned ${res.status}`);
        }

        const data = await res.json();
        // expect { response: "...", meta: {...} }
        if (data && typeof data.response === 'string') return data.response;
        // fallback to dataset if response missing
        return localFallbackResponse(userText);
    } catch (err) {
        console.warn('Server call failed, using local fallback:', err);
        // fallback to local lightweight ML-like behavior
        return localFallbackResponse(userText);
    }
}

// ------------------------------
// 4. Handle send with UI state, typing indicator
// ------------------------------
let sending = false;
async function handleChat() {
    const text = userInput.value.trim();
    if (!text || sending) return;

    // create user message
    const userMsg = { id: makeId(), sender: 'user', text, ts: Date.now() };
    renderMessage(userMsg, true);

    // clear input
    userInput.value = '';
    userInput.focus();

    // disable UI
    sending = true;
    sendBtn.disabled = true;
    userInput.disabled = true;
    micBtn.disabled = true;

    // typing indicator (bot)
    const typingId = makeId();
    const typingObj = { id: typingId, sender: 'bot', text: 'Typing...', ts: Date.now() };
    renderMessage(typingObj, false);

    // get response (server or fallback)
    let botText;
    try {
        botText = await getBotResponse(text);
    } catch (e) {
        botText = "Sorry, something went wrong.";
    }

    // remove typing indicator element (by id)
    const tyEl = chatBox.querySelector(`[data-msgid="${typingId}"]`);
    if (tyEl) tyEl.remove();

    // add final bot message
    const botMsg = { id: makeId(), sender: 'bot', text: botText, ts: Date.now() };
    renderMessage(botMsg, true);

    // re-enable UI
    sending = false;
    sendBtn.disabled = false;
    userInput.disabled = false;
    micBtn.disabled = false;
    userInput.focus();
}

// prevent rapid double click/spam
sendBtn.addEventListener('click', handleChat);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChat();
});

// ------------------------------
// 5. Speech-to-text (robust handling)
// ------------------------------
let recognition = null;
const SpeechRecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition || null;

if (SpeechRecognitionConstructor) {
    recognition = new SpeechRecognitionConstructor();
    recognition.continuous = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        micBtn.classList.add('listening');
        micBtn.setAttribute('aria-pressed', 'true');
    };

    recognition.onend = () => {
        micBtn.classList.remove('listening');
        micBtn.setAttribute('aria-pressed', 'false');
    };

    recognition.onerror = (ev) => {
        console.warn('Speech recognition error:', ev);
        micBtn.classList.remove('listening');
        micBtn.setAttribute('aria-pressed', 'false');
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        userInput.value = transcript;
        // auto-send after recognition ends
        handleChat();
    };
} else {
    console.log('Speech Recognition not supported in this browser.');
}

micBtn.addEventListener('click', () => {
    if (!recognition) {
        alert('Mic not supported in this browser. Try Chrome or Edge.');
        return;
    }
    try {
        recognition.start();
    } catch (e) {
        // sometimes start() throws if already started — ignore
        console.warn('recognition.start() threw:', e);
    }
});

// ------------------------------
// 6. Download chat history as text
// ------------------------------
function downloadChatLog() {
    if (chatHistory.length === 0) {
        alert('No chat history to download.');
        return;
    }
    const lines = chatHistory.map(m => {
        const label = m.sender.toUpperCase();
        return `[${formatTime(m.ts)}] ${label}: ${m.text}`;
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chat-history.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ------------------------------
// 7. Clear history (persistent)
// ------------------------------
function clearHistory() {
    if (!confirm('Are you sure you want to delete all chat history?')) return;
    // clear DOM and storage
    chatBox.innerHTML = '';
    chatHistory = [];
    saveHistory();

    // add a static welcome message (use safe textContent)
    const welcomeObj = { id: makeId(), sender: 'bot', text: 'Chat cleared. How can I help you now?', ts: Date.now() };
    renderMessage(welcomeObj, true);
}

// Event listeners for download/clear
downloadBtn.addEventListener('click', downloadChatLog);
deleteBtn.addEventListener('click', clearHistory);

// ------------------------------
// 8. Init: load saved history or show welcome
// ------------------------------
window.addEventListener('DOMContentLoaded', () => {
    loadHistory();
    if (chatHistory.length === 0) {
        // welcome message
        const welcome = { id: makeId(), sender: 'bot', text: 'Hello! I am Computer Query Bot. How can I help you today?', ts: Date.now() };
        renderMessage(welcome, true);
    }
    // ARIA affordances
    userInput.setAttribute('aria-label', 'Type your message here');
    sendBtn.setAttribute('aria-label', 'Send message');
    micBtn.setAttribute('aria-label', 'Start voice input');
    downloadBtn.setAttribute('aria-label', 'Download chat history');
    deleteBtn.setAttribute('aria-label', 'Clear chat history');
});
