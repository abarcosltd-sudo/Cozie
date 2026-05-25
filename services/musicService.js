import { AppError } from "../utils/AppError.js";
import { db } from "../config/firebase.js";
import { musicRepository } from "../repositories/musicRepository.js";
import { userRepository } from "../repositories/userRepository.js";
import { notificationService } from "./notificationService.js";

function toSummary(song) {
  return {
    id: song.id,
    title: song.title || "Untitled",
    artist: song.artist || "Unknown Artist",
    albumArtUrl: song.albumArtUrl || null,
    fileUrl: song.fileUrl || null,
    duration: song.duration || 0,
    genre: song.genre || null,
    releaseYear: song.releaseYear || null,
    likeCount: song.likeCount || 0,
  };
}

function toLikedSongSnapshot(song) {
  return {
    songId: song.id,
    title: song.title || "",
    artist: song.artist || "",
    albumArtUrl: song.albumArtUrl || null,
    fileUrl: song.fileUrl || null,
    duration: song.duration || 0,
  };
}

export const musicService = {
  async addMusic(userId, payload) {
    const now = new Date();
    const title = payload.title || "";
    const artist = payload.artist || "";
    const data = {
      ...payload,
      // Lower-case copies so prefix search is case-insensitive without
      // pulling every doc client-side. Firestore range queries are case-
      // sensitive, so we maintain these alongside the original fields.
      titleLower: title.toLowerCase(),
      artistLower: artist.toLowerCase(),
      userId,
      likeCount: 0,
      favoriteCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const { id } = await musicRepository.create(data);
    return { musicId: id };
  },

  async search(query) {
    if (!query || !query.trim()) {
      return { songs: [] };
    }
    const term = query.trim().toLowerCase();
    const end = term.replace(/.$/, (c) =>
      String.fromCharCode(c.charCodeAt(0) + 1)
    );

    const [byTitle, byArtist] = await Promise.all([
      musicRepository.findByTitlePrefix(term, end),
      musicRepository.findByArtistPrefix(term, end),
    ]);

    const map = new Map();
    for (const doc of byTitle) map.set(doc.id, doc);
    for (const doc of byArtist) if (!map.has(doc.id)) map.set(doc.id, doc);

    const songs = Array.from(map.values()).map((doc) => ({
      id: doc.id,
      title: doc.title || "",
      artist: doc.artist || "",
      albumArtUrl: doc.albumArtUrl || null,
    }));

    return { songs };
  },

  async listTrending() {
    const items = await musicRepository.listNewest(20);
    return { trending: items.map(toSummary) };
  },

  async listTopCharts() {
    const items = await musicRepository.listMostLiked(20);
    return {
      charts: items.map((song, index) => ({
        ...toSummary(song),
        number: index + 1,
      })),
    };
  },

  async getSong(songId) {
    const song = await musicRepository.findById(songId);
    if (!song) throw AppError.notFound("Song not found");
    return { song: toSummary(song), queue: [] };
  },

  /**
   * Toggle a "like" on a song atomically. Maintains three things in a single
   * Firestore transaction so concurrent clicks (or a flaky retry) can't
   * corrupt state:
   *
   *   1. music/{songId}/likes/{userId}            — canonical like record
   *   2. users/{userId}/likedSongs/{songId}       — reverse index for fast
   *                                                "my liked songs" lookup
   *   3. music/{songId}.likeCount                 — denormalized counter
   *
   * Resolves the "race conditions on toggle likes" item from the audit.
   */
  async toggleSongLike(songId, user) {
    const songRef = musicRepository.ref(songId);
    const likeRef = musicRepository.likeRef(songId, user.id);
    const reverseRef = userRepository.likedSongRef(user.id, songId);

    const result = await db().runTransaction(async (tx) => {
      // All reads must happen before any writes inside a Firestore tx.
      const [songSnap, likeSnap] = await Promise.all([
        tx.get(songRef),
        tx.get(likeRef),
      ]);

      if (!songSnap.exists) throw AppError.notFound("Song not found");

      const song = songSnap.data();
      const currentLikeCount = song.likeCount || 0;
      const now = new Date();

      let liked;
      let newLikeCount;

      if (likeSnap.exists) {
        tx.delete(likeRef);
        tx.delete(reverseRef);
        // Clamp at 0 in case the counter was already stale before this call.
        newLikeCount = Math.max(0, currentLikeCount - 1);
        liked = false;
      } else {
        tx.set(likeRef, {
          userId: user.id,
          userName: user.displayName || user.fullname || "User",
          userAvatarUrl: user.photoURL || null,
          createdAt: now,
        });
        tx.set(reverseRef, {
          ...toLikedSongSnapshot({ id: songId, ...song }),
          likedAt: now,
        });
        newLikeCount = currentLikeCount + 1;
        liked = true;
      }

      tx.update(songRef, { likeCount: newLikeCount, updatedAt: now });
      return {
        liked,
        likeCount: newLikeCount,
        songSnapshot: { id: songId, ...song },
      };
    });

    // Notify the song uploader (or withdraw an existing one on un-like).
    // Side-effect runs after the tx commits so a notification failure can
    // never roll back the like itself.
    const { songSnapshot } = result;
    if (result.liked) {
      await notificationService.emitSongLike({
        actorUser: user,
        song: songSnapshot,
      });
    } else {
      await notificationService.withdrawSongLike({
        actorUserId: user.id,
        song: songSnapshot,
      });
    }

    return { liked: result.liked, likeCount: result.likeCount };
  },

  async listSongLikes(songId, currentUserId) {
    const song = await musicRepository.findById(songId);
    if (!song) throw AppError.notFound("Song not found");

    const likes = await musicRepository.listLikes(songId);
    return {
      songId,
      songTitle: song.title,
      songArtist: song.artist,
      likeCount: song.likeCount || 0,
      likes,
      userLiked: likes.some((like) => like.userId === currentUserId),
    };
  },

  /**
   * O(1)-per-user: reads from the denormalized users/{userId}/likedSongs
   * subcollection that toggleSongLike maintains. Previously this scanned
   * every song in the catalog and probed each one — O(catalog).
   */
  async listUserLikedSongs(userId) {
    const likedSongs = await userRepository.listLikedSongs(userId);
    return { likedSongs, count: likedSongs.length };
  },
};
