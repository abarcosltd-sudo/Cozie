const db = require("../config/firebase");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// Generate JWT
const generateToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};

// ============================
// @desc    Create user
// @route   POST /api/users
// ============================
const createUser = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    // Check if user exists
    const userSnapshot = await db
      .collection("users")
      .where("email", "==", email)
      .get();

    if (!userSnapshot.empty) {
      return res.status(400).json({
        success: false,
        message: "User already exists"
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUserRef = await db.collection("users").add({
      name,
      email,
      password: hashedPassword,
      createdAt: new Date()
    });

    res.status(201).json({
      success: true,
      message: "User created successfully",
      user: {
        id: newUserRef.id,
        name,
        email
      },
      token: generateToken(newUserRef.id)
    });

  } catch (error) {
    next(error);
  }
};

// ============================
// @desc    Login user
// @route   POST /api/users/login
// ============================
const loginUser = async (req, res, next) => {
  try {
    console.log("📥 Login request received");

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password"
      });
    }

    const snapshot = await db
      .collection("users")
      .where("email", "==", email)
      .get();

    if (snapshot.empty) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const userDoc = snapshot.docs[0];
    const user = userDoc.data();

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    res.status(200).json({
      success: true,
      message: "Login successful",
      user: {
        id: userDoc.id,
        name: user.name,
        email: user.email
      },
      token: generateToken(userDoc.id)
    });

  } catch (error) {
    next(error);
  }
};

// ============================
// @desc Get all users
// @route GET /api/users
// ============================
const getUsers = async (req, res, next) => {
  try {
    const snapshot = await db.collection("users").get();

    const users = snapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      email: doc.data().email,
      createdAt: doc.data().createdAt
    }));

    res.json(users);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createUser,
  loginUser,
  getUsers
};
