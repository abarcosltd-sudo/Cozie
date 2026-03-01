const Genre = require("../models/Genre");

const createGenre = async (req, res, next) => {
  try {
    const genre = await Genre.create(req.body);
    res.status(201).json(genre);
  } catch (error) {
    next(error);
  }
};

const getGenres = async (req, res, next) => {
  try {
    const genres = await Genre.getAll();
    res.json(genres);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createGenre,
  getGenres
};
