// ---- Identity / profile ---------------------------------------------------
// Local profile only: { id, name, createdAt, premium: false }.
// Premium (later): reserve the username on a server and tie it to an account so it can't be taken,
// and sync it (and chat history) across devices.
import { kv } from './storage.js';

const ID_RE = /^[a-z0-9]{8,32}$/;
const randId = () => [...crypto.getRandomValues(new Uint8Array(12))].map(b => (b % 36).toString(36)).join('');
export const cleanName = s => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 24);

export function getProfile() {
  let p = kv.get('profile');
  if (!p || !ID_RE.test(p.id)) {
    // reuse the main site's per-browser id if there is one, so you're the same person on both
    let legacy = null; try { legacy = localStorage.getItem('chat-client-id'); } catch {}
    let legacyName = ''; try { legacyName = localStorage.getItem('chat-name') || ''; } catch {}
    p = { id: legacy && ID_RE.test(legacy) ? legacy : randId(), name: cleanName(legacyName), createdAt: Date.now(), premium: false };
    kv.set('profile', p);
  }
  return p;
}
export function updateProfile(patch) {
  const p = Object.assign(getProfile(), patch);
  if ('name' in patch) p.name = cleanName(patch.name);
  p.premium = false; // no premium tier yet
  kv.set('profile', p);
  return p;
}
