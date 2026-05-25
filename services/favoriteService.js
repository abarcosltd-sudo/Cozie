import { FieldValue } from "firebase-admin/firestore";
import { AppError } from "../utils/AppError.js";
import { favoriteRepository } from "../repositories/favoriteRepository.js";
import { musicRepository } from "../repositories/musicRepository.js";

export const favoriteService = {
  async check(userId, songId) {
    const isFavorited = await favoriteRepository.exists(userId, songId);
    return { isFavorited, songId };
  },

  async add(userId, songId, overrides = {}) {
    const song = await musicRepository.findById(songId);
    if (!song) throw AppError.notFound("Song not found");

    const created = await favoriteRepository.createIfMissing(userId, songId, {
      title: overrides.title || song.title,
      artist: overrides.artist || song.artist,
      albumArtUrl: overrides.albumArtUrl || song.albumArtUrl || null,
      fileUrl: overrides.fileUrl || song.fileUrl,
      duration: overrides.duration || song.duration,
    });

    // Only increment when we actually inserted a new favorite. This makes
    // the endpoint idempotent — clicking favorite twice can't inflate the
    // counter.
    if (created) {
      await musicRepository.update(songId, {
        favoriteCount: FieldValue.increment(1),
      });
    }

    return { isFavorited: true, alreadyFavorited: !created };
  },

  async remove(userId, songId) {
    const removed = await favoriteRepository.deleteIfPresent(userId, songId);
    if (!removed) {
      // Was already absent. Treat as success-no-op rather than an error;
      // this is what most clients expect from a "remove" verb.
      return { isFavorited: false, alreadyAbsent: true };
    }

    await musicRepository.update(songId, {
      favoriteCount: FieldValue.increment(-1),
    });

    return { isFavorited: false };
  },

  async list(userId) {
    const favorites = await favoriteRepository.list(userId);
    return { favorites, count: favorites.length };
  },
};
