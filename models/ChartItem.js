const db = require("../config/firebase");

class ChartItem {
  static collection() {
    return db.collection("chartItems");
  }

  static async getUserCharts(userId, genres) {
    const snapshot = await this.collection()
      .where("genreId", "in", genres)
      .orderBy("number", "asc")
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  }
}

module.exports = ChartItem;
