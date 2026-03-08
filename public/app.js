const els = {
  alias: document.getElementById('alias'),
  roomId: document.getElementById('roomId'),
  secret: document.getElementById('secret'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  disconnectAfterSend: document.getElementById('disconnectAfterSend'),
  audioOnly: document.getElementById('audioOnly'),
  status: document.getElementById('status'),
  statusPill: document.getElementById('statusPill'),
  peerCount: document.getElementById('peerCount'),
  sendBtn: document.getElementById('sendBtn'),
  messageInput: document.getElementById('messageInput'),
  imageInput: document.getElementById('imageInput'),
  fileLabelText: document.getElementById('fileLabelText'),
  messages: document.getElementById('messages'),
  clearLocalBtn: document.getElementById('clearLocalBtn'),
  startCallBtn: document.getElementById('startCallBtn'),
  hangupBtn: document.getElementById('hangupBtn'),
  localVideo: document.getElementById('localVideo'),
  remoteVideo: document.getElementById('remoteVideo'),
};

const state = {
  socket: null,
  db: null,
  alias: localStorage.getItem('ghost_alias') || `anon-${Math.random().toString(36).slice(2, 7)}`,
  roomId: localStorage.getItem('ghost_room') || '',
  secret: localStorage.getItem('ghost_secret') || '',
  localStream: null,
  peerConnection: null,
  pendingIceCandidates: [],
};

els.alias.value = state.alias;
els.roomId.value = state.roomId;
els.secret.value = state.secret;

function setStatus(text) {
  els.status.textContent = text;
  els.statusPill.classList.remove('online', 'connecting');
  if (text === 'online') els.statusPill.classList.add('online');
  if (String(text).includes('connecting')) els.statusPill.classList.add('connecting');
}

function emitWithAck(eventName, payload) {
  return new Promise((resolve, reject) => {
    if (!state.socket) {
      reject(new Error('Socket not initialized.'));
      return;
    }
    state.socket.timeout(8000).emit(eventName, payload, (err, response) => {
      if (err) {
        reject(new Error(`${eventName} timed out.`));
        return;
      }
      if (response?.ok === false) {
        reject(new Error(response.error || `${eventName} failed.`));
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

function savePrefs() {
  localStorage.setItem('ghost_alias', els.alias.value.trim());
  localStorage.setItem('ghost_room', els.roomId.value.trim());
  localStorage.setItem('ghost_secret', els.secret.value);
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function deriveKey(secret, roomId) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(`ghostchat:${roomId}`),
      iterations: 250000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptJson(obj, secret, roomId) {
  const key = await deriveKey(secret, roomId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    iv: arrayBufferToBase64(iv.buffer),
    cipher: arrayBufferToBase64(cipher),
  };
}

async function decryptJson(payload, secret, roomId) {
  const key = await deriveKey(secret, roomId);
  const iv = base64ToArrayBuffer(payload.iv);
  const cipher = base64ToArrayBuffer(payload.cipher);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ghostchat-db', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' });
        store.createIndex('roomId', 'roomId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(record) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('messages', 'readwrite');
    tx.objectStore('messages').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetRoom(roomId) {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('messages', 'readonly');
    const idx = tx.objectStore('messages').index('roomId');
    const req = idx.getAll(IDBKeyRange.only(roomId));
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
}

function dbClear() {
  return new Promise((resolve, reject) => {
    const tx = state.db.transaction('messages', 'readwrite');
    tx.objectStore('messages').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMessage(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.self ? 'self' : ''}`;
  const date = new Date(msg.createdAt).toLocaleString();
  let content = '';
  if (msg.type === 'image') {
    content = `<img src="${msg.imageDataUrl}" alt="encrypted shared image" />`;
    if (msg.text) content += `<p>${escapeHtml(msg.text)}</p>`;
  } else {
    content = `<p>${escapeHtml(msg.text || '')}</p>`;
  }
  div.innerHTML = `
    <div class="meta">${escapeHtml(msg.alias)} • ${date}</div>
    ${content}
  `;
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
}

async function loadRoomHistory() {
  els.messages.innerHTML = '';
  if (!state.db || !els.roomId.value.trim()) return;
  const roomMessages = await dbGetRoom(els.roomId.value.trim());
  for (const msg of roomMessages) renderMessage(msg);
}

async function connectSocket() {
  savePrefs();
  const roomId = els.roomId.value.trim();
  const secret = els.secret.value;
  const alias = els.alias.value.trim() || 'anon';

  if (!roomId || !secret) {
    alert('Room ID and shared secret are required.');
    return;
  }

  if (state.socket?.connected) {
    state.socket.disconnect();
  }

  state.socket = io({ transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: 8 });
  setStatus('connecting...');

  state.socket.on('connect', async () => {
    try {
      await emitWithAck('join-room', { roomId, alias });
      setStatus('online');
      await loadRoomHistory();
    } catch (err) {
      console.error(err);
      setStatus('join failed');
      alert(err.message || 'Could not join the room.');
    }
  });

  state.socket.on('connect_error', (err) => {
    console.error('Socket connect error', err);
    setStatus('connection error');
  });

  state.socket.on('disconnect', () => {
    setStatus('offline');
  });

  state.socket.on('presence', ({ count }) => {
    els.peerCount.textContent = String(Math.max(0, count - 1));
  });

  state.socket.on('encrypted-message', async (payload) => {
    try {
      const data = await decryptJson(payload.encrypted, secret, roomId);
      const record = {
        id: data.id,
        roomId,
        alias: data.alias || 'anon',
        text: data.text || '',
        imageDataUrl: data.imageDataUrl || '',
        type: data.type || 'text',
        createdAt: data.createdAt || Date.now(),
        self: false,
      };
      await dbPut(record);
      renderMessage(record);
    } catch (err) {
      console.error('Decrypt failed', err);
    }
  });

  state.socket.on('signal', async (payload) => {
    const data = payload.encrypted ? await decryptJson(payload.encrypted, secret, roomId) : payload;
    await handleSignal(data);
  });
}

function disconnectSocket() {
  if (state.socket) state.socket.disconnect();
  setStatus('offline');
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function sendMessage() {
  const text = els.messageInput.value.trim();
  const file = els.imageInput.files[0];
  const roomId = els.roomId.value.trim();
  const secret = els.secret.value;
  const alias = els.alias.value.trim() || 'anon';

  if (!state.socket?.connected) {
    alert('Connect first.');
    return;
  }
  if (!text && !file) return;

  const payload = {
    id: crypto.randomUUID(),
    alias,
    text,
    type: file ? 'image' : 'text',
    imageDataUrl: file ? await fileToDataUrl(file) : '',
    createdAt: Date.now(),
  };

  try {
    const encrypted = await encryptJson(payload, secret, roomId);
    await emitWithAck('encrypted-message', { roomId, encrypted });

    const localRecord = { ...payload, roomId, self: true };
    await dbPut(localRecord);
    renderMessage(localRecord);

    els.messageInput.value = '';
    els.imageInput.value = '';
    els.fileLabelText.textContent = 'Attach image';

    if (els.disconnectAfterSend.checked) disconnectSocket();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Message send failed.');
  }
}

async function createPeerConnection() {
  if (state.peerConnection) return state.peerConnection;

  state.peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  state.peerConnection.onicecandidate = async (event) => {
    if (!event.candidate) return;
    try {
      await sendSignal({ type: 'ice-candidate', candidate: event.candidate });
    } catch (err) {
      console.error('Failed to send ICE candidate', err);
    }
  };

  state.peerConnection.ontrack = (event) => {
    els.remoteVideo.srcObject = event.streams[0];
  };

  if (!state.localStream) {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: !els.audioOnly.checked,
    });
    els.localVideo.srcObject = state.localStream;
  }

  for (const track of state.localStream.getTracks()) {
    state.peerConnection.addTrack(track, state.localStream);
  }

  return state.peerConnection;
}

async function sendSignal(signalData) {
  const roomId = els.roomId.value.trim();
  const secret = els.secret.value;
  const encrypted = await encryptJson(signalData, secret, roomId);
  await emitWithAck('signal', { roomId, encrypted });
}

async function startCall() {
  if (!state.socket?.connected) {
    alert('Connect first.');
    return;
  }
  const pc = await createPeerConnection();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await sendSignal({ type: 'offer', sdp: offer });
}

async function handleSignal(data) {
  if (data.type === 'hangup') {
    hangUp(false);
    return;
  }

  const pc = await createPeerConnection();

  if (data.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    for (const candidate of state.pendingIceCandidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Pending ICE error', err);
      }
    }
    state.pendingIceCandidates = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal({ type: 'answer', sdp: answer });
    return;
  }

  if (data.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    for (const candidate of state.pendingIceCandidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Pending ICE error', err);
      }
    }
    state.pendingIceCandidates = [];
    return;
  }

  if (data.type === 'ice-candidate' && data.candidate) {
    if (!pc.remoteDescription) {
      state.pendingIceCandidates.push(data.candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (err) {
      console.error('ICE error', err);
    }
  }
}

async function hangUp(sendRemote = true) {
  if (state.peerConnection) {
    state.peerConnection.close();
    state.peerConnection = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => track.stop());
    state.localStream = null;
  }
  els.localVideo.srcObject = null;
  els.remoteVideo.srcObject = null;
  state.pendingIceCandidates = [];
  if (sendRemote && state.socket?.connected) {
    try {
      await sendSignal({ type: 'hangup' });
    } catch (err) {
      console.error('Failed to notify peer about hangup', err);
    }
  }
}

els.connectBtn.addEventListener('click', async () => {
  await connectSocket();
});
els.disconnectBtn.addEventListener('click', disconnectSocket);
els.sendBtn.addEventListener('click', sendMessage);
els.imageInput.addEventListener('change', () => {
  const file = els.imageInput.files?.[0];
  els.fileLabelText.textContent = file ? file.name.slice(0, 24) : 'Attach image';
});
els.clearLocalBtn.addEventListener('click', async () => {
  await dbClear();
  els.messages.innerHTML = '';
});
els.startCallBtn.addEventListener('click', startCall);
els.hangupBtn.addEventListener('click', () => hangUp(true));
els.messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

(async function init() {
  try {
    state.db = await openDb();
    await loadRoomHistory();
  } catch (err) {
    console.error('Initialization failed', err);
    alert('Failed to initialize local database in this browser.');
  }
})();
