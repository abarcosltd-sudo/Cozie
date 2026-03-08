// config/firebase.js
import admin from "firebase-admin";

// ----- BACKEND FIREBASE PROJECT (your main backend) -----
const backendServiceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
};

// Initialize main backend Firebase Admin app (if not already)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(backendServiceAccount),
  });
}

const db = admin.firestore();
//const bucket = admin.storage().bucket(); // backend storage (may be null if no bucket set)

// ----- FRONTEND FIREBASE PROJECT (for signed URLs) -----
let frontendBucket = null;

if (process.env.FRONTEND_FIREBASE_SERVICE_ACCOUNT) {
  try {
    const frontendServiceAccount = JSON.parse(process.env.FRONTEND_FIREBASE_SERVICE_ACCOUNT);

    // Determine bucket name: use env var or fallback to <project_id>.appspot.com
    const frontendBucketName = process.env.FRONTEND_STORAGE_BUCKET || 
                               `${frontendServiceAccount.project_id}.appspot.com`;

    if (!frontendBucketName) {
      throw new Error('Could not determine frontend storage bucket name.');
    }

    // Initialize a separate Firebase Admin app for the frontend project
    const frontendApp = admin.initializeApp(
      {
        credential: admin.credential.cert(frontendServiceAccount),
        storageBucket: frontendBucketName,
      },
      "frontend" // unique name to avoid conflict with default app
    );

    // Get the bucket
    frontendBucket = admin.storage(frontendApp).bucket(frontendBucketName);
    console.log(`Frontend Firebase Storage initialized with bucket: ${frontendBucketName}`);
  } catch (error) {
    console.error("Failed to initialize frontend Firebase project:", error.message);
    // frontendBucket remains null – endpoints must handle this gracefully
  }
} else {
  console.warn("⚠️ FRONTEND_FIREBASE_SERVICE_ACCOUNT not set. Frontend storage not available.");
}

export { db, frontendBucket };
