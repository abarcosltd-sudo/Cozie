const MusicPost = require("../models/MusicPost");

// CREATE
const createMusicPost = async (req, res, next) => {
  try {
    const newPost = await MusicPost.create({
      ...req.body,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      data: newPost
    });
  } catch (error) {
    next(error);
  }
};

// READ
const getMusicPosts = async (req, res, next) => {
  try {
    const posts = await MusicPost.getByGenres(
      req.user.selectedGenres
    );

    res.json(posts);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createMusicPost,
  getMusicPosts
};
