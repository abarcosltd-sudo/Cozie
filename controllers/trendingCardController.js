const TrendingCard = require("../models/TrendingCard");

const createTrendingCard = async (req, res, next) => {
  try {
    const card = await TrendingCard.create(req.body);
    res.status(201).json(card);
  } catch (error) {
    next(error);
  }
};

const getTrendingCards = async (req, res, next) => {
  try {
    const cards = await TrendingCard.getByGenres(
      req.user.selectedGenres
    );

    res.json(cards);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTrendingCard,
  getTrendingCards
};
