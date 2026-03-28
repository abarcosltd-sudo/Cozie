// server.js
import express from "express";
import cors from "cors";
import nodemailer from 'nodemailer'; // or use your preferred email service
import userRoutes from "./routes/userRoutes.js";
import musicRoutes from "./routes/musicRoutes.js";
import postRoutes from "./routes/postRoutes.js";
import messageRoutes from "./routes/messageRoutes.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();

// ===== CORS SETTINGS =====
const allowedOrigins = [
  "http://localhost:3000",       // React local dev
  "http://localhost:8100",       // Ionic React local dev
  "https://cozie-cs.vercel.app", // client url
  "https://cozie-kohl.vercel.app" // backend url
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || origin.includes("vercel.app") || origin.includes("localhost") || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
};

// // CORS configuration
// const corsOptions = {
//   origin: [
//     'https://cozie-cs.vercel.app',           
//     'http://localhost:3000',                  
//     'http://localhost:5173',                  
//     'https://cozie-kohl.vercel.app',          
//   ],
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization'],
//   credentials: true,
//   optionsSuccessStatus: 200,
// };

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://cozie-cs.vercel.app');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Apply CORS middleware
app.use(cors(corsOptions));
// Handle preflight requests explicitly
app.options('/*path', cors(corsOptions));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/users", userRoutes);
app.use("/api/music", musicRoutes);
app.use("/api/posts", postRoutes);
app.use("/api/messages", messageRoutes);

app.get("/api/home", (req, res) => {
  res.json({
    message: "Welcome to the user server side",
    status: "success"
  });
});

app.get('/api/test-email', async (req, res) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'fredottache@gmail.com', // send to yourself
      subject: 'Test',
      text: 'If you see this, email works!',
    });
    res.send('Email sent');
  } catch (err) {
    console.error(err);
    res.status(500).send('Email failed: ' + err.message);
  }
});

app.get('/api/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'CORS is working!',
    timestamp: new Date().toISOString()
  });
});

app.post("/api/test", (req, res) => {
  console.log("Received:", req.body);
  res.json({
    status: "OK",
    received: req.body
  });
});

// Catch-all for 404 - use named wildcard
app.use('/*path', (req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
