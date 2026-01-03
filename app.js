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
const ERROR_HELP = "Check the console for the full Firebase error object, including request IDs.";

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
const themeSelect = document.getElementById("themeSelect");

const teamName = document.getElementById("teamName");
const btnAddTeam = document.getElementById("btnAddTeam");
const teamsList = document.getElementById("teamsList");
const btnResetScores = document.getElementById("btnResetScores");

// ---------- Local-only word lists by theme ----------
const BASE_THEMES = {
  classic: {
    label: "Classic",
    words: [
      "apple","bridge","castle","doctor","river","planet","shadow","rocket","thunder","window",
      "camera","pencil","whisper","jungle","marble","pirate","ladder","ocean","pillow","dragon",
      "guitar","forest","diamond","painter","volcano","butter","wallet","cactus","tunnel","garden"
    ]
  },
  holidays: {
    label: "Holidays",
    words: [
      "parade","fireworks","vacation","beach","family","feast","tradition","festival","lantern","bonfire",
      "costume","celebration","gathering","laughter","memories","postcard","souvenir","flight","roadtrip","picnic",
      "campfire","carnival","music","decorations","confetti","gifts","turkey","pumpkin","snowflake","carols"
    ]
  },
  birthday: {
    label: "Birthday",
    words: [
      "birthday","candles","cake","balloons","party","presents","streamers","cupcakes","surprise","wishes",
      "frosting","confetti","invitation","banner","milestone","playlist","guestlist","pinata","sparkler","bouquet",
      "centerpiece","ribbon","gratitude","laughter","keepsake","cheers","backdrop","goodiebag","sweets","celebrate"
    ]
  },
  halloween: {
    label: "Halloween",
    words: [
      "pumpkin","spooky","ghost","witch","candy","haunted","costume","cobweb","moonlight","broomstick",
      "cauldron","graveyard","zombie","vampire","skeleton","mask","lantern","midnight","foggy","howl",
      "cackle","bat","werewolf","monster","treats","trickster","shadow","casket","eerie","fright"
    ]
  },
  christmas: {
    label: "Christmas",
    words: [
      "tree","ornament","stocking","snowflake","gingerbread","sleigh","reindeer","elves","mistletoe","carols",
      "wrapping","presents","chimney","holly","wreath","tinsel","candles","bells","cookies","nutcracker",
      "northpole","wishlist","winter","cocoa","snowman","garland","sparkle","midnight","star","joy"
    ]
  },
  newyear: {
    label: "New Year",
    words: [
      "countdown","fireworks","resolutions","champagne","toast","midnight","confetti","balldrop","calendar","celebration",
      "cheers","streamers","resolution","sparkler","party","goals","freshstart","clocktower","balloon","fanfare",
      "parade","timesquare","hope","motivation","gratitude","tradition","newbeginnings","planner","horizon","wish"
    ]
  },
  valentines: {
    label: "Valentine's Day",
    words: [
      "hearts","roses","chocolate","romance","cupid","valentine","bouquet","candles","dinner","handwritten",
      "poem","embrace","kisses","sweetheart","lovenote","giftbox","balloons","tulips","promise","keepsake",
      "affection","admire","sparkle","gratitude","together","hug","compliment","cherish","devotion","spark"
    ]
  },
  sports: {
    label: "Sports",
    words: [
      "soccer","basketball","baseball","tennis","golf","hockey","football","swimming","cycling","running",
      "marathon","coach","whistle","stadium","athlete","scoreboard","referee","goal","tournament","fitness",
      "practice","medal","champion","teamwork","victory","training","playoffs","lineup","bleachers","uniform"
    ]
  },
  music: {
    label: "Music",
    words: [
      "melody","harmony","rhythm","chorus","verse","bridge","songwriter","guitar","piano","drums",
      "bassline","orchestra","conductor","microphone","amplifier","concert","backstage","playlist","headphones","singer",
      "choir","karaoke","lyric","tempo","keychange","metronome","symphony","soloist","ballad","festival"
    ]
  },
  movies: {
    label: "Movies",
    words: [
      "director","screenplay","cinema","popcorn","premiere","redcarpet","trailer","soundtrack","actor","actress",
      "camera","clapper","scene","script","storyboard","villain","hero","sequel","franchise","credits",
      "montage","blockbuster","indiefilm","costume","stunt","animation","dialogue","plottwist","cinematography","marquee"
    ]
  },
  pop: {
    label: "Pop Music",
    words: [
      "billboard","hitmaker","fanbase","superstar","boyband","diva","iconic","mainstream","earworm","catchy",
      "autotune","streaming","viral","mashup","collab","remix","acoustic","unplugged","sellout","arena",
      "groupie","encore","setlist","hype","dropbeat","trending","chartbuster","fanclub","superfan","lipsync"
    ]
  }
};

const COMMON_WORDS = [...new Set(Object.values(BASE_THEMES).flatMap((t) => t.words))];

const THEMES = {
  common: {
    label: "Common",
    words: COMMON_WORDS
  },
  ...BASE_THEMES
};
const DEFAULT_THEME = "common";

// ---------- Game state ----------
let gameId = getGameIdFromURL();
let unsubGame = null;
let unsubTeams = null;
let currentReveal = true;
let currentTheme = DEFAULT_THEME;
let latestTeams = [];
let lastScoreChangeAt = 0;
let delayedReorderTimer = null;
const SCORE_REORDER_DELAY = 5000;
let suppressThemeChange = false;

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

function getWordsForTheme(themeKey) {
  const list = THEMES[themeKey]?.words;
  const fallback = THEMES[DEFAULT_THEME].words;
  return Array.isArray(list) && list.length ? list : fallback;
}

function pickWord(themeKey = DEFAULT_THEME) {
  const list = getWordsForTheme(themeKey);
  if (!list.length) return "NO_WORDS";
  return list[Math.floor(Math.random() * list.length)];
}

function describeFirestoreError(err) {
  if (!err) return "Unknown error";
  const parts = [];
  if (err.code) parts.push(`code: ${err.code}`);
  if (err.status) parts.push(`status: ${err.status}`);
  if (err.message) parts.push(err.message);
  if (err.details) parts.push(err.details);
  return parts.join(" | ") || "Unknown Firestore error";
}

function handleActionError(actionLabel, err) {
  const message = describeFirestoreError(err);
  console.error(`Failed to ${actionLabel}`, err);
  alert(`Could not ${actionLabel}. ${message}. ${ERROR_HELP}`);
}

function getThemeLabel(themeKey) {
  return THEMES[themeKey]?.label || THEMES[DEFAULT_THEME].label;
}

function fmtTime(ts) {
  try {
    const d = ts.toDate();
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function populateThemeSelect() {
  themeSelect.innerHTML = "";
  Object.entries(THEMES).forEach(([key, info]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = info.label;
    themeSelect.appendChild(opt);
  });
  syncThemeSelect(DEFAULT_THEME);
}

function syncThemeSelect(themeKey) {
  suppressThemeChange = true;
  themeSelect.value = THEMES[themeKey] ? themeKey : DEFAULT_THEME;
  suppressThemeChange = false;
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
    const nextTheme = THEMES[data.theme] ? data.theme : DEFAULT_THEME;
    currentTheme = nextTheme;
    syncThemeSelect(nextTheme);
    const w = data.currentWord || "—";
    wordDisplay.textContent = currentReveal ? w : "••••••";
    const t = data.wordUpdatedAt ? `Updated ${fmtTime(data.wordUpdatedAt)}` : "";
    const metaParts = [`Theme: ${getThemeLabel(nextTheme)}`];
    if (t) metaParts.push(t);
    wordMeta.textContent = metaParts.join(" • ");
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

function currentUid() {
  return auth.currentUser?.uid || null;
}

async function handleThemeChange() {
  if (suppressThemeChange) return;
  const selected = themeSelect.value || DEFAULT_THEME;
  currentTheme = selected;

  if (!gameId) return;
  try {
    await ensureSignedIn();
    await ensureGameFields(gameId);
    await applyUpdatesFieldwise(gameDocRef(gameId), { theme: selected, updatedBy: currentUid() }, "update the theme");
  } catch (err) {
    handleActionError("update the theme", err);
  }
}

async function applyUpdatesFieldwise(ref, updates, actionLabel) {
  for (const [field, value] of Object.entries(updates)) {
    console.log("Firestore update request", { action: actionLabel, path: ref.path, field, value });
    try {
      await updateDoc(ref, { [field]: value });
    } catch (err) {
      const label = `${actionLabel} (field: ${field})`;
      handleActionError(label, err);
      return false;
    }
  }
  return true;
}

async function ensureGameFields(code) {
  const ref = gameDocRef(code);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;

  const data = snap.data() || {};
  const updates = {};

  if (!("theme" in data)) updates.theme = DEFAULT_THEME;
  if (!("reveal" in data)) updates.reveal = true;
  if (!("currentWord" in data)) updates.currentWord = "Press New Word";
  if (!("wordUpdatedAt" in data)) updates.wordUpdatedAt = serverTimestamp();

  if (!Object.keys(updates).length) return true;

  updates.updatedBy = currentUid();
  await setDoc(ref, updates, { merge: true });
  return true;
}

async function createGame() {
  if (btnCreate.disabled) return;
  btnCreate.disabled = true;
  btnCreate.textContent = "Creating…";

  try {
    await ensureSignedIn();
    const selectedTheme = themeSelect.value || DEFAULT_THEME;
    const code = randomGameCode();
    const payload = {
      createdAt: serverTimestamp(),
      hostUid: currentUid(),
      currentWord: "Press New Word",
      wordUpdatedAt: serverTimestamp(),
      reveal: true,
      theme: selectedTheme
    };
    console.log("Firestore create request", { action: "create game", code, payload });
    await setDoc(gameDocRef(code), {
      createdAt: serverTimestamp(),
      hostUid: currentUid(),
      currentWord: "Press New Word",
      wordUpdatedAt: serverTimestamp(),
      reveal: true,
      theme: selectedTheme
    });
    currentTheme = selectedTheme;
    setURLGame(code);
    subscribeToGame(code);
  } catch (err) {
    handleActionError("create a new game", err);
  } finally {
    btnCreate.disabled = false;
    btnCreate.textContent = "Create New Game";
  }
}

async function joinGame(code) {
  await ensureSignedIn();
  const ref = gameDocRef(code);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    alert("Game code not found. Ask the host to create it first.");
    return;
  }
  await ensureGameFields(code);
  setURLGame(code);
  subscribeToGame(code);
}

async function setNewWord() {
  if (!gameId) return alert("Create or join a game first.");
  try {
    await ensureSignedIn();
    await updateDoc(gameDocRef(gameId), {
      currentWord: pickWord(currentTheme),
      wordUpdatedAt: serverTimestamp(),
      reveal: true,
      updatedBy: currentUid()
    });
  } catch (err) {
    handleActionError("set a new word", err);
  }
}

async function toggleReveal() {
  if (!gameId) return;
  try {
    await ensureSignedIn();
    await updateDoc(gameDocRef(gameId), {
      reveal: !currentReveal,
      updatedBy: currentUid()
    });
  } catch (err) {
    handleActionError("toggle the word visibility", err);
  }
}

// Atomic score update: transaction
async function adjustScore(teamDocId, delta) {
  if (!gameId) return;
  try {
    await ensureSignedIn();
    const ref = doc(db, "games", gameId, "teams", teamDocId);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const cur = snap.data().score ?? 0;
      tx.update(ref, { score: cur + delta });
    });
  } catch (err) {
    handleActionError("update the score", err);
  }
}

async function addTeam() {
  if (!gameId) return alert("Create or join a game first.");
  try {
    await ensureSignedIn();
    const name = (teamName.value || "").trim();
    if (!name) return;
    const payload = {
      name,
      score: 0,
      createdAt: serverTimestamp(),
      createdByUid: currentUid()
    };
    console.log("addTeam: ensureSignedIn complete, currentUid =", currentUid());
    console.log("addTeam: gameId =", gameId);
    console.log("addTeam: payload =", payload);
    console.log("addTeam: teamsColRef path =", teamsColRef(gameId).path);
    await addDoc(teamsColRef(gameId), payload);
    console.log("addTeam: success");
  } catch (err) {
    console.error("addTeam: error details", { code: err.code, message: err.message, err });
    handleActionError("add the team", err);
  }
  teamName.value = "";
  teamName.focus();
}

async function removeTeam(teamDocId) {
  if (!gameId) return;
  try {
    await ensureSignedIn();
    const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js");
    await deleteDoc(doc(db, "games", gameId, "teams", teamDocId));
  } catch (err) {
    handleActionError("remove the team", err);
  }
}

async function resetScores() {
  if (!gameId) return;
  if (!confirm("Reset all scores to 0?")) return;
  try {
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
  } catch (err) {
    handleActionError("reset all scores", err);
  }
}

// ---------- Wire up ----------
populateThemeSelect();
currentTheme = themeSelect.value || DEFAULT_THEME;

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
themeSelect.onchange = handleThemeChange;

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
