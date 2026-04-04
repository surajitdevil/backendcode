const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();

const memory = [];

function addMessage(userId, role, content, channel = "text") {
  memory.push({
    userId: userId || "anonymous",
    role,
    content,
    channel,
    createdAt: new Date().toISOString(),
  });
  if (memory.length > 500) memory.shift();
}

function getMessages(userId) {
  return memory.filter((m) => m.userId === (userId || "anonymous")).slice(-20);
}

function clearMessages(userId) {
  const target = userId || "anonymous";
  for (let i = memory.length - 1; i >= 0; i -= 1) {
    if (memory[i].userId === target) memory.splice(i, 1);
  }
}

async function callLLM({ message, history = [] }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const baseUrl = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
  const model = process.env.OPENROUTER_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    return "OpenRouter key is missing. Add OPENROUTER_API_KEY in Railway variables.";
  }

  const messages = [
    {
      role: "system",
      content:
        "You are EVA, a warm, intelligent, professional executive AI assistant for Orchegentra AI. Reply clearly in English, naturally and helpfully. Greet politely when appropriate.",
    },
    ...history.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    {
      role: "user",
      content: message,
    },
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "OpenRouter request failed");
  }

  return data?.choices?.[0]?.message?.content || "No response returned.";
}

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);
app.use(
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    max: Number(process.env.RATE_LIMIT_MAX || 60),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "Orchegentra backend is running",
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/agents/list", (_req, res) => {
  res.json({
    ok: true,
    agents: [
      { id: "eva", name: "EVA", role: "Executive AI Assistant" },
      { id: "guardian", name: "Guardian Agent", role: "System Monitor" },
      { id: "qa", name: "QA Agent", role: "Bug and quality monitoring" },
      { id: "security", name: "Security Agent", role: "Security monitoring" },
      { id: "cto", name: "CTO Agent", role: "Architecture and tech direction" },
      { id: "builder", name: "Builder Agent", role: "Implementation and delivery" },
    ],
  });
});

app.get("/api/guardian/overview", (_req, res) => {
  res.json({
    ok: true,
    guardian: {
      systemStatus: "active",
      alerts: 0,
      backend: "online",
      summary: "Guardian Agent is watching core system health.",
    },
  });
});

app.post("/api/eva/chat", async (req, res) => {
  try {
    const { userId = "anonymous", channel = "text", message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ ok: false, error: "message is required" });
    }

    const history = getMessages(userId);
    addMessage(userId, "user", message, channel);

    const reply = await callLLM({ message, history });

    addMessage(userId, "assistant", reply, channel);

    return res.json({
      ok: true,
      reply,
      meta: {
        userId,
        channel,
        memoryCount: getMessages(userId).length,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      ok: false,
      error: error.message || "EVA failed",
    });
  }
});

app.get("/api/eva/history", (req, res) => {
  const userId = req.query.userId || "anonymous";
  return res.json({
    ok: true,
    items: getMessages(userId),
  });
});

app.post("/api/eva/clear-memory", (req, res) => {
  const { userId = "anonymous" } = req.body || {};
  clearMessages(userId);
  return res.json({
    ok: true,
    message: "Memory cleared",
  });
});

app.get("/api/voice/status", (_req, res) => {
  res.json({
    ok: true,
    status: "voice_phase_started",
    note: "Real-time voice provider wiring comes next.",
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: "internal_server_error",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
