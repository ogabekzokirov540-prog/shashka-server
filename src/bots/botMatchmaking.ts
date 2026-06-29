// ─────────────────────────────────────────────
//  Bot matchmaking — Express versiyasi
//  Matchmakingda o'yinchi 30 sek kutsa, bot kiradi
// ─────────────────────────────────────────────
import * as admin from "firebase-admin";
import { BOT_PROFILES, BotProfile } from "./botProfiles";
import { makeBotMoveNewFormat, seedBotToFirestore } from "./botEngine";
import { levelFromXp } from "../config";

const db  = () => admin.firestore();
const rdb = () => admin.database();

// Aktivbot o'yinlari (roomId → timeout handle)
const activeBotTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ─────────────────────────────────────────────
//  O'yinchi reyting ga mos bot tanlash
// ─────────────────────────────────────────────
function pickBotForPlayer(playerRating: number, stakeCoin: number): BotProfile | null {
  const hour = new Date().getUTCHours();

  const suitable = BOT_PROFILES.filter(b =>
    b.preferredStakes.includes(stakeCoin) &&
    b.activeHours.includes(hour) &&
    Math.abs(b.rating - playerRating) < 400
  );

  if (suitable.length > 0) {
    return suitable.reduce((a, b) =>
      Math.abs(a.rating - playerRating) <= Math.abs(b.rating - playerRating) ? a : b
    );
  }

  const byRating = BOT_PROFILES.filter(b =>
    b.preferredStakes.includes(stakeCoin) || stakeCoin <= 200
  ).sort((a, b) =>
    Math.abs(a.rating - playerRating) - Math.abs(b.rating - playerRating)
  );
  return byRating[0] ?? null;
}

// ─────────────────────────────────────────────
//  Matchmaking entry yaratilganda chaqiriladi
//  (findOrCreateMatch → isHost: true bo'lsa)
// ─────────────────────────────────────────────
export function scheduleBotsForMatchmaking(
  uid: string,
  roomId: string,
  rating: number,
  stakeCoin: number
): void {
  // 10 soniya kutish
  const timer = setTimeout(async () => {
    activeBotTimers.delete(roomId);
    try {
      // Hali ham matchmakingda turganmi?
      const stillWaiting = await rdb().ref(`matchmaking/${uid}`).get();
      if (!stillWaiting.exists()) return;

      // Room hali WAITING da turganmi?
      const roomSnap = await rdb().ref(`rooms/${roomId}`).get();
      if (!roomSnap.exists()) return;
      const room = roomSnap.val();
      if (room.status !== "WAITING") return;

      const bot = pickBotForPlayer(rating, stakeCoin);
      if (!bot) {
        console.warn(`No suitable bot for player ${uid}, stake ${stakeCoin}`);
        return;
      }

      await seedBotToFirestore(bot);
      await rdb().ref(`matchmaking/${uid}`).remove();

      const botUserSnap = await db().collection("users").doc(bot.uid).get();
      const botUser = botUserSnap.data()!;

      await rdb().ref(`rooms/${roomId}`).update({
        player2Uid:    bot.uid,
        player2Name:   bot.displayName,
        player2Avatar: botUser.avatarId ?? "avatar_01",
        status:        "PLAYING",
        isBotGame:     true,
        botUid:        bot.uid,
      });

      console.log(`Bot ${bot.displayName} joined room ${roomId} for player ${uid}`);
    } catch (err) {
      console.error("scheduleBotsForMatchmaking error:", err);
    }
  }, 10000);

  activeBotTimers.set(roomId, timer);
}

// ─────────────────────────────────────────────
//  Matchmaking bekor qilinganda timer o'chirish
// ─────────────────────────────────────────────
export function cancelBotTimer(roomId: string): void {
  const timer = activeBotTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    activeBotTimers.delete(roomId);
  }
}

// ─────────────────────────────────────────────
//  RTDB listener: GameState o'zgarganda bot harakat qiladi
//  Server start bo'lganda chaqiriladi
// ─────────────────────────────────────────────
export function startBotGameListener(): void {
  const roomsRef = rdb().ref("rooms");

  roomsRef.on("child_changed", async (snapshot) => {
    try {
      const room = snapshot.val();
      if (!room || !room.isBotGame || !room.botUid) return;
      if (room.status !== "PLAYING") return;

      const roomId  = room.roomId as string;
      const botUid  = room.botUid as string;
      const botColor = room.player2Uid === botUid ? "BLACK" : "WHITE";

      const gsSnap = await rdb().ref(`rooms/${roomId}/gameState`).get();
      if (!gsSnap.exists()) return;
      const gs = gsSnap.val();
      if (!gs || gs.isGameOver) return;
      if (gs.currentTurn !== botColor) return;

      const botProfile = BOT_PROFILES.find(b => b.uid === botUid);
      if (!botProfile) return;

      const thinkTime = botProfile.typingDelayMs +
        Math.floor(Math.random() * botProfile.typingDelayMs * 0.5);

      await new Promise(resolve => setTimeout(resolve, thinkTime));

      // Qayta tekshirish
      const currentSnap = await rdb().ref(`rooms/${roomId}/gameState/currentTurn`).get();
      if (currentSnap.val() !== botColor) return;

      await makeBotMoveNewFormat(roomId, botColor, botProfile.style);
    } catch (err) {
      console.error("startBotGameListener error:", err);
    }
  });

  console.log("Bot game listener started");
}

// ─────────────────────────────────────────────
//  O'yin tugadi: statistikani yangilash
// ─────────────────────────────────────────────
async function handleBotGameOver(
  roomId: string,
  room: Record<string, unknown>,
  botUid: string,
  winner: string | null
): Promise<void> {
  const playerUid   = room.player1Uid === botUid ? room.player2Uid : room.player1Uid;
  const stake       = (room.stakeCoin as number) ?? 0;
  const playerColor = room.player1Uid === playerUid ? "WHITE" : "BLACK";
  const playerWon   = winner === playerColor;
  const isDraw      = winner === null;

  const playerRef  = db().collection("users").doc(playerUid as string);
  const playerSnap = await playerRef.get();
  if (!playerSnap.exists) return;
  const player = playerSnap.data()!;

  if (isDraw) {
    const update: Record<string, unknown> = {
      draws:            admin.firestore.FieldValue.increment(1),
      totalGames:       admin.firestore.FieldValue.increment(1),
      xp:               admin.firestore.FieldValue.increment(15),
      level:            levelFromXp(player.xp + 15),
      currentWinStreak: 0,
    };
    if (stake > 0) update.totalCoinsWagered = admin.firestore.FieldValue.increment(stake);
    await playerRef.update(update);
  } else if (playerWon) {
    const coinsDelta = stake > 0 ? stake * 2 + 20 : 20;
    const newRating  = Math.min(3000, player.rating + 25);
    const newXp      = player.xp + 30;
    const newLevel   = levelFromXp(newXp);
    const newStreak  = (player.currentWinStreak ?? 0) + 1;
    await playerRef.update({
      wins:             admin.firestore.FieldValue.increment(1),
      totalGames:       admin.firestore.FieldValue.increment(1),
      coins:            admin.firestore.FieldValue.increment(coinsDelta),
      totalCoinsWon:    admin.firestore.FieldValue.increment(coinsDelta),
      totalCoinsWagered:admin.firestore.FieldValue.increment(stake),
      xp:               newXp,
      level:            newLevel,
      rating:           newRating,
      peakRating:       Math.max(player.peakRating ?? 0, newRating),
      currentWinStreak: newStreak,
      longestWinStreak: Math.max(player.longestWinStreak ?? 0, newStreak),
    });
    if (player.clubId) {
      await db().collection("clubs").doc(player.clubId).update({
        totalWins:  admin.firestore.FieldValue.increment(1),
        totalGames: admin.firestore.FieldValue.increment(1),
        weeklyWins: admin.firestore.FieldValue.increment(1),
      }).catch(() => {});
    }
  } else {
    const coinsDelta = stake > 0 ? -stake : 0;
    const newRating  = Math.max(0, player.rating - 15);
    const newXp      = player.xp + 10;
    await playerRef.update({
      losses:           admin.firestore.FieldValue.increment(1),
      totalGames:       admin.firestore.FieldValue.increment(1),
      coins:            admin.firestore.FieldValue.increment(coinsDelta),
      totalCoinsWagered:admin.firestore.FieldValue.increment(stake),
      xp:               admin.firestore.FieldValue.increment(10),
      level:            levelFromXp(newXp),
      rating:           newRating,
      currentWinStreak: 0,
    });
  }

  // Bot statistikasi
  const botRef  = db().collection("users").doc(botUid);
  const botSnap = await botRef.get();
  if (botSnap.exists) {
    if (!isDraw) {
      if (playerWon) {
        await botRef.update({ losses: admin.firestore.FieldValue.increment(1), totalGames: admin.firestore.FieldValue.increment(1), rating: admin.firestore.FieldValue.increment(-15) });
      } else {
        await botRef.update({ wins: admin.firestore.FieldValue.increment(1), totalGames: admin.firestore.FieldValue.increment(1), rating: admin.firestore.FieldValue.increment(25) });
      }
    } else {
      await botRef.update({ draws: admin.firestore.FieldValue.increment(1), totalGames: admin.firestore.FieldValue.increment(1) });
    }
  }

  await rdb().ref(`rooms/${roomId}`).update({ status: "FINISHED", finishedAt: Date.now() });
  console.log(`Bot game over: room ${roomId}, playerWon: ${playerWon}`);
}
