// ─────────────────────────────────────────────
//  BotEngine — botlarning harakatlarini boshqaradi
// ─────────────────────────────────────────────
import * as admin from "firebase-admin";
import { BotProfile, BotStyle } from "./botProfiles";

const db  = () => admin.firestore();
const rdb = () => admin.database();

// ── Shashka dona harakat hisoblash (soddalashtirilgan) ────────
// Serverda to'liq GameEngine mavjud emas, shuning uchun
// RTDB da saqlangan gameState dan harakatni tanlaymiz.

export interface Position { row: number; col: number; }
export interface Move { from: Position; to: Position; captured: Position[]; }

type Board = Array<Array<{ piece: { color: string; isKing: boolean } | null }>>;

export function getValidMovesForColor(board: Board, color: string): Move[] {
  const captures: Move[] = [];
  const simple: Move[]   = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const cell = board[row]?.[col];
      if (!cell?.piece || cell.piece.color !== color) continue;

      const piece  = cell.piece;
      const isKing = piece.isKing;
      const fwd    = color === "WHITE" ? -1 : 1;
      const dirs   = isKing
        ? [[-1,-1],[-1,1],[1,-1],[1,1]]
        : [[fwd,-1],[fwd,1],[-fwd,-1],[-fwd,1]]; // orqaga ham yutish mumkin

      for (const [dr, dc] of dirs) {
        const mr = row + dr; const mc = col + dc;
        const lr = row + dr*2; const lc = col + dc*2;
        const mid = board[mr]?.[mc];
        const land = board[lr]?.[lc];
        if (mid?.piece && mid.piece.color !== color && land && !land.piece && lr >= 0 && lr < 8 && lc >= 0 && lc < 8) {
          captures.push({ from:{row,col}, to:{row:lr,col:lc}, captured:[{row:mr,col:mc}] });
        }
      }
      const simpleDirs = isKing ? [[-1,-1],[-1,1],[1,-1],[1,1]] : [[fwd,-1],[fwd,1]];
      for (const [dr, dc] of simpleDirs) {
        const nr = row + dr; const nc = col + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && !board[nr]?.[nc]?.piece) {
          simple.push({ from:{row,col}, to:{row:nr,col:nc}, captured:[] });
        }
      }
    }
  }
  return captures.length > 0 ? captures : simple;
}

// ── Bot uchun eng yaxshi harakatni tanlash ───────────────────
export function selectBotMove(moves: Move[], style: BotStyle, board: Board, botColor: string): Move {
  if (moves.length === 0) throw new Error("No valid moves");
  if (moves.length === 1) return moves[0];

  // Majburiy yutish — har doim eng ko'p dona yutuvchi tanlanadi
  const captureMoves = moves.filter(m => m.captured.length > 0);
  if (captureMoves.length > 0) {
    const best = captureMoves.reduce((a, b) => a.captured.length >= b.captured.length ? a : b);
    return best;
  }

  // Har xil uslublar
  switch (style) {
    case "aggressive": {
      // Raqib donalariga eng yaqin yurish
      const oppColor = botColor === "WHITE" ? "BLACK" : "WHITE";
      return moves.reduce((best, move) => {
        const d1 = minDistToOpponent(move.to, board, oppColor);
        const d2 = minDistToOpponent(best.to, board, oppColor);
        return d1 < d2 ? move : best;
      });
    }
    case "defensive": {
      // Chekkaga, himoya pozitsiyasiga
      return moves.reduce((best, move) => {
        const s1 = defenseScore(move.to, botColor);
        const s2 = defenseScore(best.to, botColor);
        return s1 > s2 ? move : best;
      });
    }
    case "beginner": {
      // Ba'zan xato qiladi — tasodifiy
      if (Math.random() < 0.35) return moves[Math.floor(Math.random() * moves.length)];
      return moves[0];
    }
    case "random":
      return moves[Math.floor(Math.random() * moves.length)];
    case "balanced":
    default: {
      // Shoh bo'lishga intilish
      const kingMoves = moves.filter(m =>
        (botColor === "WHITE" && m.to.row === 0) ||
        (botColor === "BLACK" && m.to.row === 7)
      );
      if (kingMoves.length > 0) return kingMoves[0];
      return moves[Math.floor(Math.random() * moves.length)];
    }
  }
}

function minDistToOpponent(pos: Position, board: Board, oppColor: string): number {
  let minDist = 999;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r]?.[c]?.piece?.color === oppColor) {
        const d = Math.abs(pos.row - r) + Math.abs(pos.col - c);
        if (d < minDist) minDist = d;
      }
    }
  }
  return minDist;
}

function defenseScore(pos: Position, color: string): number {
  // Chet tomonlar va oxirgi qator ko'proq ball
  const edgeBonus = (pos.col === 0 || pos.col === 7) ? 2 : 0;
  const backRank  = color === "WHITE" ? pos.row : (7 - pos.row);
  return edgeBonus + backRank;
}

// ── Bot Firestore ga yozilishi ────────────────────────────────
export async function seedBotToFirestore(bot: BotProfile): Promise<void> {
  const ref = db().collection("users").doc(bot.uid);
  const snap = await ref.get();
  if (snap.exists) return; // Allaqachon bor

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
    peakRating:       bot.rating + Math.floor(Math.random() * 80),
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
    isBot:            true, // Ichki belgi — UI da ko'rsatilmaydi
    createdAt:        Date.now() - Math.floor(Math.random() * 90 * 86400000),
    lastSeenAt:       Date.now() - Math.floor(Math.random() * 3600000),
  });
}

// ── Bot o'yin harakatini RTDB ga yuborish ────────────────────
export async function makeBotMove(roomId: string, botUid: string, botColor: string, style: BotStyle): Promise<void> {
  const gameStateSnap = await rdb().ref(`rooms/${roomId}/gameState`).get();
  if (!gameStateSnap.exists) return;

  const gs = gameStateSnap.val();
  if (!gs || gs.isGameOver) return;
  if (gs.currentTurn !== botColor) return;

  const board: Board = gs.board;
  const moves = getValidMovesForColor(board, botColor);
  if (moves.length === 0) {
    // Bot yutqazdi
    await rdb().ref(`rooms/${roomId}/gameState`).update({
      isGameOver: true,
      winner: botColor === "WHITE" ? "BLACK" : "WHITE",
    });
    return;
  }

  const move = selectBotMove(moves, style, board, botColor);

  // Harakatni apply qilish
  const newBoard: Board = board.map(row => row.map(cell => ({ ...cell })));

  // Donani ko'chirish
  const piece = newBoard[move.from.row][move.from.col].piece!;
  newBoard[move.from.row][move.from.col].piece = null;
  move.captured.forEach(c => { newBoard[c.row][c.col].piece = null; });

  // Shoh bo'lishini tekshirish
  const becomeKing = !piece.isKing &&
    ((piece.color === "WHITE" && move.to.row === 0) ||
     (piece.color === "BLACK" && move.to.row === 7));
  newBoard[move.to.row][move.to.col].piece = { ...piece, isKing: piece.isKing || becomeKing };

  const oppColor = botColor === "WHITE" ? "BLACK" : "WHITE";

  // G'alaba tekshiruvi
  const whitePieces = newBoard.flat().filter(c => c.piece?.color === "WHITE").length;
  const blackPieces = newBoard.flat().filter(c => c.piece?.color === "BLACK").length;

  let isGameOver = false;
  let winner: string | null = null;
  if (whitePieces === 0) { isGameOver = true; winner = "BLACK"; }
  else if (blackPieces === 0) { isGameOver = true; winner = "WHITE"; }

  // Captured count
  const capturedWhite = (gs.capturedWhite || 0) + move.captured.filter((c: Position) => board[c.row]?.[c.col]?.piece?.color === "WHITE").length;
  const capturedBlack = (gs.capturedBlack || 0) + move.captured.filter((c: Position) => board[c.row]?.[c.col]?.piece?.color === "BLACK").length;

  await rdb().ref(`rooms/${roomId}/gameState`).update({
    board:         newBoard,
    currentTurn:  oppColor,
    selectedCell: null,
    validMoves:   [],
    capturedWhite,
    capturedBlack,
    isGameOver,
    winner,
    mustCaptureFrom: null,
  });
}

// ── Yangi format uchun bot harakat (row_col key format) ────────
export async function makeBotMoveNewFormat(roomId: string, botColor: string, style: BotStyle): Promise<void> {
  const gameStateSnap = await rdb().ref(`rooms/${roomId}/gameState`).get();
  if (!gameStateSnap.exists()) return;

  const gs = gameStateSnap.val();
  if (!gs || gs.isGameOver) return;
  if (gs.currentTurn !== botColor) return;

  // row_col formatdan 2D board ga o'tkazish
  const board: Board = Array.from({length: 8}, () =>
    Array.from({length: 8}, () => ({ piece: null as { color: string; isKing: boolean } | null }))
  );

  const boardData = gs.board || {};
  for (const [key, val] of Object.entries(boardData)) {
    const parts = key.split('_');
    if (parts.length !== 2) continue;
    const row = parseInt(parts[0]);
    const col = parseInt(parts[1]);
    if (isNaN(row) || isNaN(col)) continue;
    const cellVal = val as { color: string; type: string };
    board[row][col].piece = {
      color: cellVal.color,
      isKing: cellVal.type === 'KING'
    };
  }

  const moves = getValidMovesForColor(board, botColor);
  if (moves.length === 0) {
    await rdb().ref(`rooms/${roomId}/gameState`).update({
      isGameOver: true,
      winner: botColor === 'WHITE' ? 'BLACK' : 'WHITE',
    });
    return;
  }

  const move = selectBotMove(moves, style, board, botColor);

  // Harakatni apply qilish
  const piece = board[move.from.row][move.from.col].piece!;
  board[move.from.row][move.from.col].piece = null;
  move.captured.forEach(c => { board[c.row][c.col].piece = null; });

  const becomeKing = !piece.isKing &&
    ((piece.color === 'WHITE' && move.to.row === 0) ||
     (piece.color === 'BLACK' && move.to.row === 7));
  board[move.to.row][move.to.col].piece = { ...piece, isKing: piece.isKing || becomeKing };

  // 2D board dan row_col formatga qaytarish
  const newBoardData: Record<string, { color: string; type: string }> = {};
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c].piece;
      if (p) {
        newBoardData[`${r}_${c}`] = {
          color: p.color,
          type: p.isKing ? 'KING' : 'MAN'
        };
      }
    }
  }

  const whitePieces = Object.values(newBoardData).filter(p => p.color === 'WHITE').length;
  const blackPieces = Object.values(newBoardData).filter(p => p.color === 'BLACK').length;
  const isGameOver = whitePieces === 0 || blackPieces === 0;
  const winner = whitePieces === 0 ? 'BLACK' : blackPieces === 0 ? 'WHITE' : null;
  const oppColor = botColor === 'WHITE' ? 'BLACK' : 'WHITE';

  await rdb().ref(`rooms/${roomId}/gameState`).update({
    board: newBoardData,
    currentTurn: isGameOver ? botColor : oppColor,
    isGameOver,
    winner,
  });
}
