// config/firebase.js
import admin from "firebase-admin";
import { getStorage } from "firebase-admin/storage";

// ----- BACKEND FIREBASE PROJECT (your main backend) -----
const backendServiceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
};

// Initialize main backend Firebase Admin app
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(backendServiceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET, // optional, for backend storage if needed
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket(); // backend storage bucket (if used)

// ----- FRONTEND FIREBASE PROJECT (for signed URLs) -----
let frontendBucket = null;

try {
  // Parse the frontend service account JSON from environment variable
  const frontendServiceAccount = JSON.parse(process.env.FRONTEND_FIREBASE_SERVICE_ACCOUNT);

  // Initialize a separate Firebase Admin app for the frontend project
  const frontendApp = admin.initializeApp(
    {
      credential: admin.credential.cert(frontendServiceAccount),
      // Optionally set storage bucket explicitly; if not set, will use default <project_id>.appspot.com
      storageBucket: process.env.FRONTEND_STORAGE_BUCKET, // e.g., "coozie-db.firebasestorage.app"
    },
    "frontend" // Give it a name to distinguish from the default app
  );

  // Get the bucket for the frontend project
  frontendBucket = admin.storage(frontendApp).bucket(process.env.FRONTEND_STORAGE_BUCKET);
  console.log("Frontend Firebase Storage initialized successfully");
} catch (error) {
  console.error("Failed to initialize frontend Firebase project:", error.message);
  // Optionally throw if this is critical; otherwise, frontendBucket remains null
}

export { db, bucket, frontendBucket };
