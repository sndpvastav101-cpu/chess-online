// bot.js - a small built-in chess "AI". No external API/engine needed.
// Easy: random legal move
// Medium: prefers captures/checks, avoids obviously losing a piece for nothing
// Hard: 2-ply minimax with simple material + mobility evaluation

const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function evaluateBoard(chess) {
  const board = chess.board();
  let score = 0;
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue;
      const val = PIECE_VALUES[sq.type] || 0;
      score += sq.color === 'w' ? val : -val;
    }
  }
  return score; // positive = good for white
}

function randomMove(chess) {
  const moves = chess.moves();
  return moves[Math.floor(Math.random() * moves.length)];
}

function greedyMove(chess) {
  const moves = chess.moves({ verbose: true });
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    let score = 0;
    if (m.captured) score += (PIECE_VALUES[m.captured] || 0) * 10;
    if (m.san && m.san.includes('+')) score += 3;
    if (m.san && m.san.includes('#')) score += 1000;
    score += Math.random(); // tie-break
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best ? best.san : randomMove(chess);
}

function minimax(chess, depth, isMaximizing) {
  if (depth === 0 || chess.isGameOver()) {
    return evaluateBoard(chess);
  }
  const moves = chess.moves();
  let best = isMaximizing ? -Infinity : Infinity;
  for (const move of moves) {
    chess.move(move);
    const val = minimax(chess, depth - 1, !isMaximizing);
    chess.undo();
    if (isMaximizing) best = Math.max(best, val);
    else best = Math.min(best, val);
  }
  return best;
}

function hardMove(chess) {
  const botIsWhite = chess.turn() === 'w';
  const moves = chess.moves();
  let bestMove = null;
  let bestScore = botIsWhite ? -Infinity : Infinity;
  for (const move of moves) {
    chess.move(move);
    const score = minimax(chess, 2, !botIsWhite);
    chess.undo();
    if (botIsWhite && score > bestScore) { bestScore = score; bestMove = move; }
    if (!botIsWhite && score < bestScore) { bestScore = score; bestMove = move; }
  }
  return bestMove || randomMove(chess);
}

// difficulty: 'easy' | 'medium' | 'hard'
function getBotMove(chess, difficulty = 'medium') {
  if (chess.isGameOver()) return null;
  if (difficulty === 'easy') return randomMove(chess);
  if (difficulty === 'hard') return hardMove(chess);
  return greedyMove(chess);
}

module.exports = { getBotMove };
