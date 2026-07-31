// db.js
// A simple, dependency-free database using a JSON file on disk.
// No installation, no compiling, no Python needed - just plain Node.js.
// (Good for getting started / testing. Before real launch with many users,
// migrate this to a hosted database like MongoDB Atlas or Supabase - see README.)

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'chess-data.json');

function loadData() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: [], games: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    return { users: [], games: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ---------- USERS ----------
function findUserByUsernameOrEmail(value) {
  const data = loadData();
  return data.users.find(u => u.username === value || u.email === value) || null;
}

function usernameOrEmailTaken(username, email) {
  const data = loadData();
  return data.users.some(u => u.username === username || u.email === email);
}

function findUserByPlayerId(playerId) {
  const data = loadData();
  return data.users.find(u => u.player_id === playerId) || null;
}

function playerIdExists(playerId) {
  return !!findUserByPlayerId(playerId);
}

function createUser({ playerId, username, email, passwordHash }) {
  const data = loadData();
  const newUser = {
    id: data.users.length + 1,
    player_id: playerId,
    username,
    email,
    password_hash: passwordHash,
    rating: 1200,
    wins: 0,
    losses: 0,
    draws: 0,
    created_at: new Date().toISOString()
  };
  data.users.push(newUser);
  saveData(data);
  return newUser;
}

// Creates a temporary, no-password guest account. Marked with is_guest:true
// so it never shows up on the leaderboard, and so server.js knows to delete
// it once the guest's match is over (see deleteUserByPlayerId).
function createGuestUser({ playerId, username }) {
  const data = loadData();
  const newUser = {
    id: data.users.length + 1,
    player_id: playerId,
    username,
    email: null,
    password_hash: null,
    is_guest: true,
    rating: 1200,
    wins: 0,
    losses: 0,
    draws: 0,
    created_at: new Date().toISOString()
  };
  data.users.push(newUser);
  saveData(data);
  return newUser;
}

function deleteUserByPlayerId(playerId) {
  const data = loadData();
  const before = data.users.length;
  data.users = data.users.filter(u => u.player_id !== playerId);
  if (data.users.length !== before) saveData(data);
}

// field: 'wins' | 'losses' | 'draws', delta: rating change (e.g. +8 / -8 / 0)
function updateUserStats(playerId, field, delta) {
  const data = loadData();
  const user = data.users.find(u => u.player_id === playerId);
  if (!user) return;
  user[field] = (user[field] || 0) + 1;
  user.rating = Math.max(100, (user.rating || 1200) + delta);
  saveData(data);
}

// Find existing user by email, or create a new one (used for Google sign-in).
// Guarantees no duplicate account is created for an email that's already registered.
function findOrCreateGoogleUser({ email, suggestedUsername, generatePlayerId }) {
  const data = loadData();
  let user = data.users.find(u => u.email === email);
  if (user) return { user, created: false };

  let username = (suggestedUsername || email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'player';
  let candidate = username;
  let n = 1;
  while (data.users.some(u => u.username === candidate)) {
    candidate = `${username}${n}`;
    n++;
  }

  const newUser = {
    id: data.users.length + 1,
    player_id: generatePlayerId(),
    username: candidate,
    email,
    password_hash: null,   // Google-authenticated accounts have no password
    auth_provider: 'google',
    rating: 1200,
    wins: 0,
    losses: 0,
    draws: 0,
    created_at: new Date().toISOString()
  };
  data.users.push(newUser);
  saveData(data);
  return { user: newUser, created: true };
}

// ---------- GAMES (history log) ----------
function insertGame(record) {
  const data = loadData();
  data.games.push({ id: data.games.length + 1, ...record, ended_at: new Date().toISOString() });
  saveData(data);
}

function getLeaderboard(limit = 20) {
  const data = loadData();
  return [...data.users]
    .filter(u => !u.is_guest) // guests are temporary and never ranked
    .sort((a, b) => b.rating - a.rating)
    .slice(0, limit)
    .map(u => ({
      player_id: u.player_id, username: u.username, rating: u.rating,
      wins: u.wins, losses: u.losses, draws: u.draws
    }));
}

module.exports = {
  findUserByUsernameOrEmail,
  usernameOrEmailTaken,
  findUserByPlayerId,
  playerIdExists,
  createUser,
  createGuestUser,
  deleteUserByPlayerId,
  findOrCreateGoogleUser,
  updateUserStats,
  insertGame,
  getLeaderboard
};
