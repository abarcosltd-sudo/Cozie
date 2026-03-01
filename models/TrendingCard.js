const db = require("../config/firebase");

class TrendingCard {
  static collection() {
    return db.collection("trendingCards");
  }

  static async getByGenres(genres) {
    const snapshot = await this.collection()
      .where("genreId", "in", genres)
      .orderBy("rank", "asc")
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}

module.exports = TrendingCard;
