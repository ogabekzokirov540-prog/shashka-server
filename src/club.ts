// ─────────────────────────────────────────────
//  Club funksiyalari
// ─────────────────────────────────────────────
import { Router, Response } from "express";
import * as admin from "firebase-admin";
import {
  CLUB_MAX_MEMBERS,
  CHAT_MAX_LENGTH,
  BIO_MAX_LENGTH,
  ANNOUNCEMENT_MAX,
} from "./config";
import { requireAuth, AuthRequest } from "./middleware";
import { scheduleBotJoinForNewClub, checkAndManageBots } from "./bots/botClub";

const router = Router();
const db = () => admin.firestore();

// POST /club/create
router.post("/create", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    const { name, tag, description, badgeEmoji, primaryColor, bannerStyle, isPublic } = req.body as {
      name: string; tag: string; description: string;
      badgeEmoji: string; primaryColor: string; bannerStyle: string; isPublic: boolean;
    };

    if (!name || name.trim().length < 3 || name.length > 30) {
      res.status(400).json({ error: "invalid-argument", message: "Club name must be 3–30 characters" });
      return;
    }
    const cleanTag = (tag ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
    if (cleanTag.length < 2) {
      res.status(400).json({ error: "invalid-argument", message: "Tag must be 2–5 letters" });
      return;
    }

    const userSnap = await db().collection("users").doc(uid).get();
    if (!userSnap.exists) { res.status(404).json({ error: "not-found", message: "User not found" }); return; }
    const user = userSnap.data()!;
    if (user.clubId) {
      res.status(409).json({ error: "already-exists", message: "You are already in a club. Leave first." });
      return;
    }

    const tagCheck = await db().collection("clubs").where("tag", "==", cleanTag).limit(1).get();
    if (!tagCheck.empty) {
      res.status(409).json({ error: "already-exists", message: `Tag #${cleanTag} is already taken` });
      return;
    }

    const clubRef = db().collection("clubs").doc();
    const now = Date.now();

    const clubData = {
      id:           clubRef.id,
      name:         name.trim(),
      tag:          cleanTag,
      description:  (description ?? "").trim().slice(0, 150),
      adminUid:     uid,
      adminName:    user.displayName ?? "",
      memberUids:   [uid],
      memberCount:  1,
      maxMembers:   CLUB_MAX_MEMBERS,
      badgeEmoji:   badgeEmoji ?? "♟",
      primaryColor: primaryColor ?? "#D4A24C",
      bannerStyle:  bannerStyle ?? "wood",
      isPublic:     isPublic ?? true,
      totalWins:    0,
      totalGames:   0,
      weeklyWins:   0,
      announcements: "",
      createdAt:    now,
    };

    const batch = db().batch();
    batch.set(clubRef, clubData);
    batch.set(clubRef.collection("members").doc(uid), {
      uid,
      displayName:  user.displayName ?? "",
      photoUrl:     user.photoUrl ?? "",
      level:        user.level ?? 0,
      rating:       user.rating ?? 1000,
      wins:         user.wins ?? 0,
      role:         "ADMIN",
      joinedAt:     now,
    });
    batch.update(db().collection("users").doc(uid), {
      clubId:   clubRef.id,
      clubName: name.trim(),
      clubRole: "ADMIN",
    });
    await batch.commit();

    // Yangi club uchun bot qo'shishni rejalashtirish
    scheduleBotJoinForNewClub(clubRef.id);

    res.json({ ok: true, clubId: clubRef.id });
  } catch (err) {
    console.error("createClub error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /club/join
router.post("/join", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid    = req.uid!;
    const { clubId } = req.body as { clubId: string };
    if (!clubId) { res.status(400).json({ error: "invalid-argument", message: "clubId required" }); return; }

    await db().runTransaction(async (tx) => {
      const clubRef  = db().collection("clubs").doc(clubId);
      const userRef  = db().collection("users").doc(uid);
      const clubSnap = await tx.get(clubRef);
      const userSnap = await tx.get(userRef);

      if (!clubSnap.exists) throw { code: 404, message: "Club not found" };
      if (!userSnap.exists) throw { code: 404, message: "User not found" };

      const club = clubSnap.data()!;
      const user = userSnap.data()!;

      if (user.clubId) throw { code: 409, message: "Already in a club" };
      if (club.memberCount >= club.maxMembers) throw { code: 400, message: "Club is full" };
      if ((club.memberUids as string[]).includes(uid)) throw { code: 409, message: "Already a member" };
      if (!club.isPublic) throw { code: 403, message: "Club is private" };

      tx.update(clubRef, {
        memberUids:  admin.firestore.FieldValue.arrayUnion(uid),
        memberCount: admin.firestore.FieldValue.increment(1),
      });
      tx.set(clubRef.collection("members").doc(uid), {
        uid,
        displayName: user.displayName ?? "",
        photoUrl:    user.photoUrl ?? "",
        level:       user.level ?? 0,
        rating:      user.rating ?? 1000,
        wins:        user.wins ?? 0,
        role:        "MEMBER",
        joinedAt:    Date.now(),
      });
      tx.update(userRef, { clubId, clubName: club.name, clubRole: "MEMBER" });
    });

    res.json({ ok: true });

    // Bot boshqaruvini asinxron tekshirish
    checkAndManageBots(clubId).catch(console.error);
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string };
    if (e.code) { res.status(e.code).json({ error: "error", message: e.message }); return; }
    console.error("joinClub error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /club/leave
router.post("/leave", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    const { clubId } = req.body as { clubId: string };

    const clubRef  = db().collection("clubs").doc(clubId);
    const clubSnap = await clubRef.get();
    if (!clubSnap.exists) { res.status(404).json({ error: "not-found", message: "Club not found" }); return; }

    const club = clubSnap.data()!;
    if (club.adminUid === uid) {
      res.status(400).json({ error: "failed-precondition", message: "Admin cannot leave. Transfer ownership or dissolve the club." });
      return;
    }

    const batch = db().batch();
    batch.delete(clubRef.collection("members").doc(uid));
    batch.update(clubRef, {
      memberUids:  admin.firestore.FieldValue.arrayRemove(uid),
      memberCount: admin.firestore.FieldValue.increment(-1),
    });
    batch.update(db().collection("users").doc(uid), { clubId: "", clubName: "", clubRole: "MEMBER" });
    await batch.commit();
    res.json({ ok: true });

    // Bot boshqaruvini asinxron tekshirish
    checkAndManageBots(clubId).catch(console.error);
  } catch (err) {
    console.error("leaveClub error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /club/settings
router.post("/settings", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    const { clubId, name, description, badgeEmoji, primaryColor, bannerStyle, isPublic, announcements } = req.body as {
      clubId: string; name: string; description: string; badgeEmoji: string;
      primaryColor: string; bannerStyle: string; isPublic: boolean; announcements: string;
    };

    const clubSnap = await db().collection("clubs").doc(clubId).get();
    if (!clubSnap.exists) { res.status(404).json({ error: "not-found", message: "Club not found" }); return; }
    if (clubSnap.data()!.adminUid !== uid) { res.status(403).json({ error: "permission-denied", message: "Admins only" }); return; }
    if (!name || name.trim().length < 3) { res.status(400).json({ error: "invalid-argument", message: "Invalid name" }); return; }

    await db().collection("clubs").doc(clubId).update({
      name:          name.trim().slice(0, 30),
      description:   (description ?? "").trim().slice(0, 150),
      badgeEmoji:    badgeEmoji ?? "♟",
      primaryColor:  primaryColor ?? "#D4A24C",
      bannerStyle:   bannerStyle ?? "wood",
      isPublic:      isPublic ?? true,
      announcements: (announcements ?? "").trim().slice(0, ANNOUNCEMENT_MAX),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("updateClubSettings error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /club/kick
router.post("/kick", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const callerUid = req.uid!;
    const { clubId, targetUid } = req.body as { clubId: string; targetUid: string };

    const clubRef  = db().collection("clubs").doc(clubId);
    const clubSnap = await clubRef.get();
    if (!clubSnap.exists) { res.status(404).json({ error: "not-found", message: "Club not found" }); return; }

    const club = clubSnap.data()!;
    const callerMemberSnap = await clubRef.collection("members").doc(callerUid).get();
    const callerRole = callerMemberSnap.data()?.role ?? "MEMBER";
    if (callerRole === "MEMBER") { res.status(403).json({ error: "permission-denied", message: "Only admin/officer can kick" }); return; }
    if (club.adminUid === targetUid) { res.status(400).json({ error: "invalid-argument", message: "Cannot kick the admin" }); return; }

    const targetSnap = await clubRef.collection("members").doc(targetUid).get();
    const targetRole = targetSnap.data()?.role ?? "MEMBER";
    if (callerRole === "OFFICER" && targetRole !== "MEMBER") {
      res.status(403).json({ error: "permission-denied", message: "Officers can only kick regular members" });
      return;
    }

    const batch = db().batch();
    batch.delete(clubRef.collection("members").doc(targetUid));
    batch.update(clubRef, {
      memberUids:  admin.firestore.FieldValue.arrayRemove(targetUid),
      memberCount: admin.firestore.FieldValue.increment(-1),
    });
    batch.update(db().collection("users").doc(targetUid), { clubId: "", clubName: "", clubRole: "MEMBER" });
    await batch.commit();
    res.json({ ok: true });
  } catch (err) {
    console.error("kickMember error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /club/message
router.post("/message", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    const { clubId, text } = req.body as { clubId: string; text: string };

    if (!text || text.trim().length === 0) { res.status(400).json({ error: "invalid-argument", message: "Message cannot be empty" }); return; }
    if (text.length > CHAT_MAX_LENGTH) { res.status(400).json({ error: "invalid-argument", message: `Max ${CHAT_MAX_LENGTH} characters` }); return; }

    const clubRef    = db().collection("clubs").doc(clubId);
    const memberSnap = await clubRef.collection("members").doc(uid).get();
    if (!memberSnap.exists) { res.status(403).json({ error: "permission-denied", message: "You are not a member of this club" }); return; }

    const userSnap = await db().collection("users").doc(uid).get();
    const user     = userSnap.data()!;

    const msgRef = clubRef.collection("messages").doc();
    await msgRef.set({
      id:             msgRef.id,
      clubId,
      senderUid:      uid,
      senderName:     user.displayName ?? "",
      senderPhotoUrl: user.photoUrl ?? "",
      senderLevel:    user.level ?? 0,
      text:           text.trim(),
      timestamp:      Date.now(),
    });

    res.json({ ok: true, messageId: msgRef.id });
  } catch (err) {
    console.error("sendClubMessage error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /club/dissolve
router.post("/dissolve", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid = req.uid!;
    const { clubId } = req.body as { clubId: string };

    const clubRef  = db().collection("clubs").doc(clubId);
    const clubSnap = await clubRef.get();
    if (!clubSnap.exists) { res.status(404).json({ error: "not-found", message: "Club not found" }); return; }
    if (clubSnap.data()!.adminUid !== uid) { res.status(403).json({ error: "permission-denied", message: "Admins only" }); return; }

    const memberSnaps = await clubRef.collection("members").get();
    const batch = db().batch();
    memberSnaps.docs.forEach((doc) => {
      batch.update(db().collection("users").doc(doc.id), { clubId: "", clubName: "", clubRole: "MEMBER" });
      batch.delete(doc.ref);
    });
    batch.delete(clubRef);
    await batch.commit();
    res.json({ ok: true });
  } catch (err) {
    console.error("dissolveClub error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

// POST /club/bio
router.post("/bio", requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const uid     = req.uid!;
    const { bio } = req.body as { bio: string };
    const clean   = (bio ?? "").trim().slice(0, BIO_MAX_LENGTH);
    await db().collection("users").doc(uid).update({ bio: clean });
    res.json({ ok: true });
  } catch (err) {
    console.error("updateBio error:", err);
    res.status(500).json({ error: "internal", message: "Server error" });
  }
});

export default router;
