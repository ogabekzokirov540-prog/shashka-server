// ─────────────────────────────────────────────
//  Firebase Auth middleware
// ─────────────────────────────────────────────
import { Request, Response, NextFunction } from "express";
import * as admin from "firebase-admin";

export interface AuthRequest extends Request {
  uid?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthenticated", message: "Login required" });
    return;
  }
  const token = authHeader.split("Bearer ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: "unauthenticated", message: "Invalid token" });
  }
}
