// ─────────────────────────────────────────────
//  BotEngine — Minimax + Alpha-Beta pruning
// ─────────────────────────────────────────────
import * as admin from "firebase-admin";
import { BotProfile, BotStyle } from "./botProfiles";

const db  = () => admin.firestore();
const rdb = () => admin.database();

export interface Position { row: number; col: number; }
export interface Move { from: Position; to: Position; captured: Position[]; }

type Piece = { color: string; isKing: boolean } | null;
type Board = Piece[][];

// ── Board utility ─────────────────────────────
function cloneBoard(board: Board): Board {
  return board.map(row => row.map(p => p ? { ...p } : null));
}

function applyMove(board: Board, move: Move): Board {
  const b = cloneBoard(board);
  const piece = b[move.from.row][move.from.col]!;
  b[move.from.row][move.from.col] = null;
  move.captured.forEach(c => { b[c.row][c.col] = null; });
  const becomeKing = !piece.isKing &&
    ((piece.color === "WHITE" && move.to.row === 0) ||
     (piece.color === "BLACK" && move.to.row === 7));
  b[move.to.row][move.to.col] = { ...piece, isKing: piece.isKing || becomeKing };
  return b;
}

// ── Valid moves (Rus shashkasi qoidalari) ─────
export function getValidMovesForColor(board: Board, color: string): Move[] {
  const captures: Move[] = [];
  const simple: Move[]   = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece || piece.color !== color) continue;

      if (piece.isKing) {
        // Dama harakatlari
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
          let r = row + dr, c = col + dc;
          let foundEnemy: Position | null = null;
          while (r >= 0 && r < 8 && c >= 0 && c < 8) {
            const cur = board[r][c];
            if (cur) {
              if (foundEnemy || cur.color === color) break;
              foundEnemy = { row: r, col: c };
            } else if (foundEnemy) {
              captures.push({ from: {row,col}, to: {row:r,col:c}, captured: [foundEnemy] });
            } else {
              simple.push({ from: {row,col}, to: {row:r,col:c}, captured: [] });
            }
            r += dr; c += dc;
          }
        }
      } else {
        // Oddiy dona — barcha 4 tomonga urishi mumkin
        const fwd = color === "WHITE" ? -1 : 1;
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
          const mr = row+dr, mc = col+dc;
          const lr = row+dr*2, lc = col+dc*2;
          if (lr < 0 || lr >= 8 || lc < 0 || lc >= 8) continue;
          const mid = board[mr]?.[mc];
          if (mid && mid.color !== color && !board[lr][lc]) {
            captures.push({ from:{row,col}, to:{row:lr,col:lc}, captured:[{row:mr,col:mc}] });
          }
        }
        for (const [dr, dc] of [[fwd,-1],[fwd,1]]) {
          const nr = row+dr, nc = col+dc;
          if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && !board[nr][nc]) {
            simple.push({ from:{row,col}, to:{row:nr,col:nc}, captured:[] });
          }
        }
      }
    }
  }
  return captures.length > 0 ? captures : simple;
}

// ── Board baholash funksiyasi ─────────────────
function evaluate(board: Board, botColor: string): number {
  const oppColor = botColor === "WHITE" ? "BLACK" : "WHITE";
  let score = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const isBot = p.color === botColor;
      const val = p.isKing ? 5 : 1;
      // Pozitsion bonus
      const centerBonus = (r >= 2 && r <= 5 && c >= 2 && c <= 5) ? 0.1 : 0;
      // Ilgarilab ketish bonusi
      const advanceBonus = p.isKing ? 0 :
        (p.color === "WHITE" ? (7 - r) * 0.05 : r * 0.05);
      if (isBot) {
        score += val + centerBonus + advanceBonus;
      } else {
        score -= val + centerBonus + advanceBonus;
      }
    }
  }
  return score;
}

// ── Minimax + Alpha-Beta ──────────────────────
function minimax(
  board: Board,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  botColor: string
): number {
  const color = isMaximizing ? botColor : (botColor === "WHITE" ? "BLACK" : "WHITE");
  const moves = getValidMovesForColor(board, color);

  if (depth === 0 || moves.length === 0) {
    return evaluate(board, botColor);
  }

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const newBoard = applyMove(board, move);
      // Ketma-ket urish
      const continueMoves = move.captured.length > 0
        ? getValidMovesForColor(newBoard, color).filter(m => m.from.row === move.to.row && m.from.col === move.to.col && m.captured.length > 0)
        : [];
      const nextIsMax = continueMoves.length > 0 ? true : false;
      const nextColor = continueMoves.length > 0;
      const evalScore = minimax(newBoard, depth - 1, alpha, beta, nextColor ? true : false, botColor);
      maxEval = Math.max(maxEval, evalScore);
      alpha = Math.max(alpha, evalScore);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const newBoard = applyMove(board, move);
      const evalScore = minimax(newBoard, depth - 1, alpha, beta, true, botColor);
      minEval = Math.min(minEval, evalScore);
      beta = Math.min(beta, evalScore);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

// ── Bot darajasiga qarab Minimax chuqurligi ───
export function depthForLevel(level: number): number {
  if (level <= 4)  return 1;
  if (level <= 8)  return 2;
  if (level <= 12) return 3;
  if (level <= 16) return 4;
  return 5;
}

// ── Bot harakatini tanlash ────────────────────
export function selectBotMove(moves: Move[], style: BotStyle, board: Board, botColor: string, depthOverride?: number): Move {
  if (moves.length === 0) throw new Error("No valid moves");
  if (moves.length === 1) return moves[0];

  // Majburiy yutish — eng ko'p dona yutuvchi
  const captureMoves = moves.filter(m => m.captured.length > 0);

  // Minimax chuqurligi uslubga qarab
  let depth = 3;
  switch (style) {
    case "beginner": depth = 1; break;
    case "random":   return moves[Math.floor(Math.random() * moves.length)];
    case "balanced": depth = 3; break;
    case "aggressive":
    case "defensive": depth = 4; break;
    default: depth = 3;
  }

  // Daraja bo'yicha aniq chuqurlik berilgan bo'lsa — o'sha ustun
  if (depthOverride !== undefined) depth = depthOverride;

  // Beginner — ba'zan xato qiladi
  if (style === "beginner" && Math.random() < 0.3) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let bestMove = moves[0];
  let bestScore = -Infinity;

  const movesToEval = captureMoves.length > 0 ? captureMoves : moves;

  for (const move of movesToEval) {
    const newBoard = applyMove(board, move);
    const score = minimax(newBoard, depth - 1, -Infinity, Infinity, false, botColor);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

// ── Bot Firestore ga yozilishi ────────────────
export async function seedBotToFirestore(bot: BotProfile): Promise<void> {
  const ref = db().collection("users").doc(bot.uid);
  const snap = await ref.get();
  if (snap.exists) {
    // Eski seed'da rating 0 bo'lib qolgan botlarni bir marta to'g'irlaymiz
    const cur = snap.data()!;
    if ((cur.rating ?? 0) === 0 && bot.rating !== 0) {
      await ref.update({ rating: bot.rating, peakRating: Math.max(bot.rating, 0) });
    }
    return;
  }

  await ref.set({
    uid:              bot.uid,
    displayName:      bot.displayName,
    email:            `${bot.uid}@shashka.bot`,
    photoUrl:         bot.photoUrl,
    bio:              bot.bio,
    coins:            5000 + Math.floor(Math.random() * 10000),
    diamonds:         50  + Math.floor(Math.random() * 100),
    xp:               bot.xp,
    level:            bot.level,
    wins:             bot.wins,
    losses:           bot.losses,
    draws:            bot.draws,
    totalGames:       bot.totalGames,
    totalCoinsWagered:bot.wins * 200 + bot.losses * 150,
    totalCoinsWon:    bot.wins * 380,
    currentWinStreak: Math.floor(Math.random() * 5),
    longestWinStreak: Math.floor(bot.wins / 10),
    rating:           bot.rating,
    peakRating:       Math.max(bot.rating, 0),
    clubId:           "",
    clubName:         "",
    clubRole:         "MEMBER",
    equippedSkin:     "default",
    avatarId:         "avatar_01",
    unlockedSkins:    ["default"],
    friendUids:       [],
    lastDailyClaim:   Date.now() - 3600000,
    dailyStreak:      Math.floor(Math.random() * 7) + 1,
    isOnline:         false,
    isBot:            true,
    createdAt:        Date.now() - Math.floor(Math.random() * 90 * 86400000),
    lastSeenAt:       Date.now() - Math.floor(Math.random() * 3600000),
  });
}

// ── Yangi format (row_col) bot harakat ───────
export async function makeBotMoveNewFormat(roomId: string, botColor: string, style: BotStyle, level: number = 10): Promise<void> {
  const gameStateSnap = await rdb().ref(`rooms/${roomId}/gameState`).get();
  if (!gameStateSnap.exists()) return;

  const gs = gameStateSnap.val();
  if (!gs || gs.isGameOver) return;
  if (gs.currentTurn !== botColor) return;

  // row_col → 2D board
  const board: Board = Array.from({length: 8}, () => Array(8).fill(null));

  const boardData = gs.board || {};
  for (const [key, val] of Object.entries(boardData)) {
    const parts = key.split("_");
    if (parts.length !== 2) continue;
    const row = parseInt(parts[0]);
    const col = parseInt(parts[1]);
    if (isNaN(row) || isNaN(col)) continue;
    const cellVal = val as { color: string; type: string };
    board[row][col] = { color: cellVal.color, isKing: cellVal.type === "KING" };
  }

  const moves = getValidMovesForColor(board, botColor);
  if (moves.length === 0) {
    await rdb().ref(`rooms/${roomId}/gameState`).update({
      isGameOver: true,
      winner: botColor === "WHITE" ? "BLACK" : "WHITE",
    });
    return;
  }

  // LEARNING: avval o'z darajasidagi haqiqiy g'oliblar kitobidan qaraymiz,
  // topilmasa — darajaga mos chuqurlikdagi Minimax
  // (require — circular import'ning oldini olish uchun)
  const { getBookMove } = require("./botLearning") as typeof import("./botLearning");
  let move: Move | null = null;
  try { move = getBookMove(level, board, botColor, moves); } catch { move = null; }
  if (move) {
    console.log(`[bot] level ${level}: playing learned move (from real winners)`);
  } else {
    move = selectBotMove(moves, style, board, botColor, depthForLevel(level));
  }
  const newBoard = applyMove(board, move);

  // Ketma-ket urish tekshiruvi
  const continueMoves = move.captured.length > 0
    ? getValidMovesForColor(newBoard, botColor).filter(
        m => m.from.row === move!.to.row && m.from.col === move!.to.col && m.captured.length > 0
      )
    : [];

  if (continueMoves.length > 0) {
    // Ketma-ket urishni davom ettirish (bu yerda ham kitobdan qaraymiz)
    let nextMove: Move | null = null;
    try { nextMove = getBookMove(level, newBoard, botColor, continueMoves); } catch { nextMove = null; }
    if (!nextMove) {
      nextMove = selectBotMove(continueMoves, style, newBoard, botColor, depthForLevel(level));
    }
    const finalBoard = applyMove(newBoard, nextMove);
    await saveBoard(finalBoard, botColor, roomId);
    return;
  }

  await saveBoard(newBoard, botColor, roomId);
}

async function saveBoard(board: Board, botColor: string, roomId: string): Promise<void> {
  const newBoardData: Record<string, { color: string; type: string }> = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p) newBoardData[`${r}_${c}`] = { color: p.color, type: p.isKing ? "KING" : "MAN" };
    }
  }

  const whitePieces = Object.values(newBoardData).filter(p => p.color === "WHITE").length;
  const blackPieces = Object.values(newBoardData).filter(p => p.color === "BLACK").length;
  const isGameOver  = whitePieces === 0 || blackPieces === 0;
  const winner      = whitePieces === 0 ? "BLACK" : blackPieces === 0 ? "WHITE" : null;
  const oppColor    = botColor === "WHITE" ? "BLACK" : "WHITE";

  await rdb().ref(`rooms/${roomId}/gameState`).update({
    board:      newBoardData,
    currentTurn: isGameOver ? botColor : oppColor,
    isGameOver,
    winner,
  });
}

// ── Eski format (2D board) ────────────────────
export async function makeBotMove(roomId: string, botUid: string, botColor: string, style: BotStyle): Promise<void> {
  const snap = await rdb().ref(`rooms/${roomId}/gameState`).get();
  if (!snap.exists) return;
  const gs = snap.val();
  if (!gs || gs.isGameOver || gs.currentTurn !== botColor) return;

  const board: Board = gs.board;
  const moves = getValidMovesForColor(board, botColor);
  if (moves.length === 0) {
    await rdb().ref(`rooms/${roomId}/gameState`).update({ isGameOver: true, winner: botColor === "WHITE" ? "BLACK" : "WHITE" });
    return;
  }

  const move = selectBotMove(moves, style, board, botColor);
  const newBoard = applyMove(board, move);
  const oppColor = botColor === "WHITE" ? "BLACK" : "WHITE";
  const whites = newBoard.flat().filter(p => p?.color === "WHITE").length;
  const blacks = newBoard.flat().filter(p => p?.color === "BLACK").length;
  const gameOver = whites === 0 || blacks === 0;

  await rdb().ref(`rooms/${roomId}/gameState`).update({
    board: newBoard,
    currentTurn: oppColor,
    isGameOver: gameOver,
    winner: gameOver ? (whites === 0 ? "BLACK" : "WHITE") : null,
  });
}
