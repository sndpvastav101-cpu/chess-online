// server.js - main entry point
require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const auth = require('./auth');
const bot = require('./bot');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------- REST: auth ----------------
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const result = await auth.register({ username, email, password });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;
    const result = await auth.login({ usernameOrEmail, password });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Play as Guest - creates a temporary account, no email/password needed.
// The account is deleted automatically once the guest's match ends
// (see endGame below), or immediately if they log out first.
app.post('/api/guest-login', async (req, res) => {
  try {
    const result = await auth.guestLogin();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Called by the frontend when a guest clicks "Logout" - cleans up their
// temporary record right away instead of waiting for a match to finish.
app.post('/api/guest-cleanup', (req, res) => {
  try {
    const { playerId } = req.body;
    if (playerId && playerId.startsWith('GUEST-')) {
      db.deleteUserByPlayerId(playerId);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/api/leaderboard', (req, res) => {
  res.json({ ok: true, leaderboard: db.getLeaderboard(20) });
});

// Frontend fetches this to know which Google Client ID to use (kept out of
// the HTML source so it's easy to change via .env without editing code).
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

app.post('/api/google-login', async (req, res) => {
  try {
    const { idToken } = req.body;
    const result = await auth.googleLogin(idToken);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---------------- Time controls ----------------
// minutes of base time + seconds increment per move
const TIME_CONTROLS = {
  bullet: { minutes: 1, increment: 0, label: 'Bullet 1+0' },
  blitz: { minutes: 5, increment: 3, label: 'Blitz 5+3' },
  rapid: { minutes: 10, increment: 5, label: 'Rapid 10+5' },
  classical: { minutes: 30, increment: 15, label: 'Classical 30+15' }
};

// ---------------- In-memory live state ----------------
const online = new Map();     // socket.id -> { playerId, username, rating }
const playerSockets = new Map(); // playerId -> socket.id (for direct challenge delivery)
const games = new Map();      // gameId -> game state object
const matchmakingQueue = [];  // [{ playerId, socketId, timeControl, username, rating }]

function broadcastLobby() {
  const list = Array.from(online.values()).map(u => ({
    playerId: u.playerId, username: u.username, rating: u.rating, inGame: !!u.inGame, isGuest: !!u.isGuest
  }));
  io.emit('lobby:update', list);
}

function publicPlayer(p) {
  if (!p) return null;
  return { username: p.username, rating: p.rating };
}

function publicGameState(game) {
  return {
    gameId: game.id,
    fen: game.chess.fen(),
    turn: game.chess.turn(),
    history: game.chess.history(),
    clocks: game.clocks,
    timeControl: game.timeControlKey,
    white: publicPlayer(game.players.w),
    black: publicPlayer(game.players.b),
    isBotGame: !!game.isBotGame,
    status: 'active'
  };
}

function startClockTicker(game) {
  game.lastTick = Date.now();
  game.interval = setInterval(() => {
    const now = Date.now();
    const elapsed = now - game.lastTick;
    game.lastTick = now;
    const turnColor = game.chess.turn(); // 'w' or 'b'
    game.clocks[turnColor] -= elapsed;

    if (game.clocks[turnColor] <= 0) {
      game.clocks[turnColor] = 0;
      const winner = turnColor === 'w' ? 'b' : 'w';
      endGame(game, winner, 'timeout');
      return;
    }
    // broadcast a lightweight clock tick
    emitToGame(game, 'game:clock', { clocks: game.clocks });
  }, 1000);
}

function emitToGame(game, event, payload) {
  if (game.players.w.socketId) io.to(game.players.w.socketId).emit(event, payload);
  if (!game.isBotGame && game.players.b.socketId) io.to(game.players.b.socketId).emit(event, payload);
}

function ratingDelta(winnerRating, loserRating) {
  // simplified ELO, K=20
  const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const delta = Math.round(20 * (1 - expected));
  return Math.max(4, delta);
}

// Removes a guest's temporary account from the database and from the live
// online/matchmaking maps. Safe to call more than once.
function cleanupGuest(playerInfo) {
  if (!playerInfo || !playerInfo.isGuest) return;
  db.deleteUserByPlayerId(playerInfo.playerId);
  playerSockets.delete(playerInfo.playerId);
}

function endGame(game, winnerColor, reason) {
  if (game.ended) return;
  game.ended = true;
  clearInterval(game.interval);

  const whiteP = game.players.w;
  const blackP = game.players.b;
  const hasGuest = !!whiteP.isGuest || !!blackP.isGuest;
  let resultText;

  // Guests are temporary, so we never save their stats or a permanent game
  // record for a match they were part of - same treatment as bot games.
  if (winnerColor === 'draw') {
    resultText = 'Draw';
    if (!game.isBotGame && !hasGuest) {
      db.updateUserStats(whiteP.playerId, 'draws', 0);
      db.updateUserStats(blackP.playerId, 'draws', 0);
    }
  } else {
    const winner = winnerColor === 'w' ? whiteP : blackP;
    const loser = winnerColor === 'w' ? blackP : whiteP;
    resultText = `${winner.username} wins (${reason})`;
    if (!game.isBotGame && !hasGuest) {
      const wUser = db.findUserByPlayerId(winner.playerId);
      const lUser = db.findUserByPlayerId(loser.playerId);
      const delta = ratingDelta(wUser ? wUser.rating : 1200, lUser ? lUser.rating : 1200);
      db.updateUserStats(winner.playerId, 'wins', delta);
      db.updateUserStats(loser.playerId, 'losses', -delta);
    }
  }

  if (!game.isBotGame && !hasGuest) {
    db.insertGame({
      white: whiteP.playerId, black: blackP.playerId,
      result: resultText, reason, timeControl: game.timeControlKey,
      pgn: game.chess.pgn()
    });
  }

  emitToGame(game, 'game:over', {
    gameId: game.id, winnerColor, reason, resultText, fen: game.chess.fen()
  });
  games.delete(game.id);

  const w = online.get(whiteP.socketId); if (w) w.inGame = false;
  const b = online.get(blackP.socketId); if (b) b.inGame = false;

  // Match is fully over - now delete any guest accounts that took part.
  cleanupGuest(whiteP);
  cleanupGuest(blackP);

  broadcastLobby();
}

function checkGameEndConditions(game) {
  const c = game.chess;
  if (c.isCheckmate()) {
    const winner = c.turn() === 'w' ? 'b' : 'w'; // side NOT to move just delivered mate
    endGame(game, winner, 'checkmate');
    return true;
  }
  if (c.isStalemate() || c.isDraw() || c.isThreefoldRepetition() || c.isInsufficientMaterial()) {
    endGame(game, 'draw', 'draw');
    return true;
  }
  return false;
}

function createGame({ whiteInfo, blackInfo, timeControlKey, isBotGame, botDifficulty }) {
  const tc = TIME_CONTROLS[timeControlKey] || TIME_CONTROLS.blitz;
  const baseMs = tc.minutes * 60 * 1000;
  const gameId = uuidv4();
  const game = {
    id: gameId,
    chess: new Chess(),
    players: { w: whiteInfo, b: blackInfo },
    clocks: { w: baseMs, b: baseMs },
    increment: tc.increment * 1000,
    timeControlKey,
    isBotGame: !!isBotGame,
    botDifficulty,
    ended: false
  };
  games.set(gameId, game);
  startClockTicker(game);

  if (whiteInfo.playerId && whiteInfo.playerId !== 'BOT') {
    const w = online.get(whiteInfo.socketId); if (w) w.inGame = true;
  }
  if (blackInfo.playerId && blackInfo.playerId !== 'BOT') {
    const b = online.get(blackInfo.socketId); if (b) b.inGame = true;
  }
  broadcastLobby();
  return game;
}

function maybeBotMove(game) {
  if (!game.isBotGame) return;
  if (game.chess.turn() !== 'b') return; // bot always plays black here
  setTimeout(() => {
    if (game.ended) return;
    const move = bot.getBotMove(game.chess, game.botDifficulty || 'medium');
    if (!move) return;
    game.chess.move(move);
    game.clocks.b += game.increment;
    emitToGame(game, 'game:update', publicGameState(game));
    checkGameEndConditions(game);
  }, 500 + Math.random() * 700);
}

// ---------------- Socket.io ----------------
io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('auth', (token) => {
    const decoded = auth.verifyToken(token);
    if (!decoded) {
      socket.emit('auth:error', 'Invalid or expired session. Please log in again.');
      return;
    }
    const dbUser = db.findUserByPlayerId(decoded.playerId);
    if (!dbUser) {
      socket.emit('auth:error', 'Account not found.');
      return;
    }
    currentUser = {
      playerId: dbUser.player_id,
      username: dbUser.username,
      rating: dbUser.rating,
      isGuest: !!dbUser.is_guest,
      socketId: socket.id
    };
    online.set(socket.id, currentUser);
    playerSockets.set(dbUser.player_id, socket.id);
    socket.emit('auth:ok', auth.publicUser(dbUser));
    broadcastLobby();
  });

  // -------- Challenges --------
  socket.on('challenge:send', ({ toPlayerId, timeControl }) => {
    if (!currentUser) return;
    const targetSocketId = playerSockets.get(toPlayerId);
    if (!targetSocketId) {
      socket.emit('challenge:error', 'That player is not online right now.');
      return;
    }
    io.to(targetSocketId).emit('challenge:receive', {
      fromPlayerId: currentUser.playerId,
      fromUsername: currentUser.username,
      fromRating: currentUser.rating,
      timeControl
    });
  });

  socket.on('challenge:respond', ({ toPlayerId, accepted, timeControl }) => {
    if (!currentUser) return;
    const challengerSocketId = playerSockets.get(toPlayerId);
    if (!accepted) {
      if (challengerSocketId) io.to(challengerSocketId).emit('challenge:declined', { byUsername: currentUser.username });
      return;
    }
    if (!challengerSocketId) {
      socket.emit('challenge:error', 'The challenger is no longer online.');
      return;
    }
    // randomly assign colors
    const challengerInfo = online.get(challengerSocketId);
    const responderInfo = currentUser;
    const challengerIsWhite = Math.random() < 0.5;
    const whiteInfo = challengerIsWhite ? challengerInfo : responderInfo;
    const blackInfo = challengerIsWhite ? responderInfo : challengerInfo;

    const game = createGame({ whiteInfo, blackInfo, timeControlKey: timeControl });
    const state = publicGameState(game);
    io.to(whiteInfo.socketId).emit('game:start', { ...state, yourColor: 'w' });
    io.to(blackInfo.socketId).emit('game:start', { ...state, yourColor: 'b' });
  });

  // -------- Quick match (auto-pair with any online player) --------
  socket.on('matchmaking:join', ({ timeControl }) => {
    if (!currentUser) return;
    // don't queue twice
    const already = matchmakingQueue.find(q => q.playerId === currentUser.playerId);
    if (already) return;

    // try to find someone waiting - prefer same time control, else anyone
    let idx = matchmakingQueue.findIndex(q => q.timeControl === timeControl);
    if (idx === -1 && matchmakingQueue.length > 0) idx = 0;

    if (idx !== -1) {
      const opponent = matchmakingQueue.splice(idx, 1)[0];
      const opponentInfo = online.get(opponent.socketId);
      if (!opponentInfo) {
        // opponent vanished, just queue this player instead
        matchmakingQueue.push({ ...currentUser, timeControl });
        return;
      }
      const meIsWhite = Math.random() < 0.5;
      const whiteInfo = meIsWhite ? currentUser : opponentInfo;
      const blackInfo = meIsWhite ? opponentInfo : currentUser;
      const game = createGame({ whiteInfo, blackInfo, timeControlKey: opponent.timeControl || timeControl });
      const state = publicGameState(game);
      io.to(whiteInfo.socketId).emit('game:start', { ...state, yourColor: 'w' });
      io.to(blackInfo.socketId).emit('game:start', { ...state, yourColor: 'b' });
    } else {
      matchmakingQueue.push({ ...currentUser, timeControl });
      socket.emit('matchmaking:waiting');
    }
  });

  socket.on('matchmaking:leave', () => {
    const idx = matchmakingQueue.findIndex(q => q.playerId === currentUser?.playerId);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
  });

  // -------- Bot games --------
  socket.on('bot:start', ({ timeControl, difficulty }) => {
    if (!currentUser) return;
    const whiteInfo = currentUser;
    const blackInfo = { playerId: 'BOT', username: `Bot (${difficulty || 'medium'})`, socketId: null };
    const game = createGame({ whiteInfo, blackInfo, timeControlKey: timeControl, isBotGame: true, botDifficulty: difficulty });
    const state = publicGameState(game);
    socket.emit('game:start', { ...state, yourColor: 'w' });
  });

  // -------- Moves --------
  socket.on('game:move', ({ gameId, from, to, promotion }) => {
    const game = games.get(gameId);
    if (!game || game.ended || !currentUser) return;

    const myColor = game.players.w.playerId === currentUser.playerId ? 'w' : 'b';
    if (game.chess.turn() !== myColor) return; // not your turn
    if (game.isBotGame && myColor !== 'w') return;

    let move;
    try {
      move = game.chess.move({ from, to, promotion: promotion || 'q' });
    } catch (e) {
      move = null;
    }
    if (!move) {
      socket.emit('game:illegal', { from, to });
      return;
    }

    game.clocks[myColor] += game.increment;
    emitToGame(game, 'game:update', publicGameState(game));

    if (checkGameEndConditions(game)) return;
    maybeBotMove(game);
  });

  socket.on('game:resign', ({ gameId }) => {
    const game = games.get(gameId);
    if (!game || game.ended || !currentUser) return;
    const myColor = game.players.w.playerId === currentUser.playerId ? 'w' : 'b';
    const winner = myColor === 'w' ? 'b' : 'w';
    endGame(game, winner, 'resignation');
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      online.delete(socket.id);
      playerSockets.delete(currentUser.playerId);
      const qIdx = matchmakingQueue.findIndex(q => q.playerId === currentUser.playerId);
      if (qIdx !== -1) matchmakingQueue.splice(qIdx, 1);

      // If a guest disconnects mid-game (never finishing a match), still
      // clean up their temporary account so it doesn't linger forever.
      if (currentUser.isGuest) {
        const stillInLiveGame = Array.from(games.values()).some(g =>
          !g.ended && (g.players.w.playerId === currentUser.playerId || g.players.b.playerId === currentUser.playerId)
        );
        if (!stillInLiveGame) cleanupGuest(currentUser);
      }
      broadcastLobby();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess app running on http://localhost:${PORT}`);
});
