// ─────────────────────────────────────────────
//  Bot club logikasi — Express versiyasi
//  Firestore triggers o'rniga manual chaqiruvlar
// ─────────────────────────────────────────────
import * as admin from "firebase-admin";
import { BOT_PROFILES } from "./botProfiles";
import { seedBotToFirestore } from "./botEngine";

const db = () => admin.firestore();

const BOT_JOIN_THRESHOLD  = 5;
const BOT_LEAVE_THRESHOLD = 25;

const BOT_CHAT_MESSAGES = [
  "Yaxshi o'yin bo'ldi! 🎉",
  "Hammaga omad! ♟️",
  "Bugun qiyin raqiblar bor 😅",
  "Club kuchayib boraypti 💪",
  "Kim o'ynamoqchi? 🙋",
  "Yangi o'yinchilar xush kelibsiz! 👋",
  "G'alaba uchun kurashaylik! 🏆",
  "Mashq qilish kerak 📚",
  "Zo'r harakat edi!",
  "Keyingi safar yaxshiroq bo'ladi 😊",
  "Club bilan g'urur! 🏰",
  "Hammasi strategiyada 🧠",
];

// ─────────────────────────────────────────────
//  Yangi club yaratilganda bot qo'shish
//  (club/create endpoint dan chaqiriladi)
// ─────────────────────────────────────────────
export function scheduleBotJoinForNewClub(clubId: string): void {
  const delay = 120000 + Math.floor(Math.random() * 120000); // 2–4 daqiqa
  setTimeout(async () => {
    try {
      const freshSnap = await db().collection("clubs").doc(clubId).get();
      if (!freshSnap.exists) return;
      const freshClub = freshSnap.data()!;
      if (freshClub.memberCount >= BOT_JOIN_THRESHOLD) return;
      if (!freshClub.isPublic) return;
      await addBotsToClub(clubId, freshClub, freshClub.memberCount);
    } catch (err) {
      console.error("scheduleBotJoinForNewClub error:", err);
    }
  }, delay);
}

// ─────────────────────────────────────────────
//  A'zo soni o'zgarganda bot qo'shish/chiqarish tekshiruvi
//  (join/leave/kick endpointlardan chaqiriladi)
// ─────────────────────────────────────────────
export async function checkAndManageBots(clubId: string): Promise<void> {
  try {
    const clubSnap = await db().collection("clubs").doc(clubId).get();
    if (!clubSnap.exists) return;
    const club = clubSnap.data()!;
    const count = club.memberCount as number;

    if (count < BOT_JOIN_THRESHOLD && club.isPublic) {
      await addBotsToClub(clubId, club, count);
    } else if (count >= BOT_LEAVE_THRESHOLD) {
      await removeBotsFromClub(clubId, club);
    }
  } catch (err) {
    console.error("checkAndManageBots error:", err);
  }
}

// ─────────────────────────────────────────────
//  Bot club ga qo'shish
// ─────────────────────────────────────────────
async function addBotsToClub(
  clubId: string,
  club: FirebaseFirestore.DocumentData,
  currentCount: number
): Promise<void> {
  const needed = BOT_JOIN_THRESHOLD - currentCount;
  if (needed <= 0) return;

  const existingBotSnaps = await db()
    .collection("clubs").doc(clubId)
    .collection("members")
    .where("isBot", "==", true)
    .get();
  const existingBotUids = new Set(existingBotSnaps.docs.map(d => d.id));

  const availableBots = BOT_PROFILES.filter(b => !existingBotUids.has(b.uid));
  const shuffled = availableBots.sort(() => Math.random() - 0.5);
  const toAdd    = shuffled.slice(0, Math.min(needed, 3));

  for (const bot of toAdd) {
    await seedBotToFirestore(bot);
    await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 10000));

    const clubRef = db().collection("clubs").doc(clubId);
    const batch   = db().batch();

    batch.set(clubRef.collection("members").doc(bot.uid), {
      uid:         bot.uid,
      displayName: bot.displayName,
      avatarId:    "avatar_01",
      photoUrl:    bot.photoUrl,
      level:       bot.level,
      rating:      bot.rating,
      wins:        bot.wins,
      role:        "MEMBER",
      isBot:       true,
      joinedAt:    Date.now(),
    });
    batch.update(clubRef, {
      memberUids:  admin.firestore.FieldValue.arrayUnion(bot.uid),
      memberCount: admin.firestore.FieldValue.increment(1),
    });
    batch.update(db().collection("users").doc(bot.uid), {
      clubId:   clubId,
      clubName: club.name,
      clubRole: "MEMBER",
    });
    await batch.commit();

    await sendBotChatMessage(clubId, bot);
    console.log(`Bot ${bot.displayName} joined club ${clubId}`);
  }
}

// ─────────────────────────────────────────────
//  Bot club dan chiqarish
// ─────────────────────────────────────────────
async function removeBotsFromClub(clubId: string, club: FirebaseFirestore.DocumentData): Promise<void> {
  const botMembersSnap = await db()
    .collection("clubs").doc(clubId)
    .collection("members")
    .where("isBot", "==", true)
    .get();

  if (botMembersSnap.empty) return;

  for (const memberDoc of botMembersSnap.docs) {
    const botUid    = memberDoc.id;
    const botProfile = BOT_PROFILES.find(b => b.uid === botUid);
    if (botProfile) {
      const leaveMessages = [
        "Boshqa club topib oldim, omad! 👋",
        "Sog' bo'linglar, yangi sarguzasht kutmoqda 🚀",
        "Club yaxshi, lekin ketish vaqti keldi. Omad! ✨",
        "Ko'p odamlar keldi — men joy bo'shataman 😄",
        "Yangi manzilga yo'l oldim. Kuchli bo'linglar! 💪",
      ];
      const text    = leaveMessages[Math.floor(Math.random() * leaveMessages.length)];
      const clubRef = db().collection("clubs").doc(clubId);
      const msgRef  = clubRef.collection("messages").doc();
      await msgRef.set({
        id: msgRef.id, clubId,
        senderUid:      botProfile.uid,
        senderName:     botProfile.displayName,
        senderPhotoUrl: botProfile.photoUrl,
        senderLevel:    botProfile.level,
        text,
        timestamp: Date.now(),
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const batch = db().batch();
    batch.delete(db().collection("clubs").doc(clubId).collection("members").doc(botUid));
    batch.update(db().collection("clubs").doc(clubId), {
      memberUids:  admin.firestore.FieldValue.arrayRemove(botUid),
      memberCount: admin.firestore.FieldValue.increment(-1),
    });
    batch.update(db().collection("users").doc(botUid), {
      clubId: "", clubName: "", clubRole: "MEMBER",
    });
    await batch.commit();
    console.log(`Bot ${botUid} left club ${clubId}`);

    await new Promise(resolve => setTimeout(resolve, 15000 + Math.random() * 15000));

    const freshClub = await db().collection("clubs").doc(clubId).get();
    if ((freshClub.data()?.memberCount ?? 0) < BOT_LEAVE_THRESHOLD) break;
  }
}

// ─────────────────────────────────────────────
//  Bot chat xabari yuborish
// ─────────────────────────────────────────────
async function sendBotChatMessage(clubId: string, bot: { uid: string; displayName: string; photoUrl: string; level: number }): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, bot.level * 200 + Math.random() * 2000));
  const text    = BOT_CHAT_MESSAGES[Math.floor(Math.random() * BOT_CHAT_MESSAGES.length)];
  const clubRef = db().collection("clubs").doc(clubId);
  const msgRef  = clubRef.collection("messages").doc();
  await msgRef.set({
    id: msgRef.id, clubId,
    senderUid:      bot.uid,
    senderName:     bot.displayName,
    senderPhotoUrl: bot.photoUrl,
    senderLevel:    bot.level,
    text,
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────
//  Bot activity yangilash (cron tomonidan chaqiriladi)
// ─────────────────────────────────────────────
export async function refreshBotActivityJob(): Promise<void> {
  const hour  = new Date().getUTCHours();
  const batch = db().batch();
  let count   = 0;

  for (const bot of BOT_PROFILES) {
    const isActive = bot.activeHours.includes(hour);
    batch.update(db().collection("users").doc(bot.uid), {
      isOnline:   isActive,
      lastSeenAt: isActive ? Date.now() : Date.now() - Math.floor(Math.random() * 3600000),
    });
    count++;
    if (count % 400 === 0) await batch.commit();
  }
  if (count > 0) await batch.commit();
  console.log(`Refreshed activity for ${BOT_PROFILES.length} bots at hour ${hour}`);
}

// ─────────────────────────────────────────────
//  Seed all bots to Firestore
// ─────────────────────────────────────────────
export async function seedAllBotsJob(): Promise<number> {
  let seeded = 0;
  for (const bot of BOT_PROFILES) {
    await seedBotToFirestore(bot);
    seeded++;
  }
  return seeded;
}
