// app.js - client-side logic

let socket = null;
let token = localStorage.getItem('chess_token') || null;
let me = null;              // { playerId, username, rating, isGuest, ... }
let board = null;
let localChess = null;      // chess.js instance used only for move legality on the client
let currentGame = null;     // last game state we received from server
let myColor = null;
let inQuickMatchQueue = false;
let selectedSquare = null;  // used for click-to-move

// ---------- Screen helpers ----------
function showTopLevel(id) {
  ['authScreen', 'appShell', 'gameScreen'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
}

function showSection(sectionId) {
  document.querySelectorAll('.content-section').forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(sectionId);
  if (el) el.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });
  if (sectionId === 'leaderboardSection') loadLeaderboard();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.onclick = () => showSection(btn.dataset.section);
});

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ---------- Sound effects ----------
// Generated tones via the Web Audio API - no external sound files, so
// there's nothing to license and nothing extra to download.
let soundOn = localStorage.getItem('chess_sound') !== 'off';
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}
function playTone(freq, duration = 0.09, type = 'sine', gain = 0.05) {
  if (!soundOn) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start();
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.stop(ctx.currentTime + duration + 0.02);
}
function soundMove() { playTone(440, 0.07, 'triangle', 0.05); }
function soundCapture() { playTone(220, 0.12, 'square', 0.045); }
function soundCheck() { playTone(700, 0.14, 'sawtooth', 0.06); setTimeout(() => playTone(900, 0.16, 'sawtooth', 0.05), 100); }
function soundCheckmate() {
  playTone(600, 0.14, 'sawtooth', 0.06);
  setTimeout(() => playTone(500, 0.14, 'sawtooth', 0.06), 120);
  setTimeout(() => playTone(400, 0.28, 'sawtooth', 0.06), 240);
}
function soundGameStart() { playTone(523, 0.1, 'sine', 0.05); setTimeout(() => playTone(659, 0.12, 'sine', 0.05), 110); }
function soundGameOver() { playTone(392, 0.15, 'sine', 0.05); setTimeout(() => playTone(294, 0.22, 'sine', 0.05), 140); }
function soundIllegal() { playTone(150, 0.1, 'square', 0.04); }

// A very soft, generated ambient drone that plays in the background during
// a live match to make it feel a bit more alive - it's just two detuned
// sine waves, so there's no music file involved (no licensing concerns).
let ambientNodes = null;
function startAmbient() {
  if (!soundOn) return;
  const ctx = ensureAudioCtx();
  if (!ctx || ambientNodes) return;
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  osc1.type = 'sine'; osc1.frequency.value = 110;
  osc2.type = 'sine'; osc2.frequency.value = 110.6;
  gain.gain.value = 0.0001;
  osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination);
  osc1.start(); osc2.start();
  gain.gain.exponentialRampToValueAtTime(0.018, ctx.currentTime + 1.2);
  ambientNodes = { osc1, osc2, gain };
}
function stopAmbient() {
  if (!ambientNodes) return;
  const { osc1, osc2, gain } = ambientNodes;
  const ctx = audioCtx;
  if (ctx) gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); } catch (e) { /* already stopped */ } }, 600);
  ambientNodes = null;
}

const soundToggleBtn = document.getElementById('soundToggleBtn');
function refreshSoundBtn() {
  soundToggleBtn.innerHTML = soundOn ? '&#128266; Sound On' : '&#128263; Sound Off';
}
refreshSoundBtn();
soundToggleBtn.onclick = () => {
  soundOn = !soundOn;
  localStorage.setItem('chess_sound', soundOn ? 'on' : 'off');
  refreshSoundBtn();
  if (soundOn) {
    playTone(440, 0.06, 'sine', 0.04);
    if (currentGame) startAmbient();
  } else {
    stopAmbient();
  }
};

// ---------- Google Sign-In ----------
fetch('/api/config').then(r => r.json()).then(cfg => {
  if (!cfg.googleClientId) {
    document.getElementById('googleUnavailableMsg').classList.remove('hidden');
    return;
  }
  const tryInit = () => {
    if (!window.google || !window.google.accounts) { setTimeout(tryInit, 200); return; }
    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: handleGoogleCredential
    });
    google.accounts.id.renderButton(document.getElementById('googleSignInBtn'), {
      theme: 'outline', size: 'large', width: 340
    });
  };
  tryInit();
}).catch(() => {
  document.getElementById('googleUnavailableMsg').classList.remove('hidden');
});

async function handleGoogleCredential(response) {
  try {
    const res = await fetch('/api/google-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: response.credential })
    });
    const data = await res.json();
    if (!data.ok) { toast(data.error || 'Google sign-in failed.'); return; }
    onLoggedIn(data.token, data.user);
  } catch (e) { toast('Network error during Google sign-in.'); }
}

// ---------- Guest login ----------
document.getElementById('guestBtn').onclick = async () => {
  try {
    const res = await fetch('/api/guest-login', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) { toast(data.error || 'Could not start a guest session.'); return; }
    onLoggedIn(data.token, data.user);
    toast('Playing as guest - your temporary ID is removed after your match.');
  } catch (e) { toast('Network error. Is the server running?'); }
};

// ---------- Auth tabs ----------
document.getElementById('tabLogin').onclick = () => {
  document.getElementById('tabLogin').classList.add('active');
  document.getElementById('tabRegister').classList.remove('active');
  document.getElementById('loginForm').classList.remove('hidden');
  document.getElementById('registerForm').classList.add('hidden');
};
document.getElementById('tabRegister').onclick = () => {
  document.getElementById('tabRegister').classList.add('active');
  document.getElementById('tabLogin').classList.remove('active');
  document.getElementById('registerForm').classList.remove('hidden');
  document.getElementById('loginForm').classList.add('hidden');
};

document.getElementById('registerForm').onsubmit = async (e) => {
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const errEl = document.getElementById('registerErr');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!data.ok) { errEl.textContent = data.error; return; }
    onLoggedIn(data.token, data.user);
  } catch (err) { errEl.textContent = 'Network error. Is the server running?'; }
};

document.getElementById('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  const usernameOrEmail = document.getElementById('loginUserOrEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginErr');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail, password })
    });
    const data = await res.json();
    if (!data.ok) { errEl.textContent = data.error; return; }
    onLoggedIn(data.token, data.user);
  } catch (err) { errEl.textContent = 'Network error. Is the server running?'; }
};

document.getElementById('logoutBtn').onclick = async () => {
  if (me && me.isGuest) {
    try {
      await fetch('/api/guest-cleanup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: me.playerId })
      });
    } catch (e) { /* best-effort - ignore network errors on logout */ }
  }
  localStorage.removeItem('chess_token');
  location.reload();
};

function onLoggedIn(tok, user) {
  token = tok;
  me = user;
  localStorage.setItem('chess_token', token);
  applyUserBadge(user);
  connectSocket();
  showTopLevel('appShell');
  showSection('playSection');
}

function applyUserBadge(user) {
  const guestTag = user.isGuest ? '<span class="guest-tag">GUEST</span>' : '';
  document.getElementById('userName').innerHTML = `${user.username} (${user.rating})${guestTag}`;
  document.getElementById('myPlayerIdBox').textContent = user.playerId;
}

// ---------- Socket ----------
function connectSocket() {
  socket = io();
  socket.on('connect', () => socket.emit('auth', token));
  socket.on('auth:error', (msg) => { toast(msg); localStorage.removeItem('chess_token'); location.reload(); });
  socket.on('auth:ok', (user) => { me = user; applyUserBadge(user); });

  socket.on('lobby:update', (list) => renderOnlineList(list));

  socket.on('challenge:receive', ({ fromPlayerId, fromUsername, fromRating, timeControl }) => {
    document.getElementById('challengeText').textContent =
      `${fromUsername} (${fromRating}) challenges you to ${timeControl}!`;
    document.getElementById('challengePopup').classList.remove('hidden');
    document.getElementById('acceptChallengeBtn').onclick = () => {
      socket.emit('challenge:respond', { toPlayerId: fromPlayerId, accepted: true, timeControl });
      document.getElementById('challengePopup').classList.add('hidden');
    };
    document.getElementById('declineChallengeBtn').onclick = () => {
      socket.emit('challenge:respond', { toPlayerId: fromPlayerId, accepted: false, timeControl });
      document.getElementById('challengePopup').classList.add('hidden');
    };
  });

  socket.on('challenge:declined', ({ byUsername }) => toast(`${byUsername} declined your challenge.`));
  socket.on('challenge:error', (msg) => toast(msg));

  socket.on('matchmaking:waiting', () => toast('Searching for an opponent...'));

  socket.on('game:start', (state) => startGameUI(state));
  socket.on('game:update', (state) => updateGameUI(state));
  socket.on('game:clock', ({ clocks }) => updateClocks(clocks));
  socket.on('game:illegal', () => {
    if (board && currentGame) board.position(currentGame.fen);
    soundIllegal();
    toast('Illegal move');
  });
  socket.on('game:over', (info) => showGameOver(info));
}

function renderOnlineList(list) {
  const ul = document.getElementById('onlineList');
  ul.innerHTML = '';
  const others = list.filter(u => !me || u.playerId !== me.playerId);
  document.getElementById('noOneOnline').classList.toggle('hidden', others.length > 0);

  others.forEach(u => {
    const li = document.createElement('li');

    const nameBlock = document.createElement('div');
    nameBlock.className = 'player-name';
    const nameLine = document.createElement('span');
    const guestTag = u.isGuest ? ' (guest)' : '';
    nameLine.textContent = u.inGame ? `${u.username}${guestTag} (in a game)` : `${u.username}${guestTag}`;
    const ratingLine = document.createElement('span');
    ratingLine.className = 'player-rating';
    ratingLine.textContent = `Rating: ${u.rating}`;
    nameBlock.appendChild(nameLine);
    nameBlock.appendChild(ratingLine);
    li.appendChild(nameBlock);

    if (!u.inGame) {
      const btn = document.createElement('button');
      btn.textContent = 'Challenge';
      btn.onclick = () => {
        const timeControl = document.getElementById('quickTimeControl').value;
        socket.emit('challenge:send', { toPlayerId: u.playerId, timeControl });
        toast(`Challenge sent to ${u.username}...`);
      };
      li.appendChild(btn);
    }
    ul.appendChild(li);
  });
}

async function loadLeaderboard() {
  const res = await fetch('/api/leaderboard');
  const data = await res.json();
  const ol = document.getElementById('leaderboardList');
  ol.innerHTML = '';
  (data.leaderboard || []).forEach(u => {
    const li = document.createElement('li');
    li.textContent = `${u.username} - ${u.rating} (W${u.wins}/L${u.losses}/D${u.draws})`;
    ol.appendChild(li);
  });
}

// ---------- Lobby actions ----------
document.getElementById('startBotGame').onclick = () => {
  const difficulty = document.getElementById('botDifficulty').value;
  const timeControl = document.getElementById('botTimeControl').value;
  socket.emit('bot:start', { timeControl, difficulty });
};

document.getElementById('quickMatchBtn').onclick = () => {
  const timeControl = document.getElementById('quickTimeControl').value;
  socket.emit('matchmaking:join', { timeControl });
  inQuickMatchQueue = true;
  document.getElementById('quickMatchBtn').classList.add('hidden');
  document.getElementById('cancelQuickMatchBtn').classList.remove('hidden');
};
document.getElementById('cancelQuickMatchBtn').onclick = () => {
  socket.emit('matchmaking:leave');
  inQuickMatchQueue = false;
  document.getElementById('quickMatchBtn').classList.remove('hidden');
  document.getElementById('cancelQuickMatchBtn').classList.add('hidden');
};

document.getElementById('sendChallengeBtn').onclick = () => {
  const toPlayerId = document.getElementById('challengePlayerId').value.trim();
  const timeControl = document.getElementById('challengeTimeControl').value;
  if (!toPlayerId) { toast('Enter a Player ID to challenge'); return; }
  socket.emit('challenge:send', { toPlayerId, timeControl });
  toast('Challenge sent! Waiting for response...');
};

// ---------- Legal-move highlighting ----------
const whiteSquareGrey = '#a9a9a9';
const blackSquareGrey = '#696969';

function removeGreySquares() {
  document.querySelectorAll('#board .square-55d63').forEach(sq => {
    sq.style.background = '';
    sq.classList.remove('selected-square');
  });
}

function greySquare(square) {
  const squareEl = document.querySelector('#board .square-' + square);
  if (!squareEl) return;
  const background = squareEl.classList.contains('black-3c85d') ? blackSquareGrey : whiteSquareGrey;
  squareEl.style.background = background;
}

function onMouseoverSquare(square) {
  if (!currentGame || currentGame.gameId === undefined) return;
  if (selectedSquare) return; // a click-selection is active - don't fight it with hover previews
  if (localChess.turn() !== myColor) return;
  const moves = localChess.moves({ square, verbose: true });
  if (moves.length === 0) return;
  greySquare(square);
  moves.forEach(m => greySquare(m.to));
}

function onMouseoutSquare() {
  if (selectedSquare) return; // keep the click-selected piece's highlights visible
  removeGreySquares();
}

// ---------- Click-to-move ----------
// Lets a player simply click a piece, then click the destination square,
// instead of having to drag-and-drop every move.
document.getElementById('board').addEventListener('click', (e) => {
  const squareEl = e.target.closest('[class*="square-"]');
  if (!squareEl) return;
  const match = Array.from(squareEl.classList).find(c => /^square-[a-h][1-8]$/.test(c));
  if (!match) return;
  handleSquareClick(match.replace('square-', ''));
});

function selectPiece(square) {
  selectedSquare = square;
  removeGreySquares();
  const selEl = document.querySelector('#board .square-' + square);
  if (selEl) selEl.classList.add('selected-square');
  localChess.moves({ square, verbose: true }).forEach(m => greySquare(m.to));
}

function clearSelection() {
  selectedSquare = null;
  removeGreySquares();
}

function handleSquareClick(square) {
  if (!currentGame || currentGame.gameId === undefined) return;
  if (!localChess || !board) return;
  if (localChess.turn() !== myColor) return;

  const pieceAtSquare = localChess.get ? localChess.get(square) : null;

  if (selectedSquare) {
    if (square === selectedSquare) { clearSelection(); return; }

    const legalMoves = localChess.moves({ square: selectedSquare, verbose: true });
    const target = legalMoves.find(m => m.to === square);
    if (target) {
      const from = selectedSquare;
      clearSelection();
      const move = localChess.move({ from, to: square, promotion: 'q' });
      if (move) {
        board.position(localChess.fen());
        highlightCheckIfAny();
        socket.emit('game:move', { gameId: currentGame.gameId, from, to: square, promotion: 'q' });
      }
      return;
    }

    // Not a legal destination - either switch selection to another of my
    // own pieces, or just deselect.
    clearSelection();
    if (pieceAtSquare && pieceAtSquare.color === myColor) selectPiece(square);
    return;
  }

  if (pieceAtSquare && pieceAtSquare.color === myColor) selectPiece(square);
}

// ---------- Check / checkmate highlighting ----------
function findKingSquare(chess, color) {
  const rows = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = rows[r][c];
      if (sq && sq.type === 'k' && sq.color === color) {
        return `${String.fromCharCode(97 + c)}${8 - r}`;
      }
    }
  }
  return null;
}

function clearCheckHighlight() {
  document.querySelectorAll('#board .square-55d63').forEach(sq => sq.classList.remove('in-check'));
}

let lastCheckAnnounced = false;
function highlightCheckIfAny() {
  clearCheckHighlight();
  if (!localChess) return;
  const inCheck = localChess.in_check ? localChess.in_check() : false;
  if (!inCheck) { lastCheckAnnounced = false; return; }

  const turnColor = localChess.turn();
  const kingSquare = findKingSquare(localChess, turnColor);
  if (kingSquare) {
    const el = document.querySelector('#board .square-' + kingSquare);
    if (el) el.classList.add('in-check');
  }

  const isMate = localChess.in_checkmate ? localChess.in_checkmate() : false;
  if (!lastCheckAnnounced) {
    lastCheckAnnounced = true;
    if (isMate) {
      soundCheckmate();
      toast('Checkmate!');
    } else {
      soundCheck();
      toast('Check!');
    }
  }
}

// ---------- Game UI ----------
function startGameUI(state) {
  inQuickMatchQueue = false;
  document.getElementById('quickMatchBtn').classList.remove('hidden');
  document.getElementById('cancelQuickMatchBtn').classList.add('hidden');

  currentGame = state;
  myColor = state.yourColor;
  localChess = new Chess(state.fen);
  selectedSquare = null;
  lastCheckAnnounced = false;
  soundGameStart();
  startAmbient();

  document.getElementById('youName').textContent = myColor === 'w'
    ? `${me.username} (White)` : `${me.username} (Black)`;
  const opponent = myColor === 'w' ? state.black : state.white;
  document.getElementById('opponentName').textContent =
    `${(opponent && opponent.username) || 'Opponent'} (${myColor === 'w' ? 'Black' : 'White'})`;

  document.getElementById('moveHistory').innerHTML = '';
  updateClocks(state.clocks);

  showTopLevel('gameScreen');

  try {
    const cfg = {
      draggable: false, // click-to-move only - dragging was swallowing clicks unreliably
      position: state.fen,
      orientation: myColor === 'w' ? 'white' : 'black',
      onMouseoverSquare: onMouseoverSquare,
      onMouseoutSquare: onMouseoutSquare,
      pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    };
    board = Chessboard('board', cfg);
    setTimeout(() => { if (board) board.resize(); highlightCheckIfAny(); }, 50);
  } catch (err) {
    console.error('Failed to create chess board:', err);
    toast('Could not load the chess board. Check your internet connection and reload.');
  }
}

function updateGameUI(state) {
  const priorMoveCount = currentGame && currentGame.history ? currentGame.history.length : 0;
  currentGame = state;
  localChess = new Chess(state.fen);
  selectedSquare = null;
  if (board) board.position(state.fen);
  updateClocks(state.clocks);

  if (state.history.length > priorMoveCount) {
    const lastMove = state.history[state.history.length - 1] || '';
    if (lastMove.includes('#')) { /* handled by highlightCheckIfAny below */ }
    else if (lastMove.includes('+')) { /* handled by highlightCheckIfAny below */ }
    else if (lastMove.includes('x')) soundCapture();
    else soundMove();
  }

  highlightCheckIfAny();

  const historyEl = document.getElementById('moveHistory');
  historyEl.innerHTML = '';
  state.history.forEach(move => {
    const li = document.createElement('li');
    li.textContent = move;
    historyEl.appendChild(li);
  });
  historyEl.scrollTop = historyEl.scrollHeight;
}

function updateClocks(clocks) {
  document.getElementById('clockWhite').textContent = formatMs(clocks.w);
  document.getElementById('clockBlack').textContent = formatMs(clocks.b);
}
function formatMs(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

document.getElementById('resignBtn').onclick = () => {
  if (currentGame) socket.emit('game:resign', { gameId: currentGame.gameId });
};

function showGameOver(info) {
  document.getElementById('gameOverText').textContent = info.resultText;
  document.getElementById('gameOverPopup').classList.remove('hidden');
  stopAmbient();
  if (info.reason !== 'checkmate') soundGameOver(); // checkmate already played soundCheckmate()
}
document.getElementById('backToLobbyBtn').onclick = () => {
  document.getElementById('gameOverPopup').classList.add('hidden');
  currentGame = null;
  clearCheckHighlight();
  showTopLevel('appShell');
  showSection('playSection');
};

// ---------- Auto-login on page load ----------
if (token) {
  connectSocket();
  showTopLevel('appShell');
  showSection('playSection');
} else {
  showTopLevel('authScreen');
}
