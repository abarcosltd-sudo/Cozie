const db = require("../config/firebase");

class MusicPost {
  static collection() {
    return db.collection("musicPosts");
  }

  static async create(data) {
    const {
      userId,
      genreId,
      trackTitle,
      trackArtist,
      albumIcon
    } = data;

    if (!userId || !genreId) {
      throw new Error("User and Genre required");
    }

    const docRef = await this.collection().add({
      userId,
      genreId,
      trackTitle,
      trackArtist,
      albumIcon,
      likes: 0,
      comments: 0,
      createdAt: new Date()
    });

    return { id: docRef.id };
  }

  static async getByGenres(genres) {
    const snapshot = await this.collection()
      .where("genreId", "in", genres)
      .orderBy("createdAt", "desc")
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}

module.exports = MusicPost;
