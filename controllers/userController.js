import admin from "../config/firebase.js"
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
    const { fullname, username, email, password } = req.body;

    if (!fullname || !username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be provided"
      });
    }

    const normalizedEmail = email.toLowerCase();

    // 1️⃣ Check if user already exists
    const userSnapshot = await db
      .collection("users")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    if (!userSnapshot.empty) {
      return res.status(400).json({
        success: false,
        message: "User already exists"
      });
    }

    // 2️⃣ Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // 3️⃣ Create new user document
    const newUserRef = db.collection("users").doc();

    const newUser = {
      id: newUserRef.id,
      fullname,
      username,
      email: normalizedEmail,
      password: hashedPassword,
      createdAt: new Date()
    };

    await newUserRef.set(newUser);

    // 4️⃣ Generate JWT directly here
    const token = jwt.sign(
      { id: newUserRef.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        id: newUserRef.id,
        fullname,
        username,
        email: normalizedEmail
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



