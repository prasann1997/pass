import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, updateDoc, serverTimestamp,
  collection, addDoc, onSnapshot, query, orderBy, runTransaction, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

// 1) Paste your Firebase config here (Firebase Console → Project settings → Web app)
const firebaseConfig = {
  apiKey: "AIzaSyB5_W-Y7okIOThtvPkWoFWN1opcVrSPCxE",
  authDomain: "pass-35277.firebaseapp.com",
  projectId: "pass-35277",
  storageBucket: "pass-35277.firebasestorage.app",
  messagingSenderId: "186816451514",
  appId: "1:186816451514:web:58482d90739eb38b100383",
  measurementId: "G-9Q43VX9PTM"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ---------- UI ----------
const elGameCode = document.getElementById("gameCode");
const elShareHint = document.getElementById("shareHint");
const btnCreate = document.getElementById("btnCreate");
const btnCopyLink = document.getElementById("btnCopyLink");
const joinInput = document.getElementById("joinInput");
const btnJoin = document.getElementById("btnJoin");
const btnCorrect = document.getElementById("btnCorrect");
const btnSkip = document.getElementById("btnSkip");
const turnInfo = document.getElementById("turnInfo");

const wordDisplay = document.getElementById("wordDisplay");
const wordMeta = document.getElementById("wordMeta");
const btnNewWord = document.getElementById("btnNewWord");
const btnReveal = document.getElementById("btnReveal");

const teamName = document.getElementById("teamName");
const btnAddTeam = document.getElementById("btnAddTeam");
const teamsList = document.getElementById("teamsList");
const btnResetScores = document.getElementById("btnResetScores");

const customWordsEl = document.getElementById("customWords");
const btnSaveCustom = document.getElementById("btnSaveCustom");
const btnClearLocal = document.getElementById("btnClearLocal");

// ---------- Local-only word list ----------
const BUILTIN_WORDS = [
  "apple","bridge","castle","doctor","river","planet","shadow","rocket","thunder","window",
  "camera","pencil","whisper","jungle","marble","pirate","ladder","ocean","pillow","dragon",
  "guitar","forest","diamond","painter","volcano","butter","wallet","cactus","tunnel","garden"
];

const LOCAL_KEY_CUSTOM = "pw_custom_words_v1";

// ---------- Game state ----------
let gameId = getGameIdFromURL();
let unsubGame = null;
let unsubTeams = null;
let currentReveal = true;
let activeTeamId = null;
let offeredPoints = 0;
let roundActive = false;
let turnIndex = 0;
let turnOrder = [];
let attemptedTeamIds = [];
let solvedByTeamId = null;

// ---------- Helpers ----------
function randomGameCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function sanitizeCode(s) {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function setURLGame(code) {
  const url = new URL(window.location.href);
  url.searchParams.set("game", code);
  window.history.replaceState({}, "", url.toString());
}

function getGameIdFromURL() {
  const url = new URL(window.location.href);
  return sanitizeCode(url.searchParams.get("game") || "");
}

function normalizeWords(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const w = line.trim();
    if (!w) continue;
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

function getCustomWords() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY_CUSTOM);
    if (!raw) return [];
    return normalizeWords(JSON.parse(raw));
  } catch { return []; }
}

function setCustomWords(words) {
  localStorage.setItem(LOCAL_KEY_CUSTOM, JSON.stringify(words));
}

function wordPool() {
  const custom = getCustomWords();
  return normalizeWords([...BUILTIN_WORDS, ...custom]);
}

function pickWord() {
  const pool = wordPool();
  if (pool.length === 0) return "NO_WORDS";
  return pool[Math.floor(Math.random() * pool.length)];
}

function fmtTime(ts) {
  try {
    const d = ts.toDate();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// ---------- Firestore paths ----------
function gameDocRef(code) { return doc(db, "games", code); }
function teamsColRef(code) { return collection(db, "games", code, "teams"); }

// ---------- Realtime subscriptions ----------
function unsubscribeAll() {
  if (unsubGame) unsubGame();
  if (unsubTeams) unsubTeams();
  unsubGame = null;
  unsubTeams = null;
}

function subscribeToGame(code) {
  unsubscribeAll();
  gameId = code;
  elGameCode.textContent = code || "—";

  if (!code) {
    wordDisplay.textContent = "—";
    teamsList.innerHTML = "";
    elShareHint.textContent = "";
    return;
  }

  const joinLink = `${window.location.origin}${window.location.pathname}?game=${code}`;
  elShareHint.textContent = `Join link: ${joinLink}`;

  // Game doc listener
  unsubGame = onSnapshot(gameDocRef(code), (snap) => {
    if (!snap.exists()) {
      wordDisplay.textContent = "Game not found. Create it?";
      wordMeta.textContent = "";
      return;
    }
    const data = snap.data();

      roundActive = !!data.roundActive;
      activeTeamId = data.activeTeamId || null;
      offeredPoints = data.offeredPoints ?? 0;
      turnIndex = data.turnIndex ?? 0;
      turnOrder = Array.isArray(data.turnOrder) ? data.turnOrder : [];
      attemptedTeamIds = Array.isArray(data.attemptedTeamIds) ? data.attemptedTeamIds : [];
      solvedByTeamId = data.solvedByTeamId || null;

      if (!roundActive) {
	  turnInfo.textContent = "Round inactive. Hit “New Word” to start.";
      } else if (solvedByTeamId) {
	  turnInfo.textContent = `Solved! Points awarded. Hit “New Word” for the next round.`;
      } else if (activeTeamId) {
	  turnInfo.textContent = `Active team’s turn • Worth ${offeredPoints} points`;
      } else {
	  turnInfo.textContent = "Picking a team...";
      }
    currentReveal = data.reveal !== false;
    const w = data.currentWord || "—";
    wordDisplay.textContent = currentReveal ? w : "••••••";
    const t = data.wordUpdatedAt ? `Updated ${fmtTime(data.wordUpdatedAt)}` : "";
    wordMeta.textContent = t;
    btnReveal.textContent = currentReveal ? "Hide" : "Reveal";
  });

  // Teams listener
  const qTeams = query(teamsColRef(code), orderBy("score", "desc"));
  unsubTeams = onSnapshot(qTeams, (qs) => {
    const teams = [];
    qs.forEach(d => teams.push({ id: d.id, ...d.data() }));
    renderTeams(teams);
  });
}

function renderTeams(teams) {
  if (!teams.length) {
    teamsList.innerHTML = `<div class="muted small">No teams yet.</div>`;
    return;
  }
  teamsList.innerHTML = "";
  for (const t of teams) {
    const wrap = document.createElement("div");
    //wrap.className = "team";
    wrap.className = "team" + (t.id === activeTeamId ? " active" : "");

    if (t.id === activeTeamId && roundActive && !solvedByTeamId) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `TURN • ${offeredPoints} pts`;
      name.appendChild(badge);
    }

    const left = document.createElement("div");
    left.style.minWidth = "0";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = t.name || "(unnamed)";
    name.title = t.name || "";

    const score = document.createElement("div");
    score.className = "score";
    score.textContent = String(t.score ?? 0);

    left.appendChild(name);
    left.appendChild(score);

    const btns = document.createElement("div");
    btns.className = "btns";

    const plus = document.createElement("button");
    plus.className = "good";
    plus.textContent = "+1";
    plus.onclick = () => adjustScore(t.id, +1);

    const minus = document.createElement("button");
    minus.className = "danger";
    minus.textContent = "−1";
    minus.onclick = () => adjustScore(t.id, -1);

    const del = document.createElement("button");
    del.className = "secondary";
    del.textContent = "Remove";
    del.onclick = () => removeTeam(t.id);

    btns.appendChild(plus);
    btns.appendChild(minus);
    btns.appendChild(del);

    wrap.appendChild(left);
    wrap.appendChild(btns);
    teamsList.appendChild(wrap);
  }
}

// ---------- Actions ----------
async function ensureSignedIn() {
  if (auth.currentUser) return;
  await signInAnonymously(auth);
}

async function createGame() {
  await ensureSignedIn();
  const code = randomGameCode();
  await setDoc(gameDocRef(code), {
    createdAt: serverTimestamp(),
    currentWord: "Press New Word",
    wordUpdatedAt: serverTimestamp(),
    reveal: true
  });
  setURLGame(code);
  subscribeToGame(code);
}

async function joinGame(code) {
  await ensureSignedIn();
  const ref = gameDocRef(code);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    alert("Game code not found. Ask the host to create it first.");
    return;
  }
  setURLGame(code);
  subscribeToGame(code);
}

async function setNewWord() {
  if (!gameId) return alert("Create or join a game first.");
  await ensureSignedIn();

  // Load teams, sort by score asc; ties random
  const { getDocs } = await import("https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js");
  const qs = await getDocs(teamsColRef(gameId));
  const teams = [];
  qs.forEach(d => teams.push({ id: d.id, ...d.data() }));

  if (teams.length < 2) return alert("Add at least 2 teams.");

  // Group by score to randomize ties
  teams.sort((a,b) => (a.score ?? 0) - (b.score ?? 0) || a.id.localeCompare(b.id));
  // randomize within equal-score runs
  for (let i = 0; i < teams.length; ) {
    let j = i + 1;
    while (j < teams.length && (teams[j].score ?? 0) === (teams[i].score ?? 0)) j++;
    // shuffle slice [i, j)
    for (let k = j - 1; k > i; k--) {
      const r = i + Math.floor(Math.random() * (k - i + 1));
      [teams[k], teams[r]] = [teams[r], teams[k]];
    }
    i = j;
  }

  const order = teams.map(t => t.id);
  const firstTeamId = order[0];

  await updateDoc(gameDocRef(gameId), {
    currentWord: pickWord(),
    wordUpdatedAt: serverTimestamp(),
    reveal: true,

    // round fields
    roundActive: true,
    solvedByTeamId: null,
    turnOrder: order,
    turnIndex: 0,
    activeTeamId: firstTeamId,
    offeredPoints: 10,
    attemptedTeamIds: []
  });
}

async function skipOrIncorrect() {
  if (!gameId) return;
  await ensureSignedIn();

  await runTransaction(db, async (tx) => {
    const gref = gameDocRef(gameId);
    const gsnap = await tx.get(gref);
    if (!gsnap.exists()) return;

    const g = gsnap.data();
    if (!g.roundActive || g.solvedByTeamId) return;

    const order = Array.isArray(g.turnOrder) ? g.turnOrder : [];
    const idx = g.turnIndex ?? 0;
    const pts = g.offeredPoints ?? 10;
    const curTeam = g.activeTeamId;

    if (!order.length) return;

    const attempted = Array.isArray(g.attemptedTeamIds) ? g.attemptedTeamIds : [];
    const nextAttempted = curTeam ? [...new Set([...attempted, curTeam])] : attempted;

    const nextIdx = Math.min(idx + 1, order.length - 1);
    const nextTeamId = order[nextIdx];

    // points: 10 -> 9 -> 8 ... clamp to 1
    const nextPts = Math.max(1, pts - 1);

    // If we're already at the last team and they skip too, you can decide what happens.
    // Here: just stay on last team but keep pts at 1.
    const stuckAtEnd = idx >= order.length - 1;
    tx.update(gref, {
      attemptedTeamIds: nextAttempted,
      turnIndex: stuckAtEnd ? idx : nextIdx,
      activeTeamId: stuckAtEnd ? curTeam : nextTeamId,
      offeredPoints: stuckAtEnd ? Math.max(1, pts) : nextPts
    });
  });
}

async function markCorrect() {
  if (!gameId) return;
  await ensureSignedIn();

  await runTransaction(db, async (tx) => {
    const gref = gameDocRef(gameId);
    const gsnap = await tx.get(gref);
    if (!gsnap.exists()) return;

    const g = gsnap.data();
    if (!g.roundActive || g.solvedByTeamId) return;

    const teamId = g.activeTeamId;
    const pts = Math.max(1, g.offeredPoints ?? 10);
    if (!teamId) return;

    const tref = doc(db, "games", gameId, "teams", teamId);
    const tsnap = await tx.get(tref);
    if (!tsnap.exists()) return;

    const curScore = tsnap.data().score ?? 0;

    // award points
    tx.update(tref, { score: curScore + pts });

    // close round
    tx.update(gref, {
      solvedByTeamId: teamId,
      roundActive: false
    });
  });
}

async function toggleReveal() {
  if (!gameId) return;
  await ensureSignedIn();
  await updateDoc(gameDocRef(gameId), {
    reveal: !currentReveal
  });
}

// Atomic score update: transaction
async function adjustScore(teamDocId, delta) {
  if (!gameId) return;
  await ensureSignedIn();
  const ref = doc(db, "games", gameId, "teams", teamDocId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const cur = snap.data().score ?? 0;
    tx.update(ref, { score: cur + delta });
  });
}

async function addTeam() {
  if (!gameId) return alert("Create or join a game first.");
  await ensureSignedIn();
  const name = (teamName.value || "").trim();
  if (!name) return;
  await addDoc(teamsColRef(gameId), {
    name,
    score: 0,
    createdAt: serverTimestamp()
  });
  teamName.value = "";
  teamName.focus();
}

async function removeTeam(teamDocId) {
  if (!gameId) return;
  await ensureSignedIn();
  const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
  await deleteDoc(doc(db, "games", gameId, "teams", teamDocId));
}

async function resetScores() {
  if (!gameId) return;
  if (!confirm("Reset all scores to 0?")) return;
  await ensureSignedIn();

  // simple approach: read teams list from current DOM state is not reliable;
  // best: query snapshot once then transaction per doc (small n teams)
  const { getDocs } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
  const qs = await getDocs(teamsColRef(gameId));
  const promises = [];
  qs.forEach((d) => {
    promises.push(updateDoc(d.ref, { score: 0 }));
  });
  await Promise.all(promises);
}

// ---------- Local custom words ----------
function loadCustomIntoUI() {
  customWordsEl.value = getCustomWords().join("\n");
}

function saveCustomFromUI() {
  const words = normalizeWords(customWordsEl.value.split("\n"));
  setCustomWords(words);
  alert("Saved custom words locally on this device.");
}

function clearLocalCustom() {
  if (!confirm("Clear local custom words on this device?")) return;
  setCustomWords([]);
  loadCustomIntoUI();
}

// ---------- Wire up ----------
btnSkip.onclick = skipOrIncorrect;
btnCorrect.onclick = markCorrect;

btnCreate.onclick = createGame;
btnCopyLink.onclick = async () => {
  if (!gameId) return alert("Create or join a game first.");
  const link = `${window.location.origin}${window.location.pathname}?game=${gameId}`;
  await navigator.clipboard.writeText(link);
  alert("Join link copied.");
};
btnJoin.onclick = () => joinGame(sanitizeCode(joinInput.value));
btnNewWord.onclick = setNewWord;
btnReveal.onclick = toggleReveal;

btnAddTeam.onclick = addTeam;
teamName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addTeam(); }
});
btnResetScores.onclick = resetScores;

btnSaveCustom.onclick = saveCustomFromUI;
btnClearLocal.onclick = clearLocalCustom;

// ---------- Boot ----------
onAuthStateChanged(auth, async () => {
  // If user lands with ?game=CODE, auto-join (after sign-in)
  if (gameId) {
    await ensureSignedIn();
    subscribeToGame(gameId);
  } else {
    subscribeToGame("");
  }
  loadCustomIntoUI();
});

// Notes:
// - Firestore realtime updates use onSnapshot() :contentReference[oaicite:3]{index=3}
// - Score updates use runTransaction() for atomicity :contentReference[oaicite:4]{index=4}
