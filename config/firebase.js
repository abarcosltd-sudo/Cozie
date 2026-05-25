import admin from "firebase-admin";
import { env } from "./env.js";

let firestoreInstance = null;
let frontendBucketInstance = null;

function buildBackendServiceAccount() {
  return {
    type: "service_account",
    project_id: env.FIREBASE_PROJECT_ID,
    private_key_id: env.FIREBASE_PRIVATE_KEY_ID,
    private_key: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    client_email: env.FIREBASE_CLIENT_EMAIL,
    client_id: env.FIREBASE_CLIENT_ID,
  };
}

function tryInitFrontendBucket() {
  if (!env.FRONTEND_FIREBASE_SERVICE_ACCOUNT) {
    return null;
  }
  try {
    const serviceAccount = JSON.parse(env.FRONTEND_FIREBASE_SERVICE_ACCOUNT);
    const bucketName =
      env.FRONTEND_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`;

    const frontendApp = admin.initializeApp(
      {
        credential: admin.credential.cert(serviceAccount),
        storageBucket: bucketName,
      },
      "frontend"
    );

    return admin.storage(frontendApp).bucket(bucketName);
  } catch (err) {
    console.error(
      "Failed to initialise frontend Firebase project:",
      err.message
    );
    return null;
  }
}

export function initFirebase() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(buildBackendServiceAccount()),
    });
  }
  firestoreInstance = admin.firestore();
  frontendBucketInstance = tryInitFrontendBucket();
  return { db: firestoreInstance, frontendBucket: frontendBucketInstance };
}

export function db() {
  if (!firestoreInstance) {
    throw new Error(
      "Firebase has not been initialised. Call initFirebase() during startup."
    );
  }
  return firestoreInstance;
}

export function frontendBucket() {
  return frontendBucketInstance;
}

export function requireFrontendBucket() {
  if (!frontendBucketInstance) {
    throw new Error(
      "Frontend Firebase Storage bucket is not configured. Set FRONTEND_FIREBASE_SERVICE_ACCOUNT."
    );
  }
  return frontendBucketInstance;
}
