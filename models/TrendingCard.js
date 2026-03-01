const db = require("../config/firebase");

class TrendingCard {
  static collection() {
    return db.collection("trendingCards");
  }

  static async create(data) {
    const { title, artist, thumbnail } = data;

    if (!title || !artist || !thumbnail) {
      throw new Error("All fields are required");
    }

    const docRef = await this.collection().add({
      title,
      artist,
      thumbnail,
      createdAt: new Date()
    });

    return { id: docRef.id, title, artist, thumbnail };
  }

  static async getAll() {
    const snapshot = await this.collection().get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}

module.exports = TrendingCard;
