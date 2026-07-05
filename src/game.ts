// ─────────────────────────────────────────────
//  O'yin natijalari (anti-cheat versiya, v3)
//
//  KRITIK FIX: xonalar matchmaking'da Realtime Database'da yaratiladi,
//  lekin eski kod ularni Firestore'dan qidirardi — natijada har doim
//  "Room not found" bo'lib, tanga/reyting HECH QACHON hisoblanmagan.
//  Endi xona RTDB'dan o'qiladi.
//
//  Boshqa himoyalar (v1 dan):
//  1. Natijalar mos kelmasa — hech kimga to'lov yo'q, xona DISPUTED.
//  2. Hisob-kitob Firestore transaction'da — ikki marta hisoblanmaydi.
//  3. Tanga formulasi: g'olib +stake (+bonus), yutqazgan -stake.
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
const db  = () => admin.firestore();
const rdb = () => admin.database();

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

    // ── FIX: xona Realtime Database'da turadi ──
    const roomSnap = await rdb().ref(`rooms/${roomId}`).get();
    if (!roomSnap.exists()) {
      res.status(404).json({ error: "not-found", message: "Room not found" });
      return;
    }
    const room = roomSnap.val();

    if (room.player1Uid !== callerUid && room.player2Uid !== callerUid) {
      res.status(403).json({ error: "permission-denied", message: "Not your game" });
      return;
    }

    const stake: number = room.stakeCoin ?? 0;
    if (stake > 0 && !VALID_STAKES.includes(stake)) {
      res.status(400).json({ error: "invalid-argument", message: "Invalid stake amount" });
      return;
    }

    const opponentUid =
      room.player1Uid === callerUid ? room.player2Uid : room.player1Uid;

    // Hisob-kitob holati Firestore'da saqlanadi (transaction uchun)
    const settleRef = db().collection("gameSettlements").doc(roomId);

    const outcome: SubmitOutcome = await db().runTransaction(async (tx) => {
      // ── 1. Barcha o'qishlar (Firestore tx qoidasi: avval read, keyin write) ──
      const myResultRef  = settleRef.collection("results").doc(callerUid);
      const oppResultRef = settleRef.collection("results").doc(opponentUid);

      const [settleSnap, mySnap, oppSnap, callerUserSnap, oppUserSnap] = await Promise.all([
        tx.get(settleRef),
        tx.get(myResultRef),
        tx.get(oppResultRef),
        tx.get(db().collection("users").doc(callerUid)),
        tx.get(db().collection("users").doc(opponentUid)),
      ]);

      const settleStatus = settleSnap.exists ? settleSnap.data()!.status : null;
      if (settleStatus === "FINISHED" || settleStatus === "DISPUTED") {
        return { code: 200, body: { ok: true, message: "Already finished" } };
      }

      if (mySnap.exists) {
        return { code: 200, body: { ok: true, message: "Already submitted" } };
      }

      // ── 2. Yozishlar ──
      tx.set(myResultRef, { result, submittedAt: Date.now() });

      if (!oppSnap.exists) {
        // Raqib natija yubormagan (ilovadan chiqib ketgan / interneti uzilgan
        // bo'lishi mumkin). RTDB'dagi gameState yuborilgan natijani TASDIQLASA,
        // bir tomonlama yakunlaymiz — aks holda o'yin abadiy WAITING'da qolib,
        // hech kimning tanga/reytingi o'zgarmasdi.
        const gs = room.gameState;
        const callerColor = room.player1Uid === callerUid ? "WHITE" : "BLACK";
        let derived: GameResult | null = null;
        if (gs && gs.isGameOver === true) {
          derived =
            gs.winner == null ? "draw"
            : gs.winner === callerColor ? "win"
            : "loss";
        }

        if (derived !== null && derived === result) {
          const opponentResult: GameResult =
            result === "win" ? "loss" : result === "loss" ? "win" : "draw";

          const callerRating   = (callerUserSnap.data()   as UserDoc)?.rating ?? 0;
          const opponentRating = (oppUserSnap.data() as UserDoc)?.rating ?? 0;

          applyResult(tx, callerUserSnap, result,         stake, callerRating,   opponentRating);
          applyResult(tx, oppUserSnap,   opponentResult, stake, opponentRating, callerRating);

          tx.set(settleRef, {
            status: "FINISHED",
            roomId,
            singleSided: true,
            winnerId: result === "win" ? callerUid : result === "loss" ? opponentUid : null,
            finishedAt: Date.now(),
          }, { merge: true });

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

          return { code: 200, body: { ok: true, singleSided: true } };
        }

        tx.set(settleRef, { status: "WAITING", roomId, updatedAt: Date.now() }, { merge: true });
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
        tx.set(settleRef, {
          status: "DISPUTED",
          roomId,
          disputedAt: Date.now(),
          disputeInfo: {
            [callerUid]: result,
            [opponentUid]: opponentResult,
          },
        }, { merge: true });
        return { code: 200, body: { ok: true, disputed: true, message: "Result conflict — no rewards" } };
      }

      // ── 3. Mos natija — hisob-kitob ──
      const callerRating   = (callerUserSnap.data()   as UserDoc)?.rating ?? 0;
      const opponentRating = (oppUserSnap.data() as UserDoc)?.rating ?? 0;

      applyResult(tx, callerUserSnap, result,         stake, callerRating,   opponentRating);
      applyResult(tx, oppUserSnap,   opponentResult, stake, opponentRating, callerRating);

      tx.set(settleRef, {
        status: "FINISHED",
        roomId,
        winnerId: result === "win" ? callerUid : result === "loss" ? opponentUid : null,
        finishedAt: Date.now(),
      }, { merge: true });

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

    // RTDB'dagi xonani ham yangilab qo'yamiz (tx'dan tashqarida, muhim emas)
    if (outcome.code === 200 && (outcome.body.ok as boolean)) {
      try {
        await rdb().ref(`rooms/${roomId}`).update({ status: "FINISHED" });
      } catch { /* e'tiborsiz */ }
    }

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
      // Tikuv matchmaking'da yechilmaydi: g'olib raqibdan +stake oladi.
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
