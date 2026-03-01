const db = require("../config/firebase");

class GridPost {
  static collection() {
    return db.collection("gridPosts");
  }

  static async create(data) {
    const { gradient } = data;

    if (!gradient) {
      throw new Error("Gradient is required");
    }

    const docRef = await this.collection().add({
      gradient,
      createdAt: new Date()
    });

    return { id: docRef.id, gradient };
  }
}

module.exports = GridPost;
