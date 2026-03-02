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

    // 1️⃣ Check if user already exists in Firebase Auth
    let existingUser;

    try {
      existingUser = await admin.auth().getUserByEmail(email);
    } catch (error) {
      existingUser = null;
    }

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists"
      });
    }

    // 2️⃣ Create user in Firebase Authentication
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: fullname
    });

    // 3️⃣ Save extra data in Firestore
    await admin.firestore().collection("users").doc(userRecord.uid).set({
      fullname,
      username,
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 4️⃣ Generate custom token (optional)
    const token = await admin.auth().createCustomToken(userRecord.uid);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        id: userRecord.uid,
        fullname,
        username,
        email
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


