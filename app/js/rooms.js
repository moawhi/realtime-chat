// ---- Rooms ------------------------------------------------------------------
// Hosting, finding, joining and talking in rooms. Uses the transport + history interfaces only,
// so a backend room registry / message store can replace them later.
import { transport } from './transport.js';
import { history, kv } from './storage.js';
import { roomTopic, roomKey, seal, open, DIRECTORY_TOPIC } from './crypto.js';

// 6 characters, no look-alikes (no 0/O, 1/I/L): 31^6 ≈ 887 million codes.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 6;
export function newCode() { return [...crypto.getRandomValues(new Uint8Array(CODE_LEN))].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''); }
export function normCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
export const validCode = c => c.length === CODE_LEN && [...c].every(ch => CODE_ALPHABET.includes(ch));
export const cleanTitle = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 40);
export const joinLink = code => new URL('./', location.href).href + '#/join/' + code;

// keys are derived once per code and cached for the session
const keyCache = new Map();
async function roomCrypto(code) {
  if (!keyCache.has(code)) keyCache.set(code, Promise.all([roomTopic(code), roomKey(code)]).then(([topic, key]) => ({ topic, key })));
  return keyCache.get(code);
}

// ---- my rooms (this device) ----
export function myRooms() { const o = kv.get('rooms'); return o && typeof o === 'object' ? o : {}; }
export function saveRoom(code, patch) { const all = myRooms(); all[code] = Object.assign({ code, joinedAt: Date.now() }, all[code], patch); kv.set('rooms', all); return all[code]; }
export async function forgetRoom(code) { const all = myRooms(); delete all[code]; kv.set('rooms', all); await history.clear(code); }
export function roomList() { return Object.values(myRooms()).sort((a, b) => (b.lastTs || b.joinedAt || 0) - (a.lastTs || a.joinedAt || 0)); }

// relay note -> app message
function toMessage(note, p) {
  if (!p || typeof p !== 'object' || !['msg', 'card', 'join', 'create'].includes(p.t)) return null;
  const from = { id: String(p.from && p.from.id || '').slice(0, 32), name: String(p.from && p.from.name || '?').slice(0, 24) };
  const m = { id: note.id, t: p.t, from, ts: Number(p.ts) || note.time * 1000, at: note.time };
  if (p.t === 'msg') { if (typeof p.text !== 'string') return null; m.text = p.text.slice(0, 1000); }
  if (p.t === 'card') { if (!p.card || typeof p.card !== 'object') return null; m.card = p.card; }
  if (p.meta && typeof p.meta === 'object') m.meta = { title: cleanTitle(p.meta.title), hostId: String(p.meta.hostId || '').slice(0, 32), hostName: String(p.meta.hostName || '').slice(0, 24), pub: !!p.meta.pub };
  return m;
}

/** Look a room up by code. -> { title, hostId, hostName, pub } or null if no recent activity under that code. */
export async function findRoom(code, { retries = [1500, 2500] } = {}) {
  const { topic, key } = await roomCrypto(code);
  for (let i = 0; ; i++) {
    const notes = await transport.poll(topic);
    let meta = null, any = false;
    for (const n of notes) { const m = toMessage(n, await open(key, n.data)); if (!m) continue; any = true; if (m.meta && m.meta.hostId) meta = m.meta; }
    if (any) return meta || { title: '', hostId: '', hostName: '', pub: false };
    if (i >= retries.length) return null;
    await new Promise(r => setTimeout(r, retries[i]));
  }
}

async function post(code, payload) {
  const { topic, key } = await roomCrypto(code);
  await transport.publish(topic, await seal(key, payload));
}

/** Host a new room. -> { code, meta } */
export async function hostRoom(profile, { title, pub }) {
  let code;
  for (let i = 0; i < 4; i++) { code = newCode(); if (!(await findRoom(code, { retries: [] }))) break; } // avoid a live collision
  const meta = { title: cleanTitle(title) || profile.name + '\u2019s room', hostId: profile.id, hostName: profile.name, pub: !!pub };
  await post(code, { t: 'create', from: { id: profile.id, name: profile.name }, meta, ts: Date.now() });
  saveRoom(code, { title: meta.title, hostId: meta.hostId, hostName: meta.hostName, pub: meta.pub, joinedAt: Date.now() });
  if (meta.pub) announce(code, meta.title);
  return { code, meta };
}

/** Post a stats/result card to a room without opening it. */
export async function postCard(code, profile, card) {
  const r = myRooms()[code] || {};
  await post(code, { t: 'card', from: { id: profile.id, name: profile.name }, card, ts: Date.now(), meta: r.hostId ? { title: r.title, hostId: r.hostId, hostName: r.hostName, pub: r.pub } : undefined });
  saveRoom(code, { lastTs: Date.now(), lastText: 'You shared a result' });
}

/**
 * Open a room: loads the local history, then streams relay messages.
 * handlers: onMessage(msg, { live }), onMeta(meta), onStatus(text)
 * -> { send(text), sendCard(card), close(), meta }
 */
export async function openRoom(code, profile, { onMessage, onMeta = () => {}, onStatus = () => {} }) {
  const { topic, key } = await roomCrypto(code);
  const seen = new Set(), openedAt = Date.now();
  let meta = (({ title, hostId, hostName, pub }) => ({ title, hostId, hostName, pub }))(myRooms()[code] || {});
  for (const m of await history.load(code)) { seen.add(m.id); onMessage(m, { live: false, cached: true }); }
  let pending = [], flushT;
  const flush = () => { const b = pending; pending = []; history.append(code, b); };
  const close = transport.subscribe(topic, {
    onStatus,
    onMessage: async note => {
      if (seen.has(note.id)) return; seen.add(note.id);
      const m = toMessage(note, await open(key, note.data)); if (!m) return;
      if (m.meta && m.meta.hostId && m.meta.hostId !== meta.hostId) { meta = m.meta; saveRoom(code, { title: meta.title, hostId: meta.hostId, hostName: meta.hostName, pub: meta.pub }); onMeta(meta); }
      onMessage(m, { live: m.ts >= openedAt - 5000 });
      if (m.t === 'msg' || m.t === 'card') saveRoom(code, { lastTs: m.ts, lastText: (m.from.name + ': ' + (m.text || 'shared a result')).slice(0, 80) });
      pending.push(m); clearTimeout(flushT); flushT = setTimeout(flush, 300);
    },
  });
  const withMeta = obj => Object.assign(obj, { from: { id: profile.id, name: profile.name }, ts: Date.now(), meta: meta.hostId ? meta : undefined });
  return {
    get meta() { return meta; },
    send: text => post(code, withMeta({ t: 'msg', text: String(text).slice(0, 1000) })),
    sendCard: card => post(code, withMeta({ t: 'card', card })),
    join: () => post(code, withMeta({ t: 'join' })),
    close() { clearTimeout(flushT); flush(); close(); },
  };
}

// ---- public room directory (opt-in; lists the code, so anyone can join) ----
export async function announce(code, title) {
  try { await transport.publish(DIRECTORY_TOPIC, JSON.stringify({ v: 1, t: 'room', code, title: cleanTitle(title), ts: Date.now() })); } catch {}
}
export async function unlist(code) { try { await transport.publish(DIRECTORY_TOPIC, JSON.stringify({ v: 1, t: 'unlist', code, ts: Date.now() })); } catch {} }
export async function publicRooms() {
  const rooms = new Map();
  for (const n of await transport.poll(DIRECTORY_TOPIC)) {
    let p; try { p = JSON.parse(n.data); } catch { continue; }
    if (!p || p.v !== 1 || !validCode(p.code)) continue;
    const e = rooms.get(p.code) || { code: p.code, title: '', last: 0, listed: true, lastEvt: 0 };
    if (n.time >= e.lastEvt) { e.lastEvt = n.time; e.listed = p.t !== 'unlist'; }
    if (p.t === 'room') { e.last = Math.max(e.last, n.time * 1000); e.title = cleanTitle(p.title) || e.title; }
    rooms.set(p.code, e);
  }
  return [...rooms.values()].filter(e => e.listed && e.last).sort((a, b) => b.last - a.last).slice(0, 30);
}
