const db = require("../config/firebase");

class User {
  static collection() {
    return db.collection("users");
  }

  static async findByEmail(email) {
    const snapshot = await this.collection()
      .where("email", "==", email)
      .get();

    if (snapshot.empty) return null;

    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  static async create(data) {
    const docRef = await this.collection().add(data);
    return { id: docRef.id, ...data };
  }

  static async getAll() {
    const snapshot = await this.collection().get();
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}

module.exports = User;
