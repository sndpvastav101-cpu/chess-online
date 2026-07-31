// auth.js - registration, login, Google sign-in, guest sessions, and unique Player ID generation
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function generatePlayerId() {
  // Example: CHESS-7F3A9K
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars (0/O, 1/I)
  let id;
  do {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    id = `CHESS-${code}`;
  } while (db.playerIdExists(id));
  return id;
}

// Same format but with a GUEST- prefix, so it's instantly obvious (in logs,
// the lobby list, etc.) that this player is a temporary guest.
function generateGuestId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    id = `GUEST-${code}`;
  } while (db.playerIdExists(id));
  return id;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function register({ username, email, password }) {
  if (!username || !email || !password) {
    throw new Error('Username, email and password are all required.');
  }
  if (username.length < 3) throw new Error('Username must be at least 3 characters.');
  if (!isValidEmail(email)) throw new Error('Please enter a valid email address.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  if (db.usernameOrEmailTaken(username, email)) {
    throw new Error('Username or email is already registered.');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const playerId = generatePlayerId();
  const user = db.createUser({ playerId, username, email, passwordHash });
  const token = signToken(user);
  return { token, user: publicUser(user) };
}

async function login({ usernameOrEmail, password }) {
  const user = db.findUserByUsernameOrEmail(usernameOrEmail);
  if (!user) throw new Error('No account found with that username/email.');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error('Incorrect password.');
  const token = signToken(user);
  return { token, user: publicUser(user) };
}

// Creates a brand-new temporary account with no email/password. The caller
// (server.js) is responsible for deleting this record once the guest's
// match ends, or when they log out.
async function guestLogin() {
  const playerId = generateGuestId();
  const suffix = playerId.split('-')[1];
  const user = db.createGuestUser({ playerId, username: `Guest-${suffix}` });
  const token = signToken(user);
  return { token, user: publicUser(user) };
}

function signToken(user) {
  return jwt.sign({ playerId: user.player_id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Verifies a Google "ID token" (sent from the frontend after Google Sign-In)
// by asking Google directly whether it's valid - no extra library needed.
async function googleLogin(idToken) {
  if (!idToken) throw new Error('Missing Google credential.');

  const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!resp.ok) throw new Error('Could not verify Google sign-in. Please try again.');
  const payload = await resp.json();

  const expectedAud = process.env.GOOGLE_CLIENT_ID;
  if (expectedAud && payload.aud !== expectedAud) {
    throw new Error('Google sign-in configuration mismatch.');
  }
  if (!payload.email || payload.email_verified !== 'true') {
    throw new Error('Your Google account email is not verified.');
  }

  const { user } = db.findOrCreateGoogleUser({
    email: payload.email,
    suggestedUsername: payload.name || payload.email.split('@')[0],
    generatePlayerId
  });
  const token = signToken(user);
  return { token, user: publicUser(user) };
}

function publicUser(user) {
  return {
    playerId: user.player_id,
    username: user.username,
    rating: user.rating,
    wins: user.wins,
    losses: user.losses,
    draws: user.draws,
    isGuest: !!user.is_guest
  };
}

module.exports = { register, login, googleLogin, guestLogin, verifyToken, publicUser };
