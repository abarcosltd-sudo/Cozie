const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "7d"
  });
};

// =======================
// @desc Register user
// =======================
const signupUser = async (req, res, next) => {
  try {
    const {
      fullname,
      username,
      email,
      password
    } = req.body;

    // Validate required fields
    if (!fullname || !username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided"
      });
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create new user
    const newUser = await User.create({
      fullname,
      username,
      email,
      password: hashedPassword
    });

    // Send response
    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token: generateToken(newUser.id),
      user: {
        id: newUser.id,
        fullname: newUser.fullname,
        username: newUser.username,
        email: newUser.email
      }
    });

  } catch (error) {
    next(error);
  }
};

// =======================
// @desc Login user
// =======================
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findByEmail(email);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    res.json({
      success: true,
      token: generateToken(user.id),
      user: {
        id: user.id,
        fullname: user.fullname,
        username: user.username,
        email: user.email,
        selectedGenres: user.selectedGenres
      }
    });
  } catch (error) {
    next(error);
  }
};

// =======================
// @desc Get all users
// =======================
const getUsers = async (req, res, next) => {
  try {
    const users = await User.getAll();
    res.json(users);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  signupUser,
  loginUser,
  getUsers
};

