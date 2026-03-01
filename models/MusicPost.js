const db = require("../config/firebase");

class MusicPost {
  static collection() {
    return db.collection("musicPosts");
  }

  static async create(data) {
    const {
      userName,
      trackTitle,
      trackArtist,
      albumIcon
    } = data;

    if (!userName || !trackTitle || !trackArtist || !albumIcon) {
      throw new Error("Missing required fields");
    }

    const docRef = await this.collection().add({
      userName,
      postTime: new Date().toISOString(),
      trackTitle,
      trackArtist,
      albumIcon,
      likes: 0,
      comments: 0,
      liked: false,
      createdAt: new Date()
    });

    return { id: docRef.id };
  }

  static async getAll() {
    const snapshot = await this.collection()
      .orderBy("createdAt", "desc")
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}

module.exports = MusicPost;
