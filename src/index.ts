import "dotenv/config";
import express from "express";
import cors from "cors";
import * as admin from "firebase-admin";
import cron from "node-cron";

import gameRouter        from "./game";
import dailyRouter       from "./daily";
import matchmakingRouter from "./matchmaking";
import userRouter        from "./user";
import clubRouter        from "./club";

import { refreshBotActivityJob, seedAllBotsJob } from "./bots/botClub";
import { cleanupMatchmakingJob }  from "./matchmaking";
import { cleanupOfflineUsersJob } from "./user";

// Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/game",        gameRouter);
app.use("/daily",       dailyRouter);
app.use("/matchmaking", matchmakingRouter);
app.use("/user",        userRouter);
app.use("/club",        clubRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Seed bots
app.post("/admin/seed-bots", async (req, res) => {
  const token = req.headers["x-admin-token"];
  if (token !== process.env.ADMIN_SEED_TOKEN) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const seeded = await seedAllBotsJob();
    res.json({ ok: true, seeded });
  } catch (e) {
    console.error("seed-bots error:", e);
    res.status(500).json({ error: "seed failed" });
  }
});

// Cron jobs
cron.schedule("*/10 * * * *", async () => {
  try { await cleanupMatchmakingJob(); } catch (e) { console.error("cleanup matchmaking:", e); }
});

cron.schedule("*/30 * * * *", async () => {
  try { await refreshBotActivityJob(); } catch (e) { console.error("refresh bots:", e); }
});

cron.schedule("0 * * * *", async () => {
  try { await cleanupOfflineUsersJob(); } catch (e) { console.error("cleanup offline:", e); }
});

cron.schedule("0 19 * * 0", async () => {
  try {
    const snap  = await admin.firestore().collection("clubs").get();
    const batch = admin.firestore().batch();
    snap.docs.forEach((doc) => batch.update(doc.ref, { weeklyWins: 0 }));
    await batch.commit();
    console.log(`Reset weeklyWins for ${snap.size} clubs`);
  } catch (e) { console.error("reset weekly:", e); }
});

// Bot game listener — xavfsiz ishga tushirish
app.listen(PORT, () => {
  console.log(`Shashka server running on port ${PORT}`);
  try {
    const { startBotGameListener } = require("./bots/botMatchmaking");
    startBotGameListener();
  } catch (e) {
    console.error("Bot listener error (non-critical):", e);
  }
});
