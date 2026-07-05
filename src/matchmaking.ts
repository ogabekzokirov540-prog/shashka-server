// ─────────────────────────────────────────────
//  Matchmaking
// ─────────────────────────────────────────────
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { VALID_STAKES } from "./config";
import { requireAuth, AuthRequest } from "./middleware";
import { scheduleBotsForMatchmaking, cancelBotTimer } from "./bots/botMatchmaking";

const router = Router();
const db  = () => admin.firestore();
const rdb = () => admin.database();

// POST /matchmaking/find
router.post("/find", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    const { stakeCoin } = req.body as { stakeCoin: number };

    if (!VALID_STAKES.includes(stakeCoin)) {
      res.status(400).json({ error: "invalid-argument", message: "Invalid stake. Allowed: 50, 200, 1000, 5000, 10000" });
      return;
    }

    const userSnap = await db().collection("users").doc(uid).get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "not-found", message: "User not found" });
      return;
    }
    const user = userSnap.data()!;
    if (user.coins < stakeCoin) {
      res.status(400).json({ error: "failed-precondition", message: "Not enough coins" });
      return;
    }

    const mmRef = rdb().ref("matchmaking");

    const waitingSnap = await mmRef
      .orderByChild("stakeCoin")
      .equalTo(stakeCoin)
      .limitToFirst(10)
      .get();

    let foundOpponentUid: string | null = null;
    let foundRoomId: string | null = null;

    if (waitingSnap.exists()) {
      const entries = waitingSnap.val() as Record<string, {
        uid: string; roomId: string; rating: number; stakeCoin: number; createdAt: number
      }>;
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.uid === uid) continue;
        if (Date.now() - entry.createdAt > 5 * 60 * 1000) {
          await mmRef.child(key).remove();
          continue;
        }
        foundOpponentUid = entry.uid;
        foundRoomId      = entry.roomId;
        await mmRef.child(key).remove();
        break;
      }
    }

    if (foundOpponentUid && foundRoomId) {
      await rdb().ref(`rooms/${foundRoomId}`).update({
        player2Uid:    uid,
        player2Name:   user.displayName ?? "",
        player2Avatar: user.avatarId ?? "avatar_01",
        player2Rating: user.rating ?? 0,
        player2Level:  user.level ?? 1,
        status:        "PLAYING",
      });
      res.json({ roomId: foundRoomId, isHost: false });
      return;
    }

    const roomId = db().collection("rooms").doc().id;
    await rdb().ref(`rooms/${roomId}`).set({
      roomId,
      player1Uid:    uid,
      player1Name:   user.displayName ?? "",
      player1Avatar: user.avatarId ?? "avatar_01",
      player1Rating: user.rating ?? 0,
      player1Level:  user.level ?? 1,
      player2Uid:    "",
      player2Name:   "",
      player2Avatar: "default",
      stakeCoin,
      status:        "WAITING",
      createdAt:     Date.now(),
    });

    await mmRef.child(uid).set({
      uid,
      roomId,
      rating:    user.rating ?? 1000,
      stakeCoin,
      createdAt: Date.now(),
    });

    // 30 soniyadan keyin bot kiritish (agar raqib topilmasa)
    scheduleBotsForMatchmaking(uid, roomId, user.rating ?? 1000, stakeCoin);

    res.json({ roomId, isHost: true });
  } catch (err) {
    console.error("findOrCreateMatch error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /matchmaking/cancel
router.post("/cancel", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    // Avval matchmaking entry dan roomId ni olib, bot timerni bekor qilamiz
    const mmSnap = await rdb().ref(`matchmaking/${uid}`).get();
    if (mmSnap.exists()) {
      const entry = mmSnap.val() as { roomId?: string };
      if (entry?.roomId) cancelBotTimer(entry.roomId);
    }
    await rdb().ref("matchmaking").child(uid).remove();
    res.json({ ok: true });
  } catch (err) {
    console.error("cancelMatchmaking error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// Eskirgan matchmaking entrylarni tozalash (cron tomonidan chaqiriladi)
export async function cleanupMatchmakingJob(): Promise<void> {
  const cutoff = Date.now() - 5 * 60 * 1000;
  const snap   = await rdb().ref("matchmaking").orderByChild("createdAt").endAt(cutoff).get();
  if (!snap.exists()) return;
  const updates: Record<string, null> = {};
  snap.forEach((child) => { updates[child.key!] = null; });
  await rdb().ref("matchmaking").update(updates);
  console.log(`Cleaned up ${Object.keys(updates).length} stale matchmaking entries`);
}

export default router;
