// ─────────────────────────────────────────────
//  Kunlik mukofot
// ─────────────────────────────────────────────
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { DAILY_REWARDS, isSameDay, nextMidnight } from "./config";
import { requireAuth, AuthRequest } from "./middleware";

const router = Router();
const db = () => admin.firestore();

// POST /daily/claim
router.post("/claim", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid     = req.uid!;
    const userRef = db().collection("users").doc(uid);

    const result = await db().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw { code: 404, message: "User not found" };

      const user      = snap.data()!;
      const lastClaim: number = user.lastDailyClaim ?? 0;
      const now       = Date.now();

      if (lastClaim > 0 && isSameDay(lastClaim, now)) {
        const msLeft = nextMidnight(now) - now;
        throw { code: 409, message: "Already claimed today", nextClaimAt: now + msLeft };
      }

      const currentStreak: number = user.dailyStreak ?? 0;
      const yesterday = now - 86_400_000;
      const wasYesterday = lastClaim > 0 && isSameDay(lastClaim, yesterday);
      const newStreak = wasYesterday ? (currentStreak % 7) + 1 : 1;
      const reward = DAILY_REWARDS[newStreak - 1];

      tx.update(userRef, {
        coins:          admin.firestore.FieldValue.increment(reward.coins),
        diamonds:       admin.firestore.FieldValue.increment(reward.diamonds),
        dailyStreak:    newStreak,
        lastDailyClaim: now,
      });

      return { ok: true, day: newStreak, coins: reward.coins, diamonds: reward.diamonds };
    });

    res.json(result);
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string; nextClaimAt?: number };
    if (e.code === 404) {
      res.status(404).json({ error: "not-found", message: e.message });
    } else if (e.code === 409) {
      res.status(409).json({ error: "already-exists", message: e.message, nextClaimAt: e.nextClaimAt });
    } else {
      console.error("claimDailyReward error:", err);
      res.status(500).json({ error: "internal", message: "Server error" });
    }
  }
});

export default router;
