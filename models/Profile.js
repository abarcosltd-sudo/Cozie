const db = require("../config/firebase");

class Profile {
  static collection() {
    return db.collection("profiles");
  }

  static async create(data) {
    const {
      displayName,
      username,
      bio = null,
      photo = null
    } = data;

    if (!displayName || !username) {
      throw new Error("Display name and username required");
    }

    const docRef = await this.collection().add({
      displayName,
      username,
      bio,
      photo,
      timestamp: new Date().toISOString()
    });

    return { id: docRef.id };
  }
}

module.exports = Profile;
