let currentUser = null;

window.addEventListener('DOMContentLoaded', async () => {
  await loadUser();
  await loadMeetings();
});

async function loadUser() {
  try {
    const res = await fetch('/api/me');
    if (res.status === 401) { window.location.href = '/login'; return; }
    currentUser = await res.json();

    document.getElementById('user-name').textContent  = currentUser.name;
    document.getElementById('hero-name').textContent  = currentUser.name.split(' ')[0];
    document.getElementById('profile-name').textContent  = currentUser.name;
    document.getElementById('profile-email').textContent = currentUser.email || 'Google Account';
    document.getElementById('edit-name').value = currentUser.name;
    document.getElementById('profile-joined').textContent =
      new Date(currentUser.createdAt).toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

    setAvatar('user-avatar',    currentUser);
    setAvatar('profile-avatar', currentUser);

  } catch (err) {
    console.error('Failed to load user:', err);
  }
}

function setAvatar(elId, user) {
  const el = document.getElementById(elId);
  if (user.avatar && user.avatar.startsWith('http')) {
    el.innerHTML = `<img src="${user.avatar}" alt="${user.name}">`;
  } else {
    el.textContent = user.initial || user.name.charAt(0).toUpperCase();
  }
}

async function loadMeetings() {
  try {
    const res      = await fetch('/api/meetings');
    if (!res.ok) return;
    const meetings = await res.json();
    updateStats(meetings);
    renderMeetings(meetings);
  } catch (err) {
    document.getElementById('loading-meetings').innerHTML =
      '<span style="color:var(--ink-2)">Could not load meetings.</span>';
  }
}

function updateStats(meetings) {
  const total  = meetings.length;
  const hosted = meetings.filter(m => m.hostId === currentUser?.id).length;
  const secs   = meetings.reduce((acc, m) => acc + (m.duration || 0), 0);
  const people = new Set();
  meetings.forEach(m => m.participants?.forEach(p => {
    if (p.name !== currentUser?.name) people.add(p.name);
  }));

  document.getElementById('stat-total').textContent  = total;
  document.getElementById('stat-hosted').textContent = hosted;
  document.getElementById('stat-time').textContent   = formatDuration(secs) || '0m';
  document.getElementById('stat-people').textContent = people.size;
}

function renderMeetings(meetings) {
  const loading = document.getElementById('loading-meetings');
  const empty   = document.getElementById('empty-meetings');
  const table   = document.getElementById('meetings-table');
  const tbody   = document.getElementById('meetings-tbody');
  const count   = document.getElementById('meetings-count');

  loading.style.display = 'none';
  count.textContent     = `${meetings.length} meeting${meetings.length !== 1 ? 's' : ''}`;

  if (meetings.length === 0) {
    empty.style.display = 'block';
    return;
  }

  table.style.display = 'block';
  tbody.innerHTML     = '';

  meetings.forEach(m => {
    const isHost = m.hostId === currentUser?.id;
    const date   = new Date(m.startedAt);
    const dateStr= date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr= date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const dur    = m.duration
      ? formatDuration(m.duration)
      : (!m.endedAt ? '<span style="color:var(--go)">Live</span>' : '—');
    const parts  = m.participants || [];
    const shown  = parts.slice(0, 4);
    const extra  = parts.length > 4 ? parts.length - 4 : 0;
    const avatars= shown.map(p =>
      `<div class="p-avatar" title="${escHtml(p.name)}">${p.name.charAt(0).toUpperCase()}</div>`
    ).join('') + (extra > 0 ? `<div class="p-avatar">+${extra}</div>` : '');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="room-id-badge">${escHtml(m.roomId)}</span></td>
      <td style="color:var(--ink-0)">${escHtml(m.title || m.roomId)}</td>
      <td><span class="role-badge ${isHost ? 'role-host' : 'role-participant'}">${isHost ? 'Host' : 'Guest'}</span></td>
      <td>${dateStr}<br><small style="color:var(--ink-2)">${timeStr}</small></td>
      <td>${dur}</td>
      <td><div class="participants-cell">${avatars}</div></td>
      <td><a class="btn-rejoin" href="/call?room=${m.roomId}">${m.endedAt ? 'Rejoin' : 'Open'} →</a></td>`;
    tbody.appendChild(tr);
  });
}

function createMeeting() {
  document.getElementById('meeting-title').value = '';
  document.getElementById('meeting-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('meeting-title').focus(), 80);
}

function closeMeetingModal() {
  document.getElementById('meeting-modal').style.display = 'none';
}

async function confirmCreateMeeting() {
  const title = document.getElementById('meeting-title').value.trim();
  try {
    const res  = await fetch('/api/meetings/create', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title: title || undefined })
    });
    const data = await res.json();
    if (!res.ok) { showToast('Failed to create meeting.'); return; }
    closeMeetingModal();
    window.location.href = `/call?room=${data.roomId}`;
  } catch (err) {
    showToast('Network error.');
  }
}

function joinMeeting() {
  const id = document.getElementById('join-id-input').value.trim().toUpperCase();
  if (!id)        { showToast('Enter a Room ID first.'); return; }
  if (id.length < 4) { showToast('Room ID is too short.'); return; }
  window.location.href = `/call?room=${id}`;
}

async function saveName() {
  const name = document.getElementById('edit-name').value.trim();
  if (!name) { showToast('Name cannot be empty.'); return; }
  try {
    const res  = await fetch('/api/me', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name })
    });
    if (!res.ok) { showToast('Failed to update name.'); return; }
    const user = await res.json();
    document.getElementById('user-name').textContent    = user.name;
    document.getElementById('hero-name').textContent    = user.name.split(' ')[0];
    document.getElementById('profile-name').textContent = user.name;
    showToast('Name updated.');
  } catch (err) {
    showToast('Network error.');
  }
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function formatDuration(secs) {
  if (!secs || secs < 1) return '0m';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
