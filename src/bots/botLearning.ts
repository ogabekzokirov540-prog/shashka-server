// ─────────────────────────────────────────────
//  Bot Learning — real o'yinchilarning YUTGAN o'yinlaridan o'rganish
//
//  Qanday ishlaydi:
//  1. Har 6 soatda Firestore'dagi replaylarni tahlil qiladi
//     (faqat result == "win" — g'olibning yurishlari).
//  2. Har bir o'yinchi o'z LEVELiga qarab guruhga (bracket) ajratiladi:
//     1-4, 5-8, 9-12, 13-16, 17-20, 21+.
//  3. G'olib har bir pozitsiyada qaysi yurishni qilgani "kitob"ga yoziladi.
//  4. Bot o'yin paytida o'z darajasi guruhining kitobidan qaraydi —
//     pozitsiya topilsa, xuddi o'sha darajadagi haqiqiy g'oliblar kabi yuradi.
// ─────────────────────────────────────────────
import * as admin from "firebase-admin";
import { getValidMovesForColor, Move } from "./botEngine";
import { isBotUid } from "./botProfiles";

const db = () => admin.firestore();

type Piece = { color: string; isKing: boolean } | null;
type Board = Piece[][];

// bracket → posKey → moveKey → count
const books = new Map<number, Map<string, Map<string, number>>>();
let lastBuildAt = 0;

const REBUILD_EVERY_MS = 60 * 60 * 1000;     // har 1 soatda qayta o'rganish (o'yinchi kam paytda tezroq)
const MAX_PLAYERS_PER_BUILD = 200;           // bitta buildda nechta o'yinchi
const GAMES_PER_PLAYER = 30;                 // har o'yinchidan nechta o'yin (yutgan+yutqazgan)
const BOOK_MOVE_PROBABILITY = 0.85;          // kitobdan yurish ehtimoli (xilma-xillik uchun 100% emas)

// ── Level → guruh (bracket) ───────────────────
export function levelBracket(level: number): number {
  // 1-4 → 0, 5-8 → 1, 9-12 → 2, 13-16 → 3, 17-20 → 4, 21+ → 5
  return Math.min(5, Math.floor((Math.max(1, level) - 1) / 4));
}

// ── Pozitsiya va yurish kalitlari ─────────────
function posKey(board: Board, turnColor: string): string {
  let s = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      s += !p ? "." : p.color === "WHITE" ? (p.isKing ? "W" : "w") : (p.isKing ? "B" : "b");
    }
  }
  return s + ":" + turnColor[0];
}

function moveKey(m: { from: { row: number; col: number }; to: { row: number; col: number } }): string {
  return `${m.from.row},${m.from.col}>${m.to.row},${m.to.col}`;
}

// ── Board utillari (botEngine bilan bir xil qoidalar) ──
function initialBoard(): Board {
  const b: Board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 === 1) b[r][c] = { color: "BLACK", isKing: false };
  for (let r = 5; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 === 1) b[r][c] = { color: "WHITE", isKing: false };
  return b;
}

function cloneBoard(board: Board): Board {
  return board.map(row => row.map(p => (p ? { ...p } : null)));
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

// ── Bitta replayni tahlil qilish ──────────────
function analyzeReplay(
  target: Map<number, Map<string, Map<string, number>>>,
  bracket: number,
  winnerColor: string,
  moves: Array<Record<string, unknown>>
): void {
  let board = initialBoard();
  let turn = "WHITE";

  for (const raw of moves) {
    const fromRow = Number(raw.fromRow), fromCol = Number(raw.fromCol);
    const toRow   = Number(raw.toRow),   toCol   = Number(raw.toCol);
    if ([fromRow, fromCol, toRow, toCol].some(isNaN)) break;

    const legal = getValidMovesForColor(board, turn);
    const mv = legal.find(m =>
      m.from.row === fromRow && m.from.col === fromCol &&
      m.to.row === toRow && m.to.col === toCol
    );
    if (!mv) break; // qoidaga mos kelmadi — replayni tashlaymiz

    // Faqat G'OLIBNING yurishlarini eslab qolamiz
    if (turn === winnerColor) {
      let book = target.get(bracket);
      if (!book) { book = new Map(); target.set(bracket, book); }
      const pk = posKey(board, turn);
      let entry = book.get(pk);
      if (!entry) { entry = new Map(); book.set(pk, entry); }
      const mk = moveKey(mv);
      entry.set(mk, (entry.get(mk) ?? 0) + 1);
    }

    board = applyMove(board, mv);

    // Ketma-ket urish — navbat o'zgarmaydi
    const canContinue = mv.captured.length > 0 &&
      getValidMovesForColor(board, turn).some(m =>
        m.from.row === mv.to.row && m.from.col === mv.to.col && m.captured.length > 0
      );
    if (!canContinue) turn = turn === "WHITE" ? "BLACK" : "WHITE";
  }
}

// ── Kitoblarni qayta qurish ───────────────────
export async function rebuildBooks(): Promise<void> {
  try {
    const started = Date.now();
    const newBooks = new Map<number, Map<string, Map<string, number>>>();
    let gamesAnalyzed = 0;
    let positionsLearned = 0;

    // replays/{uid} hujjatlarini olib chiqamiz (virtual parentlar ham keladi)
    const parents = await db().collection("replays").listDocuments();

    for (const parent of parents.slice(0, MAX_PLAYERS_PER_BUILD)) {
      const uid = parent.id;
      if (isBotUid(uid)) continue; // botlar bir-biridan o'rganmasin

      const userSnap = await db().collection("users").doc(uid).get();
      const userData = userSnap.data();
      if (!userData || userData.isBot === true) continue;
      const level = (userData.level as number) ?? 1;
      const bracket = levelBracket(level);

      const snap = await parent.collection("games")
        .limit(GAMES_PER_PLAYER)
        .get();

      for (const doc of snap.docs) {
        const myColor = doc.get("myColor") as string;
        const result = doc.get("result") as string;
        const rawMoves = (doc.get("moves") as Array<Record<string, unknown>>) ?? [];
        if (!myColor || rawMoves.length < 4) continue; // juda qisqa o'yinlar foydasiz
        if (result !== "win" && result !== "loss") continue; // durang — o'rganilmaydi

        // Har replayda IKKALA tomon yurishlari bor. G'OLIB tomonni o'rganamiz:
        // - result=="win"  → replay egasi g'olib (odam)
        // - result=="loss" → RAQIB g'olib (ko'pincha bot!) — uning yurishlari
        //   ham kitobga kiradi. Shu tufayli bot-odam o'yinlari ham tahlil
        //   qilinadi va ma'lumot ikki baravar tez to'planadi.
        const winnerColor =
          result === "win" ? myColor : (myColor === "WHITE" ? "BLACK" : "WHITE");

        const sorted = rawMoves.slice().sort(
          (a, b) => Number(a.moveNumber ?? 0) - Number(b.moveNumber ?? 0)
        );
        analyzeReplay(newBooks, bracket, winnerColor, sorted);
        gamesAnalyzed++;
      }
    }

    // Eski kitoblarni yangisi bilan almashtiramiz
    books.clear();
    for (const [k, v] of newBooks) {
      books.set(k, v);
      for (const entry of v.values()) positionsLearned += entry.size;
    }
    lastBuildAt = Date.now();
    console.log(
      `[botLearning] Rebuilt in ${Date.now() - started}ms: ` +
      `${gamesAnalyzed} winning games, ${positionsLearned} learned moves, ` +
      `brackets: [${[...books.keys()].sort().join(", ")}]`
    );
  } catch (e) {
    console.error("[botLearning] rebuild error:", e);
  }
}

// ── O'yin paytida kitobdan yurish olish ───────
// Bot darajasiga mos guruh kitobidan joriy pozitsiyani qidiradi.
// Bir nechta variant bo'lsa — qancha ko'p o'ynalgan bo'lsa, shuncha
// katta ehtimol bilan tanlanadi (haqiqiy o'yinchilar taqsimoti).
export function getBookMove(
  level: number,
  board: Board,
  color: string,
  legalMoves: Move[]
): Move | null {
  if (books.size === 0) return null;
  if (Math.random() > BOOK_MOVE_PROBABILITY) return null;

  const book = books.get(levelBracket(level));
  if (!book) return null;

  const entry = book.get(posKey(board, color));
  if (!entry) return null;

  const candidates: { m: Move; w: number }[] = [];
  for (const m of legalMoves) {
    const w = entry.get(moveKey(m));
    if (w) candidates.push({ m, w });
  }
  if (candidates.length === 0) return null;

  const total = candidates.reduce((s, c) => s + c.w, 0);
  let r = Math.random() * total;
  for (const c of candidates) {
    r -= c.w;
    if (r <= 0) return c.m;
  }
  return candidates[0].m;
}

// ── Ishga tushirish (index.ts dan chaqiriladi) ──
export function startBotLearning(): void {
  rebuildBooks(); // start'da darhol
  setInterval(rebuildBooks, REBUILD_EVERY_MS); // keyin har 6 soatda
  console.log("[botLearning] Started — learning winner moves (incl. bot wins) every 1h");
}
