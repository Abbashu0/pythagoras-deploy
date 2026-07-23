/**
 * firebase-server.ts
 * ==================
 * Server-side Firebase Admin SDK initialization.
 *
 * Used ONLY in API routes and server components (Next.js server context).
 * Grants full admin access to Firestore, Auth, and Storage.
 *
 * SECURITY: This file MUST NEVER be imported in client-side code.
 * The private key is read from environment variables.
 *
 * Usage:
 *   import { adminDb, adminAuth, adminStorage } from "@/lib/firebase/firebase-server";
 *
 *   const snapshot = await adminDb.collection("questions").get();
 */

import * as admin from "firebase-admin";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";
import { getAuth as getAdminAuthFn } from "firebase-admin/auth";
import { getStorage as getAdminStorageFn } from "firebase-admin/storage";

let adminApp: admin.app.App | null = null;

function getAdminApp(): admin.app.App {
  if (adminApp) return adminApp;

  // Check if a default app already exists (e.g., from HMR in dev mode)
  const existingApps = admin.getApps();
  if (existingApps.length > 0) {
    adminApp = admin.app();
    return adminApp;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  // The private key may have escaped newlines (\n) in .env — convert to real newlines
  const privateKey = privateKeyRaw
    ? privateKeyRaw.replace(/\\n/g, "\n")
    : undefined;

  console.log("[Firebase Admin] Environment check:", {
    hasProjectId: !!projectId,
    hasClientEmail: !!clientEmail,
    hasPrivateKey: !!privateKey,
    privateKeyLength: privateKey?.length || 0,
    privateKeyStartsWith: privateKey?.substring(0, 30) || "MISSING",
  });

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      `Firebase Admin SDK missing env vars: projectId=${!!projectId}, clientEmail=${!!clientEmail}, privateKey=${!!privateKey}`
    );
  }

  try {
    adminApp = admin.initializeApp({
      credential: admin.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      databaseURL: process.env.FIREBASE_DATABASE_URL,
    });
    console.log("[Firebase Admin] Initialized successfully");
  } catch (e) {
    console.error("[Firebase Admin] Initialization failed:", e);
    throw e;
  }

  return adminApp;
}

// Lazy-initialized singletons — use getter functions, not direct exports
// This prevents initialization errors at module load time
let _adminDb: FirebaseFirestore.Firestore | null = null;
let _adminAuth: admin.auth.Auth | null = null;
let _adminStorage: admin.storage.Storage | null = null;

/** Admin Firestore instance (server-side only). */
export function getAdminDb(): FirebaseFirestore.Firestore {
  if (!_adminDb) {
    const app = getAdminApp();
    _adminDb = getAdminFirestore(app);
  }
  return _adminDb;
}

/** Admin Auth instance (server-side only). */
export function getAdminAuth(): admin.auth.Auth {
  if (!_adminAuth) {
    const app = getAdminApp();
    _adminAuth = getAdminAuthFn(app);
  }
  return _adminAuth;
}

/** Admin Storage instance (server-side only). */
export function getAdminStorage(): admin.storage.Storage {
  if (!_adminStorage) {
    const app = getAdminApp();
    _adminStorage = getAdminStorageFn(app);
  }
  return _adminStorage;
}

// Convenience exports — initialized lazily on first access
export const adminDb = new Proxy({} as FirebaseFirestore.Firestore, {
  get(_target, prop) {
    return Reflect.get(getAdminDb(), prop);
  },
});

export const adminAuth = new Proxy({} as admin.auth.Auth, {
  get(_target, prop) {
    return Reflect.get(getAdminAuth(), prop);
  },
});

export const adminStorage = new Proxy({} as admin.storage.Storage, {
  get(_target, prop) {
    return Reflect.get(getAdminStorage(), prop);
  },
});
