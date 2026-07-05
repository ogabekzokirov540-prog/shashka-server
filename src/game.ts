// ─────────────────────────────────────────────
//  O'yin natijalari (anti-cheat versiya)
//
//  O'zgarishlar:
//  1. Natijalar MOS KELMASA (masalan ikkalasi ham "win") — hech kimga
//     tanga/XP/reyting berilmaydi, xona DISPUTED deb belgilanadi.
//     (Eski kod faqat console.warn qilib, baribir to'lab yuborardi.)
//  2. Butun hisob-kitob Firestore transaction ichida — ikkala so'rov
//     bir vaqtda kelsa ham faqat BIR marta hisoblanadi.
//  3. Tanga formulasi to'g'irlandi: matchmaking'da tikuv yechilmaydi,
//     shuning uchun g'olib +stake oladi (stake*2 emas!), yutqazgan -stake.
//     Eski formula har o'yinda tizimga havodan +stake tanga qo'shardi.
// ─────────────────────────────────────────────
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import {
  XP_WIN, XP_LOSS, XP_DRAW,
  WIN_BASE_BONUS, VALID_STAKES,
  levelFromXp, calcElo,
} from "./config";
import { GameResult, UserDoc } from "./types";
import { requireAuth, AuthRequest } from "./middleware";

const router = Router();
const db = () => admin.firestore();

type SubmitOutcome = {
  code: number;
  body: Record<string, unknown>;
};

// POST /game/submit
router.post("/submit", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const callerUid = req.uid!;
    const { roomId, result } = req.body as { roomId: string; result: GameResult };

    if (!roomId || !["win", "loss", "draw"].includes(result)) {
      res.status(400).json({ error: "invalid-argument", message: "roomId and result required" });
      return;
    }

    const roomRef = db().collection("rooms").doc(roomId);

    const outcome: SubmitOutcome = await db().runTransaction(async (tx) => {
      // ── 1. Barcha o'qishlar (Firestore tx qoidasi: avval read, keyin write) ──
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists) {
        return { code: 404, body: { error: "not-found", message: "Room not found" } };
      }

      const room = roomSnap.data()!;

      if (room.player1Uid !== callerUid && room.player2Uid !== callerUid) {
        return { code: 403, body: { error: "permission-denied", message: "Not your game" } };
      }

      if (room.status === "FINISHED" || room.status === "DISPUTED") {
        return { code: 200, body: { ok: true, message: "Already finished" } };
      }

      const stake: number = room.stakeCoin ?? 0;
      if (stake > 0 && !VALID_STAKES.includes(stake)) {
        return { code: 400, body: { error: "invalid-argument", message: "Invalid stake amount" } };
      }

      const opponentUid =
        room.player1Uid === callerUid ? room.player2Uid : room.player1Uid;

      const myResultRef  = roomRef.collection("results").doc(callerUid);
      const oppResultRef = roomRef.collection("results").doc(opponentUid);

      const [mySnap, oppSnap, callerUserSnap, oppUserSnap] = await Promise.all([
        tx.get(myResultRef),
        tx.get(oppResultRef),
        tx.get(db().collection("users").doc(callerUid)),
        tx.get(db().collection("users").doc(opponentUid)),
      ]);

      if (mySnap.exists) {
        return { code: 200, body: { ok: true, message: "Already submitted" } };
      }

      // ── 2. Yozishlar ──
      tx.set(myResultRef, { result, submittedAt: Date.now() });

      if (!oppSnap.exists) {
        return { code: 200, body: { ok: true, message: "Waiting for opponent result" } };
      }

      const opponentResult = oppSnap.data()!.result as GameResult;

      const isConsistent =
        (result === "win"  && opponentResult === "loss") ||
        (result === "loss" && opponentResult === "win")  ||
        (result === "draw" && opponentResult === "draw");

      if (!isConsistent) {
        // ANTI-CHEAT: natijalar mos emas — hech kimga hech narsa berilmaydi.
        console.warn("Result conflict — room DISPUTED", {
          roomId, callerUid, result, opponentUid, opponentResult,
        });
        tx.update(roomRef, {
          status: "DISPUTED",
          disputedAt: Date.now(),
          disputeInfo: {
            [callerUid]: result,
            [opponentUid]: opponentResult,
          },
        });
        return { code: 200, body: { ok: true, disputed: true, message: "Result conflict — no rewards" } };
      }

      // ── 3. Mos natija — hisob-kitob ──
      const callerRating   = (callerUserSnap.data()   as UserDoc)?.rating ?? 0;
      const opponentRating = (oppUserSnap.data() as UserDoc)?.rating ?? 0;

      applyResult(tx, callerUserSnap, result,         stake, callerRating,   opponentRating);
      applyResult(tx, oppUserSnap,   opponentResult, stake, opponentRating, callerRating);

      tx.update(roomRef, {
        status: "FINISHED",
        winnerId: result === "win" ? callerUid : result === "loss" ? opponentUid : null,
        finishedAt: Date.now(),
      });

      // Klub statistikasi (g'olibning klubi bo'lsa)
      if (result !== "draw") {
        const winnerSnap = result === "win" ? callerUserSnap : oppUserSnap;
        const clubId = winnerSnap.data()?.clubId as string | undefined;
        if (clubId) {
          tx.update(db().collection("clubs").doc(clubId), {
            totalWins:  admin.firestore.FieldValue.increment(1),
            totalGames: admin.firestore.FieldValue.increment(1),
            weeklyWins: admin.firestore.FieldValue.increment(1),
          });
        }
      }

      return { code: 200, body: { ok: true } };
    });

    res.status(outcome.code).json(outcome.body);
  } catch (err) {
    console.error("submitGameResult error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

function applyResult(
  tx: FirebaseFirestore.Transaction,
  userSnap: FirebaseFirestore.DocumentSnapshot,
  result: GameResult,
  stake: number,
  myRating: number,
  opponentRating: number
): void {
  if (!userSnap.exists) return;
  const user = userSnap.data() as UserDoc;

  let coinsDelta = 0;
  let xpGain     = 0;
  let eloDelta   = 0;
  let streakNew  = user.currentWinStreak;

  switch (result) {
    case "win":
      // COIN FIX: tikuv matchmaking'da yechilmaydi, shuning uchun g'olib
      // raqibdan +stake oladi (stake*2 EMAS — eski formula tizimga
      // havodan tanga qo'shardi).
      coinsDelta = stake > 0 ? stake + WIN_BASE_BONUS : WIN_BASE_BONUS;
      xpGain     = XP_WIN;
      eloDelta   = calcElo(myRating, opponentRating, 1);
      streakNew  = user.currentWinStreak + 1;
      break;
    case "loss":
      coinsDelta = stake > 0 ? -stake : 0;
      xpGain     = XP_LOSS;
      eloDelta   = calcElo(myRating, opponentRating, 0);
      streakNew  = 0;
      break;
    case "draw":
      coinsDelta = 0;
      xpGain     = XP_DRAW;
      eloDelta   = calcElo(myRating, opponentRating, 0.5);
      streakNew  = 0;
      break;
  }

  const newXp      = user.xp + xpGain;
  const newLevel   = levelFromXp(newXp);
  const newRating  = Math.max(-100, user.rating + eloDelta);
  const newPeak    = Math.max(user.peakRating ?? 0, newRating);
  const newLongest = Math.max(user.longestWinStreak ?? 0, streakNew);

  const update: Partial<Record<string, unknown>> = {
    xp:               newXp,
    level:            newLevel,
    rating:           newRating,
    peakRating:       newPeak,
    currentWinStreak: streakNew,
    longestWinStreak: newLongest,
    totalGames:       admin.firestore.FieldValue.increment(1),
    coins:            admin.firestore.FieldValue.increment(coinsDelta),
  };

  if (result === "win") {
    update.wins = admin.firestore.FieldValue.increment(1);
    if (stake > 0) update.totalCoinsWon = admin.firestore.FieldValue.increment(coinsDelta);
  } else if (result === "loss") {
    update.losses = admin.firestore.FieldValue.increment(1);
  } else {
    update.draws = admin.firestore.FieldValue.increment(1);
  }

  if (stake > 0) {
    update.totalCoinsWagered = admin.firestore.FieldValue.increment(stake);
  }

  tx.update(userSnap.ref, update);
}

export default router;
