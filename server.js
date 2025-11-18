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

// middleware
app.use(cors());
app.use(express.json());

// routes
app.use("/api/users", userRoutes);
app.use('/', (req, res) => {
    res.send("welcome to the server");
})

app.use('/home', (req, res) => {
    res.send("Welcome to the user server side");
})

// error handler
app.use(errorHandler);

// start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
