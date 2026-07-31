# ChessOnline — Real-time Multiplayer Chess

Email registration, unique Player ID, online lobby, direct challenges,
4 timed formats, and a built-in bot opponent. No native/compiled
dependencies — pure JavaScript, so `npm install` works on any machine
with Node.js, no Python or build tools needed.

## 1. Install Node.js
Download from https://nodejs.org (choose the "LTS" version) and install it
like any normal program. Restart your terminal after installing.

Check it worked:
```
node -v
```
Should print something like `v20.x.x` or higher.

## 2. Install and run
Open a terminal inside the `server` folder:
```
cd chess-app/server
npm install
copy .env.example .env      (Windows)
cp .env.example .env        (Mac/Linux)
npm start
```
You should see:
```
Chess app running on http://localhost:3000
```
Open that link in your browser. To test multiplayer, open a second
browser window (or an incognito window) and register a second account —
now you have two players to challenge each other with.

## 3. What's new in this version
- **Quick Match**: click "Find Opponent" and you're auto-paired with whoever
  else is searching - no need to know anyone's ID.
- **Google Sign-In** (optional): if you set up `GOOGLE_CLIENT_ID` (see
  below), people can log in with one click using their Google account
  instead of a password. If an email is already registered, signing in
  with Google for that same email logs into the *same* account - it never
  creates a duplicate.
- **Less info shown about other players**: the lobby now only shows
  usernames (no Player ID or rating leaked to strangers) with a
  "Challenge" button. Your own Player ID is only shown to you, to share
  privately with a specific friend if you want.
- **Fixed**: "Play vs Bot" doing nothing when clicked. The chess board
  library needs its container to be visible *before* it draws itself; the
  screen switch now happens first.

## 4. Setting up Google Sign-In (optional)
This step is optional - the app works fully with plain email/password
without it. If you want the "Sign in with Google" button to work:
1. Go to https://console.cloud.google.com/ and create a project (free).
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth
   client ID**.
3. Application type: **Web application**.
4. Under "Authorized JavaScript origins" add the URL you'll run the app
   on, e.g. `http://localhost:3000` (and your real domain later, e.g.
   `https://yourdomain.com`).
5. Copy the generated **Client ID** (looks like
   `123456-abc.apps.googleusercontent.com`).
6. Paste it into your `.env` file as `GOOGLE_CLIENT_ID=...` and restart
   the server (`npm start`).

If you skip this, the Google button area will just show a small note and
everyone uses email/password - nothing else breaks.

## 5. How it works
- **Register**: email + username + password. You instantly get a unique
  Player ID like `CHESS-7F3A9K` — share this with friends so they can
  challenge you directly.
- **Lobby**: shows everyone currently online. You can challenge anyone by
  their Player ID, or play the built-in bot (Easy/Medium/Hard).
- **Time controls**: Bullet (1+0), Blitz (5+3), Rapid (10+5), Classical
  (30+15) — pick one before the game starts.
- **Moves**: validated on the server using the `chess.js` rules engine, so
  no one can cheat by sending illegal moves.
- **Game end**: checkmate, stalemate/draw, resignation, or running out of
  time are all detected automatically. Ratings update after every game
  (simple Elo-style system).

## 6. Where your data is stored
Right now, everything (accounts, stats, game history) is saved in a
single file: `server/chess-data.json`. This is great for testing but:
- it resets if you delete that file
- it won't survive some hosting platforms restarting your server (their
  filesystem is temporary)

**Before a real public launch**, move this data into a proper hosted
database — MongoDB Atlas (free tier) or Supabase (free tier) are both
beginner-friendly. Ask me when you're ready and I'll do that migration
for you; the rest of the app won't need to change.

## 7. Putting it online for real (so anyone can play)
Good beginner-friendly hosts for a Node.js + Socket.io app:
- **Render.com** (free/cheap tier, very simple)
- **Railway.app**
- **Fly.io**

General steps (same idea on any of them):
1. Push this project to a GitHub repository.
2. Create a new "Web Service" on the host, connect your GitHub repo.
3. Set the start command to `npm start` (root: `server` folder).
4. Add an environment variable `JWT_SECRET` with a long random value.
5. Deploy — they give you a public URL anyone can open.

## 8. About earning money
Real-money betting on game outcomes is legally regulated (often requires
a gambling licence) in most countries, including India — so this
prototype does **not** include that. Legitimate ways to monetize that
don't need a gambling licence:
- Premium subscriptions (extra board themes, no ads, deeper game
  analysis)
- Paid entry tournaments with a fixed prize pool (different legal
  category from betting — check local rules first)
- Coaching / lesson bookings between players
- Simple ads

When you're ready, I can wire up Stripe or Razorpay for subscriptions or
tournament entry fees.

## Project structure
```
chess-app/
  server/
    server.js        <- main server, sockets, game logic, timers
    auth.js           <- register/login, Player ID generation
    bot.js             <- built-in bot (3 difficulty levels)
    db.js               <- simple JSON-file database
    package.json
    .env.example
  public/
    index.html          <- the whole front-end page
    style.css
    app.js               <- front-end logic (board, sockets, lobby)
```

## Troubleshooting
- **"npm install" fails on `better-sqlite3` or similar native package**:
  this project doesn't use any native/compiled packages, so this
  shouldn't happen. If you renamed/edited `package.json`, make sure it
  matches the one in this repo.
- **Port already in use**: change `PORT` in `.env` to something else,
  e.g. `3001`.
- **Can't connect from another computer on the same WiFi**: use your
  computer's local IP address instead of `localhost`, e.g.
  `http://192.168.1.5:3000`, and make sure your firewall allows it.
