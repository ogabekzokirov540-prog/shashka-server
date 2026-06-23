// ─────────────────────────────────────────────
//  Shashka Express Server — Railway uchun
// ─────────────────────────────────────────────
import "dotenv/config";
import express from "express";
import cors from "cors";
import * as admin from "firebase-admin";
import cron from "node-cron";

// Routes
import gameRouter       from "./game";
import dailyRouter      from "./daily";
import matchmakingRouter from "./matchmaking";
import userRouter       from "./user";
import clubRouter       from "./club";

// Bot services
import { startBotGameListener }    from "./bots/botMatchmaking";
import { refreshBotActivityJob, seedAllBotsJob } from "./bots/botClub";
import { cleanupMatchmakingJob }   from "./matchmaking";
import { cleanupOfflineUsersJob }  from "./user";

// Admin SDK — Railway environment variabllaridan
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ─────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Routes ─────────────────────────────────────
app.use("/game",        gameRouter);
app.use("/daily",       dailyRouter);
app.use("/matchmaking", matchmakingRouter);
app.use("/user",        userRouter);
app.use("/club",        clubRouter);

// ── Admin endpointlar ──────────────────────────
// POST /admin/seed-bots  — botlarni Firestore ga seed qilish
app.post("/admin/seed-bots", async (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token !== process.env.ADMIN_SEED_TOKEN) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const seeded = await seedAllBotsJob();
  res.json({ ok: true, seeded });
});

// GET /health  — Railway health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── Cron jobs ──────────────────────────────────
// Har 10 daqiqa: eskirgan matchmaking tozalash
cron.schedule("*/10 * * * *", async () => {
  try { await cleanupMatchmakingJob(); } catch (e) { console.error(e); }
});

// Har 30 daqiqa: bot activity yangilash
cron.schedule("*/30 * * * *", async () => {
  try { await refreshBotActivityJob(); } catch (e) { console.error(e); }
});

// Har soat: offline foydalanuvchilarni tozalash
cron.schedule("0 * * * *", async () => {
  try { await cleanupOfflineUsersJob(); } catch (e) { console.error(e); }
});

// Har dushanba 00:00 (Toshkent UTC+5 = 19:00 UTC)
cron.schedule("0 19 * * 0", async () => {
  try {
    const snap  = await admin.firestore().collection("clubs").get();
    const batch = admin.firestore().batch();
    snap.docs.forEach((doc) => batch.update(doc.ref, { weeklyWins: 0 }));
    await batch.commit();
    console.log(`Reset weeklyWins for ${snap.size} clubs`);
  } catch (e) { console.error(e); }
});

// ── Server start ───────────────────────────────
app.listen(PORT, () => {
  console.log(`Shashka server running on port ${PORT}`);

  // Bot RTDB listener
  startBotGameListener();
});
