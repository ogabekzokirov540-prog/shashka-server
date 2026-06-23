// ─────────────────────────────────────────────
//  Foydalanuvchi
// ─────────────────────────────────────────────
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { requireAuth, AuthRequest } from "./middleware";

const router = Router();
const db = () => admin.firestore();

// POST /user/created  (Android tomonidan yangi foydalanuvchi yaratilganda chaqiriladi)
router.post("/created", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid     = req.uid!;
    const { displayName, email, photoUrl } = req.body as {
      displayName?: string; email?: string; photoUrl?: string;
    };

    const existing = await db().collection("users").doc(uid).get();
    if (existing.exists) {
      res.json({ ok: true, message: "Already exists" });
      return;
    }

    const now = Date.now();
    await db().collection("users").doc(uid).set({
      uid,
      displayName:       displayName ?? "Player",
      email:             email ?? "",
      photoUrl:          photoUrl ?? "",
      bio:               "",
      fullName:          "",
      occupation:        "",
      gender:            "",
      country:           "",
      age:               0,
      avatarId:          "avatar_01",
      coins:             200,
      diamonds:          50,
      xp:                0,
      level:             0,
      wins:              0,
      losses:            0,
      draws:             0,
      totalGames:        0,
      totalCoinsWagered: 0,
      totalCoinsWon:     0,
      currentWinStreak:  0,
      longestWinStreak:  0,
      rating:            1000,
      peakRating:        1000,
      clubId:            "",
      clubName:          "",
      clubRole:          "MEMBER",
      equippedSkin:      "default",
      unlockedSkins:     ["default"],
      friendUids:        [],
      lastDailyClaim:    0,
      dailyStreak:       0,
      isOnline:          true,
      createdAt:         now,
      lastSeenAt:        now,
    }, { merge: false });

    console.log(`New user created: ${uid}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("onUserCreated error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /user/deleted  (Android tomonidan account o'chirilganda chaqiriladi)
router.post("/deleted", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid      = req.uid!;
    const userRef  = db().collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (userSnap.exists) {
      const userData = userSnap.data()!;
      if (userData.clubId) {
        const clubRef = db().collection("clubs").doc(userData.clubId);
        const batch   = db().batch();
        batch.delete(clubRef.collection("members").doc(uid));
        batch.update(clubRef, {
          memberUids:  admin.firestore.FieldValue.arrayRemove(uid),
          memberCount: admin.firestore.FieldValue.increment(-1),
        });
        await batch.commit();
      }
      await userRef.delete();
    }

    console.log(`User deleted: ${uid}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("onUserDeleted error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /user/online
router.post("/online", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isOnline } = req.body as { isOnline: boolean };
    await db().collection("users").doc(req.uid!).update({
      isOnline,
      lastSeenAt: Date.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("setOnlineStatus error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// GET /user/leaderboard
router.get("/leaderboard", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const snap = await db()
      .collection("users")
      .orderBy("rating", "desc")
      .limit(50)
      .get();

    const data = snap.docs.map((doc, index) => {
      const u = doc.data();
      return {
        rank:        index + 1,
        uid:         u.uid,
        displayName: u.displayName,
        photoUrl:    u.photoUrl,
        rating:      u.rating,
        level:       u.level,
        wins:        u.wins,
        clubName:    u.clubName,
      };
    });

    res.json(data);
  } catch (err) {
    console.error("getLeaderboard error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /user/profile
router.post("/profile", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    const {
      fullName, displayName, bio, occupation,
      gender, country, age, avatarId
    } = req.body as {
      fullName: string; displayName: string; bio: string;
      occupation: string; gender: string; country: string;
      age: number; avatarId: string;
    };

    const VALID_GENDERS    = ["male", "female", "other", ""];
    const VALID_AVATAR_IDS = Array.from({length: 20}, (_, i) => `avatar_${String(i+1).padStart(2,"0")}`);
    const VALID_COUNTRIES  = ["UZ","RU","KZ","KG","TJ","TM","AZ","TR","DE","GB","US","FR","CN","KR","JP","OTHER",""];

    if ((fullName ?? "").length > 50) { res.status(400).json({ error: "invalid-argument", message: "Full name too long" }); return; }
    if ((displayName ?? "").length > 30) { res.status(400).json({ error: "invalid-argument", message: "Username too long" }); return; }
    if ((bio ?? "").length > 120) { res.status(400).json({ error: "invalid-argument", message: "Bio too long" }); return; }
    if (!VALID_GENDERS.includes(gender ?? "")) { res.status(400).json({ error: "invalid-argument", message: "Invalid gender" }); return; }
    if (!VALID_COUNTRIES.includes(country ?? "")) { res.status(400).json({ error: "invalid-argument", message: "Invalid country" }); return; }
    if (!VALID_AVATAR_IDS.includes(avatarId)) { res.status(400).json({ error: "invalid-argument", message: "Invalid avatar" }); return; }
    if (age < 0 || age > 120) { res.status(400).json({ error: "invalid-argument", message: "Invalid age" }); return; }

    const dn = (displayName ?? "").trim() || (fullName ?? "").trim().slice(0, 30);
    if (!dn) { res.status(400).json({ error: "invalid-argument", message: "Name is required" }); return; }

    await db().collection("users").doc(uid).update({
      fullName:    (fullName ?? "").trim().slice(0, 50),
      displayName: dn,
      bio:         (bio ?? "").trim().slice(0, 120),
      occupation:  occupation ?? "",
      gender:      gender ?? "",
      country:     country ?? "",
      age:         Number.isInteger(age) ? age : 0,
      avatarId,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("updateProfile error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// Offline foydalanuvchilarni tozalash (cron tomonidan chaqiriladi)
export async function cleanupOfflineUsersJob(): Promise<void> {
  const cutoff = Date.now() - 10 * 60 * 1000;
  const snap   = await db()
    .collection("users")
    .where("isOnline", "==", true)
    .where("lastSeenAt", "<", cutoff)
    .get();

  const batch = db().batch();
  snap.docs.forEach((doc) => batch.update(doc.ref, { isOnline: false }));
  await batch.commit();
  console.log(`Marked ${snap.size} users as offline`);
}

export default router;
