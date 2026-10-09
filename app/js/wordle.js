// ---- Games: daily Wordle --------------------------------------------------
// Same puzzle for everyone each Sydney day (same word list + day numbering as /wordle.html).
// Stats live on this device. A finished daily is counted the moment the last guess is saved,
// and a finished-but-uncounted day is repaired on load (the fix from the main site).
// Premium/backend later: a daily puzzle server and server-checked stats (anti-cheat).
import { ANSWERS, VALID } from './words.js';
import { kv } from './storage.js';

const ROWS = 6, COLS = 5;
const ans = []; for (let i = 0; i < ANSWERS.length; i += 5) ans.push(ANSWERS.slice(i, i + 5));
const valid = new Set(ans); for (let i = 0; i < VALID.length; i += 5) valid.add(VALID.slice(i, i + 5));

export const sydDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const dayNum = s => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5) - Math.round(Date.UTC(2026, 0, 1) / 864e5);
const prevDay = s => sydDate(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - 864e5 + 12 * 36e5));
export const puzzleNo = s => dayNum(s) + 1;
export const dailyWord = s => ans[((dayNum(s) % ans.length) + ans.length) % ans.length];
export function score(guess, target) {
  const res = Array(COLS).fill('absent'), left = {};
  for (let i = 0; i < COLS; i++) { if (guess[i] === target[i]) res[i] = 'correct'; else left[target[i]] = (left[target[i]] || 0) + 1; }
  for (let i = 0; i < COLS; i++) if (res[i] !== 'correct' && left[guess[i]]) { res[i] = 'present'; left[guess[i]]--; }
  return res;
}

const EMPTY = () => ({ played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0], last: null, lastWin: null });
export function loadStats() { const s = Object.assign(EMPTY(), kv.get('wordle-stats') || {}); if (!Array.isArray(s.dist) || s.dist.length !== 6) s.dist = EMPTY().dist; return s; }
function record(date, won, n) {
  const s = loadStats(); if (s.last === date) return s;
  s.played++; s.last = date;
  if (won) { s.streak = s.lastWin === prevDay(date) ? s.streak + 1 : 1; s.lastWin = date; s.wins++; s.dist[n - 1]++; s.maxStreak = Math.max(s.maxStreak, s.streak); }
  else s.streak = 0;
  kv.set('wordle-stats', s); return s;
}
/** stats as shown: the streak only counts if the last win was today or yesterday */
export function statsView() {
  const s = loadStats(), today = sydDate();
  const alive = s.lastWin === today || s.lastWin === prevDay(today);
  const dw = s.dist.reduce((a, b) => a + b, 0);
  return { played: s.played, wins: s.wins, winPct: s.played ? Math.round(s.wins / s.played * 100) : 0, streak: alive ? s.streak : 0, maxStreak: s.maxStreak, avg: dw ? Math.round(s.dist.reduce((a, v, i) => a + v * (i + 1), 0) / dw * 100) / 100 : null, dist: s.dist };
}

/** Today's game state, restored from this device (and counted if it was finished but never counted). */
export function todayGame() {
  const date = sydDate(), answer = dailyWord(date);
  const st = kv.get('wordle-daily');
  const guesses = st && st.date === date && Array.isArray(st.guesses) ? st.guesses.filter(g => typeof g === 'string' && g.length === 5).slice(0, ROWS) : [];
  const won = guesses.includes(answer), over = won || guesses.length >= ROWS;
  if (over) record(date, won, guesses.length); // repair (no-op if already counted)
  return { date, answer, guesses, won, over };
}
export function resultCard(g = todayGame()) {
  const s = statsView();
  return { game: 'wordle', v: 1, date: g.date, no: puzzleNo(g.date), n: g.guesses.length, won: g.won, over: g.over,
    rows: g.guesses.map(w => score(w, g.answer).map(x => x[0]).join('')),
    stats: { played: s.played, winPct: s.winPct, streak: s.streak, maxStreak: s.maxStreak, avg: s.avg } };
}

/** Mount the playable board into `el`. opts.onShare(card), opts.toast(msg) */
export function mountWordle(el, { onShare, toast }) {
  el.innerHTML = `
    <div class="wl-head"><div><b>Daily</b> <span class="muted" id="wlNo"></span></div><button class="chip" id="wlStatsBtn" type="button">Stats</button></div>
    <div class="wl-board"><div class="wl-grid" id="wlGrid"></div></div>
    <div class="wl-kb" id="wlKb"></div>
    <div class="sheet-bg" id="wlModal"><div class="sheet" role="dialog" aria-labelledby="wlTitle">
      <div class="sheet-h"><b id="wlTitle">Statistics</b><button class="chip" id="wlClose" type="button">Close</button></div>
      <div class="muted" id="wlAnswer"></div>
      <div class="wl-stats" id="wlStats"></div>
      <div class="wl-dist" id="wlDist"></div>
      <button class="btn" id="wlShare" type="button">💬 Share result to room</button>
      <p class="muted small">Same puzzle for everyone today (Sydney date). Your streak is kept on this device. New word at midnight Sydney time.</p>
    </div></div>`;
  const $ = id => el.querySelector('#' + id);
  let g = todayGame(), cur = '', busy = false;
  const rows = [];
  for (let r = 0; r < ROWS; r++) { const row = document.createElement('div'); row.className = 'wl-row'; for (let c = 0; c < COLS; c++) { const t = document.createElement('div'); t.className = 'wl-tile'; row.appendChild(t); } $('wlGrid').appendChild(row); rows.push(row); }
  const keyEls = {};
  ['qwertyuiop', 'asdfghjkl', '+zxcvbnm-'].forEach(r => {
    const kr = document.createElement('div'); kr.className = 'wl-kr';
    for (const ch of r) {
      const k = document.createElement('button'); k.type = 'button'; k.className = 'wl-key';
      if (ch === '+') { k.textContent = 'Enter'; k.classList.add('wide'); k.dataset.key = 'Enter'; }
      else if (ch === '-') { k.textContent = '⌫'; k.classList.add('wide'); k.dataset.key = 'Backspace'; k.setAttribute('aria-label', 'Backspace'); }
      else { k.textContent = ch; k.dataset.key = ch; keyEls[ch] = k; }
      kr.appendChild(k);
    }
    $('wlKb').appendChild(kr);
  });
  $('wlKb').addEventListener('click', e => { const k = e.target.closest('.wl-key'); if (k) { press(k.dataset.key); k.blur(); } });
  const onKey = e => {
    if (!el.isConnected || el.offsetParent === null || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input,textarea')) return;
    if ($('wlModal').classList.contains('on')) { if (e.key === 'Escape') closeModal(); return; }
    if (e.key === 'Enter' || e.key === 'Backspace' || /^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); press(e.key.length === 1 ? e.key.toLowerCase() : e.key); }
  };
  document.addEventListener('keydown', onKey);
  const RANK = { absent: 1, present: 2, correct: 3 };
  function paintKeys() {
    Object.values(keyEls).forEach(k => k.classList.remove('correct', 'present', 'absent'));
    const best = {};
    g.guesses.forEach(w => score(w, g.answer).forEach((s, i) => { if (!best[w[i]] || RANK[s] > RANK[best[w[i]]]) best[w[i]] = s; }));
    Object.entries(best).forEach(([ch, s]) => keyEls[ch] && keyEls[ch].classList.add(s));
  }
  function renderRow(r, word, states, animate) {
    [...rows[r].children].forEach((t, c) => {
      t.textContent = word[c] || ''; t.className = 'wl-tile' + (word[c] ? ' filled' : '');
      if (states) { t.style.animationDelay = animate ? (c * 0.22) + 's' : '0s'; t.classList.add(states[c]); t.dataset.state = states[c]; } else delete t.dataset.state;
    });
  }
  function renderAll() {
    for (let r = 0; r < ROWS; r++) r < g.guesses.length ? renderRow(r, g.guesses[r], score(g.guesses[r], g.answer), false) : renderRow(r, r === g.guesses.length ? cur : '', null);
    paintKeys(); $('wlNo').textContent = '#' + puzzleNo(g.date) + ' · ' + g.date;
  }
  function shake(msg) { const row = rows[g.guesses.length]; row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake'); toast(msg); }
  function press(k) {
    if (g.over || busy) return;
    if (k === 'Backspace') { cur = cur.slice(0, -1); return renderRow(g.guesses.length, cur, null); }
    if (k === 'Enter') return submit();
    if (/^[a-z]$/.test(k) && cur.length < COLS) { cur += k; renderRow(g.guesses.length, cur, null); }
  }
  function submit() {
    if (cur.length < COLS) return shake('Not enough letters');
    if (!valid.has(cur)) return shake('Not in word list');
    const w = cur; cur = ''; g.guesses.push(w);
    g.won = w === g.answer; g.over = g.won || g.guesses.length >= ROWS;
    kv.set('wordle-daily', { date: g.date, guesses: g.guesses });   // save the guess...
    if (g.over) record(g.date, g.won, g.guesses.length);            // ...and count a finished game at the same moment
    renderRow(g.guesses.length - 1, w, score(w, g.answer), true);
    busy = true;
    setTimeout(() => {
      busy = false; paintKeys();
      if (g.won) toast(['Genius', 'Magnificent', 'Impressive', 'Splendid', 'Great', 'Phew'][g.guesses.length - 1]);
      else if (g.over) toast(g.answer.toUpperCase(), 2500);
      if (g.over) setTimeout(openModal, 1200);
    }, COLS * 220 + 300);
  }
  function openModal() {
    const s = statsView();
    $('wlTitle').textContent = g.over ? (g.won ? 'You got it' : 'Next time') : 'Statistics';
    $('wlAnswer').innerHTML = g.over ? 'The word was <b class="acc">' + g.answer.toUpperCase() + '</b>' : '';
    $('wlStats').innerHTML = [[s.played, 'Played'], [s.winPct, 'Win %'], [s.streak, 'Streak'], [s.maxStreak, 'Max']].map(([v, l]) => '<div><b>' + v + '</b><span>' + l + '</span></div>').join('');
    const mx = Math.max(1, ...s.dist);
    $('wlDist').innerHTML = s.dist.map((v, i) => '<div class="bar">' + (i + 1) + '<i class="' + (g.won && g.guesses.length === i + 1 ? 'hl' : '') + '" style="width:' + Math.max(8, v / mx * 100) + '%">' + v + '</i></div>').join('');
    $('wlShare').style.display = g.over ? '' : 'none';
    $('wlModal').classList.add('on');
  }
  function closeModal() { $('wlModal').classList.remove('on'); }
  $('wlStatsBtn').addEventListener('click', openModal);
  $('wlClose').addEventListener('click', closeModal);
  $('wlModal').addEventListener('click', e => { if (e.target.id === 'wlModal') closeModal(); });
  $('wlShare').addEventListener('click', () => { closeModal(); onShare(resultCard(g)); });
  renderAll();
  return {
    refresh() { const d = sydDate(); if (d !== g.date) { g = todayGame(); cur = ''; renderAll(); } }, // new day
    state: () => ({ date: g.date, guesses: g.guesses.slice(), won: g.won, over: g.over, no: puzzleNo(g.date) }),
  };
}
