const User = require("../models/User");

// Mock user data (replace with your database later)
const users = [
  {
    id: 1,
    email: "demo@cozie.com",
    password: "demo123",
    name: "Demo User",
    createdAt: new Date()
  }
];

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res, next) => {
  try {
    // Log that we received the request
    console.log('📥 Login request received at:', new Date().toISOString());
    
    // Get the JSON data from the request body
    const { email, password } = req.body;
    
    // Log the received data (be careful not to log passwords in production!)
    console.log('📧 Email received:', email);
    console.log('🔐 Password received:', password ? '[PROVIDED]' : '[MISSING]');
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password'
      });
    }

    // For demo purposes, check against mock user
    // In production, you would query your database
    const user = users.find(u => u.email === email && u.password === password);
    
    if (user) {
      // Successful login
      console.log('✅ Login successful for:', email);
      
      // Don't send the password back
      const { password, ...userWithoutPassword } = user;
      
      res.status(200).json({
        success: true,
        message: 'Login successful',
        user: userWithoutPassword,
        token: 'sample-jwt-token-' + Date.now() // Generate a real JWT in production
      });
    } else {
      // Failed login
      console.log('❌ Login failed for:', email);
      
      res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
  } catch (error) {
    console.error('🔥 Login error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};




// @desc Get all users
exports.getUsers = async (req, res, next) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    next(err);
  }
};

// @desc Create a new user
exports.createUser = async (req, res, next) => {
  try {
    const { name, email } = req.body;

    const user = await User.create({ name, email });
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  loginUser  // Make sure loginUser is included here
};


