// ═══════════════════════════════════════════════════════
//  Professional Russian Checkers AI Engine
//  Features: Minimax + Alpha-Beta + Iterative Deepening
//  Transposition Table + Zobrist Hashing + Move Ordering
//  Quiescence Search + Opening Book + Endgame Knowledge
// ═══════════════════════════════════════════════════════
import * as admin from "firebase-admin";
import { BotProfile, BotStyle } from "./botProfiles";

const db  = () => admin.firestore();
const rdb = () => admin.database();

// ── Types ─────────────────────────────────────────────
export type Piece = { color: string; isKing: boolean } | null;
export type Board = Piece[][];
export type BotDifficulty = "beginner"|"easy"|"medium"|"hard"|"expert"|"master"|"grandmaster";

export interface Position { row: number; col: number; }
export interface Move {
  from: Position;
  to: Position;
  captured: Position[];
  isCapture: boolean;
  promotesToKing?: boolean;
}

// ── Difficulty config ─────────────────────────────────
const DIFFICULTY_CONFIG: Record<BotDifficulty, {
  depth: number;
  mistakeRate: number;
  randomness: number;
  quiescenceDepth: number;
  useOpeningBook: boolean;
}> = {
  beginner:    { depth: 2, mistakeRate: 0.25, randomness: 0.3,  quiescenceDepth: 0, useOpeningBook: false },
  easy:        { depth: 3, mistakeRate: 0.10, randomness: 0.15, quiescenceDepth: 1, useOpeningBook: false },
  medium:      { depth: 5, mistakeRate: 0.03, randomness: 0.05, quiescenceDepth: 2, useOpeningBook: true  },
  hard:        { depth: 7, mistakeRate: 0.01, randomness: 0.02, quiescenceDepth: 3, useOpeningBook: true  },
  expert:      { depth: 9, mistakeRate: 0.00, randomness: 0.01, quiescenceDepth: 4, useOpeningBook: true  },
  master:      { depth:11, mistakeRate: 0.00, randomness: 0.00, quiescenceDepth: 5, useOpeningBook: true  },
  grandmaster: { depth:13, mistakeRate: 0.00, randomness: 0.00, quiescenceDepth: 6, useOpeningBook: true  },
};

// ── Zobrist Hashing ───────────────────────────────────
const ZOBRIST: number[][][] = Array.from({length: 8}, () =>
  Array.from({length: 8}, () =>
    Array.from({length: 4}, () => Math.floor(Math.random() * 2**31))
  )
);
const ZOBRIST_TURN = Math.floor(Math.random() * 2**31);

function pieceIndex(piece: Piece): number {
  if (!piece) return -1;
  if (piece.color === "WHITE") return piece.isKing ? 1 : 0;
  return piece.isKing ? 3 : 2;
}

function computeHash(board: Board, isWhiteTurn: boolean): number {
  let hash = isWhiteTurn ? ZOBRIST_TURN : 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const idx = pieceIndex(board[r][c]);
      if (idx >= 0) hash ^= ZOBRIST[r][c][idx];
    }
  }
  return hash;
}

// ── Transposition Table ───────────────────────────────
interface TTEntry { score: number; depth: number; flag: "exact"|"lower"|"upper"; bestMove?: Move; }
const transpositionTable = new Map<number, TTEntry>();
const MAX_TT_SIZE = 100000;

function ttGet(hash: number): TTEntry | undefined {
  return transpositionTable.get(hash);
}
function ttSet(hash: number, entry: TTEntry): void {
  if (transpositionTable.size >= MAX_TT_SIZE) {
    const firstKey = transpositionTable.keys().next().value!;
    transpositionTable.delete(firstKey);
  }
  transpositionTable.set(hash, entry);
}

// ── Opening Book ──────────────────────────────────────
const OPENING_MOVES: Move[][] = [
  [{ from:{row:5,col:0}, to:{row:4,col:1}, captured:[], isCapture:false }],
  [{ from:{row:5,col:2}, to:{row:4,col:1}, captured:[], isCapture:false }],
  [{ from:{row:5,col:2}, to:{row:4,col:3}, captured:[], isCapture:false }],
  [{ from:{row:5,col:4}, to:{row:4,col:3}, captured:[], isCapture:false }],
  [{ from:{row:5,col:4}, to:{row:4,col:5}, captured:[], isCapture:false }],
  [{ from:{row:5,col:6}, to:{row:4,col:5}, captured:[], isCapture:false }],
  [{ from:{row:6,col:1}, to:{row:5,col:0}, captured:[], isCapture:false }],
  [{ from:{row:6,col:1}, to:{row:5,col:2}, captured:[], isCapture:false }],
];

// ── Board utilities ───────────────────────────────────
export function cloneBoard(board: Board): Board {
  return board.map(row => row.map(p => p ? { ...p } : null));
}

function applyMoveToBoard(board: Board, move: Move): Board {
  const b = cloneBoard(board);
  const piece = b[move.from.row][move.from.col]!;
  if (!piece) return b;
  b[move.from.row][move.from.col] = null;
  // Remove all captured pieces
  move.captured.forEach(c => { b[c.row][c.col] = null; });
  const becomeKing = !piece.isKing &&
    ((piece.color === "WHITE" && move.to.row === 0) ||
     (piece.color === "BLACK" && move.to.row === 7));
  b[move.to.row][move.to.col] = { ...piece, isKing: piece.isKing || becomeKing };
  return b;
}

// ── Move generation ───────────────────────────────────
function getCaptures(board: Board, from: Position, color: string, isKing: boolean, alreadyCaptured: Set<string>): Move[] {
  const result: Move[] = [];
  const dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];

  if (isKing) {
    for (const [dr, dc] of dirs) {
      let r = from.row + dr, c = from.col + dc;
      let foundEnemy: Position | null = null;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const cur = board[r][c];
        const key = `${r},${c}`;
        if (cur) {
          if (foundEnemy || cur.color === color || alreadyCaptured.has(key)) break;
          foundEnemy = { row: r, col: c };
        } else if (foundEnemy) {
          result.push({
            from, to: {row:r,col:c},
            captured: [foundEnemy], isCapture: true
          });
        }
        r += dr; c += dc;
      }
    }
  } else {
    for (const [dr, dc] of dirs) {
      const mr = from.row+dr, mc = from.col+dc;
      const lr = from.row+dr*2, lc = from.col+dc*2;
      if (lr < 0 || lr >= 8 || lc < 0 || lc >= 8) continue;
      const mid = board[mr]?.[mc];
      const key = `${mr},${mc}`;
      if (mid && mid.color !== color && !alreadyCaptured.has(key) && !board[lr][lc]) {
        result.push({ from, to:{row:lr,col:lc}, captured:[{row:mr,col:mc}], isCapture:true });
      }
    }
  }
  return result;
}

function getSimpleMoves(board: Board, from: Position, color: string, isKing: boolean): Move[] {
  const result: Move[] = [];
  const fwd = color === "WHITE" ? -1 : 1;

  if (isKing) {
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let r = from.row+dr, c = from.col+dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && !board[r][c]) {
        result.push({ from, to:{row:r,col:c}, captured:[], isCapture:false });
        r += dr; c += dc;
      }
    }
  } else {
    for (const dc of [-1, 1]) {
      const nr = from.row+fwd, nc = from.col+dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && !board[nr][nc]) {
        const promotesToKing = (color === "WHITE" && nr === 0) || (color === "BLACK" && nr === 7);
        result.push({ from, to:{row:nr,col:nc}, captured:[], isCapture:false, promotesToKing });
      }
    }
  }
  return result;
}

// Get all possible capture sequences (chain captures)
function getAllCaptureSequences(
  board: Board, from: Position, color: string, isKing: boolean,
  alreadyCaptured: Set<string>, capturedSoFar: Position[] = []
): Move[] {
  const caps = getCaptures(board, from, color, isKing, alreadyCaptured);
  if (caps.length === 0) {
    // End of chain — return accumulated move if we captured something
    if (capturedSoFar.length > 0) {
      return [{ from: capturedSoFar.length > 0 ? from : from, to: from, captured: capturedSoFar, isCapture: true }];
    }
    return [];
  }

  const results: Move[] = [];
  for (const cap of caps) {
    const newBoard = applyMoveToBoard(board, cap);
    const newCaptured = new Set(alreadyCaptured);
    cap.captured.forEach(c => newCaptured.add(`${c.row},${c.col}`));
    const allCaptured = [...capturedSoFar, ...cap.captured];
    const piece = newBoard[cap.to.row][cap.to.col]!;

    const chainMoves = getAllCaptureSequences(
      newBoard, cap.to, color, piece.isKing, newCaptured, allCaptured
    );

    if (chainMoves.length > 0) {
      // Continue chain
      for (const chain of chainMoves) {
        results.push({
          from: capturedSoFar.length === 0 ? cap.from : from,
          to: chain.to,
          captured: allCaptured,
          isCapture: true
        });
      }
    } else {
      results.push({
        from: capturedSoFar.length === 0 ? cap.from : from,
        to: cap.to,
        captured: allCaptured,
        isCapture: true
      });
    }
  }
  return results;
}

export function getValidMovesForColor(board: Board, color: string): Move[] {
  const captures: Move[] = [];
  const simples: Move[] = [];

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || piece.color !== color) continue;
      const from = { row: r, col: c };

      // Get all capture sequences including chains
      const capSequences = getAllCaptureSequences(board, from, from, color, piece.isKing, new Set<string>());
      captures.push(...capSequences);

      if (capSequences.length === 0) {
        simples.push(...getSimpleMoves(board, from, color, piece.isKing));
      }
    }
  }
  return captures.length > 0 ? captures : simples;
}

// Chain captures
function getChainCaptures(board: Board, from: Position, color: string, isKing: boolean, alreadyCaptured: Set<string>): Move[] {
  return getCaptures(board, from, color, isKing, alreadyCaptured);
}

// ── Evaluation function ───────────────────────────────
const CENTER_BONUS = [
  [0,0,0,0,0,0,0,0],
  [0,1,1,1,1,1,1,0],
  [0,1,2,2,2,2,1,0],
  [0,1,2,3,3,2,1,0],
  [0,1,2,3,3,2,1,0],
  [0,1,2,2,2,2,1,0],
  [0,1,1,1,1,1,1,0],
  [0,0,0,0,0,0,0,0],
];

function evaluate(board: Board, botColor: string, style: BotStyle): number {
  const oppColor = botColor === "WHITE" ? "BLACK" : "WHITE";
  let score = 0;
  let botPieces = 0, oppPieces = 0, botKings = 0, oppKings = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const isBot = p.color === botColor;
      
      if (p.isKing) {
        // Dama juda qimmat
        const kingVal = 7.0 + CENTER_BONUS[r][c] * 0.3;
        if (isBot) { score += kingVal; botKings++; }
        else { score -= kingVal; oppKings++; }
      } else {
        // Oddiy dona
        const advanceRow = p.color === "WHITE" ? (7 - r) : r;
        const advanceVal = advanceRow * 0.08;
        const centerVal = CENTER_BONUS[r][c] * 0.12;
        // Orqa qator bonusi (dama bo'lishni oldini olish uchun)
        const backRow = (p.color === "WHITE" && r === 7) || (p.color === "BLACK" && r === 0);
        const backVal = backRow ? 0.5 : 0;
        // Yon qirg'oq jarima (yon tomondagi donalar zaif)
        const edgePenalty = (c === 0 || c === 7) ? -0.1 : 0;
        
        const totalVal = 1.0 + advanceVal + centerVal + backVal + edgePenalty;
        if (isBot) { score += totalVal; botPieces++; }
        else { score -= totalVal; oppPieces++; }
      }
    }
  }

  // Mobility bonus
  const botMoves = getValidMovesForColor(board, botColor);
  const oppMoves = getValidMovesForColor(board, oppColor);
  score += (botMoves.length - oppMoves.length) * 0.08;

  // Capture threat bonus
  const botCaptures = botMoves.filter(m => m.isCapture).length;
  const oppCaptures = oppMoves.filter(m => m.isCapture).length;
  score += (botCaptures - oppCaptures) * 0.15;

  // Trade advantage — agar ko'proq dona bo'lsa, almashtirish foydali
  const botTotal = botPieces + botKings * 3;
  const oppTotal = oppPieces + oppKings * 3;
  if (botTotal > oppTotal) score += 0.3;

  // Style adjustments
  if (style === "aggressive") {
    score += botCaptures * 0.3;
    score += botKings * 1.0;
  } else if (style === "defensive") {
    const backRank = backRankBonus(board, botColor);
    score += backRank * 0.5;
    // Donalarni himoya qilish
    score -= oppCaptures * 0.4;
  }

  // Endgame
  const total = botPieces + oppPieces + botKings + oppKings;
  if (total <= 8) {
    score += (botKings - oppKings) * 3.0;
    // King vs pieces endgame
    if (botKings >= 2 && oppKings === 0) score += 5.0;
    if (oppKings >= 2 && botKings === 0) score -= 5.0;
    // Yaqinlashtirish bonusi — endgame da donalarni yaqinlash
    if (botKings > 0 && oppPieces > 0) {
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = board[r][c];
          if (!p || p.color !== botColor || !p.isKing) continue;
          for (let r2 = 0; r2 < 8; r2++) {
            for (let c2 = 0; c2 < 8; c2++) {
              const p2 = board[r2][c2];
              if (!p2 || p2.color === botColor) continue;
              const dist = Math.abs(r - r2) + Math.abs(c - c2);
              score += (14 - dist) * 0.05;
            }
          }
        }
      }
    }
  }

  return score;
}

function backRankBonus(board: Board, color: string): number {
  const row = color === "WHITE" ? 7 : 0;
  let bonus = 0;
  for (let c = 0; c < 8; c++) {
    const p = board[row][c];
    if (p && p.color === color && !p.isKing) bonus++;
  }
  return bonus;
}

// ── Move ordering ─────────────────────────────────────
function orderMoves(moves: Move[], board: Board, botColor: string, bestMove?: Move): Move[] {
  return moves.sort((a, b) => {
    let scoreA = 0, scoreB = 0;
    if (bestMove && a.from.row === bestMove.from.row && a.from.col === bestMove.from.col &&
        a.to.row === bestMove.to.row && a.to.col === bestMove.to.col) scoreA += 1000;
    if (bestMove && b.from.row === bestMove.from.row && b.from.col === bestMove.from.col &&
        b.to.row === bestMove.to.row && b.to.col === bestMove.to.col) scoreB += 1000;
    if (a.isCapture) scoreA += 100 + a.captured.length * 50;
    if (b.isCapture) scoreB += 100 + b.captured.length * 50;
    if (a.promotesToKing) scoreA += 80;
    if (b.promotesToKing) scoreB += 80;
    const centerA = CENTER_BONUS[a.to.row][a.to.col];
    const centerB = CENTER_BONUS[b.to.row][b.to.col];
    scoreA += centerA * 5;
    scoreB += centerB * 5;
    return scoreB - scoreA;
  });
}

// ── Quiescence Search ─────────────────────────────────
function quiescence(board: Board, alpha: number, beta: number, isMaximizing: boolean,
    botColor: string, style: BotStyle, depth: number): number {
  const standPat = evaluate(board, botColor, style) * (isMaximizing ? 1 : -1);
  if (depth <= 0) return standPat;
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  const color = isMaximizing ? botColor : (botColor === "WHITE" ? "BLACK" : "WHITE");
  const allMoves = getValidMovesForColor(board, color);
  const captures = allMoves.filter(m => m.isCapture);

  for (const move of captures) {
    const newBoard = applyMoveToBoard(board, move);
    const score = -quiescence(newBoard, -beta, -alpha, !isMaximizing, botColor, style, depth - 1);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// ── Minimax + Alpha-Beta + TT ─────────────────────────
function minimax(board: Board, depth: number, alpha: number, beta: number,
    isMaximizing: boolean, botColor: string, style: BotStyle,
    hash: number, quiescenceDepth: number): { score: number; bestMove?: Move } {
  const ttEntry = ttGet(hash);
  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === "exact") return { score: ttEntry.score, bestMove: ttEntry.bestMove };
    if (ttEntry.flag === "lower" && ttEntry.score > alpha) alpha = ttEntry.score;
    if (ttEntry.flag === "upper" && ttEntry.score < beta) beta = ttEntry.score;
    if (alpha >= beta) return { score: ttEntry.score, bestMove: ttEntry.bestMove };
  }

  const color = isMaximizing ? botColor : (botColor === "WHITE" ? "BLACK" : "WHITE");
  const moves = getValidMovesForColor(board, color);

  if (moves.length === 0) {
    return { score: isMaximizing ? -100 : 100 };
  }

  if (depth <= 0) {
    const score = quiescence(board, alpha, beta, isMaximizing, botColor, style, quiescenceDepth);
    return { score };
  }

  const ordered = orderMoves(moves, board, botColor, ttEntry?.bestMove);
  let bestMove: Move | undefined;
  let originalAlpha = alpha;

  if (isMaximizing) {
    let maxScore = -Infinity;
    for (const move of ordered) {
      const newBoard = applyMoveToBoard(board, move);
      const newHash = computeHash(newBoard, !isMaximizing);
      const { score } = minimax(newBoard, depth - 1, alpha, beta, false, botColor, style, newHash, quiescenceDepth);
      if (score > maxScore) { maxScore = score; bestMove = move; }
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    const flag = maxScore <= originalAlpha ? "upper" : maxScore >= beta ? "lower" : "exact";
    ttSet(hash, { score: maxScore, depth, flag, bestMove });
    return { score: maxScore, bestMove };
  } else {
    let minScore = Infinity;
    for (const move of ordered) {
      const newBoard = applyMoveToBoard(board, move);
      const newHash = computeHash(newBoard, !isMaximizing);
      const { score } = minimax(newBoard, depth - 1, alpha, beta, true, botColor, style, newHash, quiescenceDepth);
      if (score < minScore) { minScore = score; bestMove = move; }
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
    const flag = minScore >= beta ? "lower" : minScore <= originalAlpha ? "upper" : "exact";
    ttSet(hash, { score: minScore, depth, flag, bestMove });
    return { score: minScore, bestMove };
  }
}

// ── Iterative Deepening ───────────────────────────────
function iterativeDeepening(board: Board, maxDepth: number, botColor: string,
    style: BotStyle, quiescenceDepth: number, timeLimit: number): Move | null {
  const startTime = Date.now();
  let bestMove: Move | null = null;
  const hash = computeHash(board, botColor === "WHITE");

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (Date.now() - startTime > timeLimit) break;
    const result = minimax(board, depth, -Infinity, Infinity, true, botColor, style, hash, quiescenceDepth);
    if (result.bestMove) bestMove = result.bestMove;
  }
  return bestMove;
}

// ── Style move selection ──────────────────────────────
export function selectBotMove(moves: Move[], style: BotStyle, board: Board,
    botColor: string, difficulty: BotDifficulty = "medium"): Move {
  if (moves.length === 0) throw new Error("No valid moves");
  if (moves.length === 1) return moves[0];

  const config = DIFFICULTY_CONFIG[difficulty] || DIFFICULTY_CONFIG.medium;

  // Mistake simulation
  if (config.mistakeRate > 0 && Math.random() < config.mistakeRate) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // Use opening book for early game
  if (config.useOpeningBook) {
    const whiteCount = board.flat().filter(p => p?.color === "WHITE").length;
    const blackCount = board.flat().filter(p => p?.color === "BLACK").length;
    if (whiteCount === 12 && blackCount === 12) {
      const bookLine = OPENING_MOVES[Math.floor(Math.random() * OPENING_MOVES.length)];
      const bookMove = bookLine[0];
      const matching = moves.find(m =>
        m.from.row === bookMove.from.row && m.from.col === bookMove.from.col &&
        m.to.row === bookMove.to.row && m.to.col === bookMove.to.col
      );
      if (matching) return matching;
    }
  }

  const timeLimit = difficulty === "grandmaster" ? 8000 :
    difficulty === "master" ? 6000 :
    difficulty === "expert" ? 4000 :
    difficulty === "hard" ? 3000 :
    difficulty === "medium" ? 2000 :
    difficulty === "easy" ? 1000 : 500;

  const bestMove = iterativeDeepening(board, config.depth, botColor, style,
    config.quiescenceDepth, timeLimit);

  if (!bestMove) return moves[0];

  // Slight randomness for lower levels
  if (config.randomness > 0 && Math.random() < config.randomness) {
    const topMoves = moves.slice(0, Math.min(3, moves.length));
    return topMoves[Math.floor(Math.random() * topMoves.length)];
  }

  return bestMove;
}

// ── Seed bot to Firestore ─────────────────────────────
export async function seedBotToFirestore(bot: BotProfile): Promise<void> {
  const ref = db().collection("users").doc(bot.uid);
  const snap = await ref.get();
  if (snap.exists) return;

  await ref.set({
    uid: bot.uid, displayName: bot.displayName,
    email: `${bot.uid}@shashka.bot`, photoUrl: bot.photoUrl,
    bio: bot.bio, coins: 5000 + Math.floor(Math.random() * 10000),
    diamonds: 50 + Math.floor(Math.random() * 100),
    xp: bot.xp, level: bot.level, wins: bot.wins,
    losses: bot.losses, draws: bot.draws, totalGames: bot.totalGames,
    totalCoinsWagered: bot.wins * 200, totalCoinsWon: bot.wins * 380,
    currentWinStreak: Math.floor(Math.random() * 5),
    longestWinStreak: Math.floor(bot.wins / 10),
    rating: bot.rating, peakRating: bot.rating,
    clubId: "", clubName: "", clubRole: "MEMBER",
    equippedSkin: "default", avatarId: "avatar_01",
    unlockedSkins: ["default"], friendUids: [],
    lastDailyClaim: Date.now() - 3600000,
    dailyStreak: Math.floor(Math.random() * 7) + 1,
    isOnline: false, isBot: true,
    createdAt: Date.now() - Math.floor(Math.random() * 90 * 86400000),
    lastSeenAt: Date.now() - Math.floor(Math.random() * 3600000),
  });
}

// ── Main bot move (new row_col format) ────────────────
export async function makeBotMoveNewFormat(roomId: string, botColor: string,
    style: BotStyle, difficulty?: BotDifficulty): Promise<void> {
  const snap = await rdb().ref(`rooms/${roomId}/gameState`).get();
  if (!snap.exists()) return;
  const gs = snap.val();
  if (!gs || gs.isGameOver || gs.currentTurn !== botColor) return;

  // Parse board
  const board: Board = Array.from({length: 8}, () => Array(8).fill(null));
  for (const [key, val] of Object.entries(gs.board || {})) {
    const [r, c] = key.split("_").map(Number);
    if (isNaN(r) || isNaN(c)) continue;
    const v = val as { color: string; type: string };
    board[r][c] = { color: v.color, isKing: v.type === "KING" };
  }

  const moves = getValidMovesForColor(board, botColor);
  if (moves.length === 0) {
    await rdb().ref(`rooms/${roomId}/gameState`).update({
      isGameOver: true,
      winner: botColor === "WHITE" ? "BLACK" : "WHITE",
    });
    return;
  }

  const diff: BotDifficulty = difficulty || styleToDifficulty(style);
  const move = selectBotMove(moves, style, board, botColor, diff);
  const newBoard = applyMoveToBoard(board, move);

  await saveBoard(newBoard, botColor, roomId);
}

function styleToDifficulty(style: BotStyle): BotDifficulty {
  switch (style) {
    case "beginner": return "beginner";
    case "random":   return "easy";
    case "balanced": return "medium";
    case "aggressive": return "hard";
    case "defensive":  return "hard";
    default: return "medium";
  }
}

async function saveBoard(board: Board, botColor: string, roomId: string): Promise<void> {
  const newBoardData: Record<string, { color: string; type: string }> = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) newBoardData[`${r}_${c}`] = { color: p.color, type: p.isKing ? "KING" : "MAN" };
    }
  }
  const whites = Object.values(newBoardData).filter(p => p.color === "WHITE").length;
  const blacks = Object.values(newBoardData).filter(p => p.color === "BLACK").length;
  const isGameOver = whites === 0 || blacks === 0;
  const winner = whites === 0 ? "BLACK" : blacks === 0 ? "WHITE" : null;
  const opp = botColor === "WHITE" ? "BLACK" : "WHITE";

  await rdb().ref(`rooms/${roomId}/gameState`).update({
    board: newBoardData,
    currentTurn: isGameOver ? botColor : opp,
    isGameOver, winner,
  });
}

// Legacy
export async function makeBotMove(roomId: string, botUid: string,
    botColor: string, style: BotStyle): Promise<void> {
  await makeBotMoveNewFormat(roomId, botColor, style);
}
