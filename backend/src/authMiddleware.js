import { admin } from "./firebaseAdmin.js";

export async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, message: "Missing bearer token." });
    return;
  }

  const token = authHeader.slice("Bearer ".length).trim();

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (!decoded.email_verified) {
      res.status(403).json({
        success: false,
        message: "Email not verified. Please verify your email before accessing the system.",
      });
      return;
    }
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: "Invalid Firebase token.", error: error.message });
  }
}
