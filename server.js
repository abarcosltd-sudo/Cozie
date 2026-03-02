// server.js
import express from "express";
import cors from "cors";
// import dotenv from "dotenv";
// dotenv.config();

import userRoutes from "./routes/userRoutes.js";
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

app.get("/api/home", (req, res) => {
  res.json({
    message: "Welcome to the user server side",
    status: "success"
  });
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


