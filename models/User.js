const db = require("../config/firebase");

class User {
  static collection() {
    return db.collection("users");
  }

  static async create(data) {
    const {
      fullname,
      username,
      email,
      password,
      selectedGenres = []
    } = data;

    const docRef = await this.collection().add({
      fullname,
      username,
      email,
      password,
      selectedGenres,
      profile: {
        displayName: fullname,
        bio: null,
        photo: null,
        timestamp: new Date().toISOString()
      },
      createdAt: new Date()
    });

    return { id: docRef.id };
  }

  static async findById(id) {
    const doc = await this.collection().doc(id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }
}

module.exports = User;
