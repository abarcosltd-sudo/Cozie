const db = require("../config/firebase");

class Genre {
  static collection() {
    return db.collection("genres");
  }

  static async create(data) {
    const { name, emoji } = data;

    if (!name || !emoji) {
      throw new Error("Name and emoji are required");
    }

    const docRef = await this.collection().add({
      name,
      emoji,
      createdAt: new Date()
    });

    return { id: docRef.id, name, emoji };
  }

  static async getAll() {
    const snapshot = await this.collection().get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}

module.exports = Genre;
