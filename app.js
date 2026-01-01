import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, updateDoc, serverTimestamp,
  collection, addDoc, onSnapshot, query, runTransaction, getDoc
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

const wordDisplay = document.getElementById("wordDisplay");
const wordMeta = document.getElementById("wordMeta");
const btnNewWord = document.getElementById("btnNewWord");
const btnReveal = document.getElementById("btnReveal");

const teamName = document.getElementById("teamName");
const btnAddTeam = document.getElementById("btnAddTeam");
const teamsList = document.getElementById("teamsList");
const btnResetScores = document.getElementById("btnResetScores");

// ---------- Local-only word list ----------
const BUILTIN_WORDS = [
  "apple","bridge","castle","doctor","river","planet","shadow","rocket","thunder","window",
  "camera","pencil","whisper","jungle","marble","pirate","ladder","ocean","pillow","dragon",
  "guitar","forest","diamond","painter","volcano","butter","wallet","cactus","tunnel","garden"
];

// ---------- Game state ----------
let gameId = getGameIdFromURL();
let unsubGame = null;
let unsubTeams = null;
let currentReveal = true;
let latestTeams = [];
let lastScoreChangeAt = 0;
let delayedReorderTimer = null;
const SCORE_REORDER_DELAY = 5000;

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

function pickWord() {
  if (BUILTIN_WORDS.length === 0) return "NO_WORDS";
  return BUILTIN_WORDS[Math.floor(Math.random() * BUILTIN_WORDS.length)];
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
function clearDelayedReorderTimer() {
  if (delayedReorderTimer) {
    clearTimeout(delayedReorderTimer);
    delayedReorderTimer = null;
  }
}

// ---------- Realtime subscriptions ----------
function unsubscribeAll() {
  if (unsubGame) unsubGame();
  if (unsubTeams) unsubTeams();
  unsubGame = null;
  unsubTeams = null;
  clearDelayedReorderTimer();
}

function subscribeToGame(code) {
  unsubscribeAll();
  resetTeamState();
  gameId = code;
  elGameCode.textContent = code || "—";

  if (!code) {
    wordDisplay.textContent = "—";
    teamsList.innerHTML = "";
    elShareHint.textContent = "";
    resetTeamState();
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
    currentReveal = data.reveal !== false;
    const w = data.currentWord || "—";
    wordDisplay.textContent = currentReveal ? w : "••••••";
    const t = data.wordUpdatedAt ? `Updated ${fmtTime(data.wordUpdatedAt)}` : "";
    wordMeta.textContent = t;
    btnReveal.textContent = currentReveal ? "Hide" : "Reveal";
  });

  // Teams listener
  const qTeams = query(teamsColRef(code));
  unsubTeams = onSnapshot(qTeams, (qs) => {
    const teams = [];
    qs.forEach(d => teams.push({ id: d.id, ...d.data() }));
    handleTeamsUpdate(teams);
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
    wrap.className = "team";

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

    const scoreButtons = [
      { label: "+10", delta: 10, className: "good" },
      { label: "+1", delta: 1, className: "good" },
      { label: "−1", delta: -1, className: "danger" },
    ];

    for (const { label, delta, className } of scoreButtons) {
      const btn = document.createElement("button");
      btn.className = className;
      btn.textContent = label;
      btn.onclick = () => adjustScore(t.id, delta);
      btns.appendChild(btn);
    }

    const del = document.createElement("button");
    del.className = "secondary";
    del.textContent = "Remove";
    del.onclick = () => removeTeam(t.id);

    btns.appendChild(del);

    wrap.appendChild(left);
    wrap.appendChild(btns);
    teamsList.appendChild(wrap);
  }
}

function handleTeamsUpdate(teams) {
  const scoresChanged = didScoresChange(teams);
  latestTeams = teams;

  if (scoresChanged) {
    lastScoreChangeAt = Date.now();
    scheduleDelayedScoreReorder();
  }

  renderTeams(getDisplayTeams());
}

function didScoresChange(nextTeams) {
  if (!latestTeams.length) return false;
  if (nextTeams.length !== latestTeams.length) return true;
  const prevScores = new Map(latestTeams.map((t) => [t.id, t.score ?? 0]));
  return nextTeams.some((t) => (t.score ?? 0) !== (prevScores.get(t.id) ?? 0));
}

function getDisplayTeams() {
  return shouldSortByScore()
    ? getTeamsOrderedByScore(latestTeams)
    : getTeamsByCreatedAt(latestTeams);
}

function shouldSortByScore() {
  if (!lastScoreChangeAt) return true;
  return (Date.now() - lastScoreChangeAt) >= SCORE_REORDER_DELAY;
}

function scheduleDelayedScoreReorder() {
  clearDelayedReorderTimer();
  delayedReorderTimer = setTimeout(() => {
    renderTeams(getTeamsOrderedByScore(latestTeams));
    delayedReorderTimer = null;
  }, SCORE_REORDER_DELAY);
}

function getTeamsOrderedByScore(list) {
  return [...list].sort((a, b) => {
    const diff = (b.score ?? 0) - (a.score ?? 0);
    if (diff !== 0) return diff;
    return getCreatedAtMs(a) - getCreatedAtMs(b);
  });
}

function getTeamsByCreatedAt(list) {
  return [...list].sort((a, b) => getCreatedAtMs(a) - getCreatedAtMs(b));
}

function getCreatedAtMs(team) {
  const ms = team.createdAt?.toMillis?.();
  return typeof ms === "number" ? ms : 0;
}

function resetTeamState() {
  latestTeams = [];
  lastScoreChangeAt = 0;
  clearDelayedReorderTimer();
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
  await updateDoc(gameDocRef(gameId), {
    currentWord: pickWord(),
    wordUpdatedAt: serverTimestamp(),
    reveal: true
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

// ---------- Wire up ----------
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

// ---------- Boot ----------
onAuthStateChanged(auth, async () => {
  // If user lands with ?game=CODE, auto-join (after sign-in)
  if (gameId) {
    await ensureSignedIn();
    subscribeToGame(gameId);
  } else {
    subscribeToGame("");
  }
});

// Notes:
// - Firestore realtime updates use onSnapshot() :contentReference[oaicite:3]{index=3}
// - Score updates use runTransaction() for atomicity :contentReference[oaicite:4]{index=4}
