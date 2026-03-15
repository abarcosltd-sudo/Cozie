// server.js
import express from "express";
import cors from "cors";
import nodemailer from 'nodemailer'; // or use your preferred email service
//import dotenv from "dotenv";
// dotenv.config();

import userRoutes from "./routes/userRoutes.js";
import musicRoutes from "./routes/musicRoutes.js";
import postRoutes from "./routes/postMusicRoutes.js";
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

// Apply CORS middleware
app.use(cors(corsOptions));


// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/users", userRoutes);
app.use("/api/music", musicRoutes);
app.use("/api/post", postMusicRoutes);

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

app.post("/api/test", (req, res) => {
  console.log("Received:", req.body);
  res.json({
    status: "OK",
    received: req.body
  });
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));




