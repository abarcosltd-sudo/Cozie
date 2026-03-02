import { db } from "../config/firebase.js"
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

    // Check if user already exists
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

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create new user document
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

    // Generate JWT directly here
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

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const normalizedEmail = email.toLowerCase();

    // Find user in Firestore
    const userSnapshot = await db
      .collection("users")
      .where("email", "==", normalizedEmail)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const userDoc = userSnapshot.docs[0];
    const user = userDoc.data();

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    // Generate JWT
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user.id,
        fullname: user.fullname,
        username: user.username,
        email: user.email
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





