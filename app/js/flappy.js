// ---- Games: Flappy v2 (daily best) ----------------------------------------------
// Reuses the main site's /flappy.html (v2 rules, v2 best in 'flappy2-*', pauses when hidden) in a frame,
// loaded only when first selected. This module adds a per-device daily best that resets each Sydney day.
import { kv } from './storage.js';
import { sydDate } from './wordle.js';

const n = v => Math.max(0, Math.floor(Number(v) || 0));
const lvl = s => Math.floor(s / 10) + 1; // Flappy v2 levels go up every 10 points
function daily() { const d = kv.get('flappy-daily'), today = sydDate(); return d && d.date === today ? d : { date: today, best: 0, games: 0 }; }
function allTime() { return { best: n(localStorage.getItem('flappy2-best')), last: n(localStorage.getItem('flappy2-last')), games: n(localStorage.getItem('flappy2-games')) }; }

/** called after each finished run (the frame reports it) */
function recordRun() {
  const a = allTime(), d = daily();
  d.best = Math.max(d.best, a.last); d.games++; d.lastRunGames = a.games;
  kv.set('flappy-daily', d);
}
export function flappyCard() {
  const a = allTime(), d = daily();
  return { game: 'flappy', v: 2, date: d.date, today: d.best, todayGames: d.games, best: a.best, last: a.last, level: lvl(a.last), bestLevel: lvl(a.best) };
}
export const flappyStats = () => ({ ...allTime(), today: daily().best, todayGames: daily().games });

/** Mount into `el`. onShare(card). Returns { show(), hide() } */
export function mountFlappy(el, { onShare }) {
  let frame = null, lastGames = allTime().games;
  function ensure() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.src = '../flappy.html'; frame.title = 'Flappy'; frame.className = 'fl-frame';
    el.appendChild(frame);
    // flappy.html blocks touch "click"s page-wide (to stop scrolling), which also swallows taps on its
    // Share button on phones. Same origin, so route a tap on that button to a click from here.
    frame.addEventListener('load', () => {
      try {
        const btn = frame.contentDocument.getElementById('share');
        if (btn) btn.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); btn.click(); });
      } catch {}
    });
  }
  window.addEventListener('message', e => {
    if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'offsuit-stats' && e.data.game === 'flappy') { const g = allTime().games; if (g !== lastGames) { lastGames = g; recordRun(); } }
    if (e.data.type === 'offsuit-share' && e.data.game === 'flappy') onShare(flappyCard());
  });
  const pause = () => { if (frame) try { frame.contentWindow.postMessage({ type: 'pause' }, location.origin); } catch {} };
  return {
    show() { ensure(); el.hidden = false; setTimeout(() => { try { frame.focus(); frame.contentWindow.focus(); } catch {} }, 50); },
    hide() { pause(); el.hidden = true; },
    pause,
    loaded: () => !!frame,
    state: () => { try { return frame && frame.contentWindow.flappyState ? frame.contentWindow.flappyState() : null; } catch { return null; } },
  };
}
