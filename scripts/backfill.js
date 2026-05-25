/**
 * One-time backfill for fields introduced by the bug-fix phase:
 *
 *   - music.titleLower / music.artistLower  (case-insensitive search)
 *   - music.likeCount                        (counter sanity if missing)
 *   - musicPosts.likeCount / commentCount    (denormalized feed counters)
 *   - users/{u}/likedSongs/{s}               (reverse index built from
 *                                            music/{s}/likes/{u})
 *
 * Usage:
 *   node scripts/backfill.js                 # do everything
 *   node scripts/backfill.js music           # just lower-case indexes
 *   node scripts/backfill.js posts           # just post counters
 *   node scripts/backfill.js liked-songs     # just reverse like index
 *   node scripts/backfill.js users           # follower/following counts + visibility + unreadNotificationCount
 *
 * Safe to run multiple times — every step is idempotent.
 */
import { initFirebase, db } from "../config/firebase.js";
import { COLLECTIONS, SUBCOLLECTIONS } from "../utils/collections.js";
import { logger } from "../utils/logger.js";

initFirebase();

const BATCH_LIMIT = 400;

async function flushBatch(batch, count) {
  if (count === 0) return 0;
  await batch.commit();
  return count;
}

async function backfillMusicLowerFields() {
  logger.info("Backfilling music.titleLower / music.artistLower …");
  const snap = await db().collection(COLLECTIONS.MUSIC).get();
  let batch = db().batch();
  let pending = 0;
  let touched = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const update = {};
    if (data.title && !data.titleLower) {
      update.titleLower = String(data.title).toLowerCase();
    }
    if (data.artist && !data.artistLower) {
      update.artistLower = String(data.artist).toLowerCase();
    }
    if (typeof data.likeCount !== "number") {
      update.likeCount = 0;
    }
    if (Object.keys(update).length === 0) continue;

    batch.update(doc.ref, update);
    pending++;
    touched++;
    if (pending >= BATCH_LIMIT) {
      await flushBatch(batch, pending);
      batch = db().batch();
      pending = 0;
    }
  }
  await flushBatch(batch, pending);
  logger.info({ touched, total: snap.size }, "music backfill complete");
}

async function backfillPostCounters() {
  logger.info("Backfilling musicPosts.likeCount / commentCount …");
  const postsSnap = await db().collection(COLLECTIONS.MUSIC_POSTS).get();
  let touched = 0;
  for (const post of postsSnap.docs) {
    const data = post.data();
    if (
      typeof data.likeCount === "number" &&
      typeof data.commentCount === "number"
    ) {
      continue;
    }
    const [likesAgg, commentsAgg] = await Promise.all([
      post.ref.collection(SUBCOLLECTIONS.LIKES).count().get(),
      post.ref.collection(SUBCOLLECTIONS.COMMENTS).count().get(),
    ]);
    await post.ref.update({
      likeCount: likesAgg.data().count,
      commentCount: commentsAgg.data().count,
    });
    touched++;
  }
  logger.info({ touched, total: postsSnap.size }, "post counter backfill complete");
}

async function backfillReverseLikes() {
  logger.info("Backfilling users/{u}/likedSongs from music/{s}/likes …");
  const songsSnap = await db().collection(COLLECTIONS.MUSIC).get();
  let touched = 0;
  for (const song of songsSnap.docs) {
    const likes = await song.ref.collection(SUBCOLLECTIONS.LIKES).get();
    if (likes.empty) continue;
    const songData = song.data();
    const snapshotFields = {
      songId: song.id,
      title: songData.title || "",
      artist: songData.artist || "",
      albumArtUrl: songData.albumArtUrl || null,
      fileUrl: songData.fileUrl || null,
      duration: songData.duration || 0,
    };
    let batch = db().batch();
    let pending = 0;
    for (const like of likes.docs) {
      const userId = like.id;
      const likedAt = like.data().createdAt || new Date();
      const ref = db()
        .collection(COLLECTIONS.USERS)
        .doc(userId)
        .collection(SUBCOLLECTIONS.LIKED_SONGS)
        .doc(song.id);
      batch.set(ref, { ...snapshotFields, likedAt }, { merge: true });
      pending++;
      touched++;
      if (pending >= BATCH_LIMIT) {
        await batch.commit();
        batch = db().batch();
        pending = 0;
      }
    }
    if (pending > 0) await batch.commit();
  }
  logger.info({ touched }, "reverse-like backfill complete");
}

async function backfillUserSocialFields() {
  logger.info(
    "Backfilling users.{followerCount, followingCount, visibility, unreadNotificationCount} …"
  );
  const snap = await db().collection(COLLECTIONS.USERS).get();
  let batch = db().batch();
  let pending = 0;
  let touched = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const update = {};
    if (typeof data.followerCount !== "number") update.followerCount = 0;
    if (typeof data.followingCount !== "number") update.followingCount = 0;
    if (!data.visibility) update.visibility = "public";
    if (typeof data.unreadNotificationCount !== "number") {
      update.unreadNotificationCount = 0;
    }
    if (Object.keys(update).length === 0) continue;

    batch.update(doc.ref, update);
    pending++;
    touched++;
    if (pending >= BATCH_LIMIT) {
      await flushBatch(batch, pending);
      batch = db().batch();
      pending = 0;
    }
  }
  await flushBatch(batch, pending);
  logger.info(
    { touched, total: snap.size },
    "user social-fields backfill complete"
  );
}

async function main() {
  const which = process.argv[2] || "all";
  if (which === "all" || which === "music") await backfillMusicLowerFields();
  if (which === "all" || which === "posts") await backfillPostCounters();
  if (which === "all" || which === "liked-songs") await backfillReverseLikes();
  if (which === "all" || which === "users") await backfillUserSocialFields();
  logger.info("All requested backfills complete.");
  process.exit(0);
}

main().catch((err) => {
  logger.fatal({ err }, "Backfill failed");
  process.exit(1);
});
