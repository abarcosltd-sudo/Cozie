const express = require("express");
const router = express.Router();
const { getUsers, createUser } = require("../controllers/userController");

router.get("/", getUsers);
router.post("/", createUser);
router.post("/login", loginUser);


module.exports = router;
