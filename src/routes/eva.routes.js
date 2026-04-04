const express = require("express");
const { evaChat, evaHistory, evaClearMemory } = require("../controllers/eva.controller");

const router = express.Router();

router.post("/chat", evaChat);
router.get("/history", evaHistory);
router.post("/clear-memory", evaClearMemory);

module.exports = router;


