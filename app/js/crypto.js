// ---- Room crypto ------------------------------------------------------------
// The short room code is the room key: topic and AES-GCM key are both derived from it in the browser.
// The relay only sees a hashed topic and ciphertext.
const enc = new TextEncoder(), dec = new TextDecoder();
// Legacy protocol constants (topic namespace + key salt below), kept unchanged for compatibility so
// rooms created before the ChatHouse rename still connect. Not user-visible branding.
const APP = 'offsuit-rtchat-7f3k9q';
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export async function roomTopic(code) { return APP + '-app-' + hex(await crypto.subtle.digest('SHA-256', enc.encode('approom/v1/' + code))).slice(0, 32); }
export async function roomKey(code) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('offsuit-app/v1/' + code), iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) });
}
/** -> object, or null if it isn't ours / doesn't decrypt */
export async function open(key, str) {
  let e; try { e = JSON.parse(str); } catch { return null; }
  if (!e || e.v !== 1 || typeof e.iv !== 'string' || typeof e.ct !== 'string') return null;
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, key, unb64(e.ct)))); } catch { return null; }
}
export const DIRECTORY_TOPIC = APP + '-app-directory-v1';
