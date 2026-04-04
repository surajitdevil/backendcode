const { addMessage, getMessages, clearMessages } = require("../utils/memoryStore");
const { callLLM } = require("../services/openrouter.service");

async function evaChat(req, res) {
  try {
    const { userId = "anonymous", message } = req.body || {};

    if (!message) {
      return res.status(400).json({ ok: false, error: "message required" });
    }

    const history = getMessages(userId);
    addMessage(userId, "user", message);

    const reply = await callLLM({ message, memory: history });

    addMessage(userId, "assistant", reply);

    res.json({ ok: true, reply });

  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

function evaHistory(req, res) {
  const userId = req.query.userId || "anonymous";
  res.json({ ok: true, items: getMessages(userId) });
}

function evaClearMemory(req, res) {
  const { userId } = req.body;
  clearMessages(userId);
  res.json({ ok: true });
}

module.exports = { evaChat, evaHistory, evaClearMemory };
