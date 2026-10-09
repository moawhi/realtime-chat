// ---- Transport / relay ----------------------------------------------------
// Interface (a backend can implement the same shape):
//   publish(topic, text) -> Promise<void>
//   poll(topic) -> Promise<Array<{ id, time, data }>>           (recent messages, oldest first)
//   subscribe(topic, { onMessage, onStatus }) -> close()        (live messages, incl. recent backlog)
// `time` is seconds since epoch (relay clock). Payloads are opaque strings (already encrypted).
//
// Implementation: ntfy.sh public pub/sub over HTTPS + SSE (free, no account). It keeps messages ~12h.
const RELAY = 'https://ntfy.sh';
const SINCE = '12h';

export const ntfyTransport = {
  async publish(topic, text) {
    const r = await fetch(RELAY + '/', { method: 'POST', body: JSON.stringify({ topic, message: text }) });
    if (!r.ok) throw new Error(r.status === 429 ? 'The free relay is rate-limiting. Wait a moment.' : 'Send failed (' + r.status + ')');
  },
  async poll(topic) {
    const r = await fetch(RELAY + '/' + topic + '/json?poll=1&since=' + SINCE, { cache: 'no-store' });
    if (!r.ok) throw new Error('Could not reach the relay (' + r.status + ')');
    const out = [];
    for (const line of (await r.text()).split('\n')) {
      let n; try { n = JSON.parse(line); } catch { continue; }
      if (n.event === 'message') out.push({ id: n.id, time: n.time, data: n.message });
    }
    return out;
  },
  subscribe(topic, { onMessage, onStatus = () => {} }) {
    let es, closed = false; const timers = [];
    const deliver = n => { if (!closed && n && n.event === 'message') onMessage({ id: n.id, time: n.time, data: n.message }); };
    // the relay can take a few seconds to show just-sent messages to new subscribers: catch up after connecting
    const catchUp = async () => { try { for (const m of await ntfyTransport.poll(topic)) if (!closed) onMessage(m); } catch {} };
    const open = () => {
      onStatus('connecting');
      es = new EventSource(RELAY + '/' + topic + '/sse?since=' + SINCE);
      es.onopen = () => { onStatus('live'); [2500, 7000].forEach(ms => timers.push(setTimeout(catchUp, ms))); };
      es.onerror = () => onStatus(es.readyState === 2 ? 'offline' : 'reconnecting');
      es.addEventListener('message', ev => { try { deliver(JSON.parse(ev.data)); } catch {} });
    };
    open();
    return () => { closed = true; timers.forEach(clearTimeout); if (es) es.close(); };
  },
};
export const transport = ntfyTransport;
