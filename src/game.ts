// ─────────────────────────────────────────────
//  O'yin natijalari
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

// POST /game/submit
router.post("/submit", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const callerUid = req.uid!;
    const { roomId, result } = req.body as { roomId: string; result: GameResult };

    if (!roomId || !["win", "loss", "draw"].includes(result)) {
      res.status(400).json({ error: "invalid-argument", message: "roomId and result required" });
      return;
    }

    const roomRef  = db().collection("rooms").doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      res.status(404).json({ error: "not-found", message: "Room not found" });
      return;
    }

    const room = roomSnap.data()!;

    if (room.player1Uid !== callerUid && room.player2Uid !== callerUid) {
      res.status(403).json({ error: "permission-denied", message: "Not your game" });
      return;
    }

    if (room.status === "FINISHED") {
      res.json({ ok: true, message: "Already finished" });
      return;
    }

    const stake: number = room.stakeCoin ?? 0;
    if (stake > 0 && !VALID_STAKES.includes(stake)) {
      res.status(400).json({ error: "invalid-argument", message: "Invalid stake amount" });
      return;
    }

    const opponentUid = room.player1Uid === callerUid ? room.player2Uid : room.player1Uid;

    const resultRef = roomRef.collection("results").doc(callerUid);
    const existingResult = await resultRef.get();
    if (existingResult.exists) {
      res.json({ ok: true, message: "Already submitted" });
      return;
    }
    await resultRef.set({ result, submittedAt: Date.now() });

    const opponentResultSnap = await roomRef.collection("results").doc(opponentUid).get();
    if (!opponentResultSnap.exists) {
      res.json({ ok: true, message: "Waiting for opponent result" });
      return;
    }

    const opponentResult = opponentResultSnap.data()!.result as GameResult;

    const isConsistent =
      (result === "win"  && opponentResult === "loss") ||
      (result === "loss" && opponentResult === "win")  ||
      (result === "draw" && opponentResult === "draw");

    if (!isConsistent) {
      console.warn("Result conflict", { roomId, callerUid, result, opponentResult });
    }

    // Ikki o'yinchining ratingini olish
    const [callerSnap, opponentSnap] = await Promise.all([
      db().collection("users").doc(callerUid).get(),
      db().collection("users").doc(opponentUid).get(),
    ]);
    const callerRating   = (callerSnap.data()   as UserDoc)?.rating ?? 0;
    const opponentRating = (opponentSnap.data() as UserDoc)?.rating ?? 0;

    const batch = db().batch();
    await applyResult(batch, callerUid,   result,         stake, callerRating,   opponentRating);
    await applyResult(batch, opponentUid, opponentResult, stake, opponentRating, callerRating);

    batch.update(roomRef, {
      status:    "FINISHED",
      winnerId:  result === "win" ? callerUid : result === "loss" ? opponentUid : null,
      finishedAt: Date.now(),
    });

    if (result === "win") {
      const userSnap = await db().collection("users").doc(callerUid).get();
      const clubId = userSnap.data()?.clubId as string | undefined;
      if (clubId) {
        batch.update(db().collection("clubs").doc(clubId), {
          totalWins:  admin.firestore.FieldValue.increment(1),
          totalGames: admin.firestore.FieldValue.increment(1),
          weeklyWins: admin.firestore.FieldValue.increment(1),
        });
      }
    }

    await batch.commit();
    res.json({ ok: true });
  } catch (err) {
    console.error("submitGameResult error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

async function applyResult(
  batch: FirebaseFirestore.WriteBatch,
  uid: string,
  result: GameResult,
  stake: number,
  myRating: number,
  opponentRating: number
): Promise<void> {
  const userRef  = db().collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return;
  const user = userSnap.data() as UserDoc;

  let coinsDelta = 0;
  let xpGain     = 0;
  let eloDelta   = 0;
  let streakNew  = user.currentWinStreak;

  switch (result) {
    case "win":
      coinsDelta = stake > 0 ? stake * 2 + WIN_BASE_BONUS : WIN_BASE_BONUS;
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

  batch.update(userRef, update);
}

export default router;
