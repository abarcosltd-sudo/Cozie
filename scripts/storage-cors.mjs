/**
 * Apply / verify CORS configuration on the Firebase Storage bucket
 * fronting our music library. Required by the reels music-merge
 * pipeline: the in-browser MusicTrimmer does a HEAD-CORS pre-check and
 * `videoMerge.ts` does a `fetch(songUrl)` to pull the bytes into
 * ffmpeg.wasm. Without CORS the browser blocks both.
 *
 * Why a custom script instead of `gsutil cors set`?
 *   - The repo already has firebase-admin + the frontend service-account
 *     env we'd authenticate gsutil with, so we save a tooling install.
 *   - Verification can read back the live config and compare with our
 *     desired one — useful in CI / smoke tests.
 *
 * Usage:
 *   # Apply storage.cors.json to the bucket pointed at by
 *   # FRONTEND_FIREBASE_SERVICE_ACCOUNT + FRONTEND_STORAGE_BUCKET.
 *   node scripts/storage-cors.mjs apply
 *
 *   # Just read what's currently applied (read-only; safe in prod).
 *   node scripts/storage-cors.mjs verify
 *
 *   # Read-only diff against storage.cors.json (non-zero exit on drift).
 *   node scripts/storage-cors.mjs diff
 *
 * Required env (see Cozie/.env.example):
 *   FRONTEND_FIREBASE_SERVICE_ACCOUNT  — full service-account JSON
 *   FRONTEND_STORAGE_BUCKET            — optional, defaults to
 *                                        `<project_id>.appspot.com`
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initFirebase, requireFrontendBucket } from "../config/firebase.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORS_FILE = resolve(__dirname, "..", "storage.cors.json");

function readDesired() {
  try {
    const raw = readFileSync(CORS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Could not read ${CORS_FILE}: ${err.message}`);
    process.exit(1);
  }
}

function normalize(rules) {
  // Sort `origin` / `method` / `responseHeader` so the diff is stable
  // across hand-edits. Stringify with stable key order.
  const sorted = (rules || []).map((r) => ({
    origin: [...(r.origin || [])].sort(),
    method: [...(r.method || [])].sort(),
    responseHeader: [...(r.responseHeader || [])].sort(),
    maxAgeSeconds: r.maxAgeSeconds ?? 0,
  }));
  return JSON.stringify(sorted, null, 2);
}

async function getLiveCors() {
  const bucket = requireFrontendBucket();
  const [metadata] = await bucket.getMetadata();
  return metadata.cors || [];
}

async function apply() {
  const desired = readDesired();
  const bucket = requireFrontendBucket();
  console.log(`Applying CORS to bucket: ${bucket.name}`);
  await bucket.setCorsConfiguration(desired);
  const live = await getLiveCors();
  console.log("Applied. Live config now:");
  console.log(normalize(live));
}

async function verify() {
  const live = await getLiveCors();
  if (!live.length) {
    console.warn("No CORS rules currently set on the bucket.");
    process.exit(2);
  }
  console.log("Live CORS configuration:");
  console.log(normalize(live));
}

async function diff() {
  const desired = readDesired();
  const [desiredStr, liveStr] = [normalize(desired), normalize(await getLiveCors())];
  if (desiredStr === liveStr) {
    console.log("CORS in sync with storage.cors.json");
    return;
  }
  console.error("CORS drift detected:");
  console.error("--- desired ---");
  console.error(desiredStr);
  console.error("--- live ---");
  console.error(liveStr);
  process.exit(2);
}

async function main() {
  const cmd = process.argv[2];
  initFirebase();

  switch (cmd) {
    case "apply":
      await apply();
      break;
    case "verify":
      await verify();
      break;
    case "diff":
      await diff();
      break;
    default:
      console.error(
        `Usage: node scripts/storage-cors.mjs <apply|verify|diff>`
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
