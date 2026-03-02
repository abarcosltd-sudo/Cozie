const express = require("express");
const router = express.Router();
const { getUsers, signupUser, getProfile, loginUser } = require("../controllers/userController");

router.get("/", getUsers);
router.post("/signup", signupUser);
router.post("/login", loginUser);
router.get("/profile", getProfile);


module.exports = router;




