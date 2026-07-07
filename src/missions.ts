// ─────────────────────────────────────────────
//  Kunlik topshiriqlar (Daily Missions)
//
//  Har kuni yarim tunda (foydalanuvchi ochganda) yangilanadi.
//  Progress server tomonida yuritiladi — g'irromlik bo'lmaydi:
//  o'yin tugaganda game.ts progressni oshiradi (bumpMissionProgress),
//  bu yerda foydalanuvchi faqat TAYYOR topshiriq mukofotini oladi.
//
//  GET  /missions        → bugungi topshiriqlar + progress
//  POST /missions/claim  → { missionId } tayyor topshiriq mukofotini olish
// ─────────────────────────────────────────────
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import { isSameDay } from "./config";
import { requireAuth, AuthRequest } from "./middleware";

const router = Router();
const db = () => admin.firestore();

// Topshiriqlar ta'rifi. type — game.ts qaysi hisoblagichni oshirishini bildiradi.
export interface MissionDef {
  id: string;
  title: string;
  type: "play_games" | "win_games" | "play_streak_days" | "capture_pieces";
  target: number;
  coins: number;
  diamonds: number;
}

export const DAILY_MISSIONS: MissionDef[] = [
  { id: "play_3",        title: "Play 3 games today",          type: "play_games",       target: 3,  coins: 150, diamonds: 0  },
  { id: "win_3",         title: "Win 3 games today",           type: "win_games",        target: 3,  coins: 100, diamonds: 0  },
  { id: "win_1",         title: "Win your first game today",   type: "win_games",        target: 1,  coins: 50,  diamonds: 0  },
  { id: "capture_20",    title: "Capture 20 pieces today",     type: "capture_pieces",   target: 20, coins: 0,   diamonds: 10 },
  { id: "streak_3",      title: "Play 3 days in a row",        type: "play_streak_days", target: 3,  coins: 0,   diamonds: 20 },
];

type MissionState = {
  progress: Record<string, number>;   // missionId → hozirgi progress
  claimed: Record<string, boolean>;   // missionId → olinganmi
  dayStamp: number;                   // qaysi kunniki
};

function freshState(now: number): MissionState {
  return { progress: {}, claimed: {}, dayStamp: now };
}

// Kunlik reset: yangi kun bo'lsa progress tozalanadi
// (streak_3 progressi user.dailyStreak'dan olinadi, reset'ga tegmaydi)
function normalizeForToday(state: MissionState | undefined, now: number): MissionState {
  if (!state || !state.dayStamp || !isSameDay(state.dayStamp, now)) {
    return freshState(now);
  }
  return { progress: state.progress ?? {}, claimed: state.claimed ?? {}, dayStamp: state.dayStamp };
}

// GET /missions
router.get("/", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    const userRef = db().collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) { res.status(404).json({ error: "not-found" }); return; }

    const now = Date.now();
    const user = snap.data()!;
    const state = normalizeForToday(user.missionState as MissionState | undefined, now);
    const dailyStreak: number = user.dailyStreak ?? 0;

    // Agar kun almashgan bo'lsa — tozalangan holatni saqlab qo'yamiz
    if (!user.missionState || !isSameDay((user.missionState as MissionState).dayStamp ?? 0, now)) {
      await userRef.update({ missionState: state });
    }

    const missions = DAILY_MISSIONS.map((m) => {
      const progress = m.type === "play_streak_days"
        ? Math.min(dailyStreak, m.target)          // streak alohida manbadan
        : (state.progress[m.id] ?? 0);
      return {
        id: m.id, title: m.title, target: m.target,
        coins: m.coins, diamonds: m.diamonds,
        progress: Math.min(progress, m.target),
        completed: progress >= m.target,
        claimed: state.claimed[m.id] === true,
      };
    });

    res.json({ ok: true, missions, resetAt: nextMidnightTs(now) });
  } catch (err) {
    console.error("missions get error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /missions/claim  { missionId }
router.post("/claim", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    const { missionId } = req.body as { missionId: string };
    const def = DAILY_MISSIONS.find((m) => m.id === missionId);
    if (!def) { res.status(400).json({ error: "invalid-argument", message: "Unknown mission" }); return; }

    const userRef = db().collection("users").doc(uid);
    const now = Date.now();

    const result = await db().runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw { code: 404 };
      const user = snap.data()!;
      const state = normalizeForToday(user.missionState as MissionState | undefined, now);
      const dailyStreak: number = user.dailyStreak ?? 0;

      const progress = def.type === "play_streak_days"
        ? Math.min(dailyStreak, def.target)
        : (state.progress[def.id] ?? 0);

      if (progress < def.target) throw { code: 409, message: "Mission not completed yet" };
      if (state.claimed[def.id]) throw { code: 409, message: "Already claimed" };

      state.claimed[def.id] = true;

      tx.update(userRef, {
        coins:    admin.firestore.FieldValue.increment(def.coins),
        diamonds: admin.firestore.FieldValue.increment(def.diamonds),
        missionState: state,
      });

      return { ok: true, coins: def.coins, diamonds: def.diamonds };
    });

    res.json(result);
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code === 404) res.status(404).json({ error: "not-found" });
    else if (e.code === 409) res.status(409).json({ error: "conflict", message: e.message });
    else { console.error("missions claim error:", err); res.status(500).json({ error: "internal" }); }
  }
});

function nextMidnightTs(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * O'yin tugaganda game.ts shu funksiyani chaqiradi (transaction ichida).
 * Bugungi progressni oshiradi: har o'yin uchun play_games+1,
 * yutgan bo'lsa win_games+1, urilgan donalar soni capture_pieces'ga.
 */
export function bumpMissionProgress(
  tx: FirebaseFirestore.Transaction,
  userRef: FirebaseFirestore.DocumentReference,
  userData: FirebaseFirestore.DocumentData,
  opts: { won: boolean; captured: number }
): void {
  const now = Date.now();
  const state = normalizeForToday(userData.missionState as MissionState | undefined, now);

  const inc = (id: string, by: number) => {
    state.progress[id] = (state.progress[id] ?? 0) + by;
  };

  // play_games turidagi barcha topshiriqlar
  for (const m of DAILY_MISSIONS) {
    if (m.type === "play_games") inc(m.id, 1);
    if (m.type === "win_games" && opts.won) inc(m.id, 1);
    if (m.type === "capture_pieces") inc(m.id, opts.captured);
  }

  tx.update(userRef, { missionState: state });
}

export default router;
