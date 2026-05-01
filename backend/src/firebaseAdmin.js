import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import dotenv from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(moduleDir, "..", ".env") });

function resolveServiceAccountPath(inputPath) {
  const candidates = path.isAbsolute(inputPath)
    ? [inputPath]
    : [
        path.resolve(process.cwd(), inputPath),
        path.resolve(moduleDir, inputPath),
        path.resolve(moduleDir, "..", inputPath),
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  // In hosted environments (Render, Vercel, etc), require secret env var and
  // do not allow local key-file paths.
  if (process.env.NODE_ENV === "production") {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON in production.");
  }

  const p = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (p) {
    const abs = resolveServiceAccountPath(p);
    if (!abs) {
      throw new Error(`Firebase service account file not found for path: ${p}`);
    }

    const raw = fs.readFileSync(abs, "utf-8");
    return JSON.parse(raw);
  }

  throw new Error("Missing Firebase service account. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.");
}

if (!admin.apps.length) {
  const serviceAccount = readServiceAccount();
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

export { admin, db };
