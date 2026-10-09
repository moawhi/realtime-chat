// ---- Storage module -------------------------------------------------------
// Two small interfaces. Today both are backed by this browser (localStorage);
// a backend (premium: synced profile + chat history) can implement the same shapes.
//
//   KV store       get(key) -> value | null,  set(key, value),  del(key)
//   History store  load(room) -> Promise<Message[]>   (oldest first)
//                  append(room, messages) -> Promise<void>   (dedupes by message id, keeps the newest `cap`)
//                  clear(room) -> Promise<void>
//
// Message = { id, t: 'msg'|'card'|'join'|'create', from: { id, name }, text?, card?, ts }

export function createLocalKV(prefix = 'oa-') {
  return {
    get(key) { try { const v = localStorage.getItem(prefix + key); return v == null ? null : JSON.parse(v); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(prefix + key, JSON.stringify(value)); } catch {} },
    del(key) { try { localStorage.removeItem(prefix + key); } catch {} },
  };
}

export function createLocalHistory({ prefix = 'oa-hist-', cap = 300 } = {}) {
  const read = room => { try { const a = JSON.parse(localStorage.getItem(prefix + room) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
  return {
    cap,
    async load(room) { return read(room); },
    async append(room, msgs) {
      if (!msgs.length) return;
      const all = read(room), ids = new Set(all.map(m => m.id));
      for (const m of msgs) if (m && m.id && !ids.has(m.id)) { all.push(m); ids.add(m.id); }
      all.sort((a, b) => a.ts - b.ts);
      const keep = all.slice(-cap);
      try { localStorage.setItem(prefix + room, JSON.stringify(keep)); }
      catch { try { localStorage.setItem(prefix + room, JSON.stringify(keep.slice(-Math.floor(cap / 3)))); } catch {} } // storage full: keep fewer
    },
    async clear(room) { try { localStorage.removeItem(prefix + room); } catch {} },
  };
}

// The app uses these instances; swap them for backend-backed ones later.
export const kv = createLocalKV('oa-');
export const history = createLocalHistory({ cap: 300 });
