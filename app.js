import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection,
  onSnapshot, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ---------- Game content ---------- */
const GRID = [
  { id: "elephant", label: "Elephant", pts: 5 },
  { id: "tracks", label: "Railway tracks", pts: 1 },
  { id: "music", label: "A spot blasting music", pts: 1 },
  { id: "cows", label: "Cows on the road", pts: 1 },
  { id: "atm", label: "SBS ATM", pts: 2, max: 3 },

  { id: "birds", label: "Two birds sitting together", pts: 1 },
  { id: "canetruck", label: "Sugar-cane truck", pts: 2 },
  { id: "giraffe", label: "Giraffe", pts: 5 },
  { id: "fruit", label: "Roadside fruit stall", pts: 1 },
  { id: "kombi", label: "Kombi with roof load or trailer", pts: 2 },

  { id: "emahiya", label: "Someone wearing emahiya", pts: 2 },
  { id: "monkey", label: "Monkey or baboon", pts: 2 },
  { id: "free", label: "Sugar-cane fields", free: true },
  { id: "braai", label: "Roadside braai stand", pts: 2 },
  { id: "hiker", label: "Hitchhiker", pts: 1 },

  { id: "usutu", label: "Crossing the Usutu River", pts: 1 },
  { id: "bakkie", label: "Bakkie with people in the back", pts: 1 },
  { id: "raptor", label: "Bird of prey on a pole", pts: 3 },
  { id: "zebra", label: "Zebra", pts: 3 },
  { id: "goats", label: "Goats on the road", pts: 1 },

  { id: "head", label: "Load carried on a head", pts: 1 },
  { id: "police", label: "Police roadblock", pts: 2 },
  { id: "flag", label: "Eswatini flag", pts: 1 },
  { id: "donkey", label: "Donkey", pts: 2 },
  { id: "impala", label: "Impala or antelope", pts: 2 }
];
const WILD = [
  { id: "w-train", label: "A train actually moving" },
  { id: "w-hornbill", label: "A hornbill" },
  { id: "w-horse", label: "Someone on horseback" },
  { id: "w-rainbow", label: "A rainbow" },
  { id: "w-church", label: "A church service outdoors" },
  { id: "w-yellowcar", label: "A yellow car" },
  { id: "w-tortoise", label: "A tortoise near the road" },
  { id: "w-banana", label: "Banana trees" }
];
const WILD_PTS = 4;
const LINE_BONUS = 5;
const LINES = [
  [0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],
  [0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],
  [0,6,12,18,24],[4,8,12,16,20]
];
const ATM_SLOTS = ["atm-1", "atm-2", "atm-3"];
// Duels: a second tap that lands within 2 s of the first claim (server clock) starts
// a best-of-3 rock-paper-scissors duel, 5 s per round.
const ROUND_MS = 5000;
const REVEAL_MS = 2200;
const READY_MS = 1500;
const GRACE_MS = 700;
const MAX_ROUNDS = 7; // after 7 rounds of draws, the first tap keeps it
const MOVES = { rock: "✊", paper: "✋", scissors: "✌️" };
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
const PLAYER_COLORS = ["#C2551B", "#58436C", "#8C3D35", "#B07A12", "#3F6B55", "#A63E6B", "#2F5F8A", "#6B6B1F"];
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function labelFor(key) {
  if (key.startsWith("atm-")) return "SBS ATM";
  const it = GRID.find(g => g.id === key) || WILD.find(w => w.id === key);
  return it ? it.label : key;
}

function pointsFor(key) {
  if (key.startsWith("w-")) return WILD_PTS;
  if (key.startsWith("atm-")) return 2;
  const it = GRID.find(g => g.id === key);
  return it ? it.pts : 0;
}

/* ---------- State ---------- */
const S = {
  uid: null,
  code: null,
  room: null,
  players: {},
  claims: {},
  duels: {},
  duelSeen: {},
  dl: null, // my active duel's local timing: {id, round, startAt, resolving}
  tab: "card",
  unsubs: [],
  busy: false,
  error: ""
};
const app = document.getElementById("app");
const sheetRoot = document.getElementById("sheet-root");
const toastEl = document.getElementById("toast");

const configured = firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE");
let auth, db;

/* ---------- Helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ptsText = n => n + (n === 1 ? " pt" : " pts");
const timeOf = c => (c && c.at && typeof c.at.toMillis === "function") ? c.at.toMillis() : Date.now();
function colorFor(uid) {
  const p = S.players[uid];
  if (p && p.color) return p.color;
  let h = 0;
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
}
function nameFor(c) {
  if (!c) return "";
  if (c.uid === S.uid) return "You";
  const p = S.players[c.uid];
  return (p && p.name) || c.name || "Someone";
}
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
}
function saveSession(code, name) {
  try { localStorage.setItem("rtb-session", JSON.stringify({ code, name })); } catch (e) {}
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem("rtb-session") || "null"); } catch (e) { return null; }
}
function clearSession() {
  try { localStorage.removeItem("rtb-session"); } catch (e) {}
}
function newCode() {
  let s = "";
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  for (const n of buf) s += CODE_CHARS[n % CODE_CHARS.length];
  return s;
}
function shareUrl() {
  return location.origin + location.pathname + "?trip=" + S.code;
}
const isHost = () => S.room && S.room.hostUid === S.uid;
const isLive = () => S.room && S.room.status === "live";

/* ---------- Scoring ---------- */
function tileState(i) {
  const it = GRID[i];
  if (it.free) return { claimed: true, at: -Infinity, uid: null };
  if (it.max) {
    const cs = ATM_SLOTS.map(k => S.claims[k]).filter(Boolean);
    if (!cs.length) return { claimed: false };
    const first = cs.reduce((a, b) => (timeOf(a) <= timeOf(b) ? a : b));
    return { claimed: true, at: timeOf(first), uid: first.uid };
  }
  const c = S.claims[it.id];
  return c ? { claimed: true, at: timeOf(c), uid: c.uid } : { claimed: false };
}
function computeScores() {
  const rows = {};
  const row = uid => (rows[uid] ||= { uid, spot: 0, wild: 0, lines: 0, count: 0 });
  Object.keys(S.players).forEach(row);
  for (const [key, c] of Object.entries(S.claims)) {
    const r = row(c.uid);
    r.count++;
    if (key.startsWith("w-")) r.wild += WILD_PTS; else r.spot += pointsFor(key);
  }
  // Whoever ticks the LAST square of a full row, column or diagonal earns the bonus.
  const states = GRID.map((_, i) => tileState(i));
  for (const line of LINES) {
    if (!line.every(i => states[i].claimed)) continue;
    let closer = null;
    for (const i of line) if (states[i].uid && (!closer || states[i].at > closer.at)) closer = states[i];
    if (closer) row(closer.uid).lines += LINE_BONUS;
  }
  return Object.values(rows)
    .map(r => ({ ...r, total: r.spot + r.wild + r.lines }))
    .sort((a, b) => b.total - a.total);
}

/* ---------- Firebase actions ---------- */
async function createTrip(tripName, playerName) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const ref = doc(db, "rooms", code);
    const existing = await getDoc(ref);
    if (existing.exists()) continue;
    await setDoc(ref, { name: tripName, hostUid: S.uid, status: "live", createdAt: serverTimestamp() });
    await joinTrip(code, playerName, true);
    return;
  }
  throw new Error("Couldn't make a trip code. Try again.");
}

async function joinTrip(code, playerName, skipCheck) {
  code = code.toUpperCase().trim();
  if (!skipCheck) {
    const snap = await getDoc(doc(db, "rooms", code));
    if (!snap.exists()) throw new Error("No trip with code " + code + ". Check the code with your driver.");
  }
  const used = new Set();
  // Pick a colour nobody else in the car has, where possible.
  try {
    const ps = await getDocs(collection(db, "rooms", code, "players"));
    ps.forEach(d => { if (d.id !== S.uid && d.data().color) used.add(d.data().color); });
  } catch (e) {}
  const color = PLAYER_COLORS.find(c => !used.has(c)) || PLAYER_COLORS[0];
  await setDoc(doc(db, "rooms", code, "players", S.uid), { name: playerName, color, joinedAt: serverTimestamp() });
  saveSession(code, playerName);
  enterTrip(code);
}

function enterTrip(code) {
  S.unsubs.forEach(u => u());
  S.unsubs = [];
  S.code = code;
  S.room = null; S.players = {}; S.claims = {};
  S.duels = {}; S.duelSeen = {}; S.dl = null; S.duelsLoaded = false;
  S.tab = "card";
  history.replaceState(null, "", location.pathname + "?trip=" + code);
  document.body.classList.add("in-game");
  render();
  const onErr = () => toast("Connection problem — retrying…");
  S.unsubs.push(onSnapshot(doc(db, "rooms", code), snap => {
    S.room = snap.exists() ? snap.data() : null;
    render();
  }, onErr));
  S.unsubs.push(onSnapshot(collection(db, "rooms", code, "players"), snap => {
    const p = {};
    snap.forEach(d => { p[d.id] = d.data(); });
    S.players = p;
    render();
  }, onErr));
  S.unsubs.push(onSnapshot(collection(db, "rooms", code, "claims"), snap => {
    const c = {};
    snap.forEach(d => { c[d.id] = d.data(); });
    S.claims = c;
    render();
  }, onErr));
  S.unsubs.push(onSnapshot(collection(db, "rooms", code, "duels"), snap => {
    const d = {};
    snap.forEach(x => { d[x.id] = x.data(); });
    handleDuels(d);
  }, onErr));
}

function leaveTrip() {
  S.unsubs.forEach(u => u());
  S.unsubs = [];
  S.code = null; S.room = null; S.players = {}; S.claims = {};
  S.duels = {}; S.dl = null; renderDuel();
  clearSession();
  history.replaceState(null, "", location.pathname);
  document.body.classList.remove("in-game");
  render();
}

async function claim(key) {
  if (!isLive()) { toast("This trip has ended."); return; }
  const me = S.players[S.uid];
  const ref = doc(db, "rooms", S.code, "claims", key);
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        const e = new Error("taken");
        e.taken = snap.data();
        throw e;
      }
      tx.set(ref, { uid: S.uid, name: (me && me.name) || "Player", at: serverTimestamp() });
    });
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) {} }
    return true;
  } catch (e) {
    if (e.taken && e.taken.uid !== S.uid && Date.now() - timeOf(e.taken) < 6000) {
      // Possibly a tie — the server's rules decide whether it was within 2 seconds.
      if (await startDuel(key, e.taken)) return false;
    }
    if (e.taken) toast(nameFor(e.taken) + " already claimed that one!");
    else toast("Someone beat you to it, or the connection dropped.");
    return false;
  }
}

async function unclaim(key) {
  try {
    await deleteDoc(doc(db, "rooms", S.code, "claims", key));
  } catch (e) {
    toast("Couldn't remove that claim.");
  }
}

async function claimAtm() {
  // Two people shouting about the same ATM at once? That's a duel, not two ATMs.
  const recent = ATM_SLOTS
    .map(k => ({ k, c: S.claims[k] }))
    .filter(x => x.c && x.c.uid !== S.uid && Date.now() - timeOf(x.c) < 6000)
    .sort((x, y) => timeOf(y.c) - timeOf(x.c))[0];
  if (recent && await startDuel(recent.k, recent.c)) return;
  const free = ATM_SLOTS.filter(k => !S.claims[k]);
  if (!free.length) { toast("All 3 ATMs have been claimed."); return; }
  for (const k of free) {
    const ref = doc(db, "rooms", S.code, "claims", k);
    const snap = await getDoc(ref);
    if (!snap.exists()) { await claim(k); return; }
  }
  toast("All 3 ATMs have been claimed.");
}

async function endTrip() {
  try { await updateDoc(doc(db, "rooms", S.code), { status: "ended" }); }
  catch (e) { toast("Only the host can end the trip."); }
}

/* ---------- Rock-paper-scissors duels ---------- */
const duelRoot = document.getElementById("duel-root");
const liveDuelFor = key => Object.entries(S.duels).find(([, d]) => d.key === key && d.status === "live");
const myLiveDuel = () => Object.entries(S.duels).find(([, d]) => d.status === "live" && (d.a === S.uid || d.b === S.uid));
const sideOf = d => (d.a === S.uid ? "a" : "b");
const playerName = uid => (uid === S.uid ? "You" : (S.players[uid] || {}).name || "Someone");

async function startDuel(key, taken) {
  if (liveDuelFor(key)) { toast("There's already a duel on that one!"); return true; }
  const me = S.players[S.uid] || {};
  const id = key + "-" + newCode().toLowerCase() + newCode().toLowerCase();
  try {
    await setDoc(doc(db, "rooms", S.code, "duels", id), {
      key, a: taken.uid, b: S.uid,
      aName: (S.players[taken.uid] || {}).name || taken.name || "Player",
      bName: me.name || "Player",
      status: "live", round: 1, wins: { a: 0, b: 0 }, moves: {}, lastRound: null,
      createdAt: serverTimestamp()
    });
    toast("Dead heat! Rock, paper, scissors…");
    return true;
  } catch (e) {
    return false; // Not within 2 s on the server's clock: a plain "already claimed".
  }
}

function handleDuels(d) {
  const prev = S.duels;
  S.duels = d;
  for (const [id, du] of Object.entries(d)) {
    if (du.status !== "done" || S.duelSeen[id]) continue;
    S.duelSeen[id] = true;
    const mine = du.a === S.uid || du.b === S.uid;
    if (S.duelsLoaded && prev[id] && prev[id].status === "live") {
      const winName = du.winner === S.uid ? "You" : (du.winner === du.a ? du.aName : du.bName);
      toast(`${winName} won the duel for ${labelFor(du.key)}!`);
      if (mine) S.dlResult = { id, until: Date.now() + 3500 };
    }
    if (mine) transferIfNeeded(id, du);
  }
  S.duelsLoaded = true;

  const live = myLiveDuel();
  if (live) {
    const [id, du] = live;
    if (!S.dl || S.dl.id !== id || S.dl.round !== du.round) {
      const pause = du.round === 1 ? READY_MS : REVEAL_MS;
      S.dl = { id, round: du.round, startAt: Date.now() + pause, resolving: false };
    }
    const m = du.moves || {};
    if (m[`r${du.round}_a`] && m[`r${du.round}_b`]) resolveRound(id, du.round, false);
  } else if (S.dl && !(S.dlResult && S.dlResult.id === S.dl.id)) {
    S.dl = null;
  }
  render();
  renderDuel(true);
}

async function pickMove(move) {
  const live = myLiveDuel();
  if (!live || !S.dl) return;
  const [id, du] = live;
  const now = Date.now();
  if (now < S.dl.startAt || now > S.dl.startAt + ROUND_MS + GRACE_MS) return;
  const field = `moves.r${du.round}_${sideOf(du)}`;
  if ((du.moves || {})[`r${du.round}_${sideOf(du)}`]) return;
  try { await updateDoc(doc(db, "rooms", S.code, "duels", id), { [field]: move }); }
  catch (e) { toast("Move didn't send — tap again!"); }
}

async function resolveRound(id, round, timedOut) {
  if (S.dl && S.dl.id === id && S.dl.round === round) {
    if (S.dl.resolving) return;
    S.dl.resolving = true;
  }
  const ref = doc(db, "rooms", S.code, "duels", id);
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.status !== "live" || d.round !== round) return;
      const m = d.moves || {};
      const ma = m[`r${round}_a`] || null, mb = m[`r${round}_b`] || null;
      if (!timedOut && !(ma && mb)) return;
      let res = "draw";
      if (ma && mb) res = BEATS[ma] === mb ? "a" : BEATS[mb] === ma ? "b" : "draw";
      else if (ma) res = "a";
      else if (mb) res = "b";
      const wins = { a: (d.wins && d.wins.a) || 0, b: (d.wins && d.wins.b) || 0 };
      if (res !== "draw") wins[res]++;
      const upd = { wins, lastRound: { r: round, a: ma, b: mb, res } };
      if (wins.a >= 2 || wins.b >= 2) {
        upd.status = "done";
        upd.winner = wins.a >= 2 ? d.a : d.b;
      } else if (round >= MAX_ROUNDS) {
        upd.status = "done";
        upd.winner = d.a; // endless draws: first tap keeps it
      } else {
        upd.round = round + 1;
      }
      tx.update(ref, upd);
    });
  } catch (e) {
    if (S.dl && S.dl.id === id && S.dl.round === round) S.dl.resolving = false;
  }
}

async function transferIfNeeded(id, du) {
  if (du.winner !== du.b) return; // first tap won: claim already theirs
  const ref = doc(db, "rooms", S.code, "claims", du.key);
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        const c = snap.data();
        if (c.uid === du.b) return;
        if (c.uid !== du.a) return;
        tx.update(ref, { uid: du.b, name: du.bName, at: c.at, duelId: id });
      } else if (du.b === S.uid) {
        tx.set(ref, { uid: S.uid, name: du.bName, at: serverTimestamp() });
      }
    });
  } catch (e) { /* the other duellist's phone will hand it over */ }
}

let lastDuelKey = "";
function renderDuel(force) {
  const now = Date.now();
  if (S.dlResult && now > S.dlResult.until) { S.dlResult = null; if (!myLiveDuel()) S.dl = null; force = true; }
  const entry = S.dl && S.duels[S.dl.id] ? [S.dl.id, S.duels[S.dl.id]] : null;
  if (!entry) {
    if (duelRoot.innerHTML) duelRoot.innerHTML = "";
    lastDuelKey = "";
    return;
  }
  const [id, du] = entry;
  const side = sideOf(du), opp = side === "a" ? "b" : "a";
  const oppName = side === "a" ? du.bName : du.aName;
  const myWins = (du.wins || {})[side] || 0, oppWins = (du.wins || {})[opp] || 0;
  const myMove = (du.moves || {})[`r${du.round}_${side}`];
  let phase;
  if (du.status === "done") phase = "done";
  else if (now < S.dl.startAt) phase = du.round === 1 ? "ready" : "reveal";
  else if (now <= S.dl.startAt + ROUND_MS) phase = myMove ? "locked" : "pick";
  else phase = "time";
  const left = Math.max(0, Math.ceil((S.dl.startAt + ROUND_MS - now) / 1000));
  const key = [id, du.round, du.status, phase, myMove || "", myWins, oppWins].join("|");

  // Timeout: either duellist can settle the round once the clock (plus grace) runs out.
  if (du.status === "live" && now > S.dl.startAt + ROUND_MS + GRACE_MS) resolveRound(id, du.round, true);

  if (!force && key === lastDuelKey) {
    const c = duelRoot.querySelector("[data-countdown]");
    if (c) c.textContent = left;
    return;
  }
  lastDuelKey = key;

  const lr = du.lastRound;
  const showMove = mv => (mv ? MOVES[mv] : "⏱️");
  let body = "";
  if (phase === "ready") {
    body = `<p class="duel-big">Get ready…</p>`;
  } else if (phase === "reveal" && lr) {
    const res = lr.res === "draw" ? "Draw — go again!" : (lr.res === side ? "You win the round!" : `${esc(oppName)} wins the round`);
    body = `<div class="duel-reveal"><span>${showMove(lr[side])}</span><small>vs</small><span>${showMove(lr[opp])}</span></div>
      <p class="duel-big">${res}</p>`;
  } else if (phase === "pick") {
    body = `<p class="duel-count" data-countdown>${left}</p>
      <div class="duel-moves">
        ${Object.entries(MOVES).map(([k, e]) => `<button type="button" class="duel-move" data-action="rps" data-move="${k}" aria-label="${k}"><span aria-hidden="true">${e}</span><small>${k}</small></button>`).join("")}
      </div>`;
  } else if (phase === "locked") {
    body = `<p class="duel-count" data-countdown>${left}</p>
      <p class="duel-big">${MOVES[myMove]} locked in</p><p class="muted center">Waiting for ${esc(oppName)}…</p>`;
  } else if (phase === "time") {
    body = `<p class="duel-big">Time!</p><p class="muted center">Settling the round…</p>`;
  } else {
    const won = du.winner === S.uid;
    body = `<p class="duel-big">${won ? "You win the claim! 🎉" : `${esc(oppName)} takes it`}</p>
      <p class="muted center">${esc(labelFor(du.key))} goes to ${won ? "you" : esc(oppName)}.</p>
      <button type="button" class="btn btn-primary" data-action="duel-close" style="margin-top:12px">Back to the card</button>`;
  }
  duelRoot.innerHTML = `<div class="duel-backdrop"><div class="duel" role="dialog" aria-modal="true" aria-label="Rock paper scissors duel">
    <div class="kicker" style="color:var(--amber)">Dead heat · best of 3</div>
    <h3 class="display duel-title">${esc(labelFor(du.key))}</h3>
    <div class="duel-score">
      <div><span>You</span><b>${myWins}</b></div>
      <em>vs</em>
      <div><span>${esc(oppName)}</span><b>${oppWins}</b></div>
    </div>
    <p class="duel-round">${du.status === "done" ? "Final" : "Round " + du.round}</p>
    ${body}
  </div></div>`;
}
setInterval(() => renderDuel(false), 200);

/* ---------- Views ---------- */
function viewSetup() {
  return `
    <h1 class="display title">Road Trip Bingo</h1>
    <div class="card setup">
      <h2>One more step</h2>
      <p class="muted">The game needs a Firebase project to keep everyone's claims in sync. Paste your config into <code>firebase-config.js</code> — the README has the steps.</p>
    </div>`;
}

function viewHome() {
  const params = new URLSearchParams(location.search);
  const invite = (params.get("trip") || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  const saved = loadSession();
  const savedName = saved && saved.name ? saved.name : "";
  return `
    <div class="kicker" style="margin-top:18px">Spot it · shout it · claim it</div>
    <h1 class="display title" style="margin-top:4px">Road Trip Bingo</h1>
    <p class="lede">A shared card for the whole car. The first person to claim a sighting gets it — nobody else can.</p>
    <p class="error" id="home-error" role="alert">${esc(S.error)}</p>

    <form class="card" data-form="join">
      <h2>${invite ? "You're invited" : "Join a trip"}</h2>
      <div class="field">
        <label for="join-code">Trip code</label>
        <input id="join-code" class="code" name="code" maxlength="4" autocomplete="off" autocapitalize="characters" required value="${esc(invite)}" placeholder="ABCD">
      </div>
      <div class="field">
        <label for="join-name">Your name</label>
        <input id="join-name" name="name" maxlength="20" required value="${esc(savedName)}" placeholder="e.g. Lindiwe">
      </div>
      <button class="btn btn-plum" type="submit">Join the trip</button>
    </form>

    <form class="card" data-form="create">
      <h2>Start a trip</h2>
      <p class="muted" style="margin:0 0 12px">You'll be the host and referee. Share the code with everyone in your car — or other cars in the convoy.</p>
      <div class="field">
        <label for="trip-name">Trip name</label>
        <input id="trip-name" name="trip" maxlength="40" value="Mbabane to Jozini" required>
      </div>
      <div class="field">
        <label for="host-name">Your name</label>
        <input id="host-name" name="name" maxlength="20" required value="${esc(savedName)}" placeholder="e.g. Kwan">
      </div>
      <button class="btn btn-primary" type="submit">Start a new trip</button>
    </form>`;
}

function whoHtml(c) {
  return `<span class="who"><span class="dot" style="background:${colorFor(c.uid)}"></span><span>${esc(nameFor(c))}</span></span>`;
}

function viewCard() {
  const tiles = GRID.map((it, i) => {
    if (it.free) {
      return `<div class="tile free" role="img" aria-label="Free square: ${esc(it.label)}"><span class="pts">FREE</span><span>${esc(it.label)}</span></div>`;
    }
    if (it.max) {
      const cs = ATM_SLOTS.map(k => S.claims[k]).filter(Boolean);
      const mine = cs.some(c => c.uid === S.uid);
      const first = cs[0];
      const style = first ? `border-color:${colorFor(first.uid)};background:${colorFor(first.uid)}1A` : "";
      return `<button type="button" class="tile ${cs.length ? "claimed" : ""} ${mine ? "mine" : ""}" style="${style}" data-action="atm" aria-label="${esc(it.label)}, ${cs.length} of 3 claimed">
        <span>${esc(it.label)}</span>
        <span class="pts">${cs.length}/3 · 2 each</span>
      </button>`;
    }
    const c = S.claims[it.id];
    if (c) {
      const col = colorFor(c.uid);
      const duel = liveDuelFor(it.id);
      return `<button type="button" class="tile claimed ${c.uid === S.uid ? "mine" : ""} ${duel ? "duelling" : ""}" style="border-color:${col};background:${col}1A" data-action="claimed" data-key="${it.id}" aria-label="${esc(it.label)}, ${duel ? "duel in progress" : "claimed by " + esc(nameFor(c))}">
        <span>${esc(it.label)}</span>${duel ? `<span class="who">⚔️ Duel!</span>` : whoHtml(c)}
      </button>`;
    }
    return `<button type="button" class="tile" data-action="claim" data-key="${it.id}" ${isLive() ? "" : "disabled"} aria-label="Claim ${esc(it.label)}, ${ptsText(it.pts)}">
      <span>${esc(it.label)}</span><span class="pts">${ptsText(it.pts)}</span>
    </button>`;
  }).join("");
  return `<div class="grid">${tiles}</div>
    <p class="legend">Tap a square the moment you spot it. Close a full row, column or diagonal (last square ticked) for +${LINE_BONUS}.</p>`;
}

function viewWild() {
  const rows = WILD.map(w => {
    const c = S.claims[w.id];
    if (c) {
      const col = colorFor(c.uid);
      return `<div class="wild claimed" style="border-color:${col};background:${col}1A">
        <div><div class="label">${esc(w.label)}</div><div class="sub"><span class="dot" style="background:${col}"></span>${esc(nameFor(c))} · ${WILD_PTS} pts</div></div>
        ${(c.uid === S.uid || isHost()) && isLive() ? `<button type="button" class="btn btn-ghost btn-small" data-action="claimed" data-key="${w.id}">Undo</button>` : ""}
      </div>`;
    }
    return `<div class="wild">
      <div><div class="label">${esc(w.label)}</div><div class="sub">${WILD_PTS} pts · rare</div></div>
      <button type="button" class="btn btn-primary btn-small" style="width:auto" data-action="claim" data-key="${w.id}" ${isLive() ? "" : "disabled"}>Claim</button>
    </div>`;
  }).join("");
  return `<p class="muted" style="margin:0 0 10px">Bonus sightings off the card. Worth ${WILD_PTS} points each.</p><div class="wild-list">${rows}</div>`;
}

function viewScores() {
  const scores = computeScores();
  const top = scores[0] ? scores[0].total : 0;
  const rows = scores.map((r, i) => {
    const p = S.players[r.uid] || {};
    const name = r.uid === S.uid ? (p.name || "You") + " (you)" : (p.name || "Someone");
    return `<div class="score-row ${r.total === top && top > 0 ? "lead" : ""}">
      <div class="rank">${i + 1}</div>
      <div>
        <div class="score-name"><span class="dot" style="background:${colorFor(r.uid)}"></span>${esc(name)}${S.room && S.room.hostUid === r.uid ? ` <span class="muted">· referee</span>` : ""}</div>
        <div class="score-detail">${r.spot} card · ${r.wild} wild · ${r.lines} lines</div>
      </div>
      <div class="score-total">${r.total}</div>
    </div>`;
  }).join("") || `<p class="muted">No players yet.</p>`;
  return `${rows}
    <div class="card" style="margin-top:14px">
      <h2>House rules</h2>
      <ol class="rules">
        <li>First to claim a sighting gets it. The app won't let anyone else claim it after.</li>
        <li>SBS ATM can be claimed 3 times — one per different ATM.</li>
        <li>Whoever ticks the last square of a full line gets +${LINE_BONUS}.</li>
        <li>The host is the referee and can remove a cheeky claim.</li>
        <li>Game ends when the host taps End trip at the reserve.</li>
      </ol>
      ${isHost() && isLive() ? `<button type="button" class="btn btn-primary" data-action="end-ask" style="margin-top:8px">End trip</button>` : ""}
    </div>`;
}

function viewGame() {
  if (!S.room) {
    return `<p class="muted center" style="margin-top:30px">Loading trip ${esc(S.code)}…</p>
      <div class="center"><button type="button" class="btn btn-ghost btn-small" data-action="leave">Back</button></div>`;
  }
  const scores = computeScores();
  const mine = scores.find(r => r.uid === S.uid);
  let banner = "";
  if (!isLive()) {
    const w = scores[0];
    const wn = w ? (w.uid === S.uid ? "You" : (S.players[w.uid] || {}).name || "Someone") : "Nobody";
    banner = `<div class="banner">Trip over! Winner: <strong>${esc(wn)}</strong> with ${w ? w.total : 0} points.</div>`;
  }
  const watching = Object.values(S.duels).filter(d => d.status === "live" && d.a !== S.uid && d.b !== S.uid);
  banner += watching.map(d => `<div class="banner">⚔️ ${esc(d.aName)} vs ${esc(d.bName)} — rock-paper-scissors for <strong>${esc(labelFor(d.key))}</strong> (${(d.wins || {}).a || 0}–${(d.wins || {}).b || 0})</div>`).join("");
  const tabs = [["card", "Card"], ["wild", "Wild cards"], ["scores", `Scores${mine ? " · " + mine.total : ""}`]];
  return `
    <div class="game-head">
      <div>
        <h1 class="display trip-name">${esc(S.room.name)}</h1>
        <span class="code-pill" aria-label="Trip code ${esc(S.code)}">${esc(S.code)}</span>
      </div>
      <div class="head-actions">
        <button type="button" class="btn btn-plum btn-small" style="width:auto" data-action="share">Invite</button>
        <button type="button" class="btn btn-ghost btn-small" data-action="leave">Leave</button>
      </div>
    </div>
    ${banner}
    <div class="tabs" role="tablist">
      ${tabs.map(([k, l]) => `<button type="button" role="tab" class="tab" aria-selected="${S.tab === k}" data-action="tab" data-tab="${k}">${esc(l)}</button>`).join("")}
    </div>
    <section role="tabpanel">
      ${S.tab === "card" ? viewCard() : S.tab === "wild" ? viewWild() : viewScores()}
    </section>`;
}

function render() {
  const focusedId = document.activeElement && document.activeElement.id;
  if (!configured) app.innerHTML = viewSetup();
  else if (!S.uid) app.innerHTML = `<p class="muted center" style="margin-top:30px">Getting ready…</p>`;
  else if (S.code) app.innerHTML = viewGame();
  else {
    // Don't wipe what someone is typing on the home screen.
    if (app.dataset.view === "home" && !S.forceHome) return;
    app.innerHTML = viewHome();
    S.forceHome = false;
  }
  app.dataset.view = S.code ? "game" : "home";
  if (focusedId) { const el = document.getElementById(focusedId); if (el) el.focus(); }
}

/* ---------- Sheets ---------- */
function openSheet(html) {
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-action="close-sheet"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  const first = sheetRoot.querySelector("button");
  if (first) first.focus();
}
function closeSheet() { sheetRoot.innerHTML = ""; }

function sheetForClaimed(key) {
  const c = S.claims[key];
  if (!c) return;
  const label = (GRID.find(g => g.id === key) || WILD.find(w => w.id === key) || {}).label || key;
  const canRemove = isLive() && (c.uid === S.uid || isHost());
  openSheet(`
    <h3>${esc(label)}</h3>
    <p>Claimed by <strong>${esc(nameFor(c))}</strong> for ${ptsText(pointsFor(key))}.</p>
    <div class="sheet-actions">
      ${canRemove ? `<button type="button" class="btn btn-primary" data-action="unclaim" data-key="${key}">${c.uid === S.uid ? "Undo my claim" : "Remove claim (referee)"}</button>` : ""}
      <button type="button" class="btn btn-ghost" data-action="close-sheet">Close</button>
    </div>`);
}

function sheetForAtm() {
  const slots = ATM_SLOTS.map((k, i) => {
    const c = S.claims[k];
    if (!c) return `<div class="slot"><span>ATM ${i + 1}</span><span class="muted">Not spotted yet</span></div>`;
    const canRemove = isLive() && (c.uid === S.uid || isHost());
    return `<div class="slot"><span>ATM ${i + 1} · ${whoHtml(c)}</span>
      ${canRemove ? `<button type="button" class="btn btn-ghost btn-small" data-action="unclaim" data-key="${k}">Remove</button>` : ""}</div>`;
  }).join("");
  const left = ATM_SLOTS.filter(k => !S.claims[k]).length;
  openSheet(`
    <h3>SBS ATM</h3>
    <p>Up to 3 different ATMs, 2 points each.</p>
    ${slots}
    <div class="sheet-actions" style="margin-top:14px">
      ${left && isLive() ? `<button type="button" class="btn btn-primary" data-action="claim-atm">I spotted an ATM!</button>` : ""}
      <button type="button" class="btn btn-ghost" data-action="close-sheet">Close</button>
    </div>`);
}

/* ---------- Events ---------- */
document.addEventListener("click", async e => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "close-sheet") {
    if (el.classList.contains("sheet-backdrop") && e.target !== el) return;
    closeSheet(); return;
  }
  if (el.disabled) return;
  if (a === "tab") { S.tab = el.dataset.tab; render(); return; }
  if (a === "rps") { duelRoot.querySelectorAll(".duel-move").forEach(b => { b.disabled = true; }); await pickMove(el.dataset.move); return; }
  if (a === "duel-close") { S.dlResult = null; if (!myLiveDuel()) S.dl = null; renderDuel(true); return; }
  if (a === "claim") {
    el.disabled = true;
    const ok = await claim(el.dataset.key);
    if (!ok && el.isConnected) el.disabled = false;
    return;
  }
  if (a === "claimed") { sheetForClaimed(el.dataset.key); return; }
  if (a === "unclaim") { closeSheet(); await unclaim(el.dataset.key); return; }
  if (a === "atm") { sheetForAtm(); return; }
  if (a === "claim-atm") { closeSheet(); await claimAtm(); return; }
  if (a === "leave") { leaveTrip(); return; }
  if (a === "end-ask") {
    openSheet(`<h3>End the trip?</h3><p>Nobody can claim anything after this, and the winner is announced.</p>
      <div class="sheet-actions"><button type="button" class="btn btn-primary" data-action="end">Yes, end it</button>
      <button type="button" class="btn btn-ghost" data-action="close-sheet">Keep playing</button></div>`);
    return;
  }
  if (a === "end") { closeSheet(); await endTrip(); return; }
  if (a === "share") {
    const url = shareUrl();
    const text = `Join our Road Trip Bingo! Code ${S.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Road Trip Bingo", text, url }); return; } catch (err) { if (err && err.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(text + " — " + url); toast("Invite link copied"); }
    catch (err) { toast("Share this code: " + S.code); }
  }
});

document.addEventListener("submit", async e => {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim().slice(0, 20);
  if (!name) return;
  const btn = form.querySelector("button[type=submit]");
  const errEl = document.getElementById("home-error");
  if (S.busy) return;
  S.busy = true;
  if (btn) btn.disabled = true;
  if (errEl) errEl.textContent = "";
  try {
    if (form.dataset.form === "create") {
      const trip = String(data.get("trip") || "").trim().slice(0, 40) || "Road trip";
      await createTrip(trip, name);
    } else {
      const code = String(data.get("code") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (code.length !== 4) throw new Error("Trip codes are 4 characters.");
      await joinTrip(code, name);
    }
  } catch (err) {
    const msg = err && err.message && !/permission|insufficient/i.test(err.message)
      ? err.message : "Something went wrong. Check your signal and try again.";
    const live = document.getElementById("home-error");
    if (live) live.textContent = msg;
  } finally {
    S.busy = false;
    if (btn) btn.disabled = false;
  }
});

/* ---------- Start ---------- */
if (configured) {
  const fb = initializeApp(firebaseConfig);
  auth = getAuth(fb);
  db = getFirestore(fb);
  onAuthStateChanged(auth, async user => {
    if (!user) {
      try { await signInAnonymously(auth); }
      catch (e) { S.error = "Couldn't connect. Check your signal and refresh."; S.uid = "offline"; S.forceHome = true; render(); }
      return;
    }
    S.uid = user.uid;
    const saved = loadSession();
    const params = new URLSearchParams(location.search);
    const urlCode = (params.get("trip") || "").toUpperCase();
    // Rejoin automatically if this phone already joined this trip.
    if (saved && saved.code && (!urlCode || urlCode === saved.code)) {
      const p = await getDoc(doc(db, "rooms", saved.code, "players", user.uid)).catch(() => null);
      if (p && p.exists()) { enterTrip(saved.code); return; }
    }
    S.forceHome = true;
    render();
  });
}
render();
