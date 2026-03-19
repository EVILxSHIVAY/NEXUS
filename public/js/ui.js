/**
 * UI.js — All DOM manipulation and UI state for NEXUS
 */
const UI = (() => {

  // ── State ────────────────────────────────────────────────────────────────
  let sidebarOpen = false;
  let activeTab = 'chat';
  const messages = [];
  const participants = new Map(); // socketId -> { name }
  let toastTimer = null;
  let callStart = null;
  let timerInterval = null;

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    makePipDraggable();
  }

  // ── Landing ───────────────────────────────────────────────────────────────
  function setServerStatus(status) {
    const el = document.getElementById('server-status');
    const dot = el.querySelector('.dot');
    const span = el.querySelector('span');
    dot.className = 'dot';
    if (status === 'connected') {
      dot.classList.add('dot-green');
      span.textContent = 'Server connected';
    } else if (status === 'error') {
      dot.classList.add('dot-red');
      span.textContent = 'Cannot reach server';
    } else {
      dot.classList.add('dot-yellow');
      span.textContent = 'Connecting to server...';
    }
  }

  // ── Call screen ───────────────────────────────────────────────────────────
  function showCallScreen(roomId, myName) {
    document.getElementById('landing').style.display = 'none';
    const cs = document.getElementById('call-screen');
    cs.classList.add('active');

    document.getElementById('topbar-room-id').textContent = roomId;
    document.getElementById('share-room-id-box').querySelector('#share-id-text').textContent = roomId;
    document.getElementById('share-url-box').textContent = window.location.origin + '/?room=' + roomId;
    document.getElementById('pip-label').textContent = myName + ' (you)';
    document.getElementById('pip-avatar').textContent = myName.charAt(0).toUpperCase();
    document.getElementById('room-label-ctrl').textContent = 'Room: ' + roomId;

    callStart = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer();
  }

  function hideCallScreen() {
    const cs = document.getElementById('call-screen');
    cs.classList.remove('active');
    document.getElementById('landing').style.display = 'flex';
    document.getElementById('videos-grid').innerHTML = `
      <div class="empty-state" id="empty-state">
        <div class="empty-icon">⬡</div>
        <div class="empty-text">Waiting for others to join...</div>
        <div class="empty-sub">Share your Room ID to invite people</div>
        <button class="btn btn-secondary" style="margin-top:20px;width:auto;padding:12px 24px" onclick="UI.showShareModal()">🔗 Share Room ID</button>
      </div>`;
    clearInterval(timerInterval);
    messages.length = 0;
    participants.clear();
    sidebarOpen = false;
    document.getElementById('sidebar').classList.remove('open');
  }

  function updateTimer() {
    if (!callStart) return;
    const s = Math.floor((Date.now() - callStart) / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    document.getElementById('call-timer').textContent =
      String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  // ── Connection status ─────────────────────────────────────────────────────
  function setConnectionStatus(status, text) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('conn-status');
    dot.className = 'status-dot';
    if (status === 'connected') dot.classList.add('connected');
    label.textContent = text;
  }

  function updateParticipantCount(count) {
    document.getElementById('part-count').textContent = '👤 ' + count;
  }

  // ── Video tiles ───────────────────────────────────────────────────────────
  function addRemoteTile(socketId, name, stream) {
    const grid = document.getElementById('videos-grid');

    // Remove empty state
    const empty = document.getElementById('empty-state');
    if (empty) empty.remove();

    // Check if tile already exists
    let tile = document.getElementById('tile-' + socketId);
    if (tile) {
      tile.querySelector('video').srcObject = stream;
      return;
    }

    tile = document.createElement('div');
    tile.className = 'video-tile';
    tile.id = 'tile-' + socketId;

    const initial = name.charAt(0).toUpperCase();

    tile.innerHTML = `
      <video autoplay playsinline></video>
      <div class="video-avatar">
        <div class="avatar-circle">${initial}</div>
        <div class="avatar-name">${name}</div>
      </div>
      <div class="video-name-tag">${name}</div>
      <div class="video-badges">
        <div class="badge muted-mic" title="Muted">🔇</div>
        <div class="badge muted-cam" title="Camera off">📵</div>
      </div>
    `;

    tile.querySelector('video').srcObject = stream;
    grid.appendChild(tile);
    updateGridLayout();
  }

  function removeRemoteTile(socketId) {
    const tile = document.getElementById('tile-' + socketId);
    if (tile) {
      tile.style.animation = 'none';
      tile.style.opacity = '0';
      tile.style.transition = 'opacity 0.2s';
      setTimeout(() => {
        tile.remove();
        updateGridLayout();
        checkEmptyGrid();
      }, 200);
    }
  }

  function checkEmptyGrid() {
    const grid = document.getElementById('videos-grid');
    if (grid.children.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" id="empty-state">
          <div class="empty-icon">⬡</div>
          <div class="empty-text">Waiting for others to join...</div>
          <div class="empty-sub">Share your Room ID to invite people</div>
          <button class="btn btn-secondary" style="margin-top:20px;width:auto;padding:12px 24px" onclick="UI.showShareModal()">🔗 Share Room ID</button>
        </div>`;
    }
  }

  function updateGridLayout() {
    const grid = document.getElementById('videos-grid');
    const count = grid.querySelectorAll('.video-tile').length;
    grid.className = 'videos-grid g' + Math.max(1, Math.min(count, 6));
  }

  function setPeerMediaState(socketId, audio, video) {
    const tile = document.getElementById('tile-' + socketId);
    if (!tile) return;
    tile.classList.toggle('cam-off', !video);
    tile.classList.toggle('mic-off', !audio);
  }

  // ── Local video ───────────────────────────────────────────────────────────
  function setLocalStream(stream) {
    document.getElementById('local-video').srcObject = stream;
  }

  function setMicState(on) {
    const btn = document.getElementById('btn-mic');
    btn.textContent = on ? '🎙' : '🔇';
    btn.classList.toggle('off', !on);
  }

  function setCamState(on) {
    const btn = document.getElementById('btn-cam');
    btn.textContent = on ? '📷' : '🚫';
    btn.classList.toggle('off', !on);
    document.getElementById('local-pip').classList.toggle('cam-off', !on);
  }

  function setScreenState(on) {
    document.getElementById('btn-screen').classList.toggle('off', on);
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  function openSidebar(tab) {
    activeTab = tab;
    sidebarOpen = true;
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('btn-chat').classList.toggle('sidebar-on', tab === 'chat');
    document.getElementById('btn-people').classList.toggle('sidebar-on', tab === 'people');
    document.getElementById('stab-chat').classList.toggle('active', tab === 'chat');
    document.getElementById('stab-people').classList.toggle('active', tab === 'people');
    renderSidebarContent();
  }

  function closeSidebar() {
    sidebarOpen = false;
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('btn-chat').classList.remove('sidebar-on');
    document.getElementById('btn-people').classList.remove('sidebar-on');
  }

  function switchTab(tab) {
    activeTab = tab;
    document.getElementById('stab-chat').classList.toggle('active', tab === 'chat');
    document.getElementById('stab-people').classList.toggle('active', tab === 'people');
    document.getElementById('btn-chat').classList.toggle('sidebar-on', tab === 'chat');
    document.getElementById('btn-people').classList.toggle('sidebar-on', tab === 'people');
    renderSidebarContent();
  }

  function renderSidebarContent() {
    const content = document.getElementById('sidebar-content');
    if (activeTab === 'chat') renderChat(content);
    else renderPeople(content);
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  function addMessage(name, text, own, system = false) {
    messages.push({ name, text, own, system, t: Date.now() });
    if (sidebarOpen && activeTab === 'chat') {
      appendMessageToDOM({ name, text, own, system });
      scrollChatToBottom();
    } else if (!system && !own) {
      // Badge notification
      const btn = document.getElementById('btn-chat');
      btn.style.boxShadow = '0 0 0 3px rgba(60,255,180,0.45)';
      setTimeout(() => btn.style.boxShadow = '', 3500);
    }
  }

  function renderChat(container) {
    container.innerHTML = `
      <div class="chat-messages" id="chat-msgs"></div>
      <div class="chat-input-row">
        <input type="text" class="chat-input" id="chat-input" placeholder="Message everyone..." maxlength="500">
        <button class="chat-send" id="chat-send-btn">↑</button>
      </div>
    `;
    const msgs = document.getElementById('chat-msgs');
    messages.forEach(m => appendMessageToDOM(m, msgs));
    scrollChatToBottom();

    document.getElementById('chat-input').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); App.sendChat(); }
    });
    document.getElementById('chat-send-btn').addEventListener('click', App.sendChat);
  }

  function appendMessageToDOM(msg, container) {
    const msgs = container || document.getElementById('chat-msgs');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = `chat-msg${msg.own ? ' own' : ''}${msg.system ? ' system' : ''}`;
    if (msg.system) {
      div.innerHTML = `<div class="chat-msg-bubble">${escHtml(msg.text)}</div>`;
    } else {
      div.innerHTML = `
        <div class="chat-msg-name">${escHtml(msg.name)}</div>
        <div class="chat-msg-bubble">${escHtml(msg.text)}</div>
      `;
    }
    msgs.appendChild(div);
  }

  function scrollChatToBottom() {
    const msgs = document.getElementById('chat-msgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function getChatInputValue() {
    const el = document.getElementById('chat-input');
    return el ? el.value.trim() : '';
  }

  function clearChatInput() {
    const el = document.getElementById('chat-input');
    if (el) el.value = '';
  }

  // ── Participants ──────────────────────────────────────────────────────────
  function addParticipant(socketId, name) {
    participants.set(socketId, { name });
    if (sidebarOpen && activeTab === 'people') renderPeople(document.getElementById('sidebar-content'));
  }

  function removeParticipant(socketId) {
    participants.delete(socketId);
    if (sidebarOpen && activeTab === 'people') renderPeople(document.getElementById('sidebar-content'));
  }

  function setMyInfo(socketId, name) {
    participants.set('__me__', { name, isMe: true });
  }

  function renderPeople(container) {
    let html = '<div class="participants-list">';
    // Me first
    if (participants.has('__me__')) {
      const me = participants.get('__me__');
      html += `
        <div class="participant-item">
          <div class="participant-avatar">${me.name.charAt(0).toUpperCase()}</div>
          <div class="participant-name">${escHtml(me.name)}</div>
          <div class="participant-you">you</div>
        </div>`;
    }
    // Others
    for (const [id, p] of participants) {
      if (id === '__me__') continue;
      const colors = ['linear-gradient(135deg,#3cffb4,#0099ff)', 'linear-gradient(135deg,#ffd60a,#ff8c00)', 'linear-gradient(135deg,#b388ff,#6200ee)'];
      const color = colors[Math.abs(id.charCodeAt(0) + id.charCodeAt(1)) % colors.length];
      html += `
        <div class="participant-item">
          <div class="participant-avatar" style="background:${color}">${p.name.charAt(0).toUpperCase()}</div>
          <div class="participant-name">${escHtml(p.name)}</div>
        </div>`;
    }
    if (participants.size <= 1) {
      html += `<div style="text-align:center;padding:40px 0;font-family:'DM Mono',monospace;font-size:11px;color:rgba(255,255,255,0.2)">
        Invite others to join<br><br>
        <button class="btn btn-secondary" style="width:auto;padding:10px 18px;font-size:11px" onclick="UI.showShareModal()">Share Room ID</button>
      </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
  }

  // ── Modals ────────────────────────────────────────────────────────────────
  function showShareModal() {
    document.getElementById('share-modal').classList.add('show');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('show');
  }

  function copyRoomId() {
    const text = document.getElementById('share-id-text').textContent;
    navigator.clipboard.writeText(text).then(() => toast('📋 Room ID copied!')).catch(() => toast('Room: ' + text));
    closeModal('share-modal');
  }

  function copyLink() {
    const url = document.getElementById('share-url-box').textContent;
    navigator.clipboard.writeText(url).then(() => toast('🔗 Link copied!')).catch(() => toast('Copy failed'));
    closeModal('share-modal');
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ── Draggable PIP ─────────────────────────────────────────────────────────
  function makePipDraggable() {
    const pip = document.getElementById('local-pip');
    let dragging = false, ox = 0, oy = 0;

    pip.addEventListener('mousedown', e => {
      dragging = true;
      const r = pip.getBoundingClientRect();
      ox = e.clientX - r.left;
      oy = e.clientY - r.top;
      pip.style.transition = 'none';
      pip.style.right = 'auto'; pip.style.bottom = 'auto';
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(e.clientX - ox, window.innerWidth - pip.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - oy, window.innerHeight - pip.offsetHeight));
      pip.style.left = x + 'px';
      pip.style.top = y + 'px';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
      pip.style.transition = '';
    });

    // Touch support
    pip.addEventListener('touchstart', e => {
      const touch = e.touches[0];
      dragging = true;
      const r = pip.getBoundingClientRect();
      ox = touch.clientX - r.left;
      oy = touch.clientY - r.top;
      pip.style.right = 'auto'; pip.style.bottom = 'auto';
    });

    document.addEventListener('touchmove', e => {
      if (!dragging) return;
      const touch = e.touches[0];
      pip.style.left = (touch.clientX - ox) + 'px';
      pip.style.top = (touch.clientY - oy) + 'px';
    });

    document.addEventListener('touchend', () => { dragging = false; });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Click outside modal to close
  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('show');
  });

  return {
    init, setServerStatus, showCallScreen, hideCallScreen,
    setConnectionStatus, updateParticipantCount,
    addRemoteTile, removeRemoteTile, setPeerMediaState,
    setLocalStream, setMicState, setCamState, setScreenState,
    openSidebar, closeSidebar, switchTab,
    addMessage, getChatInputValue, clearChatInput,
    addParticipant, removeParticipant, setMyInfo,
    showShareModal, closeModal, copyRoomId, copyLink,
    toast
  };
})();
