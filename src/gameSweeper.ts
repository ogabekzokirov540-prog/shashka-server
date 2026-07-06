// ─────────────────────────────────────────────
//  Game Sweeper — tashlab ketilgan o'yinlar nazoratchisi
//  Har 60 soniyada faol xonalar tekshiriladi:
//  - 90+ soniya yurish bo'lmagan o'yinda navbati kelgan o'yinchi MAG'LUB
//  - Hisob-kitobni (tanga/reyting/XP) server o'zi yakunlaydi
//  - Boshlanmagan o'yinlar jarimasiz yopiladi, eski xonalar tozalanadi
// ─────────────────────────────────────────────
import * as admin from "firebase-admin";
import { UserDoc } from "./types";
import { applyResult } from "./game";

const db  = () => admin.firestore();
const rdb = () => admin.database();

const SWEEP_INTERVAL_MS   = 60_000;
const ABANDON_TIMEOUT_MS  = 90_000;
const CLEANUP_AFTER_MS    = 3_600_000;
const MIN_MOVES_VERSION   = 3;

export function startGameSweeper(): void {
  setInterval(sweep, SWEEP_INTERVAL_MS);
  console.log("[sweeper] Started — abandoned games are settled every 60s");
}

async function sweep(): Promise<void> {
  try {
    const snap = await rdb().ref("rooms").get();
    if (!snap.exists()) return;
    const rooms = snap.val() as Record<string, any>;
    for (const [roomId, room] of Object.entries(rooms)) {
      try {
        await checkRoom(roomId, room);
      } catch (e) {
        console.error(`[sweeper] room ${roomId} error:`, e);
      }
    }
  } catch (e) {
    console.error("[sweeper] sweep error:", e);
  }
}

async function checkRoom(roomId: string, room: any): Promise<void> {
  const gs = room?.gameState;

  if (gs?.isGameOver) {
    const last = gs.lastMoveAt ?? 0;
    if (last && Date.now() - last > CLEANUP_AFTER_MS) {
      await rdb().ref(`rooms/${roomId}`).remove();
    }
    return;
  }

  if (!gs) {
    const created = room?.createdAt ?? 0;
    if (created && Date.now() - created > CLEANUP_AFTER_MS) {
      await rdb().ref(`rooms/${roomId}`).remove();
    }
    return;
  }

  const last = gs.lastMoveAt ?? 0;
  if (!last || Date.now() - last < ABANDON_TIMEOUT_MS) return;

  const version = gs.version ?? 0;
  if (version < MIN_MOVES_VERSION) {
    await rdb().ref(`rooms/${roomId}/gameState`).update({
      isGameOver: true,
      endReason: "cancelled",
    });
    return;
  }

  const loserColor: string = gs.currentTurn ?? "WHITE";
  const winnerColor = loserColor === "WHITE" ? "BLACK" : "WHITE";
  const winnerUid: string | undefined =
    winnerColor === "WHITE" ? room.player1Uid : room.player2Uid;
  const loserUid: string | undefined =
    winnerColor === "WHITE" ? room.player2Uid : room.player1Uid;
  if (!winnerUid || !loserUid) return;

  await rdb().ref(`rooms/${roomId}/gameState`).update({
    isGameOver: true,
    winner: winnerColor,
    endReason: "timeout",
  });

  await settleAbandoned(roomId, room, winnerUid, loserUid);
  console.log(`[sweeper] room ${roomId}: ${loserUid} abandoned — winner ${winnerUid}`);
}

async function settleAbandoned(
  roomId: string,
  room: any,
  winnerUid: string,
  loserUid: string
): Promise<void> {
  const stake: number = room.stakeCoin ?? 0;
  const settleRef = db().collection("gameSettlements").doc(roomId);

  await db().runTransaction(async (tx) => {
    const [settleSnap, wSnap, lSnap] = await Promise.all([
      tx.get(settleRef),
      tx.get(db().collection("users").doc(winnerUid)),
      tx.get(db().collection("users").doc(loserUid)),
    ]);

    const status = settleSnap.exists ? settleSnap.data()!.status : null;
    if (status === "FINISHED" || status === "DISPUTED") return;

    const wRating = (wSnap.data() as UserDoc)?.rating ?? 0;
    const lRating = (lSnap.data() as UserDoc)?.rating ?? 0;

    applyResult(tx, wSnap, "win",  stake, wRating, lRating);
    applyResult(tx, lSnap, "loss", stake, lRating, wRating);

    tx.set(settleRef, {
      status: "FINISHED",
      roomId,
      winnerId: winnerUid,
      finishedAt: Date.now(),
      bySweeper: true,
    }, { merge: true });
  });
}
