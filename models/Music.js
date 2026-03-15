// models/Music.js
const db = require("../config/firebase");

class Music {
  static collection() {
    return db.collection("music");
  }

  static async create(data) {
    const {
      userId,
      fileUrl,
      albumArtUrl = null,
      title,
      artist,
      featuredArtists = "",
      album,
      genre = null,
      subgenre = "",
      mood = "",
      producer = "",
      songwriter = "",
      composer = "",
      recordLabel = "",
      releaseDate = "",
      releaseYear = "",
      country = "",
      language = "",
      duration = "",
      bpm = "",
      musicalKey = "",
      isrc = "",
      explicit = "",
      copyright = "",
      publishingRights = "",
      originalWork = false,
      description = "",
      lyrics = "",
      tags = ""
    } = data;

    const docRef = await this.collection().add({
      userId,
      fileUrl,
      albumArtUrl,
      title,
      artist,
      featuredArtists,
      album,
      genre,
      subgenre,
      mood,
      producer,
      songwriter,
      composer,
      recordLabel,
      releaseDate,
      releaseYear,
      country,
      language,
      duration,
      bpm,
      musicalKey,
      isrc,
      explicit,
      copyright,
      publishingRights,
      originalWork,
      description,
      lyrics,
      tags,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    return { id: docRef.id };
  }

  /**
   * Find a music track by its ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  static async findById(id) {
    const doc = await this.collection().doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }

  /**
   * Find all music tracks for a given user.
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  static async findByUserId(userId) {
    const snapshot = await this.collection().where("userId", "==", userId).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Update a music track.
   * @param {string} id
   * @param {Object} updates - Fields to update.
   * @returns {Promise<void>}
   */
  static async update(id, updates) {
    updates.updatedAt = new Date();
    await this.collection().doc(id).update(updates);
  }

  /**
   * Delete a music track.
   * @param {string} id
   * @returns {Promise<void>}
   */
  static async delete(id) {
    await this.collection().doc(id).delete();
  }
}

module.exports = Music;
