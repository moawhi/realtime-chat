// ---- App shell: routing + UI. Talks to the modules only through their exports. ----
import { getProfile, updateProfile, cleanName } from './profile.js';
import { history } from './storage.js';
import * as rooms from './rooms.js';
import { mountWordle, statsView } from './wordle.js';

const $ = id => document.getElementById(id);
let profile = getProfile();
let conn = null, connCode = null, heartbeat = null;

// ---------- helpers ----------
const fmt = ts => { const d = new Date(ts), now = new Date(); const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); return d.toDateString() === now.toDateString() ? t : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + t; };
const ago = ts => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let toastT;
function toast(text, action, ms = 3500) {
  $('toastText').textContent = text;
  const b = $('toastBtn'); b.hidden = !action; if (action) { b.textContent = action.label; b.onclick = () => { hideToast(); action.run(); }; }
  $('toast').classList.add('on'); clearTimeout(toastT); toastT = setTimeout(hideToast, action ? 7000 : ms);
}
const hideToast = () => $('toast').classList.remove('on');
async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { prompt('Copy this:', text); return false; } }
async function shareInvite(code, title) {
  const url = rooms.joinLink(code), text = 'Join my room "' + title + '" on Offsuit. Code: ' + code;
  if (navigator.share) { try { await navigator.share({ title: 'Offsuit room', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  await copy(text + '\n' + url); toast('Invite link copied');
}
function setStatus(s) {
  const st = $('status'); st.textContent = '';
  if (!s) return;
  const d = el('span', 'dot' + (s === 'live' ? ' on' : '')); st.append(d, s === 'live' ? 'live' : s);
}

// ---------- routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [page, arg] = h.split('/');
  const show = id => { document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === id)); };
  document.body.classList.toggle('in-room', page === 'room');
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === (page === 'daily' ? 'daily' : page === 'me' ? 'me' : 'rooms')));
  if (page !== 'room') leaveRoom();
  if (page === 'host') { show('vHost'); $('hostForm').hidden = false; $('hostDone').hidden = true; $('hostName').value = profile.name; ($('hostName').value ? $('hostTitle') : $('hostName')).focus(); }
  else if (page === 'join') { show('vJoin'); $('joinCode').value = rooms.normCode(arg || ''); $('joinName').value = profile.name; $('joinErr').textContent = ''; ($('joinCode').value.length === 6 ? $('joinName') : $('joinCode')).focus(); }
  else if (page === 'room' && rooms.validCode(rooms.normCode(arg))) { show('vRoom'); enterRoom(rooms.normCode(arg)); }
  else if (page === 'daily') { show('vDaily'); wordle.refresh(); }
  else if (page === 'me') { show('vMe'); renderMe(); }
  else { show('vRooms'); renderHome(); }
}
window.addEventListener('hashchange', route);
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) location.hash = b.dataset.go; });

// ---------- home ----------
function roomItem(r, { right, onClick, sel } = {}) {
  const b = el('button', 'item' + (sel ? ' sel' : '')); b.type = 'button'; b.dataset.code = r.code;
  const av = el('span', 'av', (r.title || r.code).trim().slice(0, 1).toUpperCase());
  const mid = el('span', 'mid'); const t = el('b', null, r.title || 'Room ' + r.code);
  if (r.hostId && r.hostId === profile.id) t.append(el('span', 'badge', 'host'));
  mid.append(t, el('span', null, r.lastText || (r.pub ? 'Public · ' : '') + 'Code ' + r.code));
  b.append(av, mid, el('span', 'rt', right || ''));
  b.addEventListener('click', onClick || (() => { location.hash = '#/room/' + r.code; }));
  return b;
}
function renderHome() {
  const my = $('myRooms'); my.textContent = '';
  const list = rooms.roomList();
  if (!list.length) my.append(el('div', 'empty', 'Rooms you host or join show up here.'));
  for (const r of list) my.append(roomItem(r, { right: ago(r.lastTs || r.joinedAt) }));
  loadPublic();
}
async function loadPublic() {
  const box = $('pubRooms');
  try {
    const list = (await rooms.publicRooms()).filter(p => !rooms.myRooms()[p.code]);
    box.textContent = '';
    if (!list.length) box.append(el('div', 'empty', 'No public rooms right now. Host one and tick "List publicly".'));
    for (const p of list.slice(0, 15)) box.append(roomItem({ code: p.code, title: p.title, pub: true }, { right: ago(p.last), onClick: () => { location.hash = '#/join/' + p.code; } }));
  } catch { box.textContent = ''; box.append(el('div', 'empty', 'Couldn\u2019t load public rooms.')); }
}
$('refreshPub').addEventListener('click', loadPublic);
$('hostBtn').addEventListener('click', () => { location.hash = '#/host'; });
$('quickJoin').addEventListener('submit', e => {
  e.preventDefault(); const c = rooms.normCode($('quickCode').value);
  if (!rooms.validCode(c)) { $('quickErr').textContent = 'Room codes are 6 letters/numbers, like K7QM3D.'; return; }
  $('quickErr').textContent = ''; $('quickCode').value = ''; location.hash = '#/join/' + c;
});

// ---------- host ----------
let hosted = null;
$('hostF').addEventListener('submit', async e => {
  e.preventDefault();
  const nm = cleanName($('hostName').value);
  if (!nm) { $('hostErr').textContent = 'Enter your name.'; $('hostName').focus(); return; }
  profile = updateProfile({ name: nm });
  const btn = $('hostGo'); btn.disabled = true; btn.textContent = 'Creating…'; $('hostErr').textContent = '';
  try {
    hosted = await rooms.hostRoom(profile, { title: $('hostTitle').value, pub: $('hostPub').checked });
    $('bigCode').textContent = hosted.code; $('hostDoneTitle').textContent = hosted.meta.title + (hosted.meta.pub ? ' · listed publicly' : ' · private (code only)');
    $('hostForm').hidden = true; $('hostDone').hidden = false; $('hostTitle').value = ''; $('hostPub').checked = false;
  } catch (err) { $('hostErr').textContent = err.message || 'Could not create the room. Try again.'; }
  finally { btn.disabled = false; btn.textContent = 'Create room'; }
});
$('shareRoom').addEventListener('click', () => hosted && shareInvite(hosted.code, hosted.meta.title));
$('copyLink').addEventListener('click', async () => { if (hosted && await copy(rooms.joinLink(hosted.code))) toast('Link copied'); });
$('copyCode').addEventListener('click', async () => { if (hosted && await copy(hosted.code)) toast('Code copied'); });
$('enterRoom').addEventListener('click', () => { if (hosted) location.hash = '#/room/' + hosted.code; });

// ---------- join ----------
let justJoined = null;
$('joinCode').addEventListener('input', e => { const v = rooms.normCode(e.target.value).slice(0, 6); if (e.target.value !== v) e.target.value = v; });
$('joinF').addEventListener('submit', async e => {
  e.preventDefault();
  const code = rooms.normCode($('joinCode').value), nm = cleanName($('joinName').value);
  if (!rooms.validCode(code)) { $('joinErr').textContent = 'Room codes are 6 letters/numbers, like K7QM3D.'; $('joinCode').focus(); return; }
  if (!nm) { $('joinErr').textContent = 'Enter your name.'; $('joinName').focus(); return; }
  profile = updateProfile({ name: nm });
  const btn = $('joinGo'); btn.disabled = true; btn.textContent = 'Finding room…'; $('joinErr').textContent = '';
  try {
    const known = rooms.myRooms()[code];
    const meta = known ? null : await rooms.findRoom(code);
    if (!known && !meta) { $('joinErr').textContent = 'No room with that code. Check it, or ask the host to send a message (rooms go quiet after 12h without activity).'; return; }
    if (meta) rooms.saveRoom(code, { title: meta.title, hostId: meta.hostId, hostName: meta.hostName, pub: meta.pub, joinedAt: Date.now() });
    justJoined = code; location.hash = '#/room/' + code;
  } catch (err) { $('joinErr').textContent = err.message || 'Something went wrong.'; }
  finally { btn.disabled = false; btn.textContent = 'Join'; }
});

// ---------- room ----------
function renderCard(card) {
  const box = el('div', 'bubble rcard');
  if (card.game !== 'wordle') { box.textContent = 'Shared a result'; return box; }
  box.append(el('div', 'h', '🔤 Daily #' + (Number(card.no) || '?') + ' · ' + (card.won ? Math.min(6, Number(card.n) || 0) + '/6' : card.over ? 'X/6' : 'in progress')));
  box.append(el('div', 's', String(card.date || '').slice(0, 10)));
  const EM = { c: '🟩', p: '🟨', a: '⬛' };
  box.append(el('div', 'g', (Array.isArray(card.rows) ? card.rows : []).slice(0, 6).map(r => [...String(r).slice(0, 5)].map(ch => EM[ch] || '⬛').join('')).join('\n')));
  const s = card.stats || {}, n = v => Math.max(0, Math.floor(Number(v) || 0));
  const kvs = el('div', 'kvs');
  for (const [k, v] of [['Streak', n(s.streak)], ['Played', n(s.played)], ['Win %', Math.min(100, n(s.winPct))], ['Avg', s.avg ? Number(s.avg).toFixed(2) : '–']]) { const d = el('div'); d.append(el('b', null, String(v)), el('span', null, k)); kvs.append(d); }
  box.append(kvs);
  return box;
}
function addMessage(m, meta) {
  const box = $('msgs');
  if (box.querySelector('[data-id="' + CSS.escape(m.id) + '"]')) return;
  let node;
  if (m.t === 'join' || m.t === 'create') {
    if (m.from.id === profile.id) return;
    node = el('div', 'sys', m.from.name + (m.t === 'create' ? ' created the room' : ' joined') + ' · ' + fmt(m.ts));
  } else {
    const mine = m.from.id === profile.id;
    node = el('div', 'msg' + (mine ? ' me' : ''));
    const metaEl = el('div', 'meta'); const nb = el('b', null, mine ? 'You' : m.from.name);
    metaEl.append(nb); if (meta.hostId && m.from.id === meta.hostId) metaEl.append(el('span', 'badge', 'host'));
    metaEl.append(' · ' + fmt(m.ts));
    node.append(metaEl, m.t === 'card' ? renderCard(m.card) : el('div', 'bubble', m.text));
  }
  node.dataset.id = m.id; node.dataset.ts = m.ts;
  const after = [...box.children].find(x => Number(x.dataset.ts) > m.ts);
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.insertBefore(node, after || null);
  if (atBottom || m.from.id === profile.id) box.scrollTop = box.scrollHeight;
}
function renderRoomHeader(code, meta) {
  $('roomTitle').textContent = meta.title || 'Room ' + code;
  const sub = $('roomSub'); sub.textContent = 'Code ' + code + (meta.pub ? ' · public' : ' · private');
  if (meta.hostId === profile.id) sub.append(' · ', el('span', 'badge', 'host'));
  else if (meta.hostName) sub.append(' · host ' + meta.hostName);
}
async function enterRoom(code) {
  if (connCode === code && conn) return;
  leaveRoom();
  connCode = code; $('msgs').textContent = '';
  const known = rooms.saveRoom(code, {});
  renderRoomHeader(code, known);
  const sys = el('div', 'sys', 'Messages are end-to-end encrypted with the room code. This device keeps the last ' + history.cap + ' messages; the relay keeps ~12h.');
  sys.dataset.ts = 0; $('msgs').append(sys);
  if (!profile.name) { location.hash = '#/join/' + code; return; }
  let c = null;
  c = await rooms.openRoom(code, profile, {
    onMessage: m => { if (connCode === code) addMessage(m, c ? c.meta : rooms.myRooms()[code] || {}); },
    onMeta: meta => { if (connCode === code) { renderRoomHeader(code, meta); rerenderBadges(meta); } },
    onStatus: setStatus,
  });
  if (connCode !== code) { c.close(); return; }
  conn = c;
  if (justJoined === code) { justJoined = null; c.join().catch(err => toast(err.message)); }
  if (c.meta.pub) { rooms.announce(code, c.meta.title); heartbeat = setInterval(() => rooms.announce(code, c.meta.title), 10 * 60 * 1000); }
  $('text').focus();
}
function rerenderBadges(meta) { // host became known after messages were drawn: redraw from history
  const code = connCode; $('msgs').querySelectorAll('[data-id]').forEach(n => n.remove());
  history.load(code).then(list => list.forEach(m => addMessage(m, meta)));
}
function leaveRoom() { if (conn) conn.close(); conn = null; connCode = null; clearInterval(heartbeat); setStatus(''); }
$('sendF').addEventListener('submit', async e => {
  e.preventDefault(); const t = $('text').value.trim(); if (!t || !conn) return;
  $('text').value = '';
  try { await conn.send(t); } catch (err) { $('text').value = t; toast(err.message); }
});
$('roomShare').addEventListener('click', () => { if (connCode) shareInvite(connCode, (rooms.myRooms()[connCode] || {}).title || 'Room ' + connCode); });

// ---------- daily ----------
const wordle = mountWordle($('wordle'), { onShare: openPicker, toast: m => toast(m, null, 1600) });
function openPicker(card) {
  $('pkErr').textContent = '';
  const prev = $('pkPrev'); prev.textContent = ''; prev.append(renderCard(card));
  const list = $('pkList'); list.textContent = '';
  const mine = rooms.roomList();
  if (!mine.length) {
    list.append(el('div', 'empty', 'You\u2019re not in any rooms yet. Host one or join with a code, then share.'));
    const b = el('button', 'btn full', 'Host a room'); b.type = 'button'; b.onclick = () => { closePicker(); location.hash = '#/host'; }; list.append(b);
  }
  for (const r of mine) list.append(roomItem(r, { right: 'Share', onClick: async ev => {
    const btn = ev.currentTarget; btn.disabled = true;
    try { await rooms.postCard(r.code, profile, card); closePicker(); toast('Shared to ' + (r.title || r.code), { label: 'Open room', run: () => { location.hash = '#/room/' + r.code; } }); }
    catch (err) { $('pkErr').textContent = err.message; }
    finally { btn.disabled = false; }
  } }));
  $('picker').classList.add('on');
}
const closePicker = () => $('picker').classList.remove('on');
$('pkClose').addEventListener('click', closePicker);
$('picker').addEventListener('click', e => { if (e.target.id === 'picker') closePicker(); });

// ---------- me ----------
async function renderMe() {
  $('meName').value = profile.name; $('meId').textContent = profile.id; $('mePlan').textContent = profile.premium ? 'Premium' : 'Free';
  $('meSince').textContent = new Date(profile.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  const list = rooms.roomList(); $('meRooms').textContent = list.length;
  let n = 0; for (const r of list) n += (await history.load(r.code)).length; $('meMsgs').textContent = n;
}
$('meSave').addEventListener('click', () => { const nm = cleanName($('meName').value); if (!nm) return; profile = updateProfile({ name: nm }); toast('Saved'); });
$('meClear').addEventListener('click', async () => { if (!confirm('Delete the saved chat history on this device?')) return; for (const r of rooms.roomList()) await history.clear(r.code); renderMe(); toast('History cleared'); });

// test/debug hooks (read-only)
window.offsuitApp = { profile: () => profile, stats: statsView, wordle: () => wordle.state(), room: () => connCode && conn ? { code: connCode, meta: conn.meta } : null };
route();
