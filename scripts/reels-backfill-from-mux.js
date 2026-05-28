/**
 * One-shot rescue script for reels that are stuck in `pending_upload` or
 * `processing` because the Mux webhook never delivered.
 *
 * What it does:
 *   1. Loads .env (so FIREBASE_* and MUX_* are available exactly as the
 *      backend sees them).
 *   2. Initialises the same Firestore admin client the app uses.
 *   3. Scans the `reels` collection for non-terminal statuses.
 *   4. For each match, calls `reelService.reconcileFromMux(reelId, userId)`
 *      — the same service method the live `/api/reels/:reelId/reconcile`
 *      endpoint calls. Mux is the source of truth; we just mirror it.
 *   5. Logs every transition; the script is idempotent so it can be
 *      re-run safely (already-ready reels are no-ops).
 *
 * Usage:
 *   node scripts/reels-backfill-from-mux.js
 *
 * Optional env knobs:
 *   BACKFILL_LIMIT      – cap on docs to process (default 500)
 *   BACKFILL_DRY_RUN    – "1" prints what WOULD change without writing
 *   BACKFILL_REEL_ID    – process just this one reel id and exit
 *   BACKFILL_OLDER_THAN – ISO timestamp; only consider reels older than this
 *                         (useful to avoid racing the live upload flow)
 *
 * Required env (same as the API):
 *   FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY_ID, FIREBASE_PRIVATE_KEY,
 *   FIREBASE_CLIENT_EMAIL, FIREBASE_CLIENT_ID
 *   MUX_TOKEN_ID, MUX_TOKEN_SECRET
 *
 * Safety:
 *   - Read-only on Mux; we never delete an asset here (the service WILL
 *     delete over-cap assets, matching webhook behaviour).
 *   - Writes only the fields the webhook would set — no schema drift.
 */

import "dotenv/config";
import { initFirebase } from "../config/firebase.js";
import { reelRepository } from "../repositories/reelRepository.js";
import { reelService } from "../services/reelService.js";
import { REEL_STATUS } from "../utils/collections.js";

const BATCH_SIZE = 50;
const SLEEP_BETWEEN_CALLS_MS = 200; // be polite to the Mux API

const DRY_RUN = process.env.BACKFILL_DRY_RUN === "1";
const LIMIT = Number(process.env.BACKFILL_LIMIT || 500);
const SINGLE_REEL_ID = process.env.BACKFILL_REEL_ID || null;
const OLDER_THAN_ISO = process.env.BACKFILL_OLDER_THAN || null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Walk the reels collection in batches, pulling only docs in non-terminal
 * states. We page with a `__name__` cursor so we don't need a composite
 * index just for the script.
 */
async function* iterateStuckReels(db) {
  const targetStatuses = [
    REEL_STATUS.PENDING_UPLOAD,
    REEL_STATUS.PROCESSING,
  ];
  for (const status of targetStatuses) {
    let lastDoc = null;
    let pulled = 0;
    while (pulled < LIMIT) {
      let q = db
        .collection("reels")
        .where("status", "==", status)
        .orderBy("__name__")
        .limit(BATCH_SIZE);
      if (lastDoc) q = q.startAfter(lastDoc);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        pulled += 1;
        yield { id: doc.id, ...doc.data() };
        if (pulled >= LIMIT) break;
      }
      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < BATCH_SIZE) break;
    }
  }
}

async function processReel(reel) {
  const before = {
    status: reel.status,
    playbackId: reel.muxPlaybackId ?? null,
  };

  // Mirror the live endpoint's authorization: reconcileFromMux requires
  // the viewer to be the author. The script acts AS the author, so we
  // pass `reel.userId` for both args.
  if (DRY_RUN) {
    console.log(
      `[dry-run] would reconcile reel=${reel.id} (status=${reel.status} muxUploadId=${reel.muxUploadId || "?"} muxAssetId=${reel.muxAssetId || "?"})`
    );
    return { reelId: reel.id, before, after: before, skipped: true };
  }

  try {
    const result = await reelService.reconcileFromMux(reel.id, reel.userId);
    // The service returns the publicReel shape — `playbackId` only exists
    // once the reel is READY, so compare on the fields it actually emits.
    const after = {
      status: result.reel.status,
      playbackId: result.reel.playbackId ?? null,
    };
    const changed =
      before.status !== after.status ||
      before.playbackId !== after.playbackId;
    return { reelId: reel.id, before, after, changed };
  } catch (err) {
    return { reelId: reel.id, before, error: err.message };
  }
}

async function main() {
  const { db } = initFirebase();
  const olderThan = OLDER_THAN_ISO ? new Date(OLDER_THAN_ISO) : null;

  console.log(
    `[backfill] starting — dryRun=${DRY_RUN} limit=${LIMIT} singleReel=${SINGLE_REEL_ID || "(all stuck)"} olderThan=${olderThan?.toISOString() || "(none)"}`
  );

  let scanned = 0;
  let changed = 0;
  let unchanged = 0;
  let failed = 0;
  const failures = [];

  const work = async (reel) => {
    scanned += 1;
    if (olderThan) {
      const ts =
        reel.createdAt?.toDate?.()?.getTime() ??
        new Date(reel.createdAt).getTime();
      if (Number.isFinite(ts) && ts > olderThan.getTime()) {
        return; // newer than the cutoff — skip
      }
    }
    const result = await processReel(reel);
    if (result.error) {
      failed += 1;
      failures.push({ id: result.reelId, error: result.error });
      console.error(
        `[backfill] reel=${result.reelId} FAILED: ${result.error}`
      );
    } else if (result.skipped) {
      // dry-run only — already logged
    } else if (result.changed) {
      changed += 1;
      console.log(
        `[backfill] reel=${result.reelId} ${result.before.status} → ${result.after.status}` +
          (result.after.playbackId
            ? ` (playbackId=${result.after.playbackId})`
            : "")
      );
    } else {
      unchanged += 1;
      console.log(
        `[backfill] reel=${result.reelId} unchanged (status=${result.after.status})`
      );
    }
    await sleep(SLEEP_BETWEEN_CALLS_MS);
  };

  if (SINGLE_REEL_ID) {
    const reel = await reelRepository.findById(SINGLE_REEL_ID);
    if (!reel) {
      console.error(`[backfill] reel=${SINGLE_REEL_ID} not found`);
      process.exit(1);
    }
    await work(reel);
  } else {
    for await (const reel of iterateStuckReels(db)) {
      await work(reel);
    }
  }

  console.log(
    `[backfill] done — scanned=${scanned} changed=${changed} unchanged=${unchanged} failed=${failed}`
  );
  if (failures.length) {
    console.log("[backfill] failures:");
    for (const f of failures) console.log(`  - ${f.id}: ${f.error}`);
  }

  // Force-exit because the firebase-admin SDK keeps gRPC sockets open
  // long after we're done; we don't want the script to hang in CI.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(2);
});
