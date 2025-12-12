const express = require("express");
const cors = require("cors");
// const dotenv = require("dotenv");

// dotenv.config();

// const connectDB = require("./config/db");
const userRoutes = require("./routes/userRoutes");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// connect DB
//connectDB();

// ===== CORS SETTINGS =====
const allowedOrigins = [
  "http://localhost:3000",     // React local dev
  "http://localhost:8100",     // Ionic React local dev
  "https://cozie-cs.vercel.app",  //client url
  "https://cozie-kohl.vercel.app" //backend url
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"]
};

app.use(cors(corsOptions));
// ==========================


// middleware
app.use(express.json());

// routes
app.use("/api/users", userRoutes);

app.use('/api/home', (req, res) => {
    res.send("Welcome to the user server side");
})

app.post("/api/test", (req, res) => {
  console.log("Received:", req.body);
  res.json({
    status: "OK",
    received: req.body
  });
});

// error handler
app.use(errorHandler);

// start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));





